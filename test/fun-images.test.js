import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, MessageFlags } from 'discord.js';
import { FunImageError, FunImageService } from '../src/features/fun-images/service.js';
import {
  data as mealData,
  execute as executeMeal,
} from '../src/commands/fun/random-meal.js';
import {
  data as catData,
  execute as executeCat,
} from '../src/commands/fun/random-cat.js';

function createInteraction(overrides = {}) {
  const calls = { replies: [], deferred: 0, edits: [] };
  return {
    calls,
    guildId: 'guild-1',
    guild: { id: 'guild-1' },
    channel: { type: ChannelType.GuildText },
    user: { id: 'user-1' },
    appPermissions: { has: () => true },
    inGuild: () => true,
    reply: async (payload) => calls.replies.push(payload),
    deferReply: async () => { calls.deferred += 1; },
    editReply: async (payload) => calls.edits.push(payload),
    ...overrides,
  };
}

test('fun image command definitions are Chinese commands without options', () => {
  const meal = mealData.toJSON();
  const cat = catData.toJSON();
  assert.equal(meal.name, '隨機料理');
  assert.equal(cat.name, '隨機貓咪');
  assert.deepEqual(meal.options ?? [], []);
  assert.deepEqual(cat.options ?? [], []);
});

test('service reads validated HTTPS images from both public APIs', async () => {
  const requests = [];
  const service = new FunImageService({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.includes('themealdb')) {
        return { ok: true, json: async () => ({ meals: [{ strMealThumb: 'https://images.example/meal.jpg' }] }) };
      }
      return { ok: true, json: async () => [{ url: 'https://images.example/cat.jpg' }] };
    },
  });

  assert.equal(await service.getImage('meal'), 'https://images.example/meal.jpg');
  assert.equal(await service.getImage('cat'), 'https://images.example/cat.jpg');
  assert.match(requests[0].url, /themealdb\.com\/api\/json\/v1\/1\/random\.php/);
  assert.match(requests[1].url, /api\.thecatapi\.com\/v1\/images\/search/);
  assert.equal(requests[0].options.headers.Accept, 'application/json');
  assert.ok(requests[0].options.signal instanceof AbortSignal);
});

test('service rejects failed, malformed, and insecure API responses', async () => {
  const cases = [
    { response: { ok: false }, code: 'image_api_status' },
    { response: { ok: true, json: async () => ({ meals: [] }) }, code: 'invalid_image_url' },
    {
      response: { ok: true, json: async () => ({ meals: [{ strMealThumb: 'http://images.example/meal.jpg' }] }) },
      code: 'invalid_image_url',
    },
    { response: { ok: true, json: async () => { throw new SyntaxError('bad json'); } }, code: 'invalid_image_response' },
  ];

  for (const { response, code } of cases) {
    const service = new FunImageService({ fetchImpl: async () => response });
    await assert.rejects(
      () => service.getImage('meal'),
      (error) => error instanceof FunImageError && error.code === code,
    );
  }
});

test('cooldowns are separate by command, server, and user and can be released', () => {
  let currentTime = 10_000;
  const service = new FunImageService({
    fetchImpl: async () => {},
    now: () => currentTime,
  });

  const first = service.acquire('meal', 'guild-1', 'user-1');
  assert.equal(first.allowed, true);
  assert.deepEqual(service.acquire('meal', 'guild-1', 'user-1'), {
    allowed: false,
    retryAfterSeconds: 5,
  });
  assert.equal(service.acquire('cat', 'guild-1', 'user-1').allowed, true);
  assert.equal(service.acquire('meal', 'guild-2', 'user-1').allowed, true);
  assert.equal(service.acquire('meal', 'guild-1', 'user-2').allowed, true);

  service.release('meal', 'guild-1', 'user-1', Symbol('wrong lease'));
  assert.equal(service.acquire('meal', 'guild-1', 'user-1').allowed, false);
  service.release('meal', 'guild-1', 'user-1', first.leaseId);
  assert.equal(service.acquire('meal', 'guild-1', 'user-1').allowed, true);

  currentTime += 5_000;
  assert.equal(service.acquire('cat', 'guild-1', 'user-1').allowed, true);
});

test('successful commands publish an image-only embed', async () => {
  for (const [execute, kind, imageUrl] of [
    [executeMeal, 'meal', 'https://images.example/meal.jpg'],
    [executeCat, 'cat', 'https://images.example/cat.jpg'],
  ]) {
    const interaction = createInteraction();
    const funImageService = {
      acquire: (actualKind) => {
        assert.equal(actualKind, kind);
        return { allowed: true, leaseId: Symbol('lease') };
      },
      getImage: async (actualKind) => {
        assert.equal(actualKind, kind);
        return imageUrl;
      },
      release: () => assert.fail('successful request must keep its cooldown'),
    };

    await execute(interaction, { funImageService });
    assert.equal(interaction.calls.deferred, 1);
    assert.equal(interaction.calls.replies.length, 0);
    assert.equal(interaction.calls.edits.length, 1);
    const payload = interaction.calls.edits[0];
    assert.equal(payload.content, undefined);
    assert.deepEqual(payload.embeds[0].toJSON(), { image: { url: imageUrl } });
  }
});

test('cooldown and channel validation replies are private', async () => {
  const cooldownInteraction = createInteraction();
  await executeMeal(cooldownInteraction, {
    funImageService: {
      acquire: () => ({ allowed: false, retryAfterSeconds: 4 }),
    },
  });
  assert.equal(cooldownInteraction.calls.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(cooldownInteraction.calls.replies[0].content, /4 秒/);
  assert.equal(cooldownInteraction.calls.deferred, 0);

  const dmInteraction = createInteraction({
    inGuild: () => false,
    guild: null,
    channel: null,
  });
  await executeCat(dmInteraction, { funImageService: {} });
  assert.equal(dmInteraction.calls.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(dmInteraction.calls.replies[0].content, /伺服器文字頻道/);
});

test('API failure releases cooldown and replaces the deferred reply with a short error', async () => {
  const interaction = createInteraction();
  const leaseId = Symbol('lease');
  const releases = [];
  const funImageService = {
    acquire: () => ({ allowed: true, leaseId }),
    getImage: async () => { throw new FunImageError('image_api_status'); },
    release: (...args) => releases.push(args),
  };

  await executeCat(interaction, { funImageService });
  assert.deepEqual(releases, [['cat', 'guild-1', 'user-1', leaseId]]);
  assert.match(interaction.calls.edits[0].content, /稍後再試/);
  assert.deepEqual(interaction.calls.edits[0].embeds, []);
});

test('missing embed permission is explained privately before using the API', async () => {
  const interaction = createInteraction({ appPermissions: { has: () => false } });
  await executeMeal(interaction, { funImageService: {} });
  assert.equal(interaction.calls.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(interaction.calls.replies[0].content, /嵌入連結/);
});
