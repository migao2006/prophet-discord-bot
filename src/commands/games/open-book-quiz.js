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
  PermissionFlagsBits.EmbedLinks,
];

const CONFLICT_MESSAGES = {
  number_chain: '這個頻道正在玩數字接龍唷～🎲 請先用 `/數字接龍 狀態:關閉`。',
  bulls_and_cows: '這個頻道正在破解 1A2B 唷～🔐 請先用 `/幾a幾b 狀態:關閉`。',
  idiom_chain: '這個頻道正在玩成語接龍唷～📚 請先用 `/成語接龍 狀態:關閉`。',
};

export const data = new SlashCommandBuilder()
  .setName('開卷有益')
  .setDescription('在目前頻道開啟或關閉四選一問答')
  .addStringOption((option) => option
    .setName('狀態')
    .setDescription('選擇要開啟或關閉遊戲')
    .setRequired(true)
    .addChoices(
      { name: '開啟', value: '開啟' },
      { name: '關閉', value: '關閉' },
    ))
  .addStringOption((option) => option
    .setName('科目')
    .setDescription('開啟時選擇題目科目，預設為全部')
    .setRequired(false)
    .addChoices(
      { name: '全部', value: '全部' },
      { name: '國文', value: '國文' },
      { name: '英文', value: '英語' },
      { name: '數學', value: '數學' },
      { name: '社會', value: '社會' },
      { name: '自然', value: '自然' },
    ));

export async function execute(interaction, { openBookQuizRepository, openBookQuizService }) {
  if (!interaction.inGuild() || !interaction.guild || !interaction.channel) {
    await interaction.reply({ content: '此指令只能在伺服器中使用。', flags: MessageFlags.Ephemeral });
    return;
  }
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(interaction.channel.type)) {
    await interaction.reply({
      content: '開卷有益只能在一般文字頻道或公告頻道中使用。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const enabled = interaction.options.getString('狀態', true) === '開啟';
  const subject = interaction.options.getString('科目') ?? '全部';
  if (enabled && interaction.appPermissions
    && !interaction.appPermissions.has(REQUIRED_BOT_PERMISSIONS)) {
    await interaction.reply({
      content: '差一點點就能開玩啦～🔧 請先給我「檢視頻道」、「傳送訊息」、「讀取訊息歷史記錄」與「嵌入連結」權限。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  const result = await openBookQuizRepository.setEnabled(
    interaction.guildId,
    interaction.channelId,
    enabled,
    { userId: interaction.user.id, isAdmin, subject },
  );
  if (result.conflict) {
    await interaction.reply({
      content: CONFLICT_MESSAGES[result.conflict] ?? '這個頻道已經有其他遊戲在進行中囉～🎮',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (result.forbidden) {
    await interaction.reply({
      content: '只有開啟遊戲的人或管理員可以關閉它唷～🔒',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (enabled && result.changed) {
    await openBookQuizService.publishInteractionQuestion(
      interaction,
      result.question,
      '開卷有益開始啦～選出你認為正確的答案吧！✨',
    );
    return;
  }
  if (enabled) {
    await interaction.reply({
      content: '這個頻道已經有一道題目在等大家回答囉～📖',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (result.changed) {
    await openBookQuizService.disableMessage(interaction.channel, result.messageId);
    await interaction.reply({ content: '開卷有益先休息一下啦～🌙 已關閉這個頻道的問答。' });
    return;
  }
  await interaction.reply({
    content: '這個頻道目前沒有開啟開卷有益唷～🍃',
    flags: MessageFlags.Ephemeral,
  });
}
