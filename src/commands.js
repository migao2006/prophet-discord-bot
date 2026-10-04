import { MessageFlags, SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('確認機器人是否在線'),
  new SlashCommandBuilder().setName('hello').setDescription('讓機器人向你打招呼'),
];

export async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;
  switch (interaction.commandName) {
    case 'ping':
      await interaction.reply({ content: 'Pong！機器人已上線。', flags: MessageFlags.Ephemeral });
      break;
    case 'hello':
      await interaction.reply({
        content: `你好，${interaction.user.username}！👋`,
        allowedMentions: { parse: [] },
      });
      break;
    default:
      await interaction.reply({ content: '此指令目前不支援。', flags: MessageFlags.Ephemeral });
  }
}
