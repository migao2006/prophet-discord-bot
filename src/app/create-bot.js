import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { loadCommands } from '../discord/command-loader.js';
import { createInteractionHandler } from '../discord/interaction-router.js';
import { ActivityRepository } from '../features/activity/repository.js';
import { ActivityTracker } from '../features/activity/tracker.js';
import { ActivityService } from '../features/activity/service.js';
import { VoiceTracker } from '../features/activity/voice-tracker.js';
import { MemberRepository } from '../features/members/repository.js';
import { MemberTracker } from '../features/members/tracker.js';
import { ServerStatsService } from '../features/members/server-stats-service.js';
import { NumberChainRepository } from '../features/games/number-chain/repository.js';
import { NumberChainService } from '../features/games/number-chain/service.js';
import { BullsAndCowsRepository } from '../features/games/bulls-and-cows/repository.js';
import { BullsAndCowsService } from '../features/games/bulls-and-cows/service.js';
import { IdiomChainRepository } from '../features/games/idiom-chain/repository.js';
import { IdiomChainService } from '../features/games/idiom-chain/service.js';
import { OpenBookQuizRepository } from '../features/games/open-book-quiz/repository.js';
import { OpenBookQuizService } from '../features/games/open-book-quiz/service.js';
import { FunImageService } from '../features/fun-images/service.js';
import { GameProgressRepository } from '../features/games/progress/repository.js';
import { GameLevelRoleService } from '../features/games/progress/role-service.js';
import { GameProgressService } from '../features/games/progress/service.js';
import { WerewolfRepository } from '../features/games/werewolf/repository.js';
import { WerewolfService } from '../features/games/werewolf/service.js';
import { registerBotEvents } from './register-events.js';

const INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildVoiceStates,
];

export async function createBot({ database, logger }) {
  const activityRepository = new ActivityRepository(database);
  const memberRepository = new MemberRepository(database);
  const activityTracker = new ActivityTracker(activityRepository, logger);
  const voiceTracker = new VoiceTracker(activityRepository, logger);
  const memberTracker = new MemberTracker(memberRepository, logger);
  const activityService = new ActivityService(activityRepository, activityTracker, logger);
  const serverStatsService = new ServerStatsService(memberRepository, activityTracker);
  const gameProgressRepository = new GameProgressRepository(database, logger);
  const gameLevelRoleService = new GameLevelRoleService(gameProgressRepository, logger);
  const gameProgressService = new GameProgressService(
    gameProgressRepository,
    gameLevelRoleService,
    logger,
  );
  const numberChainRepository = new NumberChainRepository(database, gameProgressRepository);
  const numberChainService = new NumberChainService(numberChainRepository, logger, gameProgressService);
  const bullsAndCowsRepository = new BullsAndCowsRepository(database, undefined, gameProgressRepository);
  const bullsAndCowsService = new BullsAndCowsService(bullsAndCowsRepository, logger, gameProgressService);
  const idiomChainRepository = new IdiomChainRepository(database, gameProgressRepository);
  const idiomChainService = new IdiomChainService(idiomChainRepository, logger, gameProgressService);
  const openBookQuizRepository = new OpenBookQuizRepository(database, gameProgressRepository);
  const openBookQuizService = new OpenBookQuizService(openBookQuizRepository, logger, gameProgressService);
  const funImageService = new FunImageService({ logger });
  const werewolfRepository = new WerewolfRepository(database, gameProgressRepository);
  const werewolfService = new WerewolfService(werewolfRepository, gameProgressService, logger);
  const commands = await loadCommands();
  const client = new Client({
    intents: INTENTS,
    partials: [Partials.Channel, Partials.Message],
  });
  const interactionHandler = createInteractionHandler({
    commands,
    context: {
      activityService,
      serverStatsService,
      numberChainRepository,
      bullsAndCowsRepository,
      idiomChainRepository,
      openBookQuizRepository,
      openBookQuizService,
      funImageService,
      gameProgressRepository,
      gameLevelRoleService,
      gameProgressService,
      werewolfService,
    },
    logger,
  });
  const dispose = registerBotEvents({
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
    werewolfService,
    logger,
  });

  return { client, commands, dispose };
}
