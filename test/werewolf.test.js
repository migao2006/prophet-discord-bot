import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import {
  DURATIONS, advancePhase, assignRoles, newLobby, roleDeck, startGame, submitAction, topVote, victory,
} from '../src/features/games/werewolf/domain.js';
import { privatePayload, publicPayload } from '../src/features/games/werewolf/views.js';
import { WerewolfService } from '../src/features/games/werewolf/service.js';
import { createInteractionHandler } from '../src/discord/interaction-router.js';
import { data } from '../src/commands/games/werewolf.js';

function game() {
  const state = newLobby('wolf1', 1000);
  state.players = [
    { id: 'wolf1', role: 'wolf', alive: true },
    { id: 'wolf2', role: 'wolf', alive: true },
    { id: 'seer', role: 'seer', alive: true },
    { id: 'witch', role: 'witch', alive: true },
    { id: 'villager1', role: 'villager', alive: true },
    { id: 'villager2', role: 'villager', alive: true },
  ];
  state.phase = 'wolves';
  state.round = 1;
  state.deadline = 46000;
  return state;
}

function room(state = game()) {
  return { id: '11111111-1111-4111-8111-111111111111', guildId: 'guild', channelId: 'channel', revision: 3, state };
}

test('all supported rosters have exactly one seer and witch, with two or three wolves', () => {
  for (let count = 6; count <= 10; count += 1) {
    const deck = roleDeck(count);
    assert.equal(deck.length, count);
    assert.equal(deck.filter((role) => role === 'wolf').length, count >= 9 ? 3 : 2);
    assert.equal(deck.filter((role) => role === 'seer').length, 1);
    assert.equal(deck.filter((role) => role === 'witch').length, 1);
    assert.equal(assignRoles(Array.from({ length: count }, (_, id) => ({ id }))).length, count);
  }
  assert.throws(() => roleDeck(5));
  assert.throws(() => roleDeck(11));
  const lobby = newLobby('host', 0);
  assert.throws(() => startGame(lobby, 0));
});

test('wolf ties are random among the highest choices; daytime ties and abstentions expel nobody', () => {
  assert.equal(topVote(['a', 'b'], true, () => 1), 'b');
  assert.equal(topVote(['a', 'a', 'b'], true), 'a');
  assert.equal(topVote(['a', 'b']), null);
  assert.equal(topVote(['skip', 'skip']), null);
});

test('wolves cannot target teammates and a replacement selection counts only once in tally', () => {
  const state = game();
  assert.throws(() => submitAction(state, 'wolf1', 'wolf2', 1000));
  submitAction(state, 'wolf1', 'seer', 1000);
  submitAction(state, 'wolf1', 'villager1', 1000);
  submitAction(state, 'wolf2', 'villager1', 1000);
  advancePhase(state, state.deadline);
  assert.equal(state.victim, 'villager1');
  assert.equal(state.phase, 'seer');
  assert.equal(state.deadline, 46000 + DURATIONS.seer * 1000);
});

test('seer can change a target but learns only the final result after the stage ends', () => {
  const state = game();
  advancePhase(state, state.deadline);
  submitAction(state, 'seer', 'wolf1', state.deadline - 1);
  submitAction(state, 'seer', 'villager1', state.deadline - 1);
  assert.deepEqual(state.inspections, {});
  advancePhase(state, state.deadline);
  assert.deepEqual(state.inspections, { 1: { target: 'villager1', alignment: 'good' } });
  assert.equal(state.phase, 'witch');
});

test('the attacked witch can save herself and uses only one potion per night', () => {
  const state = game();
  submitAction(state, 'wolf1', 'witch', 1000);
  advancePhase(state, state.deadline);
  advancePhase(state, state.deadline);
  submitAction(state, 'witch', 'wolf1', state.deadline - 1);
  submitAction(state, 'witch', 'save', state.deadline - 1);
  advancePhase(state, state.deadline);
  assert.equal(state.players.find((player) => player.id === 'witch').alive, true);
  assert.equal(state.players.find((player) => player.id === 'wolf1').alive, true);
  assert.equal(state.antidote, false);
  assert.equal(state.poison, true);
  assert.deepEqual(state.deaths, []);
});

test('poison and wolf attacks resolve simultaneously, including an attacked witch action', () => {
  const state = game();
  submitAction(state, 'wolf1', 'witch', 1000);
  advancePhase(state, state.deadline);
  advancePhase(state, state.deadline);
  submitAction(state, 'witch', 'wolf1', state.deadline - 1);
  advancePhase(state, state.deadline);
  assert.equal(state.players.find((player) => player.id === 'witch').alive, false);
  assert.equal(state.players.find((player) => player.id === 'wolf1').alive, false);
  assert.equal(state.poison, false);
  assert.equal(state.antidote, true);
  assert.equal(state.phase, 'discussion');
});

