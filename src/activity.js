import { ChannelType, PermissionFlagsBits } from 'discord.js';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const SCAN_CONCURRENCY = 2;

export function taipeiDateString(timestamp = Date.now()) {
  const taipei = new Date(timestamp + TAIPEI_OFFSET_MS);
  return taipei.toISOString().slice(0, 10);
}

export function startOfTaipeiDay(now = Date.now()) {
  const taipei = new Date(now + TAIPEI_OFFSET_MS);
  return Date.UTC(taipei.getUTCFullYear(), taipei.getUTCMonth(), taipei.getUTCDate()) - TAIPEI_OFFSET_MS;
}

export function memberActivityWindow(now = Date.now()) {
  const endAt = now;
  const startAt = startOfTaipeiDay(now) - 29 * DAY_MS;
  return { startAt, endAt, startDate: taipeiDateString(startAt) };
}

export function summarizeVoiceSessions(sessions, startAt, endAt) {
  let seconds = 0;
  let lastActivityAt = null;
  const activeDates = new Set();

  for (const session of sessions) {
    const joinedAt = Math.max(new Date(session.joined_at).getTime(), startAt);
    const rawLeftAt = session.left_at ? new Date(session.left_at).getTime() : endAt;
    const leftAt = Math.min(rawLeftAt, endAt);
    if (leftAt <= joinedAt) continue;
    seconds += Math.floor((leftAt - joinedAt) / 1_000);
    const activityAt = session.left_at ? leftAt : endAt;
    lastActivityAt = Math.max(lastActivityAt ?? 0, activityAt);

    for (let day = startOfTaipeiDay(joinedAt); day < leftAt; day += DAY_MS) {
      activeDates.add(taipeiDateString(day));
    }
  }

  return { seconds, activeDates: [...activeDates], lastActivityAt };
}

export function formatVoiceDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours} 小時 ${remainder} 分` : `${minutes} 分`;
}

export function formatTaipeiActivity(timestamp, now = Date.now()) {
  if (!timestamp) return '無紀錄';
  const date = new Date(timestamp + TAIPEI_OFFSET_MS);
  const dateString = date.toISOString().slice(0, 10);
  const time = date.toISOString().slice(11, 16);
  const today = taipeiDateString(now);
  const yesterday = taipeiDateString(startOfTaipeiDay(now) - DAY_MS);
  if (dateString === today) return `今天 ${time}`;
  if (dateString === yesterday) return `昨天 ${time}`;
  return `${dateString.replaceAll('-', '/')} ${time}`;
}

export async function countChannelMessages(channel, userId, startTimestamp, now = Date.now()) {
  let before;
  let count = 0;

  while (true) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    const messages = [...page.values()];
    if (messages.length === 0) break;

    for (const message of messages) {
      if (
        message.createdTimestamp >= startTimestamp
        && message.createdTimestamp <= now
        && message.author.id === userId
      ) {
        count += 1;
      }
    }

    const oldest = messages.at(-1);
    if (messages.length < 100 || oldest.createdTimestamp < startTimestamp) break;
    before = oldest.id;
  }

  return count;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

export async function countTodayMessages(guild, botUser, userId, now = Date.now()) {
  const channels = await guild.channels.fetch();
  const candidates = [...channels.values()].filter((channel) => (
    channel
    && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)
  ));

  const readable = [];
  let skippedChannels = 0;
  for (const channel of candidates) {
    const permissions = channel.permissionsFor(botUser);
    if (permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
      readable.push(channel);
    } else {
      skippedChannels += 1;
    }
  }

  const startTimestamp = startOfTaipeiDay(now);
  const results = await mapWithConcurrency(
    readable,
    SCAN_CONCURRENCY,
    (channel) => countChannelMessages(channel, userId, startTimestamp, now),
  );

  let count = 0;
  let scannedChannels = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      count += result.value;
      scannedChannels += 1;
    } else {
      skippedChannels += 1;
    }
  }

  return { count, scannedChannels, skippedChannels };
}

export async function readableActivityChannels(guild, botUser) {
  const channels = await guild.channels.fetch();
  const candidates = [...channels.values()].filter((channel) => (
    channel
    && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)
  ));
  const readable = candidates.filter((channel) => channel.permissionsFor(botUser)?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
  ]));
  return { readable, skippedChannels: candidates.length - readable.length };
}
