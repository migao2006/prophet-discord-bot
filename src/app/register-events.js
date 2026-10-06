import { Events } from 'discord.js';
import { errorCode } from '../core/config.js';

function observe(promise, logger, event, fields = {}) {
  Promise.resolve(promise).catch((error) => {
    logger.error(event, { ...fields, errorCode: errorCode(error) });
  });
}

export function registerBotEvents({
  client,
  interactionHandler,
  activityTracker,
  voiceTracker,
  memberTracker,
  numberChainService,
  bullsAndCowsService,
  idiomChainService,
  openBookQuizService,
  gameLevelRoleService,
  logger,
}) {
  client.once(Events.ClientReady, (readyClient) => {
    observe((async () => {
      await activityTracker.initializeClient(readyClient);
      await voiceTracker.initializeClient(readyClient);
      await memberTracker.initializeClient(readyClient);
      await openBookQuizService.initializeClient(readyClient);
      logger.info('bot_ready', {
        userTag: readyClient.user.tag,
        guilds: readyClient.guilds.cache.size,
      });
      observe(
        activityTracker.backfillClient(readyClient),
        logger,
        'activity_backfill_failed',
      );
    })(), logger, 'bot_initialization_failed');
  });

  client.on(Events.Error, (error) => {
    logger.error('discord_error', { errorCode: errorCode(error) });
  });
  client.on(Events.InteractionCreate, interactionHandler);

  client.on(Events.GuildCreate, (guild) => {
    observe((async () => {
      await activityTracker.resetAndInitializeGuild(guild, client.user);
      await voiceTracker.initializeGuild(guild);
      await memberTracker.initializeGuild(guild);
      await activityTracker.backfillRecentGuild(guild, client.user);
    })(), logger, 'guild_initialization_failed', { guildId: guild.id });
  });

  client.on(Events.GuildMemberAdd, (member) => {
    observe(
      memberTracker.handleMemberAdd(member),
      logger,
      'member_join_tracking_failed',
      { guildId: member.guild.id, userId: member.id },
    );
    observe(
      gameLevelRoleService.handleMemberAdd(member),
      logger,
      'game_level_role_join_sync_failed',
      { guildId: member.guild.id, userId: member.id },
    );
  });
  client.on(Events.GuildMemberRemove, (member) => {
    observe(
      memberTracker.handleMemberRemove(member),
      logger,
      'member_leave_tracking_failed',
      { guildId: member.guild.id, userId: member.id },
    );
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    observe(
      voiceTracker.handleVoiceStateUpdate(oldState, newState),
      logger,
      'voice_tracking_failed',
      {
        guildId: newState.guild?.id ?? oldState.guild?.id,
        userId: newState.id ?? oldState.id,
      },
    );
  });

  client.on(Events.MessageCreate, (message) => {
    const fields = { guildId: message.guildId, channelId: message.channelId };
    observe(activityTracker.handleMessageCreate(message), logger, 'message_tracking_failed', fields);
    observe(numberChainService.handleMessage(message), logger, 'number_chain_failed', fields);
    observe(bullsAndCowsService.handleMessage(message), logger, 'bulls_and_cows_failed', fields);
    observe(idiomChainService.handleMessage(message), logger, 'idiom_chain_failed', fields);
  });
  client.on(Events.MessageDelete, (message) => {
    observe(
      activityTracker.handleMessageDelete(message),
      logger,
      'message_delete_tracking_failed',
      { guildId: message.guildId, channelId: message.channelId },
    );
  });
  client.on(Events.MessageBulkDelete, (messages) => {
    observe(
      activityTracker.handleMessageDeleteBulk(messages),
      logger,
      'message_bulk_delete_tracking_failed',
    );
  });

  return function dispose() {
    client.removeAllListeners();
    voiceTracker.stop();
    client.destroy();
  };
}