test('a spent antidote does not reveal the new nightly victim to the witch', () => {
  const state = game();
  state.phase = 'witch';
  state.victim = 'seer';
  state.antidote = false;
  const payload = privatePayload(room(state), 'witch', 'panel', null, 1000);
  assert.doesNotMatch(payload.content, /被襲擊/);
  assert.throws(() => submitAction(state, 'witch', 'save', 1000));
  const options = payload.components[0].components[0].toJSON().options;
  assert.equal(options.some((option) => option.value === 'save'), false);
});

test('deadline, outsider, dead-player, role, and self-target checks reject invalid actions', () => {
  const state = game();
  assert.throws(() => submitAction(state, 'outside', 'seer', 1000));
  assert.throws(() => submitAction(state, 'seer', 'wolf1', 1000));
  assert.throws(() => submitAction(state, 'wolf1', 'seer', state.deadline));
  state.players[0].alive = false;
  assert.throws(() => submitAction(state, 'wolf1', 'seer', 1000));
  state.phase = 'vote';
  assert.throws(() => submitAction(state, 'seer', 'seer', 1000));
});

test('dead-role stages are skipped; expired phases restart their next deadline from recovery time', () => {
  const state = game();
  state.players.find((player) => player.role === 'seer').alive = false;
  state.players.find((player) => player.role === 'witch').alive = false;
  state.players.find((player) => player.id === 'wolf2').alive = false;
  advancePhase(state, 100000);
  assert.equal(state.phase, 'discussion');
  assert.equal(state.deadline, 280000);
});

test('no actions throughout a complete day/night cycle cancels without a winner', () => {
  const state = game();
  while (!['cancelled', 'ended'].includes(state.phase)) advancePhase(state, state.deadline);
  assert.equal(state.phase, 'cancelled');
  assert.equal(state.winner, null);
});

test('normal votes eliminate only a unique highest target and the next night resets actions', () => {
  const state = game();
  state.phase = 'vote';
  submitAction(state, 'seer', 'wolf1', 1000);
  submitAction(state, 'witch', 'wolf1', 1000);
  advancePhase(state, state.deadline);
  assert.equal(state.players[0].alive, false);
  assert.equal(state.phase, 'wolves');
  assert.equal(state.round, 2);
  assert.equal(state.activity, 0);
  assert.deepEqual(state.actions, {});
});

test('wolf parity, no wolves, and no survivors yield wolf victory, good victory, and draw', () => {
  const state = game();
  assert.equal(victory(state.players), null);
  state.players.filter((player) => player.role === 'villager').forEach((player) => { player.alive = false; });
  assert.equal(victory(state.players), 'wolf');
  state.players.filter((player) => player.role === 'wolf').forEach((player) => { player.alive = false; });
  assert.equal(victory(state.players), 'good');
  state.players.forEach((player) => { player.alive = false; });
  assert.equal(victory(state.players), 'draw');
});

test('public panels never show hidden roles, actions, inspections or potions before game end', () => {
  const state = game();
  state.actions.wolves = { wolf1: 'seer' };
  state.inspections = { 1: { target: 'witch', alignment: 'good' } };
  const before = publicPayload(room(state));
  assert.doesNotThrow(() => before.components.map((component) => component.toJSON()));
  assert.doesNotMatch(before.embeds[0].data.description, /預言家|女巫|查驗|藥/);
  state.phase = 'ended';
  state.winner = 'good';
  const after = publicPayload(room(state));
  assert.match(after.embeds[0].data.description, /預言家|女巫/);
  assert.equal(after.components.length, 0);
});

test('private wolf panel contains teammates but rejects outsiders and dead-player actions', () => {
  const state = game();
  assert.match(privatePayload(room(state), 'wolf1', 'identity', null, 1000).content, /<@wolf2>/);
  assert.throws(() => privatePayload(room(state), 'outsider', 'identity', null, 1000));
  state.players[0].alive = false;
  assert.throws(() => privatePayload(room(state), 'wolf1', 'panel', null, 1000));
});

test('werewolf is a public Chinese command with three room operations', () => {
  const definition = data.toJSON();
  assert.equal(definition.name, '狼人殺');
  assert.equal(definition.default_member_permissions, undefined);
  assert.deepEqual(definition.options[0].choices.map((choice) => choice.value), ['開啟', '開始', '關閉']);
});

