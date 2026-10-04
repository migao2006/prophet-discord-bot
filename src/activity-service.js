import { countTodayMessages, startOfTaipeiDay, taipeiDateString } from './activity.js';
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
}
