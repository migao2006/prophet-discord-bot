import { errorCode } from '../../../core/config.js';

const DIGITS_PATTERN = /^\d+$/;
const VALID_GUESS_PATTERN = /^\d{4}$/;

export class BullsAndCowsService {
  constructor(repository, logger, progressService = null) {
    this.repository = repository;
    this.logger = logger;
    this.progressService = progressService;
  }

  async handleMessage(message) {
    if (!message.guildId || !message.channelId || !message.author || message.author.bot) {
      return { status: 'ignored' };
    }

    const content = message.content.trim();
    if (!DIGITS_PATTERN.test(content)) return { status: 'ignored' };
    const validGuess = VALID_GUESS_PATTERN.test(content)
      && new Set(content).size === content.length;
    const result = await this.repository.submitGuess(
      message.guildId,
      message.channelId,
      message.author.id,
      message.id,
      validGuess ? content : null,
    );
    if (result.status === 'disabled') return result;

    let reply;
    if (result.status === 'invalid') {
      reply = '這組密碼不合規則唷～🔐 請輸入 **4 個不重複的數字**，第一位也可以是 0！';
    } else if (result.status === 'won') {
      reply = `🎉 猜中啦！**${result.answer} → 4A0B**｜第 **${result.attempt}** 次猜測\n新的一局已經開始，快來破解下一組密碼吧～✨`;
    } else {
      reply = `**${content} → ${result.a}A${result.b}B** 🎯｜第 **${result.attempt}** 次猜測`;
    }

    try {
      await message.reply({
        content: reply,
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (error) {
      this.logger.error('bulls_and_cows_reply_failed', {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        errorCode: errorCode(error),
      });
    }
    if (this.progressService) {
      await this.progressService.handleAward(
        message.client,
        message.guildId,
        message.author.id,
        result.progress,
      );
    }
    return result;
  }
}
