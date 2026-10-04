import { errorCode } from './config.js';

const DIGITS_PATTERN = /^\d+$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

export class NumberChainService {
  constructor(repository, logger) {
    this.repository = repository;
    this.logger = logger;
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
    if (result.status === 'incorrect') {
      const content = result.reason === 'same_user'
        ? '不能自己接自己啦～🐾 接龍已重新開始，下一位請輸入 **1**！'
        : '哎呀，數字接錯了啦～💥 接龍已重新開始，下一位請輸入 **1**！🌱';
      try {
        await message.reply({
          content,
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
    return result;
  }
}
