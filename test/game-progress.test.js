import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ChannelType,
  Collection,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import {
  GAME_XP,
  LEVEL_TITLE_COLORS,
  LEVEL_TITLES,
  levelForXp,
  progressForXp,
  titleForLevel,
  xpForLevel,
} from '../src/features/games/progress/domain.js';
import { GameProgressRepository } from '../src/features/games/progress/repository.js';
import { GameLevelRoleService } from '../src/features/games/progress/role-service.js';
import { GameProgressService } from '../src/features/games/progress/service.js';
import { data as levelData } from '../src/commands/games/game-level.js';
import { data as rankingData } from '../src/commands/games/game-ranking.js';
import { data as roleData } from '../src/commands/games/level-roles.js';
import {
  data as notificationData,
  execute as executeNotification,
} from '../src/commands/games/level-notifications.js';

test('game XP values, level thresholds, and five-level titles match the design', () => {
  assert.deepEqual(GAME_XP, {
    number_chain: 4,
    bulls_and_cows: 50,
    idiom_chain: 16,
    open_book_quiz: 20,
  });
  assert.equal(LEVEL_TITLES.length, 21);
  assert.equal(LEVEL_TITLE_COLORS.size, 21);
  assert.ok([...LEVEL_TITLE_COLORS.values()].every(
    (color) => Number.isInteger(color) && color > 0 && color <= 0xFFFFFF,
  ));
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(2), 50);
  assert.equal(xpForLevel(10), 2250);
  assert.equal(xpForLevel(100), 247500);
  assert.equal(levelForXp(49), 1);
  assert.equal(levelForXp(50), 2);
  assert.equal(levelForXp(247499), 99);
  assert.equal(levelForXp(999999), 100);
  assert.equal(titleForLevel(1), '小小萌芽');
  assert.equal(titleForLevel(24), '智慧小鹿');
  assert.equal(titleForLevel(100), '永恆預言者');
  assert.deepEqual(progressForXp(75), {
    totalXp: 75,
    level: 2,
    title: '小小萌芽',
    currentFloor: 50,
    nextFloor: 150,
    progress: 0.25,
  });
});

test('XP awards are idempotent and the first award triggers role synchronization', async () => {
  const logs = [];
  let duplicate = false;
  let updates = 0;
  const client = {
    query: async (sql) => {
      if (sql.startsWith('INSERT INTO game_xp_events')) {
        return { rowCount: duplicate ? 0 : 1 };
      }
      updates += 1;
      return {
        rows: [{
          user_id: 'user',
          total_xp: '4',
          number_chain_successes: '1',
          bulls_and_cows_wins: '0',
          idiom_chain_successes: '0',
          open_book_correct: '0',
        }],
      };
    },
  };
  const repository = new GameProgressRepository({}, {
    info: (event, fields) => logs.push({ event, fields }),
  });
  const first = await repository.award(client, {
    eventKey: 'number_chain:message',
    userId: 'user',
    guildId: 'guild',
    channelId: 'channel',
    gameType: 'number_chain',
  });
  assert.equal(first.awarded, true);
  assert.equal(first.xp, 4);
  assert.equal(first.profile.numberChainSuccesses, 1);
  assert.equal(first.titleChanged, true);
  assert.equal(first.leveledUp, false);
  assert.equal(updates, 1);
  assert.equal(logs[0].event, 'game_xp_awarded');

  duplicate = true;
  assert.deepEqual(await repository.award(client, {
    eventKey: 'number_chain:message',
    userId: 'user',
    guildId: 'guild',
    channelId: 'channel',
    gameType: 'number_chain',
  }), { awarded: false });
  assert.equal(updates, 1);
});

