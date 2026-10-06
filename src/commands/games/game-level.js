import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';

function progressBar(progress) {
  const filled = Math.min(10, Math.max(0, Math.floor(progress * 10)));
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}`;
}

export const data = new SlashCommandBuilder()
  .setName('遊戲等級')
  .setDescription('查看自己或其他成員的遊戲等級')
  .addUserOption((option) => option
    .setName('使用者')
    .setDescription('要查詢的成員，未指定時查詢自己'));

export async function execute(interaction, { gameProgressRepository }) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: '此指令只能在伺服器中使用。', flags: MessageFlags.Ephemeral });
    return;
  }
  const user = interaction.options.getUser('使用者') ?? interaction.user;
  if (user.bot) {
    await interaction.reply({ content: '機器人不會累積遊戲經驗唷～🤖', flags: MessageFlags.Ephemeral });
    return;
  }
  const profile = await gameProgressRepository.getProfile(user.id);
  const nextText = profile.nextFloor === null
    ? `已達最高等級｜總經驗 ${profile.totalXp.toLocaleString('zh-TW')} XP`
    : `${profile.totalXp - profile.currentFloor} / ${profile.nextFloor - profile.currentFloor} XP｜總經驗 ${profile.totalXp.toLocaleString('zh-TW')}`;
  const embed = new EmbedBuilder()
    .setColor(0xF3A6C8)
    .setAuthor({ name: user.displayName, iconURL: user.displayAvatarURL() })
    .setTitle(`🌱 Lv.${profile.level}｜${profile.title}`)
    .setDescription(`${progressBar(profile.progress)}\n${nextText}`)
    .addFields(
      { name: '🎲 數字接龍', value: `${profile.numberChainSuccesses} 次`, inline: true },
      { name: '📚 成語接龍', value: `${profile.idiomChainSuccesses} 次`, inline: true },
      { name: '📖 開卷有益', value: `${profile.openBookCorrect} 題`, inline: true },
      { name: '🔐 1A2B', value: `${profile.bullsAndCowsWins} 局`, inline: true },
      { name: '🐺 狼人殺', value: `${profile.werewolfWins} 勝`, inline: true },
    );
  await interaction.reply({ embeds: [embed] });
}
