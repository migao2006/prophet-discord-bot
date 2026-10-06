import { MessageFlags } from 'discord.js';
import { errorCode } from '../core/config.js';

async function sendFailure(interaction) {
  const response = { content: '處理失敗，請稍後再試。', flags: MessageFlags.Ephemeral };
  if (interaction.deferred) {
    if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
      await interaction.followUp(response).catch(() => {});
    } else {
      await interaction.editReply({ content: response.content }).catch(() => {});
    }
  } else if (interaction.replied) {
    await interaction.followUp(response).catch(() => {});
  } else if (interaction.isRepliable()) {
    await interaction.reply(response).catch(() => {});
  }
}

export function createInteractionHandler({ commands, context, logger }) {
  return async function handleInteraction(interaction) {
    if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
      const startedAt = Date.now();
      try {
        const isWerewolf = interaction.customId?.startsWith('ww:');
        const handled = isWerewolf
          ? await context.werewolfService?.handleComponent(interaction)
          : interaction.isButton?.() ? await context.openBookQuizService?.handleButton(interaction) : false;
        if (handled) {
          logger.info('button_completed', {
            component: isWerewolf ? 'werewolf' : 'open_book_quiz',
            guildId: interaction.guildId,
            durationMs: Date.now() - startedAt,
          });
        }
      } catch (error) {
        logger.error('button_failed', {
          component: interaction.customId?.startsWith('ww:') ? 'werewolf' : 'open_book_quiz',
          guildId: interaction.guildId,
          durationMs: Date.now() - startedAt,
          errorCode: errorCode(error),
        });
        await sendFailure(interaction);
      }
      return;
    }
    if (!interaction.isChatInputCommand?.()) return;
    const startedAt = Date.now();
    const command = commands.get(interaction.commandName);
    if (!command) {
      await interaction.reply({ content: '此指令目前不支援。', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      await command.execute(interaction, context);
      logger.info('command_completed', {
        command: interaction.commandName,
        guildId: interaction.guildId,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      logger.error('command_failed', {
        command: interaction.commandName,
        guildId: interaction.guildId,
        durationMs: Date.now() - startedAt,
        errorCode: errorCode(error),
      });
      await sendFailure(interaction);
    }
  };
}