test('global leaderboard gives tied XP the same rank', async () => {
  const repository = new GameProgressRepository({
    query: async () => ({
      rows: [
        {
          user_id: 'a', total_xp: '100', number_chain_successes: '0',
          bulls_and_cows_wins: '0', idiom_chain_successes: '0', open_book_correct: '0',
        },
        {
          user_id: 'b', total_xp: '100', number_chain_successes: '0',
          bulls_and_cows_wins: '0', idiom_chain_successes: '0', open_book_correct: '0',
        },
        {
          user_id: 'c', total_xp: '75', number_chain_successes: '0',
          bulls_and_cows_wins: '0', idiom_chain_successes: '0', open_book_correct: '0',
        },
      ],
    }),
  });
  const ranking = await repository.getLeaderboard(['a', 'b', 'c']);
  assert.deepEqual(ranking.map(({ userId, rank }) => ({ userId, rank })), [
    { userId: 'a', rank: 1 },
    { userId: 'b', rank: 1 },
    { userId: 'c', rank: 3 },
  ]);
});

test('role sync keeps only the member current five-level title', async () => {
  const oldRole = { id: 'role-5' };
  const currentRole = { id: 'role-10' };
  const available = new Map([[5, oldRole], [10, currentRole]]);
  const removed = [];
  const added = [];
  const repository = {
    getRoleSetting: async () => ({ enabled: true, roles: new Map() }),
    getProfile: async () => ({ totalXp: 2250, level: 10 }),
  };
  const service = new GameLevelRoleService(repository, { error: () => {} });
  const member = {
    id: 'user',
    user: { bot: false },
    guild: { id: 'guild' },
    roles: {
      cache: new Collection([['role-5', oldRole]]),
      remove: async (ids) => removed.push(...ids),
      add: async (role) => added.push(role.id),
    },
  };
  assert.deepEqual(await service.syncMember(member, available), { changed: true });
  assert.deepEqual(removed, ['role-5']);
  assert.deepEqual(added, ['role-10']);
});

test('existing level roles receive their configured fantasy colors', async () => {
  const edited = [];
  const roleEntries = LEVEL_TITLES.map(([level, title]) => {
    const id = `role-${level}`;
    return [id, {
      id,
      name: `Lv.${level}｜${title}`,
      color: 0,
      edit: async (options) => {
        edited.push({ level, options });
        return { id, ...options };
      },
    }];
  });
  const repository = {
    getRoleSetting: async () => ({
      enabled: true,
      roles: new Map(LEVEL_TITLES.map(([level]) => [level, `role-${level}`])),
    }),
    saveRole: async () => {},
  };
  const service = new GameLevelRoleService(repository, { info: () => {}, error: () => {} });
  const roles = await service.ensureRoles({
    id: 'guild',
    members: {
      me: { permissions: { has: () => true } },
    },
    roles: {
      cache: new Collection(roleEntries),
      create: async () => { throw new Error('Unexpected role creation'); },
    },
  });
  assert.equal(roles.size, 21);
  assert.equal(edited.length, 21);
  for (const { level, options } of edited) {
    assert.equal(options.color, LEVEL_TITLE_COLORS.get(level));
  }
});

test('new game progress commands expose the intended Chinese interface', () => {
  const level = levelData.toJSON();
  assert.equal(level.name, '遊戲等級');
  assert.equal(level.options[0].name, '使用者');
  assert.notEqual(level.options[0].required, true);

  assert.equal(rankingData.toJSON().name, '遊戲排行');

  const roles = roleData.toJSON();
  assert.equal(roles.name, '身分組稱號');
  assert.equal(roles.default_member_permissions, PermissionFlagsBits.Administrator.toString());
  assert.deepEqual(roles.options[0].choices.map(({ name, value }) => ({ name, value })), [
    { name: '開啟', value: '開啟' },
    { name: '關閉', value: '關閉' },
  ]);

  const notifications = notificationData.toJSON();
  assert.equal(notifications.name, '升等通知');
  assert.equal(
    notifications.default_member_permissions,
    PermissionFlagsBits.Administrator.toString(),
  );
  assert.deepEqual(
    notifications.options[0].choices.map(({ name, value }) => ({ name, value })),
    [
      { name: '開啟', value: '開啟' },
      { name: '關閉', value: '關閉' },
    ],
  );
});

