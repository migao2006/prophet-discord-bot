import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { errorCode } from '../../../core/config.js';

export const OPEN_BOOK_BUTTON_PREFIX = 'openbook';
const LETTERS = ['A', 'B', 'C', 'D'];
const SUBJECT_NAMES = { 英語: '英文' };

function buttonId(questionId, answerIndex) {
  return `${OPEN_BOOK_BUTTON_PREFIX}:${questionId}:${answerIndex}`;
}

function disabledRows(rows) {
  return rows.map((row) => ActionRowBuilder.from(row).setComponents(
    row.components.map((component) => ButtonBuilder.from(component).setDisabled(true)),
  ));
}

function hasCurrentButtons(message, questionId) {
  const expected = `${OPEN_BOOK_BUTTON_PREFIX}:${questionId}:`;
  return message?.components?.some((row) => row.components?.some((component) => {
    const id = component.customId ?? component.data?.custom_id;
    return typeof id === 'string' && id.startsWith(expected);
  }));
}

export function createQuestionPayload(question, content) {
  const subject = SUBJECT_NAMES[question.subject] ?? question.subject;
  const choices = question.options
    .map((option, index) => `${LETTERS[index]}．${option}`)
    .join('\n\n');
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📖 開卷有益・${subject}`)
    .setDescription(`${question.question}\n\n${choices}`)
    .setFooter({ text: '選一個答案吧～每人每題只能回答一次' });
  const buttons = new ActionRowBuilder().addComponents(
    ...LETTERS.map((letter, index) => new ButtonBuilder()
      .setCustomId(buttonId(question.id, index))
      .setLabel(letter)
      .setStyle(ButtonStyle.Primary)),
  );
  return {
    ...(content ? { content } : {}),
    embeds: [embed],
    components: [buttons],
    allowedMentions: { parse: [] },
  };
}

export class OpenBookQuizService {
  constructor(repository, logger) {
    this.repository = repository;
    this.logger = logger;
  }

  async publishInteractionQuestion(interaction, question, content) {
    await interaction.reply(createQuestionPayload(question, content));
    const message = await interaction.fetchReply();
    await this.repository.setMessageId(
      interaction.guildId,
      interaction.channelId,
      question.id,
      message.id,
    );
  }

  async disableMessage(channel, messageId) {
    if (!messageId || !channel?.messages?.fetch) return;
    try {
      const message = await channel.messages.fetch(messageId);
      if (message?.components?.length) {
        await message.edit({ components: disabledRows(message.components) });
      }
    } catch (error) {
      this.logger.error('open_book_quiz_disable_message_failed', {
        channelId: channel?.id,
        messageId,
        errorCode: errorCode(error),
      });
    }
  }

  async handleButton(interaction) {
    const [prefix, rawQuestionId, rawAnswerIndex] = interaction.customId.split(':');
    const questionId = Number(rawQuestionId);
    const answerIndex = Number(rawAnswerIndex);
    if (prefix !== OPEN_BOOK_BUTTON_PREFIX
      || !Number.isSafeInteger(questionId)
      || !Number.isInteger(answerIndex)
      || answerIndex < 0
      || answerIndex > 3
      || !interaction.guildId
      || !interaction.channelId
      || interaction.user?.bot) {
      return false;
    }

    const result = await this.repository.submitAnswer(
      interaction.guildId,
      interaction.channelId,
      questionId,
      interaction.user.id,
      answerIndex,
    );
    if (result.status === 'incorrect') {
      await interaction.reply({
        content: '差一點點～這個答案不對唷！再幫其他人加油吧 🌱',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    if (result.status === 'already_answered') {
      await interaction.reply({
        content: '這題你已經回答過啦～把機會留給其他人吧 🐾',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    if (result.status === 'disabled' || result.status === 'stale') {
      await interaction.reply({
        content: '這題已經結束囉～請看看最新一題！✨',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await interaction.deferUpdate();
    if (interaction.message?.components?.length) {
      await interaction.message.edit({ components: disabledRows(interaction.message.components) });
    }
    const answer = `${LETTERS[result.question.answerIndex]}．${result.question.options[result.question.answerIndex]}`;
    const message = await interaction.channel.send(createQuestionPayload(
      result.nextQuestion,
      `🎉 <@${interaction.user.id}> 答對啦！答案是 **${answer}**\n下一題來囉～`,
    ));
    await this.repository.setMessageId(
      interaction.guildId,
      interaction.channelId,
      result.nextQuestion.id,
      message.id,
    );
    return true;
  }

  async initializeClient(client) {
    const states = await this.repository.listEnabled();
    for (const state of states) {
      try {
        const channel = await client.channels.fetch(state.channelId);
        if (!channel?.isTextBased() || !channel.messages?.fetch || !channel.send) continue;
        let message;
        if (state.messageId) {
          message = await channel.messages.fetch(state.messageId).catch(() => null);
        }
        if (hasCurrentButtons(message, state.question.id)) continue;
        if (message?.components?.length) {
          await message.edit({ components: disabledRows(message.components) }).catch(() => {});
        }
        const restored = await channel.send(createQuestionPayload(
          state.question,
          '我回來啦～📚 繼續回答這一題吧！',
        ));
        await this.repository.setMessageId(
          state.guildId,
          state.channelId,
          state.question.id,
          restored.id,
        );
      } catch (error) {
        this.logger.error('open_book_quiz_restore_failed', {
          guildId: state.guildId,
          channelId: state.channelId,
          errorCode: errorCode(error),
        });
      }
    }
  }
}
