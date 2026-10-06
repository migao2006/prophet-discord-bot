import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../src/infrastructure/database/migrate.js';
import { WerewolfRepository } from '../src/features/games/werewolf/repository.js';
import { GameProgressRepository } from '../src/features/games/progress/repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

test('PostgreSQL werewolf reservations, phase races, rollback, and winner rewards survive recovery', {
  skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
}, async () => {
  const schema = `werewolf_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString });
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await migrate(pool);
    await migrate(pool);
    let now = 1000;
    const progress = new GameProgressRepository(pool);
    const repository = new WerewolfRepository(pool, progress, () => now);
    const scope = { guildId: 'guild', channelId: 'one' };
    let room = await repository.create('guild', 'one', 'host');
    await assert.rejects(repository.create('guild', 'one', 'other'), /已有遊戲/);
    await assert.rejects(repository.create('other-guild', 'two', 'host'), /另一局/);
    assert.equal(await repository.getActive('other-guild', 'two'), null);
    await assert.rejects(repository.control(room.id, room.revision, 'other', 'cancel', false, scope), /只有房主/);
    await assert.rejects(repository.control(room.id, room.revision, 'host', 'start', false, scope), /6～10/);
    const initialRevision = room.revision;
    for (let index = 1; index <= 5; index += 1) {
      room = await repository.control(room.id, room.revision, `player${index}`, 'join', false, scope);
    }
    await assert.rejects(repository.control(room.id, initialRevision, 'host', 'start', false, scope), /過期/);
    await assert.rejects(repository.control(room.id, room.revision, 'host', 'start', false,
      { guildId: 'guild', channelId: 'wrong' }), /本局/);
    room = await repository.control(room.id, room.revision, 'host', 'start', false, scope);
    const wolves = room.state.players.filter((player) => player.role === 'wolf');
    const good = room.state.players.find((player) => player.role !== 'wolf');
    await Promise.all(wolves.map((player) => repository.action(room.id, room.revision, player.id, good.id, scope)));
    const selected = await repository.get(room.id);
    assert.equal(selected.revision, room.revision);
    assert.equal(Object.keys(selected.state.actions.wolves).length, 2);
    now = room.state.deadline;
    const expired = await Promise.allSettled([
      repository.expire(room.id, room.revision), repository.expire(room.id, room.revision),
    ]);
    assert.equal(expired.filter((result) => result.status === 'fulfilled').length, 1);
    room = await repository.get(room.id);
    assert.equal(room.state.phase, 'seer');
    assert.equal(room.state.victim, good.id);
    assert.ok(room.state.deadline > now);

    // Prepare a decisive vote: the winning good team includes a previously dead villager.
    const state = room.state;
    state.phase = 'vote';
    state.deadline = now + 1000;
    state.players.find((player) => player.id === wolves[0].id).alive = false;
    const deadGood = state.players.find((player) => player.role === 'villager');
    deadGood.alive = false;
    state.actions.vote = { voter: wolves[1].id };
    state.activity = 1;
    await pool.query('UPDATE werewolf_rooms SET state = $2, deadline = $3 WHERE id = $1',
      [room.id, state, new Date(state.deadline)]);
    now = state.deadline;

    // A failed award rolls back deaths, progress, memberships, and the channel release together.
    let awards = 0;
    const failing = new WerewolfRepository(pool, {
      award: async (client, event) => {
        const result = await progress.award(client, event);
        if (++awards === 2) throw new Error('Injected award failure');
        return result;
      },
    }, () => now);
    await assert.rejects(failing.expire(room.id, room.revision), /Injected/);
    assert.equal((await repository.get(room.id)).state.phase, 'vote');
    assert.equal(Number((await pool.query('SELECT count(*) FROM game_xp_events')).rows[0].count), 0);
    assert.equal(await repository.participantRoom(deadGood.id), room.id);
    const finished = await Promise.allSettled([
      repository.expire(room.id, room.revision), repository.expire(room.id, room.revision),
    ]);
    assert.equal(finished.filter((result) => result.status === 'fulfilled').length, 1);
    room = await repository.get(room.id);
    assert.equal(room.state.winner, 'good');
    assert.equal(room.state.effects.length, 4);
    assert.equal(await repository.getActive('guild', 'one'), null);
    assert.equal(await repository.participantRoom(deadGood.id), null);
    for (const player of state.players) {
      const profile = await progress.getProfile(player.id);
      assert.equal(profile.totalXp, player.role === 'wolf' ? 0 : 100);
      assert.equal(profile.werewolfWins, player.role === 'wolf' ? 0 : 1);
    }
    const recovered = new WerewolfRepository(pool, progress, () => now);
    assert.equal((await recovered.listWork()).find((entry) => entry.id === room.id).state.effects.length, 4);
    await recovered.acknowledgePanel(room.id, room.revision, 'message');
    await recovered.acknowledgeEffects(room.id);
    assert.equal((await recovered.listWork()).some((entry) => entry.id === room.id), false);
    const next = await repository.create('guild', 'one', 'host');
    await assert.rejects(repository.cancel(room.id, 'stale cancel'), /結束/);
    assert.equal((await repository.getActive('guild', 'one')).id, next.id);
    let lobby = await repository.control(next.id, next.revision, 'new-host', 'join', false, scope);
    lobby = await repository.control(lobby.id, lobby.revision, 'host', 'leave', false, scope);
    assert.equal(lobby.state.hostId, 'new-host');
    lobby = await repository.control(lobby.id, lobby.revision, 'new-host', 'leave', false, scope);
    assert.equal(lobby.state.phase, 'cancelled');

    const races = await Promise.allSettled([
      repository.create('guild', 'race-one', 'shared'), repository.create('guild', 'race-two', 'shared'),
    ]);
    assert.equal(races.filter((result) => result.status === 'fulfilled').length, 1);
    const reserved = races.find((result) => result.status === 'fulfilled').value;
    now = reserved.state.deadline;
    assert.equal((await repository.expire(reserved.id, reserved.revision)).state.phase, 'cancelled');
    assert.equal(await repository.participantRoom('shared'), null);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