test('level notification command stores the current channel and can disable it server-wide', async () => {
  const calls = [];
  const replies = [];
  let state = '開啟';
  const interaction = {
    inGuild: () => true,
    guild: { id: 'guild' },
    guildId: 'guild',
    channelId: 'notice',
    channel: { type: ChannelType.GuildText },
    memberPermissions: { has: () => true },
    appPermissions: { has: () => true },
    options: { getString: () => state },
    reply: async (value) => replies.push(value),
  };
  const gameProgressRepository = {
    setLevelNotification: async (...args) => calls.push(args),
  };
  await executeNotification(interaction, { gameProgressRepository });
  assert.deepEqual(calls[0], ['guild', true, 'notice']);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
  assert.match(replies[0].content, /<#notice>/);

  state = '關閉';
  await executeNotification(interaction, { gameProgressRepository });
  assert.deepEqual(calls[1], ['guild', false, null]);
  assert.match(replies[1].content, /已關閉/);
});

test('level notification command rejects non-administrators and missing bot permissions', async () => {
  let reply;
  let saved = false;
  const interaction = {
    inGuild: () => true,
    guild: { id: 'guild' },
    guildId: 'guild',
    channelId: 'notice',
    channel: { type: ChannelType.GuildText },
    memberPermissions: { has: () => false },
    appPermissions: { has: () => true },
    options: { getString: () => '開啟' },
    reply: async (value) => { reply = value; },
  };
  const gameProgressRepository = {
    setLevelNotification: async () => { saved = true; },
  };
  await executeNotification(interaction, { gameProgressRepository });
  assert.match(reply.content, /只有伺服器管理員/);
  assert.equal(saved, false);

  interaction.memberPermissions.has = () => true;
  interaction.appPermissions.has = () => false;
  await executeNotification(interaction, { gameProgressRepository });
  assert.match(reply.content, /檢視頻道/);
  assert.equal(saved, false);
});

test('level notifications use the configured source-guild channel and ping the player', async () => {
  const sent = [];
  const roleSyncs = [];
  const repository = {
    getLevelNotificationSetting: async () => ({ enabled: true, channelId: 'notice' }),
  };
  const service = new GameProgressService(
    repository,
    { syncUserAcrossGuilds: async (...args) => roleSyncs.push(args) },
    { error: () => {} },
  );
  const client = {
    channels: {
      fetch: async (channelId) => ({
        id: channelId,
        guildId: 'guild',
        isTextBased: () => true,
        send: async (payload) => sent.push(payload),
      }),
    },
  };
  await service.handleAward(client, 'guild', 'user', {
    awarded: true,
    leveledUp: true,
    titleChanged: true,
    profile: { level: 5 },
  });
  assert.equal(roleSyncs.length, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /<@user>/);
  assert.match(sent[0].content, /Lv\.5/);
  assert.deepEqual(sent[0].allowedMentions, { parse: [], users: ['user'] });
});

test('disabled level notifications stay silent without blocking role synchronization', async () => {
  let fetched = false;
  let synced = false;
  const service = new GameProgressService(
    {
      getLevelNotificationSetting: async () => ({ enabled: false, channelId: null }),
    },
    { syncUserAcrossGuilds: async () => { synced = true; } },
    { error: () => {} },
  );
  await service.handleAward({
    channels: { fetch: async () => { fetched = true; } },
  }, 'guild', 'user', {
    awarded: true,
    leveledUp: true,
    titleChanged: true,
    profile: { level: 5 },
  });
  assert.equal(synced, true);
  assert.equal(fetched, false);
});

test('an unavailable notification channel is logged and does not reject the award handler', async () => {
  const errors = [];
  const service = new GameProgressService(
    {
      getLevelNotificationSetting: async () => ({ enabled: true, channelId: 'missing' }),
    },
    { syncUserAcrossGuilds: async () => {} },
    { error: (event, fields) => errors.push({ event, fields }) },
  );
  await service.handleAward({
    channels: { fetch: async () => { throw new Error('Unknown Channel'); } },
  }, 'guild', 'user', {
    awarded: true,
    leveledUp: true,
    titleChanged: false,
    profile: { level: 6 },
  });
  assert.equal(errors[0].event, 'game_level_notification_failed');
  assert.equal(errors[0].fields.channelId, 'missing');
});
