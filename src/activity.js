import { ChannelType, PermissionFlagsBits } from 'discord.js';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const SCAN_CONCURRENCY = 2;

export function startOfTaipeiDay(now = Date.now()) {
  const taipei = new Date(now + TAIPEI_OFFSET_MS);
  return Date.UTC(taipei.getUTCFullYear(), taipei.getUTCMonth(), taipei.getUTCDate()) - TAIPEI_OFFSET_MS;
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
