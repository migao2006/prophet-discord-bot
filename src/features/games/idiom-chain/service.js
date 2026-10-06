import { errorCode } from '../../../core/config.js';

const IDIOM_PATTERN = /^\p{Script=Han}{4}$/u;

function incorrectMessage(result, idiom) {
  if (result.reason === 'not_found') {
    return `詞庫裡找不到「**${idiom}**」耶～📖 再想一個真正的四字成語吧！`;
  }
  if (result.reason === 'same_user') {
    return '先讓別人接一棒吧～🐾 同一位玩家不能連續接龍！';
  }
  if (result.reason === 'already_used') {
    return `「**${idiom}**」這輪已經用過啦～🔁 換一個成語試試看！`;
  }
  return `要用「**${result.expected}**」開頭喔～🌸 再接一次看看！`;
}

export class IdiomChainService {
  constructor(repository, logger, progressService = null) {
    this.repository = repository;
    this.logger = logger;
    this.progressService = progressService;
  }

  async handleMessage(message) {
    if (!message.guildId || !message.channelId || !message.author || message.author.bot) {
      return { status: 'ignored' };
    }
    const idiom = message.content.trim();
    if (!IDIOM_PATTERN.test(idiom)) return { status: 'ignored' };

    const result = await this.repository.tryAdvance(
      message.guildId,
      message.channelId,
      message.author.id,
      message.id,
      idiom,
    );
    if (result.status === 'disabled') return result;

    const emoji = ['correct', 'round_complete'].includes(result.status) ? '✅' : '❌';
    try {
      await message.react(emoji);
    } catch (error) {
      this.logger.error('idiom_chain_reaction_failed', {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        errorCode: errorCode(error),
      });
    }

    let reply;
    if (result.status === 'round_complete') {
      const nextCharacter = Array.from(result.openingIdiom).at(-1);
      reply = `🎊 「**${idiom}**」把這輪漂亮收尾啦！\n新的起始成語是「**${result.openingIdiom}**」，請從「**${nextCharacter}**」開始～`;
    } else if (result.status === 'incorrect') {
      reply = incorrectMessage(result, idiom);
    }
    if (reply) {
      try {
        await message.reply({
          content: reply,
          allowedMentions: { parse: [], repliedUser: false },
        });
      } catch (error) {
        this.logger.error('idiom_chain_reply_failed', {
          guildId: message.guildId,
          channelId: message.channelId,
          messageId: message.id,
          errorCode: errorCode(error),
        });
      }
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
