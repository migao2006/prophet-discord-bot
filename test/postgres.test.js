import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { migrate } from '../src/migrate.js';
import { ActivityRepository } from '../src/activity-repository.js';

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
  } finally {
    await pool.end();
  }
});
