import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import {
  evaluateGuess,
  generateSecret,
} from '../src/features/games/bulls-and-cows/game.js';
import { BullsAndCowsService } from '../src/features/games/bulls-and-cows/service.js';
import { data, execute } from '../src/commands/games/bulls-and-cows.js';

class MemoryBullsAndCowsRepository {
  constructor(answer = '0123') {
    this.enabled = true;
    this.answer = answer;
    this.guessCount = 0;
    this.calls = 0;
  }

  async submitGuess(_guildId, _channelId, guess) {
    this.calls += 1;
    if (!this.enabled) return { status: 'disabled' };
    if (!guess) return { status: 'invalid' };
    this.guessCount += 1;
    const score = evaluateGuess(this.answer, guess);
    if (score.a === 4) {
      const result = {
        status: 'won',
        ...score,
        attempt: this.guessCount,
        answer: this.answer,
      };
      this.answer = '4567';
      this.guessCount = 0;
      return result;
    }
    return { status: 'guessed', ...score, attempt: this.guessCount };
  }
}

function createMessage(content) {
  const replies = [];
  return {
    id: `message-${content}`,
    content,
    guildId: 'guild',
    channelId: 'channel',
    author: { id: 'user', bot: false },
    reply: async (value) => replies.push(value),
    replies,
  };
}

test('generates four unique digits and scores A/B correctly', () => {
  for (let index = 0; index < 100; index += 1) {
    const secret = generateSecret();
    assert.match(secret, /^\d{4}$/);
    assert.equal(new Set(secret).size, 4);
  }
  assert.deepEqual(evaluateGuess('0123', '0123'), { a: 4, b: 0 });
  assert.deepEqual(evaluateGuess('0123', '1038'), { a: 0, b: 3 });
  assert.deepEqual(evaluateGuess('0123', '4567'), { a: 0, b: 0 });
});

test('1A2B service ignores chat and publicly replies to guesses', async () => {
  const repository = new MemoryBullsAndCowsRepository();
  const service = new BullsAndCowsService(repository, { error: () => {} });

  const chat = createMessage('答案是 0123');
  assert.deepEqual(await service.handleMessage(chat), { status: 'ignored' });
  assert.equal(repository.calls, 0);

  const guess = createMessage(' 1038 ');
  assert.deepEqual(await service.handleMessage(guess), {
    status: 'guessed', a: 0, b: 3, attempt: 1,
  });
  assert.match(guess.replies[0].content, /1038 → 0A3B/);
  assert.match(guess.replies[0].content, /第 \*\*1\*\* 次/);
  assert.deepEqual(guess.replies[0].allowedMentions, { parse: [], repliedUser: false });

  const invalid = createMessage('0012');
  assert.equal((await service.handleMessage(invalid)).status, 'invalid');
  assert.match(invalid.replies[0].content, /4 個不重複的數字/);

  const won = createMessage('0123');
  assert.equal((await service.handleMessage(won)).status, 'won');
  assert.match(won.replies[0].content, /猜中啦/);
  assert.match(won.replies[0].content, /新的一局/);
});

test('1A2B service ignores bots and disabled channels', async () => {
  const repository = new MemoryBullsAndCowsRepository();
  const service = new BullsAndCowsService(repository, { error: () => {} });
  const botMessage = createMessage('0123');
  botMessage.author.bot = true;
  assert.equal((await service.handleMessage(botMessage)).status, 'ignored');
  assert.equal(repository.calls, 0);

  repository.enabled = false;
  const disabled = createMessage('0123');
  assert.equal((await service.handleMessage(disabled)).status, 'disabled');
  assert.deepEqual(disabled.replies, []);
});

test('1A2B command is administrator-only with Chinese choices', () => {
  const definition = data.toJSON();
  assert.equal(definition.name, '幾a幾b');
  assert.equal(definition.default_member_permissions, PermissionFlagsBits.Administrator.toString());
  assert.deepEqual(definition.options[0].choices.map(({ name, value }) => ({ name, value })), [
    { name: '開啟', value: '開啟' },
    { name: '關閉', value: '關閉' },
  ]);
});

test('1A2B command opens current channel and reports number-chain conflicts', async () => {
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
  const bullsAndCowsRepository = {
    setEnabled: async (...args) => {
      saved = args;
      return { changed: true, enabled: true, guessCount: 0 };
    },
  };

  await execute(interaction, { bullsAndCowsRepository });
  assert.deepEqual(saved, ['guild', 'channel', true]);
  assert.equal(reply.flags, MessageFlags.Ephemeral);
  assert.match(reply.content, /4 個不重複的數字/);

  bullsAndCowsRepository.setEnabled = async () => ({
    changed: false, enabled: false, conflict: 'number_chain',
  });
  await execute(interaction, { bullsAndCowsRepository });
  assert.match(reply.content, /數字接龍/);
});
