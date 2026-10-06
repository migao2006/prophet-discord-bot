import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits } from 'discord.js';
import {
  GAME_XP,
  LEVEL_TITLES,
  levelForXp,
  progressForXp,
  titleForLevel,
  xpForLevel,
} from '../src/features/games/progress/domain.js';
import { GameProgressRepository } from '../src/features/games/progress/repository.js';
import { GameLevelRoleService } from '../src/features/games/progress/role-service.js';
import { data as levelData } from '../src/commands/games/game-level.js';
import { data as rankingData } from '../src/commands/games/game-ranking.js';
import { data as roleData } from '../src/commands/games/level-roles.js';

test('game XP values, level thresholds, and five-level titles match the design', () => {
  assert.deepEqual(GAME_XP, {
    number_chain: 2,
    bulls_and_cows: 25,
    idiom_chain: 8,
    open_book_quiz: 10,
  });
  assert.equal(LEVEL_TITLES.length, 21);
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
          total_xp: '2',
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
  assert.equal(first.xp, 2);
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
});
