import test from 'node:test';
import assert from 'node:assert/strict';
import { commands, handleInteraction } from '../src/commands.js';
import { readConfig } from '../src/config.js';
import { countChannelMessages, countTodayMessages, startOfTaipeiDay } from '../src/activity.js';

test('missing credentials fail before any network connection', () => {
  assert.throws(() => readConfig({}), /DISCORD_TOKEN/);
  assert.throws(() => readConfig({ DISCORD_TOKEN: 'replace_with_bot_token' }), /DISCORD_TOKEN/);
  assert.throws(() => readConfig({ DISCORD_TOKEN: 'test', DISCORD_APPLICATION_ID: 'invalid' }, { registration: true }), /DISCORD_APPLICATION_ID/);
  assert.deepEqual(
    readConfig({ DISCORD_TOKEN: 'test', DISCORD_APPLICATION_ID: '1556252999041556582' }, { registration: true }),
    { DISCORD_TOKEN: 'test', DISCORD_APPLICATION_ID: '1556252999041556582' },
  );
});

test('non-command events are ignored', async () => {
  await handleInteraction({ isChatInputCommand: () => false });
});

test('Taipei day starts at 16:00 UTC on the previous date', () => {
  assert.equal(
    startOfTaipeiDay(Date.parse('2026-10-04T18:30:00Z')),
    Date.parse('2026-10-04T16:00:00Z'),
  );
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
        return new Map((requests.length === 1 ? firstPage : secondPage).map((message) => [message.id, message]));
      },
    },
  };

  assert.equal(await countChannelMessages(channel, 'target', start, now), 51);
  assert.deepEqual(requests, [{ limit: 100 }, { limit: 100, before: '101' }]);
});

test('today count sums readable channels and reports skipped channels', async () => {
  const now = Date.parse('2026-10-04T18:30:00Z');
  const message = { id: '1', createdTimestamp: now, author: { id: 'target' } };
  const readableChannel = {
    type: 0,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => new Map([['1', message]]) },
  };
  const deniedChannel = {
    type: 5,
    permissionsFor: () => ({ has: () => false }),
  };
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

test('Chinese activity command requires a user and replies publicly', async () => {
  assert.deepEqual(commands.map((command) => command.name), ['今日發言']);
  const definition = commands.find((command) => command.name === '今日發言').toJSON();
  assert.equal(definition.options[0].name, '使用者');
  assert.equal(definition.options[0].required, true);
  assert.equal(definition.options[0].type, 6);
  assert.equal(definition.options[0].autocomplete, undefined);

  let deferred = false;
  let reply;
  const now = Date.now();
  const interaction = {
    isChatInputCommand: () => true,
    commandName: '今日發言',
    inGuild: () => true,
    client: { user: { id: 'bot' } },
    options: { getUser: () => ({ id: '123456789012345678' }) },
    guild: {
      channels: {
        fetch: async () => new Map([['a', {
          type: 0,
          permissionsFor: () => ({ has: () => true }),
          messages: {
            fetch: async () => new Map([['1', { id: '1', createdTimestamp: now, author: { id: '123456789012345678' } }]]),
          },
        }]]),
      },
    },
    deferReply: async () => { deferred = true; },
    editReply: async (value) => { reply = value; },
  };

  await handleInteraction(interaction);
  assert.equal(deferred, true);
  assert.match(reply.content, /今天（台灣時間）/);
  assert.match(reply.content, /\*\*1\*\*/);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});
