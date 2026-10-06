import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

const REQUIRED_BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
];

export const data = new SlashCommandBuilder()
  .setName('升等通知')
  .setDescription('設定伺服器的遊戲升等通知頻道')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) => option
    .setName('狀態')
    .setDescription('選擇要開啟或關閉升等通知')
    .setRequired(true)
    .addChoices(
      { name: '開啟', value: '開啟' },
      { name: '關閉', value: '關閉' },
    ));

export async function execute(interaction, { gameProgressRepository }) {
  if (!interaction.inGuild() || !interaction.guild || !interaction.channel) {
    await interaction.reply({
      content: '此指令只能在伺服器中使用。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: '只有伺服器管理員可以使用此指令。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(interaction.channel.type)) {
    await interaction.reply({
      content: '升等通知只能設定在一般文字頻道或公告頻道。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const enabled = interaction.options.getString('狀態', true) === '開啟';
  if (enabled && interaction.appPermissions
    && !interaction.appPermissions.has(REQUIRED_BOT_PERMISSIONS)) {
    await interaction.reply({
      content: '請先給我這個頻道的「檢視頻道」與「傳送訊息」權限唷～🔧',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await gameProgressRepository.setLevelNotification(
    interaction.guildId,
    enabled,
    enabled ? interaction.channelId : null,
  );
  const content = enabled
    ? `升等通知已開啟～🌟 之後會在 <#${interaction.channelId}> 公開 @ 升級的玩家。`
    : '升等通知已關閉～🌙 之後升級時不會發送公開通知。';
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}
