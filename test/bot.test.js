import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execute, data } from '../src/commands/activity/today.js';
import { loadCommands } from '../src/discord/command-loader.js';
import { createInteractionHandler } from '../src/discord/interaction-router.js';
import { readConfig } from '../src/core/config.js';
import {
  countChannelMessages,
  countTodayMessages,
  startOfTaipeiDay,
  taipeiDateString,
} from '../src/features/activity/domain.js';
import { ActivityService } from '../src/features/activity/service.js';

test('runtime and registration credentials are validated separately', () => {
  assert.throws(() => readConfig({}), /DISCORD_TOKEN/);
  assert.throws(() => readConfig({ DISCORD_TOKEN: 'test' }), /DATABASE_URL/);
  assert.throws(
    () => readConfig({ DISCORD_TOKEN: 'test', DATABASE_URL: 'postgres://test', DATABASE_SSL: 'maybe' }),
    /DATABASE_SSL/,
  );
  assert.deepEqual(
    readConfig({ DISCORD_TOKEN: 'test', DATABASE_URL: 'postgres://test', DATABASE_SSL: 'true' }),
    { DISCORD_TOKEN: 'test', DATABASE_URL: 'postgres://test', DATABASE_SSL: true },
  );
  assert.deepEqual(
    readConfig(
      { DISCORD_TOKEN: 'test', DISCORD_APPLICATION_ID: '1556252999041556582' },
      { registration: true },
    ),
    { DISCORD_TOKEN: 'test', DISCORD_APPLICATION_ID: '1556252999041556582' },
  );
});

test('command loader finds modules and rejects duplicate names', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'prophet-commands-'));
  try {
    await mkdir(path.join(directory, 'one'));
    await writeFile(
      path.join(directory, 'one', 'a.js'),
      `export const data={name:'測試',toJSON(){return {name:this.name}}};export async function execute(){}`,
    );
    const commands = await loadCommands(directory);
    assert.deepEqual([...commands.keys()], ['測試']);

    await writeFile(
      path.join(directory, 'b.js'),
      `export const data={name:'測試',toJSON(){return {name:this.name}}};export async function execute(){}`,
    );
    await assert.rejects(() => loadCommands(directory), /指令名稱重複/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('router ignores non-commands and dispatches known commands', async () => {
  let executed = false;
  const handler = createInteractionHandler({
    commands: new Map([['測試', { execute: async () => { executed = true; } }]]),
    context: {},
    logger: { info: () => {}, error: () => {} },
  });
  await handler({ isChatInputCommand: () => false });
  assert.equal(executed, false);
  await handler({
    isChatInputCommand: () => true,
    commandName: '測試',
    guildId: 'guild',
  });
  assert.equal(executed, true);
});

test('router dispatches open-book buttons without treating them as commands', async () => {
  let handled = false;
  const handler = createInteractionHandler({
    commands: new Map(),
    context: {
      openBookQuizService: {
        handleButton: async () => { handled = true; return true; },
      },
    },
    logger: { info: () => {}, error: () => {} },
  });
  await handler({
    isButton: () => true,
    customId: 'openbook:1:0',
    guildId: 'guild',
  });
  assert.equal(handled, true);
});

test('Taipei date helpers cross the day boundary at 16:00 UTC', () => {
  assert.equal(
    startOfTaipeiDay(Date.parse('2026-10-04T18:30:00Z')),
    Date.parse('2026-10-04T16:00:00Z'),
  );
  assert.equal(taipeiDateString(Date.parse('2026-10-04T15:59:59Z')), '2026-10-04');
  assert.equal(taipeiDateString(Date.parse('2026-10-04T16:00:00Z')), '2026-10-05');
});

test('message history is paged until the start of the Taipei day', async () => {
  const now = Date.parse('2026-10-04T18:30:00Z');
  const start = startOfTaipeiDay(now);
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: String(200 - index),
    createdTimestamp: now - index * 1_000,
    author: { id: index % 2 === 0 ? 'target' : 'other' },
  }));
  const secondPage = [
    { id: '100', createdTimestamp: start + 1, author: { id: 'target' } },
    { id: '99', createdTimestamp: start - 1, author: { id: 'target' } },
  ];
  const requests = [];
  const channel = {
    messages: {
      fetch: async (options) => {
        requests.push(options);
        const page = requests.length === 1 ? firstPage : secondPage;
        return new Map(page.map((message) => [message.id, message]));
      },
    },
  };

  assert.equal(await countChannelMessages(channel, 'target', start, now), 51);
  assert.deepEqual(requests, [{ limit: 100 }, { limit: 100, before: '101' }]);
});

test('history count sums readable channels and reports skipped channels', async () => {
  const now = Date.parse('2026-10-04T18:30:00Z');
  const message = { id: '1', createdTimestamp: now, author: { id: 'target' } };
  const readableChannel = {
    type: 0,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => new Map([['1', message]]) },
  };
  const deniedChannel = { type: 5, permissionsFor: () => ({ has: () => false }) };
  const failedChannel = {
    type: 0,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => { throw new Error('unavailable'); } },
  };
  const guild = {
    channels: { fetch: async () => new Map([['a', readableChannel], ['b', deniedChannel], ['c', failedChannel]]) },
  };

  assert.deepEqual(await countTodayMessages(guild, { id: 'bot' }, 'target', now), {
    count: 1,
    scannedChannels: 1,
    skippedChannels: 2,
  });
});

test('activity service uses database only after a complete Taipei day', async () => {
  const now = Date.parse('2026-10-05T18:30:00Z');
  const repository = {
    getTrackingStartedAt: async () => new Date('2026-10-04T12:00:00Z'),
    countMessages: async (_guild, _user, date, channels) => {
      assert.equal(date, '2026-10-06');
      assert.deepEqual(channels, ['channel']);
      return 7;
    },
  };
  const tracker = {
    catchUpGuild: async () => ({ readable: [{ id: 'channel' }], skippedChannels: 1 }),
  };
  const service = new ActivityService(repository, tracker, { error: () => {} });
  assert.deepEqual(await service.countToday({ id: 'guild' }, {}, 'user', now), {
    count: 7,
    scannedChannels: 1,
    skippedChannels: 1,
    source: 'database',
  });
});

test('Chinese activity command keeps its native user option and public reply', async () => {
  const definition = data.toJSON();
  assert.equal(definition.name, '今日發言');
  assert.equal(definition.options[0].name, '使用者');
  assert.equal(definition.options[0].type, 6);
  assert.equal(definition.options[0].required, true);

  let deferred = false;
  let reply;
  const interaction = {
    inGuild: () => true,
    client: { user: { id: 'bot' } },
    options: { getUser: () => ({ id: '123456789012345678' }) },
    guild: { id: 'guild' },
    deferReply: async () => { deferred = true; },
    editReply: async (value) => { reply = value; },
  };
  const activityService = {
    countToday: async () => ({ count: 3, scannedChannels: 2, skippedChannels: 0 }),
  };

  await execute(interaction, { activityService });
  assert.equal(deferred, true);
  assert.match(reply.content, /今天（台灣時間）/);
  assert.match(reply.content, /\*\*3\*\*/);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});
