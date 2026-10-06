import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder().setName('狼人殺')
  .setDescription('建立 6～10 人文字狼人殺，機器人自動主持')
  .addStringOption((option) => option.setName('操作').setDescription('選擇房間操作')
    .setRequired(true).addChoices(
      { name: '開啟', value: '開啟' }, { name: '開始', value: '開始' }, { name: '關閉', value: '關閉' },
    ));

export async function execute(interaction, { werewolfService }) {
  if (!interaction.inGuild() || !interaction.channel
    || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(interaction.channel.type)
    || interaction.user?.bot) {
    await interaction.reply({ content: '請在伺服器的一般文字或公告頻道遊玩唷～', flags: MessageFlags.Ephemeral });
    return;
  }
  const operation = interaction.options.getString('操作', true);
  if (operation !== '關閉' && !interaction.appPermissions?.has([
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks,
  ])) {
    await interaction.reply({
      content: '請先給我「檢視頻道」、「傳送訊息」、「讀取訊息歷史記錄」及「嵌入連結」權限～🔧',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await werewolfService.command(interaction, operation);
}
