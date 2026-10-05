import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';

const REQUIRED_BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

const TEXT_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

export async function executeRandomImage(interaction, { funImageService }, config) {
  if (!interaction.inGuild() || !interaction.guild || !interaction.channel
    || !TEXT_CHANNEL_TYPES.includes(interaction.channel.type)) {
    await interaction.reply({
      content: '此指令只能在伺服器文字頻道中使用。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.appPermissions
    && !interaction.appPermissions.has(REQUIRED_BOT_PERMISSIONS)) {
    await interaction.reply({
      content: '還差一點點～請先給我「檢視頻道」、「傳送訊息」與「嵌入連結」權限。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const cooldown = funImageService.acquire(
    config.kind,
    interaction.guildId,
    interaction.user.id,
  );
  if (!cooldown.allowed) {
    await interaction.reply({
      content: `慢慢來～再等 ${cooldown.retryAfterSeconds} 秒就能${config.action}囉！${config.emoji}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await interaction.deferReply();
  } catch (error) {
    funImageService.release(
      config.kind,
      interaction.guildId,
      interaction.user.id,
      cooldown.leaseId,
    );
    throw error;
  }

  try {
    const imageUrl = await funImageService.getImage(config.kind);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setImage(imageUrl)],
      allowedMentions: { parse: [] },
    });
  } catch {
    funImageService.release(
      config.kind,
      interaction.guildId,
      interaction.user.id,
      cooldown.leaseId,
    );
    await interaction.editReply({
      content: config.failureMessage,
      embeds: [],
      allowedMentions: { parse: [] },
    });
  }
}
