import { ChannelType } from 'discord.js';
import { errorCode } from '../../core/config.js';
import { KeyedTaskQueue } from '../../core/keyed-task-queue.js';
import {
  readableActivityChannels,
  startOfTaipeiDay,
  taipeiDateString,
} from './domain.js';

const DISCORD_EPOCH = 1_420_070_400_000n;

function snowflakeTimestamp(id) {
  if (!id) return 0;
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

function snowflakeFromTimestamp(timestamp) {
  return String((BigInt(timestamp) - DISCORD_EPOCH) << 22n);
}

export class ActivityTracker {
  constructor(repository, logger) {
    this.repository = repository;
    this.logger = logger;
    this.queue = new KeyedTaskQueue();
    this.initializedGuilds = new Set();
  }

  enqueue(channelId, task) {
    return this.queue.enqueue(channelId, task);
  }

  async ensureGuild(guildId, startedAt = new Date()) {
    if (this.initializedGuilds.has(guildId)) return;
    await this.repository.ensureGuild(guildId, startedAt);
    this.initializedGuilds.add(guildId);
  }

  async initializeClient(client) {
    const cutoff = new Date(Date.now() - 35 * 24 * 60 * 60 * 1_000);
    const cutoffDate = taipeiDateString(cutoff.getTime());
    const [messages, dailyCounts, voiceSessions] = await Promise.all([
      this.repository.pruneProcessedMessages(cutoff),
      this.repository.pruneDailyMessageCounts(cutoffDate),
      this.repository.pruneVoiceSessions(cutoff),
    ]);
    this.logger.info('activity_retention_pruned', { messages, dailyCounts, voiceSessions });
    for (const guild of client.guilds.cache.values()) {
      try {
        await this.catchUpGuild(guild, client.user);
      } catch (error) {
        this.logger.error('activity_initialization_failed', {
          guildId: guild.id,
          errorCode: errorCode(error),
        });
      }
    }
  }

  async backfillClient(client, now = Date.now()) {
    const cutoff = new Date(startOfTaipeiDay(now) - 29 * 24 * 60 * 60 * 1_000);
    for (const guild of client.guilds.cache.values()) {
      try {
        const processed = await this.backfillGuild(guild, client.user, cutoff);
        this.logger.info('activity_backfill_completed', { guildId: guild.id, messages: processed });
      } catch (error) {
        this.logger.error('activity_backfill_failed', {
          guildId: guild.id,
          errorCode: errorCode(error),
        });
      }
    }
  }

  async backfillRecentGuild(guild, botUser, now = Date.now()) {
    const cutoff = new Date(startOfTaipeiDay(now) - 29 * 24 * 60 * 60 * 1_000);
    return this.backfillGuild(guild, botUser, cutoff);
  }

  async backfillGuild(guild, botUser, cutoff) {
    const { readable } = await this.catchUpGuild(guild, botUser);
    let nextIndex = 0;
    const worker = async () => {
      let processed = 0;
      while (nextIndex < readable.length) {
        const channel = readable[nextIndex];
        nextIndex += 1;
        processed += await this.backfillChannel(guild.id, channel, cutoff);
      }
      return processed;
    };
    const results = await Promise.all(Array.from({ length: Math.min(2, readable.length) }, worker));
    return results.reduce((sum, value) => sum + value, 0);
  }

  async backfillChannel(guildId, channel, cutoff) {
    await this.repository.prepareChannelBackfill(guildId, channel.id, cutoff);
    let state = await this.repository.getChannelBackfill(guildId, channel.id);
    if (!state || state.history_completed_at) return 0;
    const target = new Date(state.history_cutoff_at).getTime();
    let before = state.history_before_id;
    let processed = 0;

    while (true) {
      const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      const messages = [...page.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      if (messages.length === 0) {
        await this.repository.updateChannelBackfill(guildId, channel.id, before, true);
        break;
      }
      for (const message of messages) {
        if (message.createdTimestamp >= target) {
          await this.recordMessage(message);
          processed += 1;
        }
      }
      const oldest = messages.at(-1);
      before = oldest.id;
      const completed = messages.length < 100 || oldest.createdTimestamp < target;
      await this.repository.updateChannelBackfill(guildId, channel.id, before, completed);
      if (completed) break;
      state = await this.repository.getChannelBackfill(guildId, channel.id);
      if (state?.history_completed_at) break;
    }
    return processed;
  }

  async resetAndInitializeGuild(guild, botUser) {
    await this.repository.resetGuildTracking(guild.id, new Date());
    this.initializedGuilds.add(guild.id);
    return this.catchUpGuild(guild, botUser);
  }

  async catchUpGuild(guild, botUser) {
    await this.ensureGuild(guild.id);
    const { readable, skippedChannels } = await readableActivityChannels(guild, botUser);
    for (const channel of readable) {
      await this.enqueue(channel.id, () => this.catchUpChannel(guild.id, channel));
    }
    return { readable, skippedChannels };
  }

  async catchUpChannel(guildId, channel) {
    const cursor = await this.repository.getCursor(guildId, channel.id);
    if (!cursor) {
      const now = Date.now();
      await this.repository.updateCursor(
        guildId,
        channel.id,
        channel.lastMessageId ?? snowflakeFromTimestamp(now),
        channel.lastMessageId ? snowflakeTimestamp(channel.lastMessageId) : now,
      );
      return 0;
    }

    let after = cursor.last_message_id;
    let processed = 0;
    while (after) {
      const page = await channel.messages.fetch({ limit: 100, after });
      const messages = [...page.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      if (messages.length === 0) break;
      for (const message of messages) {
        await this.recordMessage(message);
        after = message.id;
        processed += 1;
      }
      if (messages.length < 100) break;
    }
    return processed;
  }

  async recordMessage(message) {
    if (!message.guildId || !message.author) return false;
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(message.channel?.type)) {
      return false;
    }
    await this.ensureGuild(message.guildId, new Date(message.createdTimestamp));
    return this.repository.recordMessage({
      messageId: message.id,
      guildId: message.guildId,
      channelId: message.channelId,
      userId: message.author.id,
      localDate: taipeiDateString(message.createdTimestamp),
      createdAt: new Date(message.createdTimestamp),
    });
  }

  async handleMessageCreate(message) {
    if (!message.guildId) return;
    await this.enqueue(message.channelId, () => this.recordMessage(message));
  }

  async handleMessageDelete(message) {
    if (!message.guildId) return;
    await this.enqueue(message.channelId, () => this.repository.deleteMessage(message.id));
  }

  async handleMessageDeleteBulk(messages) {
    const first = messages.first();
    if (!first?.guildId) return;
    await this.enqueue(first.channelId, async () => {
      for (const message of messages.values()) {
        await this.repository.deleteMessage(message.id);
      }
    });
  }
}
