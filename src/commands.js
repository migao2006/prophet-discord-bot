import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { countTodayMessages } from './activity.js';

export const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('確認機器人是否在線'),
  new SlashCommandBuilder().setName('hello').setDescription('讓機器人向你打招呼'),
  new SlashCommandBuilder()
    .setName('今日發言')
    .setDescription('查詢成員今天的發言次數')
    .addStringOption((option) => option
      .setName('使用者')
      .setDescription('搜尋整個伺服器的成員')
      .setAutocomplete(true)
      .setRequired(true)),
];

function memberChoice(member) {
  const username = member.user.username;
  const label = member.displayName === username
    ? username
    : `${member.displayName} (${username})`;
  return { name: label.slice(0, 100), value: member.id };
}

async function handleMemberAutocomplete(interaction) {
  if (interaction.commandName !== '今日發言' || !interaction.inGuild() || !interaction.guild) {
    await interaction.respond([]);
    return;
  }

  const query = interaction.options.getFocused().trim();
  let members;
  try {
    members = query
      ? await interaction.guild.members.search({ query, limit: 25 })
      : await interaction.guild.members.list({ limit: 25 });
  } catch {
    await interaction.respond([]);
    return;
  }
  const choices = [...members.values()]
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-Hant'))
    .map(memberChoice);
  await interaction.respond(choices);
}

export async function handleInteraction(interaction) {
  if (interaction.isAutocomplete?.()) {
    await handleMemberAutocomplete(interaction);
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  switch (interaction.commandName) {
    case 'ping':
      await interaction.reply({ content: 'Pong！機器人已上線。', flags: MessageFlags.Ephemeral });
      break;
    case 'hello':
      await interaction.reply({
        content: `你好，${interaction.user.username}！👋`,
        allowedMentions: { parse: [] },
      });
      break;
    case '今日發言': {
      if (!interaction.inGuild() || !interaction.guild) {
        await interaction.reply({ content: '此指令只能在伺服器中使用。', flags: MessageFlags.Ephemeral });
        break;
      }
      const targetId = interaction.options.getString('使用者', true);
      if (!/^\d{17,20}$/.test(targetId)) {
        await interaction.reply({ content: '請從成員搜尋結果中選擇一位使用者。', flags: MessageFlags.Ephemeral });
        break;
      }
      await interaction.guild.members.fetch(targetId);
      await interaction.deferReply();
      const result = await countTodayMessages(
        interaction.guild,
        interaction.client.user,
        targetId,
      );
      if (result.scannedChannels === 0) {
        await interaction.editReply({
          content: '無法統計：機器人目前讀不到任何一般文字或公告頻道，請確認 View Channel 與 Read Message History 權限。',
        });
        break;
      }
      const skipped = result.skippedChannels > 0
        ? `；另有 ${result.skippedChannels} 個頻道因權限不足或讀取失敗而略過`
        : '';
      await interaction.editReply({
        content: `<@${targetId}> 今天（台灣時間）在 ${result.scannedChannels} 個頻道共發言 **${result.count}** 次${skipped}。`,
        allowedMentions: { parse: [] },
      });
      break;
    }
    default:
      await interaction.reply({ content: '此指令目前不支援。', flags: MessageFlags.Ephemeral });
  }
}
