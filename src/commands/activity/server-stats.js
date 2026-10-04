import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { formatTaipeiActivity, taipeiDateString } from '../../features/activity/domain.js';

export const data = new SlashCommandBuilder()
  .setName('伺服器統計')
  .setDescription('查看伺服器近 30 天的會員與成長統計')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

function signed(value) {
  return value > 0 ? `+${value.toLocaleString('zh-TW')}` : value.toLocaleString('zh-TW');
}

function formatRate(value) {
  if (value === null) return '無法計算';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export async function execute(interaction, { serverStatsService }) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: '此指令只能在伺服器中使用。', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '只有伺服器管理員可以使用此指令。', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();
  const result = await serverStatsService.getStats(interaction.guild, interaction.client.user);
  const notes = [];
  if (!result.complete && result.trackingStartedAt) {
    notes.push(`離開資料自 ${formatTaipeiActivity(result.trackingStartedAt)} 起統計`);
  } else if (!result.complete) {
    notes.push('成員資料仍在初始化');
  }
  if (result.skippedChannels > 0) {
    notes.push(`${result.skippedChannels} 個文字頻道未納入活躍判定`);
  }

  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('伺服器統計')
    .setDescription(`${interaction.guild.name}｜近 30 天`)
    .addFields(
      { name: '目前會員', value: `**${result.currentMembers.toLocaleString('zh-TW')}** 人`, inline: true },
      { name: '新增成員', value: `**+${result.newMembers.toLocaleString('zh-TW')}** 人`, inline: true },
      { name: '離開成員', value: `**${signed(-result.leftMembers)}** 人`, inline: true },
      { name: '活躍會員', value: `**${result.activeMembers.toLocaleString('zh-TW')}** 人`, inline: true },
      { name: '沉睡會員', value: `**${result.sleepingMembers.toLocaleString('zh-TW')}** 人`, inline: true },
      {
        name: '淨成長',
        value: `**${signed(result.netGrowth)}** 人（${formatRate(result.growthRate)}）`,
        inline: true,
      },
    )
    .setFooter({
      text: `${taipeiDateString(result.startAt).replaceAll('-', '/')}～${taipeiDateString(result.endAt).replaceAll('-', '/')}（台灣時間）${notes.length ? `｜${notes.join('｜')}` : ''}`,
    });

  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}
