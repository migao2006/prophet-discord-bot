import { SlashCommandBuilder } from 'discord.js';
import { executeRandomImage } from '../../features/fun-images/command.js';

export const data = new SlashCommandBuilder()
  .setName('隨機料理')
  .setDescription('隨機看看一道料理');

export async function execute(interaction, context) {
  await executeRandomImage(interaction, context, {
    kind: 'meal',
    action: '找料理',
    emoji: '🍽️',
    failureMessage: '料理圖片暫時躲起來了～請稍後再試 🍽️',
  });
}