test('component service responds privately and rejects stale and foreign-channel panels', async () => {
  const state = game();
  const current = room(state);
  const responses = [];
  const service = new WerewolfService({ get: async () => current }, {}, { error: () => {} });
  const interaction = {
    customId: `ww:${current.id}:3:identity`, guildId: 'guild', channelId: 'channel',
    user: { id: 'wolf1', bot: false }, client: {}, guild: {},
    deferReply: async (payload) => { assert.equal(payload.flags, MessageFlags.Ephemeral); },
    editReply: async (payload) => responses.push(payload),
  };
  await service.handleComponent(interaction);
  assert.match(responses[0].content, /你的身分/);
  interaction.customId = `ww:${current.id}:2:identity`;
  await service.handleComponent(interaction);
  assert.match(responses[1].content, /過期/);
  interaction.customId = `ww:${current.id}:3:identity`;
  interaction.channelId = 'other';
  await service.handleComponent(interaction);
  assert.match(responses[2].content, /本局頻道/);
});

test('router dispatches werewolf string menus without passing them to open-book or command handlers', async () => {
  let handled = 0;
  const router = createInteractionHandler({
    commands: new Map(), logger: { info: () => {}, error: () => {} },
    context: {
      werewolfService: { handleComponent: async () => { handled += 1; return true; } },
      openBookQuizService: { handleButton: async () => { throw new Error('Wrong router'); } },
    },
  });
  await router({ customId: 'ww:example', isButton: () => false, isStringSelectMenu: () => true });
  assert.equal(handled, 1);
});

test('poll advances one expired stage and publishes restored panels without skipping later discussion', async () => {
  const current = room(game());
  current.state.deadline = 0;
  let stages = 0;
  const service = new WerewolfService({
    listWork: async () => [structuredClone(current)],
    expire: async (_id, revision) => {
      assert.equal(revision, 3);
      stages += 1;
      advancePhase(current.state, Date.now());
      current.revision += 1;
    },
  }, {}, { error: () => {} });
  let refreshes = 0;
  service.refresh = async () => { refreshes += 1; };
  await service.poll();
  await service.poll();
  assert.equal(stages, 1);
  assert.equal(refreshes, 2);
  assert.equal(current.state.phase, 'seer');
  assert.ok(current.state.deadline > Date.now());
});

test('missing public messages are restored, while lost permissions cancel an active room', async () => {
  const current = { ...room(), dirty: true, messageId: 'deleted' };
  let acknowledged = 0;
  let cancelled = 0;
  let sent = 0;
  const service = new WerewolfService({
    get: async () => current,
    acknowledgePanel: async (_id, revision, messageId) => {
      assert.equal(revision, current.revision);
      assert.equal(messageId, 'restored');
      acknowledged += 1;
    },
    cancel: async () => { cancelled += 1; },
  }, {}, { error: () => {} });
  service.client = { channels: { fetch: async () => ({
    guildId: 'guild', messages: { fetch: async () => { throw Object.assign(new Error(), { code: 10008 }); } },
    send: async (payload) => {
      payload.embeds[0].toJSON();
      payload.components[0].toJSON();
      sent += 1;
      return { id: 'restored' };
    },
  }) } };
  await service.refresh(current.id);
  assert.equal(sent, 1);
  assert.equal(acknowledged, 1);
  service.client.channels.fetch = async () => { throw Object.assign(new Error(), { code: 50013 }); };
  await service.refresh(current.id);
  assert.equal(cancelled, 1);
});

test('only a participant leaving the room guild cancels the game', async () => {
  const current = room();
  let cancelled = 0;
  const service = new WerewolfService({
    participantRoom: async (id) => id === 'wolf1' ? current.id : null,
    get: async () => current,
    cancel: async () => { cancelled += 1; },
  }, {}, { error: () => {} });
  service.refresh = async () => {};
  await service.handleMemberRemove({ id: 'wolf1', guild: { id: 'other-guild' } });
  await service.handleMemberRemove({ id: 'outsider', guild: { id: 'guild' } });
  assert.equal(cancelled, 0);
  await service.handleMemberRemove({ id: 'wolf1', guild: { id: 'guild' } });
  assert.equal(cancelled, 1);
});

test('failed notification delivery leaves committed reward effects available for retry', async () => {
  const current = { ...room(), dirty: false };
  current.state.phase = 'ended';
  current.state.effects = [{ userId: 'seer', progress: { awarded: true } }];
  let acknowledged = 0;
  const service = new WerewolfService({
    get: async () => current,
    acknowledgeEffects: async () => { acknowledged += 1; },
  }, { handleAward: async () => { throw new Error('Temporary failure'); } }, { error: () => {} });
  await service.refresh(current.id);
  assert.equal(acknowledged, 0);
  service.progressService.handleAward = async () => {};
  await service.refresh(current.id);
  assert.equal(acknowledged, 1);
});
