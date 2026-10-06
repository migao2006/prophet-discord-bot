import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';

const MEDALS = new Map([[1, '🥇'], [2, '🥈'], [3, '🥉']]);

export const data = new SlashCommandBuilder()
  .setName('遊戲排行')
  .setDescription('查看目前伺服器的遊戲經驗排行榜');

export async function execute(interaction, { gameProgressRepository }) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: '此指令只能在伺服器中使用。', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply();
  const members = await interaction.guild.members.fetch();
  const userIds = [...members.values()].filter((member) => !member.user.bot).map((member) => member.id);
  const ranking = await gameProgressRepository.getLeaderboard(userIds);
  if (!ranking.length) {
    await interaction.editReply('目前還沒有人取得遊戲經驗，快去玩第一局吧～🌱');
    return;
  }
  const lines = ranking.map((profile) => {
    const marker = MEDALS.get(profile.rank) ?? `**${profile.rank}.**`;
    return `${marker} <@${profile.userId}>　Lv.${profile.level}「${profile.title}」　**${profile.totalXp.toLocaleString('zh-TW')} XP**`;
  });
  const embed = new EmbedBuilder()
    .setColor(0xFFD166)
    .setTitle('🏆 遊戲經驗排行榜')
    .setDescription(lines.join('\n'))
    .setFooter({ text: '顯示本伺服器成員的全域遊戲經驗' });
  await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
}
