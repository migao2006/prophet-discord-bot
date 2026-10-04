import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { migrate } from '../src/migrate.js';
import { ActivityRepository } from '../src/activity-repository.js';
import { MemberRepository } from '../src/member-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

test('PostgreSQL migration and activity writes are idempotent', {
  skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
}, async () => {
  const pool = new pg.Pool({ connectionString });
  try {
    await migrate(pool);
    await migrate(pool);
    const repository = new ActivityRepository(pool);
    const guildId = `test-${Date.now()}`;
    await repository.ensureGuild(guildId, new Date('2026-10-04T00:00:00Z'));
    const message = {
      messageId: `message-${Date.now()}`,
      guildId,
      channelId: 'channel',
      userId: 'user',
      localDate: '2026-10-04',
      createdAt: new Date('2026-10-04T01:00:00Z'),
    };

    assert.equal(await repository.recordMessage(message), true);
    assert.equal(await repository.recordMessage(message), false);
    assert.equal(
      await repository.countMessages(guildId, 'user', '2026-10-04', ['channel']),
      1,
    );
    assert.equal(await repository.deleteMessage(message.messageId), true);
    assert.equal(
      await repository.countMessages(guildId, 'user', '2026-10-04', ['channel']),
      0,
    );
    const cursor = await repository.getCursor(guildId, 'channel');
    assert.equal(cursor.last_message_id, message.messageId);

    await repository.prepareChannelBackfill(
      guildId,
      'channel',
      new Date('2026-09-05T16:00:00Z'),
    );
    assert.deepEqual(await repository.getBackfillStatus(guildId, ['channel']), {
      total: 1,
      incomplete: 1,
    });
    await repository.updateChannelBackfill(guildId, 'channel', message.messageId, true);
    assert.deepEqual(await repository.getBackfillStatus(guildId, ['channel']), {
      total: 1,
      incomplete: 0,
    });

    const joinedAt = new Date('2026-10-04T02:00:00Z');
    await repository.ensureVoiceTrackingStarted(guildId, joinedAt);
    await repository.transitionVoiceSession({
      guildId,
      userId: 'user',
      channelId: 'voice',
      at: joinedAt,
    });
    await repository.transitionVoiceSession({
      guildId,
      userId: 'user',
      channelId: null,
      at: new Date('2026-10-04T03:00:00Z'),
    });
    const activity = await repository.getMemberActivity(
      guildId,
      'user',
      '2026-09-06',
      new Date('2026-09-05T16:00:00Z'),
      new Date('2026-10-05T00:00:00Z'),
      ['channel'],
    );
    assert.equal(activity.voiceSessions.length, 1);
    assert.equal(activity.voiceSessions[0].channel_id, 'voice');

    const members = new MemberRepository(pool);
    const syncedAt = new Date('2026-10-04T04:00:00Z');
    const initial = await members.syncMembers(guildId, [
      { userId: 'user', joinedAt: new Date('2026-10-01T00:00:00Z') },
      { userId: 'sleeper', joinedAt: new Date('2026-10-02T00:00:00Z') },
    ], new Date('2026-09-05T16:00:00Z'), syncedAt);
    assert.deepEqual(initial, { members: 2, joined: 2, left: 0, firstSync: true });

    await repository.recordMessage({
      ...message,
      messageId: `active-${Date.now()}`,
      createdAt: new Date('2026-10-04T04:30:00Z'),
    });
    const serverStats = await members.getServerStats(
      guildId,
      '2026-09-06',
      new Date('2026-09-05T16:00:00Z'),
      new Date('2026-10-05T00:00:00Z'),
      ['channel'],
    );
    assert.equal(serverStats.currentMembers, 2);
    assert.equal(serverStats.activeMembers, 1);
    assert.equal(serverStats.events.filter((event) => event.event_type === 'join')[0].count, 2);

    assert.equal(await members.removeMember(guildId, 'sleeper', new Date('2026-10-04T05:00:00Z')), true);
    assert.equal(await members.removeMember(guildId, 'sleeper', new Date('2026-10-04T05:01:00Z')), false);
  } finally {
    await pool.end();
  }
});
