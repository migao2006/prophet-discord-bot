import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { IdiomChainService } from '../src/features/games/idiom-chain/service.js';
import { data, execute } from '../src/commands/games/idiom-chain.js';

class MemoryIdiomChainRepository {
  constructor() {
    this.enabled = true;
    this.current = '一心一意';
    this.lastUserId = null;
    this.used = new Set([this.current]);
    this.dictionary = new Set(['一心一意', '意氣風發', '發揚光大', '風和日麗']);
    this.calls = 0;
  }

  async tryAdvance(_guildId, _channelId, userId, _messageId, idiom) {
    this.calls += 1;
    if (!this.enabled) return { status: 'disabled' };
    if (!this.dictionary.has(idiom)) return { status: 'incorrect', reason: 'not_found' };
    if (this.lastUserId === userId) return { status: 'incorrect', reason: 'same_user' };
    if (this.used.has(idiom)) return { status: 'incorrect', reason: 'already_used' };
    const expected = Array.from(this.current).at(-1);
    if (Array.from(idiom)[0] !== expected) {
      return { status: 'incorrect', reason: 'wrong_start', expected };
    }
    this.current = idiom;
    this.lastUserId = userId;
    this.used.add(idiom);
    return { status: 'correct', idiom };
  }
}

function createMessage(content, userId = 'user') {
  const reactions = [];
  const replies = [];
  return {
    id: `message-${content}`,
    content,
    guildId: 'guild',
    channelId: 'channel',
    author: { id: userId, bot: false },
    react: async (emoji) => reactions.push(emoji),
    reply: async (value) => replies.push(value),
    reactions,
    replies,
  };
}

test('expanded official idiom seed contains the expected unique four-character entries', async () => {
  const dataset = JSON.parse(await readFile(
    new URL('../data/moe-idioms-expanded-20261006-f3.json', import.meta.url),
    'utf8',
  ));
  assert.equal(dataset.sourceVersion, '2020_20260929+editorial-20261006-f3');
  assert.equal(dataset.entries.length, 14382);
  assert.equal(dataset.selection.coreEntryCount, 5310);
  assert.equal(dataset.selection.editorialMinimumFrequency, 3);
  assert.equal(new Set(dataset.entries.map((entry) => entry.idiom)).size, 14382);
  assert.ok(dataset.entries.some((entry) => entry.idiom === '糟糠不厭'));
  assert.ok(dataset.entries.every((entry) => /^\p{Script=Han}{4}$/u.test(entry.idiom)));
});

test('idiom chain accepts valid words and explains invalid attempts', async () => {
  const repository = new MemoryIdiomChainRepository();
  const service = new IdiomChainService(repository, { error: () => {} });

  const chat = createMessage('大家晚安囉');
  assert.deepEqual(await service.handleMessage(chat), { status: 'ignored' });
  assert.equal(repository.calls, 0);

  const correct = createMessage('意氣風發', 'a');
  assert.equal((await service.handleMessage(correct)).status, 'correct');
  assert.deepEqual(correct.reactions, ['✅']);
  assert.deepEqual(correct.replies, []);

  const sameUser = createMessage('發揚光大', 'a');
  assert.equal((await service.handleMessage(sameUser)).reason, 'same_user');
  assert.deepEqual(sameUser.reactions, ['❌']);
  assert.match(sameUser.replies[0].content, /不能連續/);

  const unknown = createMessage('天地玄黃', 'b');
  assert.equal((await service.handleMessage(unknown)).reason, 'not_found');
  assert.match(unknown.replies[0].content, /找不到/);

  const wrongStart = createMessage('風和日麗', 'b');
  assert.equal((await service.handleMessage(wrongStart)).reason, 'wrong_start');
  assert.match(wrongStart.replies[0].content, /「\*\*發\*\*」開頭/);
});

test('idiom chain announces a new opening when a round is complete', async () => {
  const repository = {
    tryAdvance: async () => ({
      status: 'round_complete',
      idiom: '意氣風發',
      openingIdiom: '一心一意',
    }),
  };
  const service = new IdiomChainService(repository, { error: () => {} });
  const message = createMessage('意氣風發');
  assert.equal((await service.handleMessage(message)).status, 'round_complete');
  assert.deepEqual(message.reactions, ['✅']);
  assert.match(message.replies[0].content, /一心一意/);
  assert.match(message.replies[0].content, /「\*\*意\*\*」開始/);
  assert.deepEqual(message.replies[0].allowedMentions, { parse: [], repliedUser: false });
});

test('idiom chain ignores bots and disabled channels', async () => {
  const repository = new MemoryIdiomChainRepository();
  const service = new IdiomChainService(repository, { error: () => {} });
  const botMessage = createMessage('意氣風發');
  botMessage.author.bot = true;
  assert.equal((await service.handleMessage(botMessage)).status, 'ignored');
  assert.equal(repository.calls, 0);

  repository.enabled = false;
  const disabled = createMessage('意氣風發');
  assert.equal((await service.handleMessage(disabled)).status, 'disabled');
  assert.deepEqual(disabled.reactions, []);
});

test('idiom chain command is administrator-only and opens publicly', async () => {
  const definition = data.toJSON();
  assert.equal(definition.name, '成語接龍');
  assert.equal(definition.default_member_permissions, PermissionFlagsBits.Administrator.toString());
  assert.deepEqual(definition.options[0].choices.map(({ name, value }) => ({ name, value })), [
    { name: '開啟', value: '開啟' },
    { name: '關閉', value: '關閉' },
  ]);

  let saved;
  let reply;
  const interaction = {
    inGuild: () => true,
    guild: { id: 'guild' },
    guildId: 'guild',
    channelId: 'channel',
    channel: { type: ChannelType.GuildText },
    memberPermissions: { has: () => true },
    appPermissions: { has: () => true },
    options: { getString: () => '開啟' },
    reply: async (value) => { reply = value; },
  };
  await execute(interaction, {
    idiomChainRepository: {
      setEnabled: async (...args) => {
        saved = args;
        return { changed: true, enabled: true, currentIdiom: '一心一意' };
      },
    },
  });
  assert.deepEqual(saved, ['guild', 'channel', true]);
  assert.equal(reply.flags, undefined);
  assert.match(reply.content, /一心一意/);
  assert.match(reply.content, /「\*\*意\*\*」開始/);
});

test('idiom chain command reports game conflicts ephemerally', async () => {
  let reply;
  const interaction = {
    inGuild: () => true,
    guild: { id: 'guild' },
    guildId: 'guild',
    channelId: 'channel',
    channel: { type: ChannelType.GuildText },
    memberPermissions: { has: () => true },
    appPermissions: { has: () => true },
    options: { getString: () => '開啟' },
    reply: async (value) => { reply = value; },
  };
  await execute(interaction, {
    idiomChainRepository: {
      setEnabled: async () => ({ conflict: 'number_chain', enabled: false, changed: false }),
    },
  });
  assert.equal(reply.flags, MessageFlags.Ephemeral);
  assert.match(reply.content, /數字接龍/);
});
