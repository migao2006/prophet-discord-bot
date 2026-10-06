import { errorCode } from '../../../core/config.js';
import { levelUpText } from '../progress/domain.js';

const DIGITS_PATTERN = /^\d+$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

export class NumberChainService {
  constructor(repository, logger, roleService = null) {
    this.repository = repository;
    this.logger = logger;
    this.roleService = roleService;
  }

  async handleMessage(message) {
    if (!message.guildId || !message.channelId || !message.author || message.author.bot) {
      return { status: 'ignored' };
    }

    const content = message.content.trim();
    if (!DIGITS_PATTERN.test(content)) return { status: 'ignored' };

    const result = await this.repository.tryAdvance(
      message.guildId,
      message.channelId,
      message.author.id,
      message.id,
      POSITIVE_INTEGER_PATTERN.test(content) ? BigInt(content) : null,
    );
    if (result.status === 'disabled') return result;

    const emoji = result.status === 'correct' ? '✅' : '❌';
    try {
      await message.react(emoji);
    } catch (error) {
      this.logger.error('number_chain_reaction_failed', {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        errorCode: errorCode(error),
      });
    }
    if (result.status === 'incorrect' || result.progress?.leveledUp) {
      const response = result.status === 'incorrect'
        ? '不能自己接自己啦～🐾 接龍已重新開始，下一位請輸入 **1**！'
        : levelUpText(message.author.id, result.progress.profile.level);
      const finalContent = result.status === 'incorrect' && result.reason !== 'same_user'
        ? '哎呀，數字接錯了啦～💥 接龍已重新開始，下一位請輸入 **1**！🌱'
        : response;
      try {
        await message.reply({
          content: finalContent,
          allowedMentions: { parse: [], repliedUser: false },
        });
      } catch (error) {
        this.logger.error('number_chain_hint_failed', {
          guildId: message.guildId,
          channelId: message.channelId,
          messageId: message.id,
          errorCode: errorCode(error),
        });
      }
    }
    if (result.progress?.titleChanged && this.roleService) {
      await this.roleService.syncUserAcrossGuilds(message.client, message.author.id);
    }
    return result;
  }
}
