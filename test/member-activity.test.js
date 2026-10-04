import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { data, execute } from '../src/commands/activity/member-activity.js';
import {
  formatTaipeiActivity,
  formatVoiceDuration,
  memberActivityWindow,
  summarizeVoiceSessions,
} from '../src/features/activity/domain.js';
import { VoiceTracker } from '../src/features/activity/voice-tracker.js';

test('member activity uses 30 Taipei calendar days and formats output', () => {
  const now = Date.parse('2026-10-04T18:30:00Z');
  const window = memberActivityWindow(now);
  assert.equal(window.startDate, '2026-09-06');
  assert.equal(window.startAt, Date.parse('2026-09-05T16:00:00Z'));
  assert.equal(formatTaipeiActivity(Date.parse('2026-10-04T17:31:00Z'), now), '今天 01:31');
  assert.equal(formatVoiceDuration(18 * 3_600 + 32 * 60 + 59), '18 小時 32 分');
});

test('voice summary clips sessions to the window and counts crossed Taipei dates', () => {
  const startAt = Date.parse('2026-10-03T16:00:00Z');
  const endAt = Date.parse('2026-10-04T18:00:00Z');
  const summary = summarizeVoiceSessions([
    {
      joined_at: new Date('2026-10-04T15:30:00Z'),
      left_at: new Date('2026-10-04T16:30:00Z'),
    },
    {
      joined_at: new Date('2026-10-04T17:30:00Z'),
      left_at: null,
    },
  ], startAt, endAt);
  assert.equal(summary.seconds, 5_400);
  assert.deepEqual(summary.activeDates.sort(), ['2026-10-04', '2026-10-05']);
  assert.equal(summary.lastActivityAt, endAt);
});

test('voice tracker excludes AFK and records channel transitions', async () => {
  const transitions = [];
  const tracker = new VoiceTracker({
    transitionVoiceSession: async (value) => transitions.push(value),
  }, { error: () => {} });
  const guild = { id: 'guild', afkChannelId: 'afk' };
  const at = new Date('2026-10-04T12:00:00Z');

  await tracker.handleVoiceStateUpdate(
    { id: 'user', guild, channelId: null },
    { id: 'user', guild, channelId: 'voice' },
    at,
  );
  await tracker.handleVoiceStateUpdate(
    { id: 'user', guild, channelId: 'voice' },
    { id: 'user', guild, channelId: 'afk' },
    at,
  );

  assert.deepEqual(transitions.map((value) => value.channelId), ['voice', null]);
});

test('member activity command is administrator-only and renders the public report', async () => {
  const definition = data.toJSON();
  assert.equal(definition.name, '成員活躍查詢');
  assert.equal(definition.default_member_permissions, PermissionFlagsBits.Administrator.toString());
  assert.equal(definition.options[0].name, '使用者');

  let reply;
  const now = Date.now();
  const interaction = {
    inGuild: () => true,
    guild: { id: 'guild' },
    client: { user: { id: 'bot' } },
    memberPermissions: { has: (permission) => permission === PermissionFlagsBits.Administrator },
    options: { getUser: () => ({ id: '123456789012345678' }) },
    deferReply: async () => {},
    editReply: async (value) => { reply = value; },
  };
  await execute(interaction, {
    activityService: {
      getMemberActivity: async () => ({
        messageCount: 1_284,
        activeDays: 24,
        voiceSeconds: 18 * 3_600 + 32 * 60,
        lastActivityAt: now,
        topChannels: [{ channelId: '234567890123456789', messageCount: 500 }],
        scannedChannels: 3,
        skippedChannels: 0,
        messageBackfillComplete: true,
        voiceTrackingStartedAt: new Date(now - 1_000),
        startAt: now - 29 * 86_400_000,
        endAt: now,
      }),
    },
  });

  const embed = reply.embeds[0].toJSON();
  assert.match(embed.description, /123456789012345678/);
  assert.match(embed.fields[0].value, /1,284/);
  assert.match(embed.fields[2].value, /18 小時 32 分/);
  assert.match(embed.fields[4].value, /234567890123456789/);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});
