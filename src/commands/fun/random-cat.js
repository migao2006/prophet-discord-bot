import { SlashCommandBuilder } from 'discord.js';
import { executeRandomImage } from '../../features/fun-images/command.js';

export const data = new SlashCommandBuilder()
  .setName('隨機貓咪')
  .setDescription('隨機看看一隻貓咪');

export async function execute(interaction, context) {
  await executeRandomImage(interaction, context, {
    kind: 'cat',
    action: '找貓咪',
    emoji: '🐾',
    failureMessage: '貓咪暫時躲起來了～請稍後再試 🐾',
  });
}
