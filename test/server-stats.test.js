import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { MemberTracker } from '../src/member-tracker.js';
import { ServerStatsService, serverStatsWindow } from '../src/server-stats.js';
import { data, execute } from '../src/commands/activity/server-stats.js';

test('server stats window starts on the first of 30 Taipei calendar days', () => {
  const window = serverStatsWindow(Date.parse('2026-10-05T18:00:00Z'));
  assert.equal(window.startDate, '2026-09-07');
});

test('member tracker excludes bots when synchronizing the roster', async () => {
  let synced;
  const tracker = new MemberTracker({
    syncMembers: async (...args) => {
      synced = args;
      return { members: args[1].length, joined: 0, left: 0, firstSync: true };
    },
  }, { info: () => {} });
  const joinedAt = new Date('2026-10-01T00:00:00Z');
  const guild = {
    id: 'guild',
    members: {
      fetch: async () => new Map([
        ['human', { id: 'human', joinedAt, user: { bot: false } }],
        ['bot', { id: 'bot', joinedAt, user: { bot: true } }],
      ]),
    },
  };

  await tracker.initializeGuild(guild, Date.parse('2026-10-05T00:00:00Z'));
  assert.deepEqual(synced[1], [{ userId: 'human', joinedAt }]);
});

test('server stats combine current roster, activity, events, and growth', async () => {
  const now = Date.parse('2026-10-05T18:00:00Z');
  const service = new ServerStatsService({
    getServerStats: async () => ({
      trackingStartedAt: new Date('2026-10-05T00:00:00Z'),
      currentMembers: 10,
      activeMembers: 4,
      events: [
        { event_type: 'join', local_date: '2026-10-05', count: 2 },
        { event_type: 'leave', local_date: '2026-10-05', count: 1 },
      ],
    }),
  }, {
    catchUpGuild: async () => ({ readable: [{ id: 'channel' }], skippedChannels: 1 }),
  });
  const result = await service.getStats({ id: 'guild' }, {}, now);

  assert.equal(result.currentMembers, 10);
  assert.equal(result.activeMembers, 4);
  assert.equal(result.sleepingMembers, 6);
  assert.equal(result.newMembers, 2);
  assert.equal(result.leftMembers, 1);
  assert.equal(result.netGrowth, 1);
  assert.equal(result.growthRate, 100 / 9);
  assert.equal(result.complete, false);
  assert.equal(result.skippedChannels, 1);
});

test('server stats command is administrator-only and returns a public embed', async () => {
  const definition = data.toJSON();
  assert.equal(definition.name, '伺服器統計');
  assert.equal(definition.default_member_permissions, PermissionFlagsBits.Administrator.toString());

  let reply;
  const now = Date.now();
  const interaction = {
    inGuild: () => true,
    guild: { id: 'guild', name: '測試伺服器' },
    client: { user: { id: 'bot' } },
    memberPermissions: { has: () => true },
    deferReply: async () => {},
    editReply: async (value) => { reply = value; },
  };
  await execute(interaction, {
    serverStatsService: {
      getStats: async () => ({
        currentMembers: 100,
        newMembers: 12,
        leftMembers: 2,
        activeMembers: 60,
        sleepingMembers: 40,
        netGrowth: 10,
        growthRate: 10 / 90 * 100,
        trackingStartedAt: now,
        complete: false,
        skippedChannels: 0,
        startAt: now - 29 * 86_400_000,
        endAt: now,
      }),
    },
  });

  const embed = reply.embeds[0].toJSON();
  assert.equal(embed.title, '伺服器統計');
  assert.match(embed.description, /測試伺服器/);
  assert.match(embed.fields[1].value, /\+12/);
  assert.match(embed.fields[5].value, /\+10/);
  assert.equal(embed.fields.length, 6);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});
