import { randomUUID } from 'node:crypto';
import { lockChannelGame, setActiveChannelGame } from '../channel-game-registry.js';
import {
  GameRuleError, TERMINAL, advancePhase, cancelGame, newLobby, requireRule, startGame, submitAction,
} from './domain.js';

function roomFromRow(row) {
  if (!row) return null;
  return {
    id: row.id, guildId: row.guild_id, channelId: row.channel_id,
    revision: row.revision, messageId: row.message_id, dirty: row.dirty, state: row.state,
  };
}

export class WerewolfRepository {
  constructor(pool, progressRepository, clock = () => Date.now()) {
    this.pool = pool;
    this.progressRepository = progressRepository;
    this.clock = clock;
  }

  async transaction(task) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await task(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw new GameRuleError('你已經在另一局狼人殺裡囉～請先退出等待房間。');
      throw error;
    } finally {
      client.release();
    }
  }

  async create(guildId, channelId, userId) {
    return this.transaction(async (client) => {
      await client.query('INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [guildId]);
      const active = await lockChannelGame(client, guildId, channelId);
      requireRule(!active, '這個頻道已有遊戲，請先關閉原本的遊戲再開房～');
      const id = randomUUID();
      const state = newLobby(userId, this.clock());
      const result = await client.query(
        `INSERT INTO werewolf_rooms (id, guild_id, channel_id, state, deadline)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, guildId, channelId, state, new Date(state.deadline)],
      );
      await client.query('INSERT INTO werewolf_memberships (user_id, room_id) VALUES ($1, $2)', [userId, id]);
      await setActiveChannelGame(client, guildId, channelId, 'werewolf');
      return roomFromRow(result.rows[0]);
    });
  }

  async get(id) {
    const result = await this.pool.query('SELECT * FROM werewolf_rooms WHERE id = $1', [id]);
    return roomFromRow(result.rows[0]);
  }

  async getActive(guildId, channelId) {
    const result = await this.pool.query(
      'SELECT * FROM werewolf_rooms WHERE guild_id = $1 AND channel_id = $2 AND active',
      [guildId, channelId],
    );
    return roomFromRow(result.rows[0]);
  }

  async listWork() {
    const result = await this.pool.query(
      `SELECT * FROM werewolf_rooms
       WHERE active OR dirty OR jsonb_array_length(state->'effects') > 0`,
    );
    return result.rows.map(roomFromRow);
  }

  async update(id, expectedRevision, task, { publicChange = true, scope = null } = {}) {
    return this.transaction(async (client) => {
      const location = await client.query('SELECT guild_id, channel_id FROM werewolf_rooms WHERE id = $1', [id]);
      requireRule(location.rows.length, '找不到這個房間。');
      const { guild_id: guildId, channel_id: channelId } = location.rows[0];
      requireRule(!scope || (scope.guildId === guildId && scope.channelId === channelId), '請回到本局的頻道操作。');
      await lockChannelGame(client, guildId, channelId);
      const row = (await client.query('SELECT * FROM werewolf_rooms WHERE id = $1 FOR UPDATE', [id])).rows[0];
      requireRule(expectedRevision === null || row.revision === expectedRevision, '這個面板已過期，請使用最新面板。');
      const state = row.state;
      const wasActive = row.active;
      await task(state, client, this.clock());
      const active = !TERMINAL.has(state.phase);
      if (wasActive && !active) {
        if (state.phase === 'ended' && state.winner !== 'draw') {
          const winners = state.players.filter((player) => (player.role === 'wolf') === (state.winner === 'wolf'))
            .sort((a, b) => a.id.localeCompare(b.id));
          for (const player of winners) {
            const progress = await this.progressRepository.award(client, {
              eventKey: `werewolf:${id}:${player.id}`, userId: player.id,
              guildId, channelId, gameType: 'werewolf',
            });
            if (progress.awarded) state.effects.push({ userId: player.id, progress });
          }
        }
        await client.query('DELETE FROM werewolf_memberships WHERE room_id = $1', [id]);
        await setActiveChannelGame(client, guildId, channelId, null);
      }
      const result = await client.query(
        `UPDATE werewolf_rooms SET state = $2, active = $3, deadline = $4,
         revision = revision + $5, dirty = dirty OR $6, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, state, active, state.deadline === null ? null : new Date(state.deadline), publicChange ? 1 : 0, publicChange],
      );
      return roomFromRow(result.rows[0]);
    });
  }

  async control(id, revision, userId, action, isAdmin, scope) {
    return this.update(id, revision, async (state, client, now) => {
      requireRule(!TERMINAL.has(state.phase), '這局已經結束囉～');
      requireRule(action === 'cancel' || now < state.deadline, '倒數已結束，請稍等最新面板。');
      if (action === 'cancel' || action === 'start') {
        requireRule(userId === state.hostId || isAdmin, '只有房主或管理員可以開始、取消遊戲。');
        if (action === 'cancel') cancelGame(state, '房主或管理員取消了這局遊戲。');
        else startGame(state, now);
      } else {
        requireRule(state.phase === 'lobby', '遊戲開始後不能加入或退出。');
        if (action === 'join') {
          requireRule(!state.players.some((player) => player.id === userId), '你已經加入了唷～');
          requireRule(state.players.length < 10, '房間已滿 10 人囉～');
          await client.query('INSERT INTO werewolf_memberships (user_id, room_id) VALUES ($1, $2)', [userId, id]);
          state.players.push({ id: userId, alive: true });
        } else if (action === 'leave') {
          requireRule(state.players.some((player) => player.id === userId), '你還沒加入這局。');
          await client.query('DELETE FROM werewolf_memberships WHERE user_id = $1 AND room_id = $2', [userId, id]);
          state.players = state.players.filter((player) => player.id !== userId);
          if (!state.players.length) cancelGame(state, '房間已經沒有玩家囉～');
          else if (state.hostId === userId) state.hostId = state.players[0].id;
        } else throw new GameRuleError('不支援的房間操作。');
      }
    }, { scope });
  }

  async action(id, revision, userId, target, scope) {
    return this.update(id, revision, (state, _client, now) => {
      submitAction(state, userId, target, now);
    }, { publicChange: false, scope });
  }

  async expire(id, revision) {
    return this.update(id, revision, (state, _client, now) => advancePhase(state, now));
  }

  async cancel(id, reason) {
    return this.update(id, null, (state) => {
      requireRule(!TERMINAL.has(state.phase), '這局已經結束囉～');
      cancelGame(state, reason);
    });
  }

  async acknowledgePanel(id, revision, messageId) {
    await this.pool.query(
      'UPDATE werewolf_rooms SET message_id = $3, dirty = false WHERE id = $1 AND revision = $2',
      [id, revision, messageId],
    );
  }

  async acknowledgeEffects(id) {
    await this.pool.query(
      `UPDATE werewolf_rooms SET state = jsonb_set(state, '{effects}', '[]'::jsonb) WHERE id = $1`,
      [id],
    );
  }

  async participantRoom(userId) {
    const result = await this.pool.query('SELECT room_id FROM werewolf_memberships WHERE user_id = $1', [userId]);
    return result.rows[0]?.room_id ?? null;
  }
}
