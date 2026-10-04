import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
import { readConfig, errorCode } from './config.js';
import { loadCommands } from './command-loader.js';
import { createInteractionHandler } from './interaction-router.js';
import { createDatabase } from './database.js';
import { migrate } from './migrate.js';
import { ActivityRepository } from './activity-repository.js';
import { ActivityTracker } from './activity-tracker.js';
import { ActivityService } from './activity-service.js';
import { VoiceTracker } from './voice-tracker.js';
import { MemberRepository } from './member-repository.js';
import { MemberTracker } from './member-tracker.js';
import { ServerStatsService } from './server-stats.js';
import { NumberChainRepository } from './number-chain-repository.js';
import { NumberChainService } from './number-chain-service.js';
import { BullsAndCowsRepository } from './bulls-and-cows-repository.js';
import { BullsAndCowsService } from './bulls-and-cows-service.js';
import { logger } from './logger.js';

let config;
try {
  config = readConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const database = createDatabase(config);
try {
  await migrate(database);
} catch (error) {
  logger.error('database_migration_failed', { errorCode: errorCode(error) });
  await database.end().catch(() => {});
  process.exit(1);
}

const commands = await loadCommands();
const repository = new ActivityRepository(database);
const memberRepository = new MemberRepository(database);
const tracker = new ActivityTracker(repository, logger);
const voiceTracker = new VoiceTracker(repository, logger);
const memberTracker = new MemberTracker(memberRepository, logger);
const activityService = new ActivityService(repository, tracker, logger);
const serverStatsService = new ServerStatsService(memberRepository, tracker);
const numberChainRepository = new NumberChainRepository(database);
const numberChainService = new NumberChainService(numberChainRepository, logger);
const bullsAndCowsRepository = new BullsAndCowsRepository(database);
const bullsAndCowsService = new BullsAndCowsService(bullsAndCowsRepository, logger);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const handleInteraction = createInteractionHandler({
  commands,
  context: {
    activityService,
    serverStatsService,
    numberChainRepository,
    bullsAndCowsRepository,
  },
  logger,
});

client.once(Events.ClientReady, async (readyClient) => {
  await tracker.initializeClient(readyClient);
  await voiceTracker.initializeClient(readyClient);
  await memberTracker.initializeClient(readyClient);
  logger.info('bot_ready', { userTag: readyClient.user.tag, guilds: readyClient.guilds.cache.size });
  tracker.backfillClient(readyClient).catch((error) => {
    logger.error('activity_backfill_failed', { errorCode: errorCode(error) });
  });
});
client.on(Events.Error, (error) => logger.error('discord_error', { errorCode: errorCode(error) }));
client.on(Events.InteractionCreate, handleInteraction);
client.on(Events.GuildCreate, (guild) => {
  tracker.resetAndInitializeGuild(guild, client.user).then(async () => {
    await voiceTracker.initializeGuild(guild);
    await memberTracker.initializeGuild(guild);
    await tracker.backfillRecentGuild(guild, client.user);
  }).catch((error) => {
    logger.error('guild_initialization_failed', { guildId: guild.id, errorCode: errorCode(error) });
  });
});
client.on(Events.GuildMemberAdd, (member) => {
  memberTracker.handleMemberAdd(member).catch((error) => {
    logger.error('member_join_tracking_failed', {
      guildId: member.guild.id,
      userId: member.id,
      errorCode: errorCode(error),
    });
  });
});
client.on(Events.GuildMemberRemove, (member) => {
  memberTracker.handleMemberRemove(member).catch((error) => {
    logger.error('member_leave_tracking_failed', {
      guildId: member.guild.id,
      userId: member.id,
      errorCode: errorCode(error),
    });
  });
});
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  voiceTracker.handleVoiceStateUpdate(oldState, newState).catch((error) => {
    logger.error('voice_tracking_failed', {
      guildId: newState.guild?.id ?? oldState.guild?.id,
      userId: newState.id ?? oldState.id,
      errorCode: errorCode(error),
    });
  });
});
client.on(Events.MessageCreate, (message) => {
  tracker.handleMessageCreate(message).catch((error) => {
    logger.error('message_tracking_failed', {
      guildId: message.guildId,
      channelId: message.channelId,
      errorCode: errorCode(error),
    });
  });
  numberChainService.handleMessage(message).catch((error) => {
    logger.error('number_chain_failed', {
      guildId: message.guildId,
      channelId: message.channelId,
      errorCode: errorCode(error),
    });
  });
  bullsAndCowsService.handleMessage(message).catch((error) => {
    logger.error('bulls_and_cows_failed', {
      guildId: message.guildId,
      channelId: message.channelId,
      errorCode: errorCode(error),
    });
  });
});
client.on(Events.MessageDelete, (message) => {
  tracker.handleMessageDelete(message).catch((error) => {
    logger.error('message_delete_tracking_failed', {
      guildId: message.guildId,
      channelId: message.channelId,
      errorCode: errorCode(error),
    });
  });
});
client.on(Events.MessageBulkDelete, (messages) => {
  tracker.handleMessageDeleteBulk(messages).catch((error) => {
    logger.error('message_bulk_delete_tracking_failed', { errorCode: errorCode(error) });
  });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('bot_shutdown', { signal });
  client.removeAllListeners();
  voiceTracker.stop();
  client.destroy();
  await database.end().catch(() => {});
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await shutdown(signal);
    process.exit(0);
  });
}

try {
  await client.login(config.DISCORD_TOKEN);
} catch (error) {
  logger.error('discord_login_failed', { errorCode: errorCode(error) });
  await shutdown('login_failed');
  process.exitCode = 1;
}
