import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { countTodayMessages } from './activity.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('今日發言')
    .setDescription('查詢成員今天的發言次數')
    .addUserOption((option) => option
      .setName('使用者')
      .setDescription('要查詢的成員')
      .setRequired(true)),
];

export async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;
  switch (interaction.commandName) {
    case '今日發言': {
      if (!interaction.inGuild() || !interaction.guild) {
        await interaction.reply({ content: '此指令只能在伺服器中使用。', flags: MessageFlags.Ephemeral });
        break;
      }
      const targetId = interaction.options.getUser('使用者', true).id;
      await interaction.deferReply();
      const result = await countTodayMessages(
        interaction.guild,
        interaction.client.user,
        targetId,
      );
      if (result.scannedChannels === 0) {
        await interaction.editReply({
          content: '無法統計：機器人目前讀不到任何一般文字或公告頻道，請確認 View Channel 與 Read Message History 權限。',
        });
        break;
      }
      const skipped = result.skippedChannels > 0
        ? `；另有 ${result.skippedChannels} 個頻道因權限不足或讀取失敗而略過`
        : '';
      await interaction.editReply({
        content: `<@${targetId}> 今天（台灣時間）在 ${result.scannedChannels} 個頻道共發言 **${result.count}** 次${skipped}。`,
        allowedMentions: { parse: [] },
      });
      break;
    }
    default:
      await interaction.reply({ content: '此指令目前不支援。', flags: MessageFlags.Ephemeral });
  }
}
