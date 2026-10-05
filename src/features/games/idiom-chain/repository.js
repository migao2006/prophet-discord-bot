import {
  GAME_TYPE,
  lockChannelGame,
  setActiveChannelGame,
} from '../channel-game-registry.js';

async function pickOpeningIdiom(client) {
  const result = await client.query(
    `SELECT current.idiom
     FROM idioms current
     WHERE current.active = true
       AND EXISTS (
         SELECT 1
         FROM idioms next
         WHERE next.active = true
           AND left(next.idiom, 1) = right(current.idiom, 1)
           AND next.idiom <> current.idiom
       )
     ORDER BY random()
     LIMIT 1`,
  );
  if (!result.rows[0]) throw new Error('成語詞庫沒有可用的開局詞');
  return result.rows[0].idiom;
}

async function resetRound(client, guildId, channelId) {
  const openingIdiom = await pickOpeningIdiom(client);
  await client.query(
    'DELETE FROM idiom_chain_used WHERE guild_id = $1 AND channel_id = $2',
    [guildId, channelId],
  );
  await client.query(
    `INSERT INTO idiom_chain_used (guild_id, channel_id, idiom)
     VALUES ($1, $2, $3)`,
    [guildId, channelId, openingIdiom],
  );
  await client.query(
    `UPDATE idiom_chain_channels
     SET current_idiom = $3, last_user_id = NULL, updated_at = now()
     WHERE guild_id = $1 AND channel_id = $2`,
    [guildId, channelId, openingIdiom],
  );
  return openingIdiom;
}

export class IdiomChainRepository {
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
      const activeGame = await lockChannelGame(client, guildId, channelId);
      const existing = await client.query(
        `SELECT enabled, current_idiom
         FROM idiom_chain_channels
         WHERE guild_id = $1 AND channel_id = $2
         FOR UPDATE`,
        [guildId, channelId],
      );
      const state = existing.rows[0];

      if (enabled && activeGame && activeGame !== GAME_TYPE.idiomChain) {
        await client.query('COMMIT');
        return { changed: false, enabled: false, conflict: activeGame };
      }
      if (enabled && state?.enabled) {
        await client.query('COMMIT');
        return { changed: false, enabled: true, currentIdiom: state.current_idiom };
      }

      if (enabled) {
        const openingIdiom = await pickOpeningIdiom(client);
        await client.query(
          `INSERT INTO idiom_chain_channels
             (guild_id, channel_id, enabled, current_idiom, last_user_id)
           VALUES ($1, $2, true, $3, NULL)
           ON CONFLICT (guild_id, channel_id) DO UPDATE
           SET enabled = true, current_idiom = EXCLUDED.current_idiom,
               last_user_id = NULL, updated_at = now()`,
          [guildId, channelId, openingIdiom],
        );
        await client.query(
          'DELETE FROM idiom_chain_used WHERE guild_id = $1 AND channel_id = $2',
          [guildId, channelId],
        );
        await client.query(
          `INSERT INTO idiom_chain_used (guild_id, channel_id, idiom)
           VALUES ($1, $2, $3)`,
          [guildId, channelId, openingIdiom],
        );
        await setActiveChannelGame(client, guildId, channelId, GAME_TYPE.idiomChain);
        await client.query('COMMIT');
        return { changed: true, enabled: true, currentIdiom: openingIdiom };
      }

      const changed = Boolean(state?.enabled);
      if (state) {
        await client.query(
          `UPDATE idiom_chain_channels
           SET enabled = false, current_idiom = NULL, last_user_id = NULL, updated_at = now()
           WHERE guild_id = $1 AND channel_id = $2`,
          [guildId, channelId],
        );
        await client.query(
          'DELETE FROM idiom_chain_used WHERE guild_id = $1 AND channel_id = $2',
          [guildId, channelId],
        );
      }
      if (activeGame === GAME_TYPE.idiomChain) {
        await setActiveChannelGame(client, guildId, channelId, null);
      }
      await client.query('COMMIT');
      return { changed, enabled: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async tryAdvance(guildId, channelId, userId, idiom) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const stateResult = await client.query(
        `SELECT enabled, current_idiom, last_user_id
         FROM idiom_chain_channels
         WHERE guild_id = $1 AND channel_id = $2
         FOR UPDATE`,
        [guildId, channelId],
      );
      const state = stateResult.rows[0];
      if (!state?.enabled || !state.current_idiom) {
        await client.query('COMMIT');
        return { status: 'disabled' };
      }

      const dictionaryResult = await client.query(
        'SELECT idiom FROM idioms WHERE idiom = $1 AND active = true',
        [idiom],
      );
      if (dictionaryResult.rowCount === 0) {
        await client.query('COMMIT');
        return { status: 'incorrect', reason: 'not_found' };
      }
      if (state.last_user_id === userId) {
        await client.query('COMMIT');
        return { status: 'incorrect', reason: 'same_user' };
      }

      const usedResult = await client.query(
        `SELECT 1 FROM idiom_chain_used
         WHERE guild_id = $1 AND channel_id = $2 AND idiom = $3`,
        [guildId, channelId, idiom],
      );
      if (usedResult.rowCount > 0) {
        await client.query('COMMIT');
        return { status: 'incorrect', reason: 'already_used' };
      }

      const expected = Array.from(state.current_idiom).at(-1);
      if (Array.from(idiom)[0] !== expected) {
        await client.query('COMMIT');
        return { status: 'incorrect', reason: 'wrong_start', expected };
      }

      await client.query(
        `INSERT INTO idiom_chain_used (guild_id, channel_id, idiom)
         VALUES ($1, $2, $3)`,
        [guildId, channelId, idiom],
      );
      const nextResult = await client.query(
        `SELECT EXISTS (
           SELECT 1
           FROM idioms candidate
           WHERE candidate.active = true
             AND left(candidate.idiom, 1) = right($3, 1)
             AND NOT EXISTS (
               SELECT 1
               FROM idiom_chain_used used
               WHERE used.guild_id = $1
                 AND used.channel_id = $2
                 AND used.idiom = candidate.idiom
             )
         ) AS has_next`,
        [guildId, channelId, idiom],
      );

      if (!nextResult.rows[0].has_next) {
        const openingIdiom = await resetRound(client, guildId, channelId);
        await client.query('COMMIT');
        return { status: 'round_complete', idiom, openingIdiom };
      }

      await client.query(
        `UPDATE idiom_chain_channels
         SET current_idiom = $3, last_user_id = $4, updated_at = now()
         WHERE guild_id = $1 AND channel_id = $2`,
        [guildId, channelId, idiom, userId],
      );
      await client.query('COMMIT');
      return { status: 'correct', idiom };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
