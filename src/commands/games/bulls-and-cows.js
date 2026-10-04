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
];

export const data = new SlashCommandBuilder()
  .setName('幾a幾b')
  .setDescription('在目前頻道開啟或關閉多人 1A2B')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) => option
    .setName('狀態')
    .setDescription('選擇要開啟或關閉遊戲')
    .setRequired(true)
    .addChoices(
      { name: '開啟', value: '開啟' },
      { name: '關閉', value: '關閉' },
    ));

export async function execute(interaction, { bullsAndCowsRepository }) {
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
      content: '1A2B 只能在一般文字頻道或公告頻道中設定。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const enabled = interaction.options.getString('狀態', true) === '開啟';
  if (enabled && interaction.appPermissions
    && !interaction.appPermissions.has(REQUIRED_BOT_PERMISSIONS)) {
    await interaction.reply({
      content: '就差一點點啦～🔧 請先給我「檢視頻道」、「傳送訊息」與「讀取訊息歷史記錄」權限。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await bullsAndCowsRepository.setEnabled(
    interaction.guildId,
    interaction.channelId,
    enabled,
  );
  let content;
  if (result.conflict === 'number_chain') {
    content = '這個頻道正在玩數字接龍唷～🎲 請先用 `/數字接龍 狀態:關閉`，再開啟 1A2B。';
  } else if (enabled && result.changed) {
    content = '密碼已經藏好啦～🔐 請直接輸入 **4 個不重複的數字**，一起來破解 1A2B 吧！';
  } else if (enabled) {
    content = `這局還在進行中唷～🕵️ 大家已經猜了 **${result.guessCount}** 次，繼續加油！`;
  } else if (result.changed) {
    content = '1A2B 先收攤休息啦～🌙 這個頻道的遊戲已關閉。';
  } else {
    content = '這個頻道目前沒有開啟 1A2B 唷～🍃';
  }
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}
