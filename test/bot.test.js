import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import { handleInteraction } from '../src/commands.js';
import { readConfig } from '../src/config.js';

test('missing credentials fail before any network connection', () => {
  assert.throws(() => readConfig({}), /DISCORD_TOKEN/);
  assert.throws(() => readConfig({ DISCORD_TOKEN: 'replace_with_bot_token' }), /DISCORD_TOKEN/);
  assert.throws(() => readConfig({ DISCORD_TOKEN: 'test', DISCORD_APPLICATION_ID: 'invalid' }, { registration: true }), /DISCORD_APPLICATION_ID/);
  assert.deepEqual(
    readConfig({ DISCORD_TOKEN: 'test', DISCORD_APPLICATION_ID: '1556252999041556582' }, { registration: true }),
    { DISCORD_TOKEN: 'test', DISCORD_APPLICATION_ID: '1556252999041556582' },
  );
});

test('ping responds privately and non-command events are ignored', async () => {
  let reply;
  await handleInteraction({ isChatInputCommand: () => false });
  await handleInteraction({ isChatInputCommand: () => true, commandName: 'ping', reply: async (value) => { reply = value; } });
  assert.match(reply.content, /Pong/);
  assert.equal(reply.flags, MessageFlags.Ephemeral);
});

test('hello cannot ping everyone through a user-controlled name', async () => {
  let reply;
  await handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'hello',
    user: { username: '@everyone' },
    reply: async (value) => { reply = value; },
  });
  assert.match(reply.content, /@everyone/);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});
