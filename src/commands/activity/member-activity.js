import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { formatTaipeiActivity, formatVoiceDuration, taipeiDateString } from '../../activity.js';

export const data = new SlashCommandBuilder()
  .setName('成員活躍查詢')
  .setDescription('查詢成員近 30 天的文字與語音活躍狀況')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((option) => option
    .setName('使用者')
    .setDescription('要查詢的成員')
    .setRequired(true));

function formatDate(timestamp) {
  return taipeiDateString(timestamp).replaceAll('-', '/');
}

export async function execute(interaction, { activityService }) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: '此指令只能在伺服器中使用。', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '只有伺服器管理員可以使用此指令。', flags: MessageFlags.Ephemeral });
    return;
  }

  const target = interaction.options.getUser('使用者', true);
  await interaction.deferReply();
  const result = await activityService.getMemberActivity(
    interaction.guild,
    interaction.client.user,
    target.id,
  );
  if (result.scannedChannels === 0) {
    await interaction.editReply({
      content: '無法統計：機器人目前讀不到任何一般文字或公告頻道，請確認 View Channel 與 Read Message History 權限。',
    });
    return;
  }

  const channels = result.topChannels.length > 0
    ? result.topChannels.map((channel, index) => (
      `${index + 1}. <#${channel.channelId}> — **${channel.messageCount.toLocaleString('zh-TW')}** 則`
    )).join('\n')
    : '無資料';
  const notes = [];
  if (!result.messageBackfillComplete) notes.push('歷史發言同步中，結果可能偏低');
  if (result.voiceTrackingStartedAt) {
    notes.push(`語音自 ${formatTaipeiActivity(new Date(result.voiceTrackingStartedAt).getTime())} 起統計`);
  } else {
    notes.push('語音統計尚未開始');
  }
  if (result.skippedChannels > 0) notes.push(`${result.skippedChannels} 個文字頻道因權限不足而未納入`);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('成員活躍查詢')
    .setDescription(`<@${target.id}>｜近 30 天`)
    .addFields(
      { name: '發言', value: `**${result.messageCount.toLocaleString('zh-TW')}** 則`, inline: true },
      { name: '活躍天數', value: `**${result.activeDays.toLocaleString('zh-TW')}** 天`, inline: true },
      { name: '語音', value: `**${formatVoiceDuration(result.voiceSeconds)}**`, inline: true },
      { name: '最後活動', value: formatTaipeiActivity(result.lastActivityAt), inline: false },
      { name: '最常出現', value: channels, inline: false },
    )
    .setFooter({
      text: `${formatDate(result.startAt)}～${formatDate(result.endAt)}（台灣時間）｜${notes.join('｜')}`,
    });

  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}
