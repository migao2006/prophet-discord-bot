import { errorCode } from '../../../core/config.js';
import { levelUpText } from './domain.js';

export class GameProgressService {
  constructor(repository, roleService, logger) {
    this.repository = repository;
    this.roleService = roleService;
    this.logger = logger;
  }

  async notifyLevelUp(client, guildId, userId, progress) {
    if (!progress?.leveledUp) return { sent: false };
    const setting = await this.repository.getLevelNotificationSetting(guildId);
    if (!setting.enabled || !setting.channelId) return { sent: false };
    try {
      const channel = await client.channels.fetch(setting.channelId);
      if (!channel?.isTextBased() || channel.guildId !== guildId || !channel.send) {
        return { sent: false };
      }
      await channel.send({
        content: levelUpText(userId, progress.profile.level),
        allowedMentions: { parse: [], users: [userId] },
      });
      return { sent: true };
    } catch (error) {
      this.logger.error('game_level_notification_failed', {
        guildId,
        channelId: setting.channelId,
        userId,
        errorCode: errorCode(error),
      });
      return { sent: false };
    }
  }

  async handleAward(client, guildId, userId, progress) {
    if (!progress?.awarded) return;
    if (progress.titleChanged) {
      try {
        await this.roleService.syncUserAcrossGuilds(client, userId);
      } catch (error) {
        this.logger.error('game_level_role_sync_failed', {
          guildId,
          userId,
          errorCode: errorCode(error),
        });
      }
    }
    await this.notifyLevelUp(client, guildId, userId, progress);
  }
}
