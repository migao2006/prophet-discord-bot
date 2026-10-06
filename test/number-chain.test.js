import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { NumberChainService } from '../src/features/games/number-chain/service.js';
import { data, execute } from '../src/commands/games/number-chain.js';

class MemoryNumberChainRepository {
  constructor() {
    this.enabled = true;
    this.current = 0n;
    this.lastUserId = null;
    this.calls = 0;
  }

  async tryAdvance(_guildId, _channelId, userId, _messageId, number) {
    this.calls += 1;
    if (!this.enabled) return { status: 'disabled' };
    const expected = this.current + 1n;
    if (number !== expected || userId === this.lastUserId) {
      const reason = userId === this.lastUserId ? 'same_user' : 'wrong_number';
      this.current = 0n;
      this.lastUserId = null;
      return { status: 'incorrect', reason, expected: '1' };
    }
    this.current = number;
    this.lastUserId = userId;
    return { status: 'correct', currentNumber: number.toString() };
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

test('number chain command is administrator-only with Chinese choices', () => {
  const definition = data.toJSON();
  assert.equal(definition.name, '數字接龍');
  assert.equal(definition.default_member_permissions, PermissionFlagsBits.Administrator.toString());
  assert.equal(definition.options[0].name, '狀態');
  assert.deepEqual(definition.options[0].choices.map(({ name, value }) => ({ name, value })), [
    { name: '開啟', value: '開啟' },
    { name: '關閉', value: '關閉' },
  ]);
});

test('number chain reacts to valid and invalid numbers while ignoring text', async () => {
  const repository = new MemoryNumberChainRepository();
  const service = new NumberChainService(repository, { error: () => {} });

  const text = createMessage('下一個是 1');
  assert.deepEqual(await service.handleMessage(text), { status: 'ignored' });
  assert.equal(repository.calls, 0);

  const first = createMessage(' 1 ', 'a');
  assert.equal((await service.handleMessage(first)).status, 'correct');
  assert.deepEqual(first.reactions, ['✅']);

  const sameUser = createMessage('2', 'a');
  assert.equal((await service.handleMessage(sameUser)).status, 'incorrect');
  assert.deepEqual(sameUser.reactions, ['❌']);
  assert.match(sameUser.replies[0].content, /不能自己接自己/);
  assert.deepEqual(sameUser.replies[0].allowedMentions, { parse: [], repliedUser: false });

  const skipped = createMessage('3', 'b');
  assert.equal((await service.handleMessage(skipped)).status, 'incorrect');
  assert.deepEqual(skipped.reactions, ['❌']);
  assert.match(skipped.replies[0].content, /數字接錯了/);

  const restarted = createMessage('1', 'b');
  assert.equal((await service.handleMessage(restarted)).status, 'correct');
  assert.deepEqual(restarted.reactions, ['✅']);

  const leadingZero = createMessage('03', 'c');
  assert.equal((await service.handleMessage(leadingZero)).status, 'incorrect');
  assert.deepEqual(leadingZero.reactions, ['❌']);

  const restartedAgain = createMessage('1', 'c');
  assert.equal((await service.handleMessage(restartedAgain)).status, 'correct');
  assert.deepEqual(restartedAgain.reactions, ['✅']);
});

test('number chain ignores bots and disabled channels', async () => {
  const repository = new MemoryNumberChainRepository();
  const service = new NumberChainService(repository, { error: () => {} });
  const botMessage = createMessage('1');
  botMessage.author.bot = true;
  assert.equal((await service.handleMessage(botMessage)).status, 'ignored');
  assert.equal(repository.calls, 0);

  repository.enabled = false;
  const disabled = createMessage('1');
  assert.equal((await service.handleMessage(disabled)).status, 'disabled');
  assert.deepEqual(disabled.reactions, []);
});

test('number chain delegates awarded progress without posting a local level notice', async () => {
  const progress = {
    awarded: true,
    leveledUp: true,
    titleChanged: true,
    profile: { level: 2 },
  };
  const calls = [];
  const service = new NumberChainService({
    tryAdvance: async () => ({ status: 'correct', currentNumber: '1', progress }),
  }, { error: () => {} }, {
    handleAward: async (...args) => calls.push(args),
  });
  const message = createMessage('1');
  message.client = { id: 'client' };
  await service.handleMessage(message);
  assert.equal(message.replies.length, 0);
  assert.deepEqual(calls, [[message.client, 'guild', 'user', progress]]);
});

test('number chain command configures only the current text channel with an ephemeral reply', async () => {
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
  const numberChainRepository = {
    setEnabled: async (...args) => {
      saved = args;
      return { changed: true, enabled: true, currentNumber: '0' };
    },
  };

  await execute(interaction, { numberChainRepository });
  assert.deepEqual(saved, ['guild', 'channel', true]);
  assert.equal(reply.flags, MessageFlags.Ephemeral);
  assert.match(reply.content, /從 \*\*1\*\* 開始/);
  assert.match(reply.content, /🎉/);
});

test('number chain command rejects non-administrators', async () => {
  let reply;
  const interaction = {
    inGuild: () => true,
    guild: { id: 'guild' },
    channel: { type: ChannelType.GuildText },
    memberPermissions: { has: () => false },
    reply: async (value) => { reply = value; },
  };
  await execute(interaction, { numberChainRepository: {} });
  assert.match(reply.content, /只有伺服器管理員/);
  assert.equal(reply.flags, MessageFlags.Ephemeral);
});

test('number chain command reports a 1A2B conflict', async () => {
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
    numberChainRepository: {
      setEnabled: async () => ({
        changed: false, enabled: false, conflict: 'bulls_and_cows',
      }),
    },
  });
  assert.match(reply.content, /1A2B/);
  assert.match(reply.content, /幾a幾b/);

  await execute(interaction, {
    numberChainRepository: {
      setEnabled: async () => ({
        changed: false, enabled: false, conflict: 'idiom_chain',
      }),
    },
  });
  assert.match(reply.content, /成語接龍/);
  assert.match(reply.content, /成語接龍 狀態:關閉/);
});
