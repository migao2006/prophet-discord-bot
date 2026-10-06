import { evaluateGuess, generateSecret } from './game.js';
import {
  GAME_TYPE,
  lockChannelGame,
  setActiveChannelGame,
} from '../channel-game-registry.js';

export class BullsAndCowsRepository {
  constructor(pool, secretGenerator = generateSecret, progressRepository = null) {
    this.pool = pool;
    this.secretGenerator = secretGenerator;
    this.progressRepository = progressRepository;
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
        `SELECT enabled, guess_count
         FROM bulls_and_cows_channels
         WHERE guild_id = $1 AND channel_id = $2
         FOR UPDATE`,
        [guildId, channelId],
      );
      const state = existing.rows[0];

      if (enabled && activeGame && activeGame !== GAME_TYPE.bullsAndCows) {
        await client.query('COMMIT');
        return { changed: false, enabled: false, conflict: activeGame };
      }

      if (enabled && activeGame === GAME_TYPE.bullsAndCows && state?.enabled) {
        await client.query('COMMIT');
        return { changed: false, enabled: true, guessCount: state.guess_count };
      }

      if (enabled) {
        const secret = this.secretGenerator();
        await client.query(
          `INSERT INTO bulls_and_cows_channels
             (guild_id, channel_id, enabled, secret_answer, guess_count)
           VALUES ($1, $2, true, $3, 0)
           ON CONFLICT (guild_id, channel_id) DO UPDATE
           SET enabled = true, secret_answer = EXCLUDED.secret_answer,
               guess_count = 0, updated_at = now()`,
          [guildId, channelId, secret],
        );
        await setActiveChannelGame(client, guildId, channelId, GAME_TYPE.bullsAndCows);
        await client.query('COMMIT');
        return { changed: true, enabled: true, guessCount: 0 };
      }

      const changed = Boolean(state?.enabled);
      if (state) {
        await client.query(
          `UPDATE bulls_and_cows_channels
           SET enabled = false, secret_answer = NULL, guess_count = 0, updated_at = now()
           WHERE guild_id = $1 AND channel_id = $2`,
          [guildId, channelId],
        );
      }
      if (activeGame === GAME_TYPE.bullsAndCows) {
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

  async submitGuess(guildId, channelId, userId, messageId, guess) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT enabled, secret_answer, guess_count
         FROM bulls_and_cows_channels
         WHERE guild_id = $1 AND channel_id = $2
         FOR UPDATE`,
        [guildId, channelId],
      );
      const state = result.rows[0];
      if (!state?.enabled || !state.secret_answer) {
        await client.query('COMMIT');
        return { status: 'disabled' };
      }
      if (!guess) {
        await client.query('COMMIT');
        return { status: 'invalid' };
      }

      const attempt = state.guess_count + 1;
      const score = evaluateGuess(state.secret_answer, guess);
      if (score.a === 4) {
        const answer = state.secret_answer;
        await client.query(
          `UPDATE bulls_and_cows_channels
           SET secret_answer = $3, guess_count = 0, updated_at = now()
           WHERE guild_id = $1 AND channel_id = $2`,
          [guildId, channelId, this.secretGenerator()],
        );
        const progress = this.progressRepository && userId && messageId
          ? await this.progressRepository.award(client, {
            eventKey: `bulls_and_cows:${messageId}`,
            userId, guildId, channelId, gameType: 'bulls_and_cows',
          })
          : null;
        await client.query('COMMIT');
        return {
          status: 'won',
          ...score,
          attempt,
          answer,
          ...(progress ? { progress } : {}),
        };
      }

      await client.query(
        `UPDATE bulls_and_cows_channels
         SET guess_count = $3, updated_at = now()
         WHERE guild_id = $1 AND channel_id = $2`,
        [guildId, channelId, attempt],
      );
      await client.query('COMMIT');
      return { status: 'guessed', ...score, attempt };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
