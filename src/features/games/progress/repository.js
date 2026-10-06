import { GAME_XP, progressForXp } from './domain.js';

const COUNTER_COLUMNS = Object.freeze({
  number_chain: 'number_chain_successes',
  bulls_and_cows: 'bulls_and_cows_wins',
  idiom_chain: 'idiom_chain_successes',
  open_book_quiz: 'open_book_correct',
  werewolf: 'werewolf_wins',
});

function toProfile(row, userId) {
  const base = row ?? {
    user_id: userId, total_xp: 0, number_chain_successes: 0,
    bulls_and_cows_wins: 0, idiom_chain_successes: 0, open_book_correct: 0,
  };
  return {
    userId: base.user_id,
    ...progressForXp(base.total_xp),
    numberChainSuccesses: Number(base.number_chain_successes),
    bullsAndCowsWins: Number(base.bulls_and_cows_wins),
    idiomChainSuccesses: Number(base.idiom_chain_successes),
    openBookCorrect: Number(base.open_book_correct),
    werewolfWins: Number(base.werewolf_wins ?? 0),
  };
}

export class GameProgressRepository {
  constructor(pool, logger = null) {
    this.pool = pool;
    this.logger = logger;
  }

  async award(client, { eventKey, userId, guildId, channelId, gameType }) {
    const xp = GAME_XP[gameType];
    const counter = COUNTER_COLUMNS[gameType];
    if (!xp || !counter) throw new Error(`未知遊戲經驗來源：${gameType}`);
    const inserted = await client.query(
      `INSERT INTO game_xp_events (event_key, user_id, guild_id, channel_id, game_type, xp)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING RETURNING event_key`,
      [eventKey, userId, guildId, channelId, gameType, xp],
    );
    if (inserted.rowCount === 0) return { awarded: false };
    const result = await client.query(
      `INSERT INTO game_progress (user_id, total_xp, ${counter})
       VALUES ($1, $2, 1)
       ON CONFLICT (user_id) DO UPDATE SET
         total_xp = game_progress.total_xp + EXCLUDED.total_xp,
         ${counter} = game_progress.${counter} + 1,
         updated_at = now()
       RETURNING *`,
      [userId, xp],
    );
    const profile = toProfile(result.rows[0], userId);
    const previousProgress = progressForXp(profile.totalXp - xp);
    this.logger?.info('game_xp_awarded', {
      userId,
      guildId,
      channelId,
      gameType,
      xp,
      totalXp: profile.totalXp,
      level: profile.level,
    });
    return {
      awarded: true,
      xp,
      profile,
      previousLevel: previousProgress.level,
      leveledUp: profile.level > previousProgress.level,
      titleChanged: profile.totalXp === xp || profile.title !== previousProgress.title,
    };
  }

  async getProfile(userId) {
    const result = await this.pool.query('SELECT * FROM game_progress WHERE user_id = $1', [userId]);
    return toProfile(result.rows[0], userId);
  }

  async getLeaderboard(userIds) {
    if (userIds.length === 0) return [];
    const result = await this.pool.query(
      `SELECT * FROM game_progress
       WHERE user_id = ANY($1::text[]) AND total_xp > 0
       ORDER BY total_xp DESC, updated_at, user_id LIMIT 10`,
      [userIds],
    );
    let previousXp = null;
    let rank = 0;
    return result.rows.map((row, index) => {
      const profile = toProfile(row, row.user_id);
      if (profile.totalXp !== previousXp) rank = index + 1;
      previousXp = profile.totalXp;
      return { ...profile, rank };
    });
  }

  async ensureGuild(guildId) {
    await this.pool.query(
      'INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [guildId],
    );
  }

  async getRoleSetting(guildId) {
    const [setting, roles] = await Promise.all([
      this.pool.query('SELECT enabled FROM guild_game_level_settings WHERE guild_id = $1', [guildId]),
      this.pool.query(
        'SELECT minimum_level, role_id FROM guild_game_level_roles WHERE guild_id = $1',
        [guildId],
      ),
    ]);
    return {
      enabled: setting.rows[0]?.enabled ?? false,
      roles: new Map(roles.rows.map((row) => [Number(row.minimum_level), row.role_id])),
    };
  }

  async setRoleEnabled(guildId, enabled) {
    await this.ensureGuild(guildId);
    await this.pool.query(
      `INSERT INTO guild_game_level_settings (guild_id, enabled)
       VALUES ($1, $2) ON CONFLICT (guild_id) DO UPDATE
       SET enabled = EXCLUDED.enabled, updated_at = now()`,
      [guildId, enabled],
    );
  }

  async saveRole(guildId, minimumLevel, roleId) {
    await this.pool.query(
      `INSERT INTO guild_game_level_roles (guild_id, minimum_level, role_id)
       VALUES ($1, $2, $3) ON CONFLICT (guild_id, minimum_level) DO UPDATE
       SET role_id = EXCLUDED.role_id, updated_at = now()`,
      [guildId, minimumLevel, roleId],
    );
  }

  async listEnabledRoleGuildIds() {
    const result = await this.pool.query(
      'SELECT guild_id FROM guild_game_level_settings WHERE enabled = true',
    );
    return result.rows.map((row) => row.guild_id);
  }

  async listRoleGuildIds() {
    const result = await this.pool.query(
      'SELECT DISTINCT guild_id FROM guild_game_level_roles',
    );
    return result.rows.map((row) => row.guild_id);
  }

  async getLevelNotificationSetting(guildId) {
    const result = await this.pool.query(
      `SELECT enabled, channel_id
       FROM guild_level_notification_settings
       WHERE guild_id = $1`,
      [guildId],
    );
    return {
      enabled: result.rows[0]?.enabled ?? false,
      channelId: result.rows[0]?.channel_id ?? null,
    };
  }

  async setLevelNotification(guildId, enabled, channelId = null) {
    await this.ensureGuild(guildId);
    await this.pool.query(
      `INSERT INTO guild_level_notification_settings (guild_id, enabled, channel_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (guild_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         channel_id = COALESCE(EXCLUDED.channel_id, guild_level_notification_settings.channel_id),
         updated_at = now()`,
      [guildId, enabled, channelId],
    );
  }
}
