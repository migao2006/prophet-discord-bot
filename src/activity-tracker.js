import { ChannelType } from 'discord.js';
import { errorCode } from './config.js';
import { readableActivityChannels, taipeiDateString } from './activity.js';

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
    this.channelQueues = new Map();
    this.initializedGuilds = new Set();
  }

  enqueue(channelId, task) {
    const previous = this.channelQueues.get(channelId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    this.channelQueues.set(channelId, current);
    current.finally(() => {
      if (this.channelQueues.get(channelId) === current) this.channelQueues.delete(channelId);
    }).catch(() => {});
    return current;
  }

  async ensureGuild(guildId, startedAt = new Date()) {
    if (this.initializedGuilds.has(guildId)) return;
    await this.repository.ensureGuild(guildId, startedAt);
    this.initializedGuilds.add(guildId);
  }

  async initializeClient(client) {
    const cutoff = new Date(Date.now() - 35 * 24 * 60 * 60 * 1_000);
    const pruned = await this.repository.pruneProcessedMessages(cutoff);
    this.logger.info('activity_retention_pruned', { messages: pruned });
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
