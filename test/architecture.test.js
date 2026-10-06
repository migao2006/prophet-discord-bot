import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Events } from 'discord.js';
import { KeyedTaskQueue } from '../src/core/keyed-task-queue.js';
import { loadCommands } from '../src/discord/command-loader.js';
import { registerBotEvents } from '../src/app/register-events.js';
import { createBot } from '../src/app/create-bot.js';

test('default command discovery loads every public command', async () => {
  const commands = await loadCommands();
  assert.deepEqual([...commands.keys()].sort(), [
    '今日發言',
    '伺服器統計',
    '成員活躍查詢',
    '成語接龍',
    '開卷有益',
    '數字接龍',
    '幾a幾b',
    '隨機料理',
    '隨機貓咪',
    '遊戲等級',
    '遊戲排行',
    '身分組稱號',
  ].sort());
});

test('composition root builds a complete disposable bot runtime', async () => {
  const runtime = await createBot({
    database: {},
    logger: { info: () => {}, error: () => {} },
  });
  assert.equal(runtime.commands.size, 12);
  assert.ok(runtime.client.listenerCount(Events.MessageCreate) > 0);
  runtime.dispose();
  assert.equal(runtime.client.listenerCount(Events.MessageCreate), 0);
});

test('keyed task queue serializes one key without blocking another key', async () => {
  const queue = new KeyedTaskQueue();
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });

  const first = queue.enqueue('same', async () => {
    order.push('first-start');
    await gate;
    order.push('first-end');
  });
  const second = queue.enqueue('same', async () => order.push('second'));
  const independent = queue.enqueue('other', async () => order.push('other'));
  await independent;
  assert.deepEqual(order, ['first-start', 'other']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'other', 'first-end', 'second']);
});

test('event wiring fans messages out and disposes runtime resources', async () => {
  class FakeClient extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  const calls = [];
  const client = new FakeClient();
  const voiceTracker = { stop: () => calls.push('voice-stop') };
  const dispose = registerBotEvents({
    client,
    interactionHandler: () => {},
    activityTracker: {
      handleMessageCreate: async () => calls.push('activity'),
      handleMessageDelete: async () => {},
      handleMessageDeleteBulk: async () => {},
    },
    voiceTracker,
    memberTracker: {},
    numberChainService: { handleMessage: async () => calls.push('number-chain') },
    bullsAndCowsService: { handleMessage: async () => calls.push('bulls-and-cows') },
    idiomChainService: { handleMessage: async () => calls.push('idiom-chain') },
    openBookQuizService: { initializeClient: async () => {} },
    logger: { info: () => {}, error: () => {} },
  });

  client.emit(Events.MessageCreate, { guildId: 'guild', channelId: 'channel' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.sort(), ['activity', 'bulls-and-cows', 'idiom-chain', 'number-chain'].sort());

  dispose();
  assert.equal(client.destroyed, true);
  assert.equal(client.listenerCount(Events.MessageCreate), 0);
  assert.ok(calls.includes('voice-stop'));
});
