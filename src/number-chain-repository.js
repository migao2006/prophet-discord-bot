export class NumberChainRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async setEnabled(guildId, channelId, enabled) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [guildId],
      );
      const existing = await client.query(
        `SELECT enabled, current_number
         FROM number_chain_channels
         WHERE guild_id = $1 AND channel_id = $2
         FOR UPDATE`,
        [guildId, channelId],
      );
      const state = existing.rows[0];

      if (!state) {
        await client.query(
          `INSERT INTO number_chain_channels
             (guild_id, channel_id, enabled, current_number, last_user_id)
           VALUES ($1, $2, $3, 0, NULL)`,
          [guildId, channelId, enabled],
        );
        await client.query('COMMIT');
        return { changed: enabled, enabled, currentNumber: '0' };
      }

      if (state.enabled === enabled) {
        await client.query('COMMIT');
        return { changed: false, enabled, currentNumber: state.current_number };
      }

      if (enabled) {
        await client.query(
          `UPDATE number_chain_channels
           SET enabled = true, current_number = 0, last_user_id = NULL, updated_at = now()
           WHERE guild_id = $1 AND channel_id = $2`,
          [guildId, channelId],
        );
      } else {
        await client.query(
          `UPDATE number_chain_channels
           SET enabled = false, updated_at = now()
           WHERE guild_id = $1 AND channel_id = $2`,
          [guildId, channelId],
        );
      }
      await client.query('COMMIT');
      return { changed: true, enabled, currentNumber: enabled ? '0' : state.current_number };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async tryAdvance(guildId, channelId, userId, number) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT enabled, current_number, last_user_id
         FROM number_chain_channels
         WHERE guild_id = $1 AND channel_id = $2
         FOR UPDATE`,
        [guildId, channelId],
      );
      const state = result.rows[0];
      if (!state?.enabled) {
        await client.query('COMMIT');
        return { status: 'disabled' };
      }

      const expected = BigInt(state.current_number) + 1n;
      if (number !== expected || state.last_user_id === userId) {
        const reason = state.last_user_id === userId ? 'same_user' : 'wrong_number';
        await client.query(
          `UPDATE number_chain_channels
           SET current_number = 0, last_user_id = NULL, updated_at = now()
           WHERE guild_id = $1 AND channel_id = $2`,
          [guildId, channelId],
        );
        await client.query('COMMIT');
        return { status: 'incorrect', reason, expected: '1' };
      }

      await client.query(
        `UPDATE number_chain_channels
         SET current_number = $3, last_user_id = $4, updated_at = now()
         WHERE guild_id = $1 AND channel_id = $2`,
        [guildId, channelId, number.toString(), userId],
      );
      await client.query('COMMIT');
      return { status: 'correct', currentNumber: number.toString() };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
