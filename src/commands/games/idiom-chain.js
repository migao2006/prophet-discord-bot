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

const CONFLICT_MESSAGES = {
  number_chain: '這個頻道正在玩數字接龍唷～🎲 請先用 `/數字接龍 狀態:關閉`，再開啟成語接龍。',
  bulls_and_cows: '這個頻道正在破解 1A2B 唷～🔐 請先用 `/幾a幾b 狀態:關閉`，再開啟成語接龍。',
  open_book_quiz: '這個頻道正在玩開卷有益唷～📖 請先用 `/開卷有益 狀態:關閉`，再開啟成語接龍。',
};

export const data = new SlashCommandBuilder()
  .setName('成語接龍')
  .setDescription('在目前頻道開啟或關閉成語接龍')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) => option
    .setName('狀態')
    .setDescription('選擇要開啟或關閉遊戲')
    .setRequired(true)
    .addChoices(
      { name: '開啟', value: '開啟' },
      { name: '關閉', value: '關閉' },
    ));

export async function execute(interaction, { idiomChainRepository }) {
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
      content: '成語接龍只能在一般文字頻道或公告頻道中設定。',
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

  const result = await idiomChainRepository.setEnabled(
    interaction.guildId,
    interaction.channelId,
    enabled,
  );
  if (result.conflict) {
    await interaction.reply({
      content: CONFLICT_MESSAGES[result.conflict] ?? '這個頻道已經有其他遊戲在進行中囉～🎮',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (enabled && result.changed) {
    const nextCharacter = Array.from(result.currentIdiom).at(-1);
    await interaction.reply({
      content: `成語接龍開張啦～🎉\n起始成語是「**${result.currentIdiom}**」，請從「**${nextCharacter}**」開始接！`,
    });
    return;
  }

  let content;
  if (enabled) {
    const nextCharacter = Array.from(result.currentIdiom).at(-1);
    content = `遊戲已經在進行中囉～📚 目前是「**${result.currentIdiom}**」，請從「**${nextCharacter}**」開始。`;
  } else if (result.changed) {
    content = '成語接龍先休息一下啦～🌙 已關閉這個頻道的遊戲。';
  } else {
    content = '這個頻道目前沒有開啟成語接龍唷～🍃';
  }
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}
