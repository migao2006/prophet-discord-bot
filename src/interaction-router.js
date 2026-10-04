import { MessageFlags } from 'discord.js';
import { errorCode } from './config.js';

async function sendFailure(interaction) {
  const response = { content: '處理失敗，請稍後再試。', flags: MessageFlags.Ephemeral };
  if (interaction.deferred) {
    await interaction.editReply({ content: response.content }).catch(() => {});
  } else if (interaction.replied) {
    await interaction.followUp(response).catch(() => {});
  } else if (interaction.isRepliable()) {
    await interaction.reply(response).catch(() => {});
  }
}

export function createInteractionHandler({ commands, context, logger }) {
  return async function handleInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return;
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
