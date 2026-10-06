import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('身分組稱號')
  .setDescription('開啟或關閉遊戲等級身分組')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) => option
    .setName('狀態')
    .setDescription('選擇要開啟或關閉稱號身分組')
    .setRequired(true)
    .addChoices(
      { name: '開啟', value: '開啟' },
      { name: '關閉', value: '關閉' },
    ));

export async function execute(interaction, { gameProgressRepository, gameLevelRoleService }) {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: '此指令只能在伺服器中使用。', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '只有伺服器管理員可以使用此指令。', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.appPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({
      content: '請先給我「管理身分組」權限，才能建立並更新等級稱號唷～🔧',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const enabled = interaction.options.getString('狀態', true) === '開啟';
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const current = await gameProgressRepository.getRoleSetting(interaction.guildId);
  if (enabled) {
    await gameProgressRepository.ensureGuild(interaction.guildId);
    await gameLevelRoleService.ensureRoles(interaction.guild);
    await gameProgressRepository.setRoleEnabled(interaction.guildId, true);
    const result = await gameLevelRoleService.syncGuild(interaction.guild);
    await interaction.editReply(
      `身分組稱號已${current.enabled ? '重新同步' : '開啟'}～✨ 已更新 **${result.synced}** 位成員${result.failed ? `，另有 ${result.failed} 位同步失敗` : ''}。`,
    );
    return;
  }
  if (!current.enabled) {
    await interaction.editReply('身分組稱號目前已經是關閉狀態囉～🍃');
    return;
  }
  await gameProgressRepository.setRoleEnabled(interaction.guildId, false);
  const result = await gameLevelRoleService.removeGuildRoles(interaction.guild);
  await interaction.editReply(
    `身分組稱號已關閉，已從 **${result.removed}** 位成員身上移除稱號${result.failed ? `，另有 ${result.failed} 位移除失敗` : ''}。`,
  );
}
