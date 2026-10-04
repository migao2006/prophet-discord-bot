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

  async ensureVoiceTrackingStarted(guildId, startedAt = new Date()) {
    await this.ensureGuild(guildId, startedAt);
    const result = await this.pool.query(
      `UPDATE guild_tracking_state
       SET voice_tracking_started_at = COALESCE(voice_tracking_started_at, $2)
       WHERE guild_id = $1
       RETURNING voice_tracking_started_at`,
      [guildId, startedAt],
    );
    return result.rows[0].voice_tracking_started_at;
  }

  async getVoiceTrackingStartedAt(guildId) {
    const result = await this.pool.query(
      'SELECT voice_tracking_started_at FROM guild_tracking_state WHERE guild_id = $1',
      [guildId],
    );
    return result.rows[0]?.voice_tracking_started_at ?? null;
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

  async prepareChannelBackfill(guildId, channelId, cutoff) {
    await this.pool.query(
      `UPDATE channel_cursors
       SET history_cutoff_at = COALESCE(history_cutoff_at, $3),
           history_started_at = COALESCE(history_started_at, now())
       WHERE guild_id = $1 AND channel_id = $2
         AND history_completed_at IS NULL`,
      [guildId, channelId, cutoff],
    );
  }

  async getChannelBackfill(guildId, channelId) {
    const result = await this.pool.query(
      `SELECT history_before_id, history_cutoff_at, history_completed_at
       FROM channel_cursors WHERE guild_id = $1 AND channel_id = $2`,
      [guildId, channelId],
    );
    return result.rows[0] ?? null;
  }

  async updateChannelBackfill(guildId, channelId, beforeId, completed = false) {
    await this.pool.query(
      `UPDATE channel_cursors
       SET history_before_id = $3,
           history_completed_at = CASE WHEN $4 THEN now() ELSE history_completed_at END,
           updated_at = now()
       WHERE guild_id = $1 AND channel_id = $2`,
      [guildId, channelId, beforeId, completed],
    );
  }

  async getBackfillStatus(guildId, channelIds) {
    if (channelIds.length === 0) return { total: 0, incomplete: 0 };
    const result = await this.pool.query(
      `SELECT COUNT(*)::integer AS total,
              COUNT(*) FILTER (WHERE history_completed_at IS NULL)::integer AS incomplete
       FROM channel_cursors
       WHERE guild_id = $1 AND channel_id = ANY($2::text[])`,
      [guildId, channelIds],
    );
    return result.rows[0];
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

  async getMemberActivity(guildId, userId, startDate, startAt, endAt, channelIds) {
    const empty = {
      messageCount: 0,
      messageDates: [],
      lastMessageAt: null,
      topChannels: [],
      voiceSessions: [],
    };
    if (channelIds.length === 0) return empty;

    const [messageSummary, lastMessage, topChannels, voiceSessions] = await Promise.all([
      this.pool.query(
        `SELECT COALESCE(SUM(message_count), 0)::integer AS message_count,
                COALESCE(array_agg(DISTINCT local_date::text)
                  FILTER (WHERE message_count > 0), ARRAY[]::text[]) AS active_dates
         FROM daily_message_counts
         WHERE guild_id = $1 AND user_id = $2 AND local_date >= $3
           AND channel_id = ANY($4::text[])`,
        [guildId, userId, startDate, channelIds],
      ),
      this.pool.query(
        `SELECT MAX(created_at) AS last_message_at
         FROM processed_messages
         WHERE guild_id = $1 AND user_id = $2
           AND created_at >= $3 AND created_at <= $4
           AND channel_id = ANY($5::text[])`,
        [guildId, userId, startAt, endAt, channelIds],
      ),
      this.pool.query(
        `SELECT channel_id, SUM(message_count)::integer AS message_count
         FROM daily_message_counts
         WHERE guild_id = $1 AND user_id = $2 AND local_date >= $3
           AND channel_id = ANY($4::text[])
         GROUP BY channel_id
         ORDER BY message_count DESC, channel_id
         LIMIT 3`,
        [guildId, userId, startDate, channelIds],
      ),
      this.pool.query(
        `SELECT channel_id, joined_at, left_at
         FROM voice_sessions
         WHERE guild_id = $1 AND user_id = $2
           AND joined_at < $4 AND COALESCE(left_at, $4) > $3
         ORDER BY joined_at`,
        [guildId, userId, startAt, endAt],
      ),
    ]);

    return {
      messageCount: messageSummary.rows[0].message_count,
      messageDates: messageSummary.rows[0].active_dates,
      lastMessageAt: lastMessage.rows[0].last_message_at,
      topChannels: topChannels.rows,
      voiceSessions: voiceSessions.rows,
    };
  }

  async transitionVoiceSession({ guildId, userId, channelId, at }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.ensureGuildWithClient(client, guildId, at);
      const open = await client.query(
        `SELECT id, channel_id FROM voice_sessions
         WHERE guild_id = $1 AND user_id = $2 AND left_at IS NULL
         FOR UPDATE`,
        [guildId, userId],
      );
      const current = open.rows[0];
      if (current && current.channel_id !== channelId) {
        await client.query(
          `UPDATE voice_sessions SET left_at = GREATEST(joined_at, $2), last_seen_at = $2
           WHERE id = $1`,
          [current.id, at],
        );
      }
      if (channelId && (!current || current.channel_id !== channelId)) {
        await client.query(
          `INSERT INTO voice_sessions
             (guild_id, user_id, channel_id, joined_at, last_seen_at)
           VALUES ($1, $2, $3, $4, $4)`,
          [guildId, userId, channelId, at],
        );
      } else if (channelId && current) {
        await client.query('UPDATE voice_sessions SET last_seen_at = $2 WHERE id = $1', [current.id, at]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reconcileVoiceSessions(guildId, states, at = new Date()) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.ensureGuildWithClient(client, guildId, at);
      await client.query(
        `UPDATE guild_tracking_state
         SET voice_tracking_started_at = COALESCE(voice_tracking_started_at, $2)
         WHERE guild_id = $1`,
        [guildId, at],
      );
      const open = await client.query(
        `SELECT id, user_id, channel_id, last_seen_at FROM voice_sessions
         WHERE guild_id = $1 AND left_at IS NULL FOR UPDATE`,
        [guildId],
      );
      const current = new Map(states.map((state) => [state.userId, state.channelId]));
      for (const session of open.rows) {
        const channelId = current.get(session.user_id);
        if (channelId === session.channel_id) {
          await client.query('UPDATE voice_sessions SET last_seen_at = $2 WHERE id = $1', [session.id, at]);
          current.delete(session.user_id);
        } else {
          await client.query(
            `UPDATE voice_sessions
             SET left_at = GREATEST(joined_at, last_seen_at), last_seen_at = GREATEST(last_seen_at, joined_at)
             WHERE id = $1`,
            [session.id],
          );
        }
      }
      for (const [userId, channelId] of current) {
        await client.query(
          `INSERT INTO voice_sessions
             (guild_id, user_id, channel_id, joined_at, last_seen_at)
           VALUES ($1, $2, $3, $4, $4)`,
          [guildId, userId, channelId, at],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async touchVoiceSessions(guildId, userIds, at = new Date()) {
    if (userIds.length === 0) return 0;
    const result = await this.pool.query(
      `UPDATE voice_sessions SET last_seen_at = $3
       WHERE guild_id = $1 AND user_id = ANY($2::text[]) AND left_at IS NULL`,
      [guildId, userIds, at],
    );
    return result.rowCount;
  }

  async ensureGuildWithClient(client, guildId, startedAt) {
    await client.query(
      'INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [guildId],
    );
    await client.query(
      `INSERT INTO guild_tracking_state (guild_id, tracking_started_at)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [guildId, startedAt],
    );
  }

  async pruneProcessedMessages(before) {
    const result = await this.pool.query(
      'DELETE FROM processed_messages WHERE created_at < $1',
      [before],
    );
    return result.rowCount;
  }

  async pruneDailyMessageCounts(beforeDate) {
    const result = await this.pool.query(
      'DELETE FROM daily_message_counts WHERE local_date < $1',
      [beforeDate],
    );
    return result.rowCount;
  }

  async pruneVoiceSessions(before) {
    const result = await this.pool.query(
      'DELETE FROM voice_sessions WHERE left_at IS NOT NULL AND left_at < $1',
      [before],
    );
    return result.rowCount;
  }
}
