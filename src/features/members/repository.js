export class MemberRepository {
  constructor(pool) {
    this.pool = pool;
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

  async syncMembers(guildId, members, cutoff, at = new Date()) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.ensureGuildWithClient(client, guildId, at);
      const state = await client.query(
        `SELECT member_tracking_started_at FROM guild_tracking_state
         WHERE guild_id = $1 FOR UPDATE`,
        [guildId],
      );
      const firstSync = !state.rows[0].member_tracking_started_at;
      if (firstSync) {
        await client.query(
          `UPDATE guild_tracking_state SET member_tracking_started_at = $2 WHERE guild_id = $1`,
          [guildId, at],
        );
      }

      const stored = await client.query(
        'SELECT user_id FROM guild_members_current WHERE guild_id = $1 FOR UPDATE',
        [guildId],
      );
      const storedIds = new Set(stored.rows.map((row) => row.user_id));
      const currentIds = new Set(members.map((member) => member.userId));
      let joined = 0;
      let left = 0;

      for (const member of members) {
        await client.query(
          `INSERT INTO guild_members_current
             (guild_id, user_id, joined_at, first_seen_at, last_seen_at)
           VALUES ($1, $2, $3, $4, $4)
           ON CONFLICT (guild_id, user_id) DO UPDATE SET
             joined_at = EXCLUDED.joined_at,
             last_seen_at = EXCLUDED.last_seen_at`,
          [guildId, member.userId, member.joinedAt, at],
        );
        if (!storedIds.has(member.userId)) {
          const eventAt = member.joinedAt >= cutoff ? member.joinedAt : at;
          if (!firstSync || member.joinedAt >= cutoff) {
            await client.query(
              `INSERT INTO guild_member_events
                 (guild_id, user_id, event_type, occurred_at, source)
               VALUES ($1, $2, 'join', $3, $4)
               ON CONFLICT DO NOTHING`,
              [guildId, member.userId, eventAt, firstSync ? 'initial' : 'reconcile'],
            );
            joined += 1;
          }
        }
      }

      if (!firstSync) {
        for (const userId of storedIds) {
          if (currentIds.has(userId)) continue;
          await client.query(
            `DELETE FROM guild_members_current WHERE guild_id = $1 AND user_id = $2`,
            [guildId, userId],
          );
          await client.query(
            `INSERT INTO guild_member_events
               (guild_id, user_id, event_type, occurred_at, source)
             VALUES ($1, $2, 'leave', $3, 'reconcile')
             ON CONFLICT DO NOTHING`,
            [guildId, userId, at],
          );
          left += 1;
        }
      }

      await client.query('COMMIT');
      return { members: members.length, joined, left, firstSync };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async addMember(guildId, userId, joinedAt, at = new Date()) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.ensureGuildWithClient(client, guildId, at);
      await client.query(
        `UPDATE guild_tracking_state
         SET member_tracking_started_at = COALESCE(member_tracking_started_at, $2)
         WHERE guild_id = $1`,
        [guildId, at],
      );
      const existing = await client.query(
        `SELECT user_id FROM guild_members_current
         WHERE guild_id = $1 AND user_id = $2 FOR UPDATE`,
        [guildId, userId],
      );
      await client.query(
        `INSERT INTO guild_members_current
           (guild_id, user_id, joined_at, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET
           joined_at = EXCLUDED.joined_at,
           last_seen_at = EXCLUDED.last_seen_at`,
        [guildId, userId, joinedAt, at],
      );
      if (existing.rowCount === 0) {
        await client.query(
          `INSERT INTO guild_member_events
             (guild_id, user_id, event_type, occurred_at, source)
           VALUES ($1, $2, 'join', $3, 'gateway')
           ON CONFLICT DO NOTHING`,
          [guildId, userId, joinedAt],
        );
      }
      await client.query('COMMIT');
      return existing.rowCount === 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async removeMember(guildId, userId, at = new Date()) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const removed = await client.query(
        `DELETE FROM guild_members_current
         WHERE guild_id = $1 AND user_id = $2 RETURNING user_id`,
        [guildId, userId],
      );
      if (removed.rowCount > 0) {
        await client.query(
          `INSERT INTO guild_member_events
             (guild_id, user_id, event_type, occurred_at, source)
           VALUES ($1, $2, 'leave', $3, 'gateway')
           ON CONFLICT DO NOTHING`,
          [guildId, userId, at],
        );
      }
      await client.query('COMMIT');
      return removed.rowCount > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getServerStats(guildId, startDate, startAt, endAt, channelIds) {
    const [state, current, active, events] = await Promise.all([
      this.pool.query(
        `SELECT member_tracking_started_at FROM guild_tracking_state WHERE guild_id = $1`,
        [guildId],
      ),
      this.pool.query(
        'SELECT COUNT(*)::integer AS count FROM guild_members_current WHERE guild_id = $1',
        [guildId],
      ),
      this.pool.query(
        `SELECT COUNT(*)::integer AS count
         FROM guild_members_current member
         WHERE member.guild_id = $1 AND (
           EXISTS (
             SELECT 1 FROM daily_message_counts message
             WHERE message.guild_id = member.guild_id AND message.user_id = member.user_id
               AND message.local_date >= $2 AND message.message_count > 0
               AND message.channel_id = ANY($5::text[])
           ) OR EXISTS (
             SELECT 1 FROM voice_sessions voice
             WHERE voice.guild_id = member.guild_id AND voice.user_id = member.user_id
               AND voice.joined_at < $4 AND COALESCE(voice.left_at, $4) > $3
           )
         )`,
        [guildId, startDate, startAt, endAt, channelIds],
      ),
      this.pool.query(
        `SELECT event_type,
                (occurred_at AT TIME ZONE 'Asia/Taipei')::date::text AS local_date,
                COUNT(*)::integer AS count
         FROM guild_member_events
         WHERE guild_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
         GROUP BY event_type, local_date
         ORDER BY local_date`,
        [guildId, startAt, endAt],
      ),
    ]);
    return {
      trackingStartedAt: state.rows[0]?.member_tracking_started_at ?? null,
      currentMembers: current.rows[0].count,
      activeMembers: active.rows[0].count,
      events: events.rows,
    };
  }
}
