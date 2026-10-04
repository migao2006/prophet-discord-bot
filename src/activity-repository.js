export class ActivityRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async ensureGuild(guildId, startedAt = new Date()) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [guildId],
      );
      await client.query(
        `INSERT INTO guild_tracking_state (guild_id, tracking_started_at)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [guildId, startedAt],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resetGuildTracking(guildId, startedAt = new Date()) {
    await this.ensureGuild(guildId, startedAt);
    await this.pool.query(
      `UPDATE guild_tracking_state SET tracking_started_at = $2 WHERE guild_id = $1`,
      [guildId, startedAt],
    );
    await this.pool.query('DELETE FROM channel_cursors WHERE guild_id = $1', [guildId]);
  }

  async getTrackingStartedAt(guildId) {
    const result = await this.pool.query(
      'SELECT tracking_started_at FROM guild_tracking_state WHERE guild_id = $1',
      [guildId],
    );
    return result.rows[0]?.tracking_started_at ?? null;
  }

  async getCursor(guildId, channelId) {
    const result = await this.pool.query(
      `SELECT last_message_id, last_message_timestamp
       FROM channel_cursors WHERE guild_id = $1 AND channel_id = $2`,
      [guildId, channelId],
    );
    return result.rows[0] ?? null;
  }

  async updateCursor(guildId, channelId, messageId, timestamp) {
    await this.pool.query(
      `INSERT INTO channel_cursors
         (guild_id, channel_id, last_message_id, last_message_timestamp)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id, channel_id) DO UPDATE SET
         last_message_id = CASE
           WHEN EXCLUDED.last_message_timestamp >= channel_cursors.last_message_timestamp
           THEN EXCLUDED.last_message_id ELSE channel_cursors.last_message_id END,
         last_message_timestamp = GREATEST(
           EXCLUDED.last_message_timestamp,
           channel_cursors.last_message_timestamp
         ),
         updated_at = now()`,
      [guildId, channelId, messageId, timestamp],
    );
  }

  async recordMessage({ messageId, guildId, channelId, userId, localDate, createdAt }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO processed_messages
           (message_id, guild_id, channel_id, user_id, local_date, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING RETURNING message_id`,
        [messageId, guildId, channelId, userId, localDate, createdAt],
      );
      if (inserted.rowCount > 0) {
        await client.query(
          `INSERT INTO daily_message_counts
             (guild_id, channel_id, user_id, local_date, message_count)
           VALUES ($1, $2, $3, $4, 1)
           ON CONFLICT (guild_id, channel_id, user_id, local_date)
           DO UPDATE SET message_count = daily_message_counts.message_count + 1`,
          [guildId, channelId, userId, localDate],
        );
      }
      await client.query(
        `INSERT INTO channel_cursors
           (guild_id, channel_id, last_message_id, last_message_timestamp)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (guild_id, channel_id) DO UPDATE SET
           last_message_id = CASE
             WHEN EXCLUDED.last_message_timestamp >= channel_cursors.last_message_timestamp
             THEN EXCLUDED.last_message_id ELSE channel_cursors.last_message_id END,
           last_message_timestamp = GREATEST(
             EXCLUDED.last_message_timestamp,
             channel_cursors.last_message_timestamp
           ),
           updated_at = now()`,
        [guildId, channelId, messageId, createdAt.getTime()],
      );
      await client.query('COMMIT');
      return inserted.rowCount > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteMessage(messageId) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const deleted = await client.query(
        `DELETE FROM processed_messages WHERE message_id = $1
         RETURNING guild_id, channel_id, user_id, local_date`,
        [messageId],
      );
      if (deleted.rowCount > 0) {
        const row = deleted.rows[0];
        await client.query(
          `UPDATE daily_message_counts
           SET message_count = GREATEST(message_count - 1, 0)
           WHERE guild_id = $1 AND channel_id = $2 AND user_id = $3 AND local_date = $4`,
          [row.guild_id, row.channel_id, row.user_id, row.local_date],
        );
        await client.query(
          `DELETE FROM daily_message_counts
           WHERE guild_id = $1 AND channel_id = $2 AND user_id = $3
             AND local_date = $4 AND message_count = 0`,
          [row.guild_id, row.channel_id, row.user_id, row.local_date],
        );
      }
      await client.query('COMMIT');
      return deleted.rowCount > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async countMessages(guildId, userId, localDate, channelIds) {
    if (channelIds.length === 0) return 0;
    const result = await this.pool.query(
      `SELECT COALESCE(SUM(message_count), 0)::integer AS count
       FROM daily_message_counts
       WHERE guild_id = $1 AND user_id = $2 AND local_date = $3
         AND channel_id = ANY($4::text[])`,
      [guildId, userId, localDate, channelIds],
    );
    return result.rows[0].count;
  }

  async pruneProcessedMessages(before) {
    const result = await this.pool.query(
      'DELETE FROM processed_messages WHERE created_at < $1',
      [before],
    );
    return result.rowCount;
  }
}
