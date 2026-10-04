import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

const REQUIRED_BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AddReactions,
];

export const data = new SlashCommandBuilder()
  .setName('數字接龍')
  .setDescription('在目前頻道開啟或關閉數字接龍')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) => option
    .setName('狀態')
    .setDescription('選擇要開啟或關閉遊戲')
    .setRequired(true)
    .addChoices(
      { name: '開啟', value: '開啟' },
      { name: '關閉', value: '關閉' },
    ));

export async function execute(interaction, { numberChainRepository }) {
  if (!interaction.inGuild() || !interaction.guild || !interaction.channel) {
    await interaction.reply({ content: '此指令只能在伺服器中使用。', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '只有伺服器管理員可以使用此指令。', flags: MessageFlags.Ephemeral });
    return;
  }
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(interaction.channel.type)) {
    await interaction.reply({
      content: '數字接龍只能在一般文字頻道或公告頻道中設定。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const enabled = interaction.options.getString('狀態', true) === '開啟';
  if (enabled && interaction.appPermissions
    && !interaction.appPermissions.has(REQUIRED_BOT_PERMISSIONS)) {
    await interaction.reply({
      content: '差一點點就能開玩啦～🔧 請先給我「檢視頻道」、「傳送訊息」、「讀取訊息歷史記錄」與「新增反應」權限。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await numberChainRepository.setEnabled(
    interaction.guildId,
    interaction.channelId,
    enabled,
  );
  let content;
  if (enabled && result.changed) content = '數字接龍開張啦～🎉 請從 **1** 開始，一起把數字接高高吧！';
  else if (enabled) content = `遊戲已經在進行中囉～🎮 下一個數字是 **${BigInt(result.currentNumber) + 1n}**。`;
  else if (result.changed) content = '數字接龍先休息一下啦～🌙 已關閉這個頻道的遊戲。';
  else content = '這個頻道目前沒有開啟數字接龍唷～🍃';

  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}
