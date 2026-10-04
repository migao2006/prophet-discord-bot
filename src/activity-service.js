import {
  countTodayMessages,
  memberActivityWindow,
  startOfTaipeiDay,
  summarizeVoiceSessions,
  taipeiDateString,
} from './activity.js';
import { errorCode } from './config.js';

export class ActivityService {
  constructor(repository, tracker, logger) {
    this.repository = repository;
    this.tracker = tracker;
    this.logger = logger;
  }

  async countToday(guild, botUser, userId, now = Date.now()) {
    try {
      const { readable, skippedChannels } = await this.tracker.catchUpGuild(guild, botUser);
      const trackingStartedAt = await this.repository.getTrackingStartedAt(guild.id);
      if (trackingStartedAt && trackingStartedAt.getTime() <= startOfTaipeiDay(now)) {
        const count = await this.repository.countMessages(
          guild.id,
          userId,
          taipeiDateString(now),
          readable.map((channel) => channel.id),
        );
        return { count, scannedChannels: readable.length, skippedChannels, source: 'database' };
      }
    } catch (error) {
      this.logger.error('activity_database_fallback', {
        guildId: guild.id,
        errorCode: errorCode(error),
      });
    }

    return { ...await countTodayMessages(guild, botUser, userId, now), source: 'history' };
  }

  async getMemberActivity(guild, botUser, userId, now = Date.now()) {
    const { readable, skippedChannels } = await this.tracker.catchUpGuild(guild, botUser);
    const channelIds = readable.map((channel) => channel.id);
    const window = memberActivityWindow(now);
    const [data, backfill, voiceTrackingStartedAt] = await Promise.all([
      this.repository.getMemberActivity(
        guild.id,
        userId,
        window.startDate,
        new Date(window.startAt),
        new Date(window.endAt),
        channelIds,
      ),
      this.repository.getBackfillStatus(guild.id, channelIds),
      this.repository.getVoiceTrackingStartedAt(guild.id),
    ]);
    const voice = summarizeVoiceSessions(data.voiceSessions, window.startAt, window.endAt);
    const activeDates = new Set([...data.messageDates, ...voice.activeDates]);
    const lastMessageAt = data.lastMessageAt ? new Date(data.lastMessageAt).getTime() : null;

    return {
      messageCount: data.messageCount,
      activeDays: activeDates.size,
      voiceSeconds: voice.seconds,
      lastActivityAt: Math.max(lastMessageAt ?? 0, voice.lastActivityAt ?? 0) || null,
      topChannels: data.topChannels.map((row) => ({
        channelId: row.channel_id,
        messageCount: row.message_count,
      })),
      scannedChannels: readable.length,
      skippedChannels,
      messageBackfillComplete: backfill.incomplete === 0 && backfill.total === channelIds.length,
      voiceTrackingStartedAt,
      ...window,
    };
  }
}
