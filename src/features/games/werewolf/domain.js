import { randomInt } from 'node:crypto';

export const ROLE_NAMES = { wolf: '狼人', seer: '預言家', witch: '女巫', villager: '村民' };
export const DURATIONS = { lobby: 600, wolves: 45, seer: 30, witch: 30, discussion: 180, vote: 45 };
export const TERMINAL = new Set(['ended', 'cancelled']);

export class GameRuleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GameRuleError';
  }
}

export function requireRule(condition, message) {
  if (!condition) throw new GameRuleError(message);
}

export function roleDeck(count) {
  requireRule(Number.isInteger(count) && count >= 6 && count <= 10, '需要 6～10 位玩家才能開始唷～🐾');
  const wolves = count >= 9 ? 3 : 2;
  return [...Array(wolves).fill('wolf'), 'seer', 'witch', ...Array(count - wolves - 2).fill('villager')];
}

export function assignRoles(players, choose = randomInt) {
  const deck = roleDeck(players.length);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = choose(index + 1);
    [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }
  return players.map((player, index) => ({ ...player, role: deck[index], alive: true }));
}

export function newLobby(hostId, now) {
  return {
    phase: 'lobby', round: 0, hostId,
    players: [{ id: hostId, alive: true }],
    actions: {}, inspections: {}, antidote: true, poison: true,
    victim: null, activity: 0, deaths: [], history: [], winner: null, reason: null,
    deadline: now + DURATIONS.lobby * 1000, effects: [],
  };
}

export function setPhase(state, phase, now) {
  state.phase = phase;
  state.deadline = TERMINAL.has(phase) ? null : now + DURATIONS[phase] * 1000;
}

export function startGame(state, now, choose = randomInt) {
  requireRule(state.phase === 'lobby', '遊戲已經開始了唷～');
  state.players = assignRoles(state.players, choose);
  state.round = 1;
  setPhase(state, 'wolves', now);
}

export function victory(players) {
  const living = players.filter((player) => player.alive);
  if (!living.length) return 'draw';
  const wolves = living.filter((player) => player.role === 'wolf').length;
  if (!wolves) return 'good';
  if (wolves >= living.length - wolves) return 'wolf';
  return null;
}

export function topVote(values, randomTie = false, choose = randomInt) {
  const counts = new Map();
  for (const value of values) {
    if (value && value !== 'skip') counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const highest = Math.max(...counts.values());
  const tied = [...counts.keys()].filter((id) => counts.get(id) === highest);
  return tied.length === 1 ? tied[0] : randomTie ? tied[choose(tied.length)] : null;
}

export function cancelGame(state, reason) {
  state.phase = 'cancelled';
  state.deadline = null;
  state.reason = reason;
}

function finishIfWon(state) {
  state.winner = victory(state.players);
  if (!state.winner) return false;
  state.phase = 'ended';
  state.deadline = null;
  return true;
}

export function advancePhase(state, now, choose = randomInt) {
  requireRule(!TERMINAL.has(state.phase), '這局已經結束囉～');
  requireRule(now >= state.deadline, '目前階段還沒結束。');
  const livingRole = (role) => state.players.some((player) => player.alive && player.role === role);
  if (state.phase === 'lobby') {
    cancelGame(state, '等待超過 10 分鐘，房間已取消。');
  } else if (state.phase === 'wolves') {
    state.victim = topVote(Object.values(state.actions.wolves ?? {}), true, choose);
    setPhase(state, livingRole('seer') ? 'seer' : livingRole('witch') ? 'witch' : 'discussion', now);
    if (state.phase === 'discussion') resolveNight(state, now);
  } else if (state.phase === 'seer') {
    const target = state.actions.seer;
    if (target) {
      const player = state.players.find((entry) => entry.id === target);
      state.inspections[state.round] = { target, alignment: player.role === 'wolf' ? 'wolf' : 'good' };
    }
    if (livingRole('witch')) setPhase(state, 'witch', now);
    else resolveNight(state, now);
  } else if (state.phase === 'witch') {
    resolveNight(state, now);
  } else if (state.phase === 'discussion') {
    setPhase(state, 'vote', now);
  } else if (state.phase === 'vote') {
    const expelled = topVote(Object.values(state.actions.vote ?? {}));
    if (expelled) state.players.find((player) => player.id === expelled).alive = false;
    state.history.push({ round: state.round, kind: 'vote', deaths: expelled ? [expelled] : [] });
    if (finishIfWon(state)) return;
    if (!state.activity) {
      cancelGame(state, '整個日夜循環都沒有操作或投票，這局先休息囉～');
      return;
    }
    state.round += 1;
    state.activity = 0;
    state.actions = {};
    state.victim = null;
    setPhase(state, 'wolves', now);
  }
}

function resolveNight(state, now) {
  const witch = state.actions.witch;
  const deaths = new Set(state.victim ? [state.victim] : []);
  if (witch?.type === 'save' && state.antidote && state.victim) {
    deaths.delete(state.victim);
    state.antidote = false;
  } else if (witch?.type === 'poison' && state.poison) {
    deaths.add(witch.target);
    state.poison = false;
  }
  for (const player of state.players) {
    if (deaths.has(player.id)) player.alive = false;
  }
  state.deaths = [...deaths];
  state.history.push({ round: state.round, kind: 'night', deaths: [...deaths] });
  if (!finishIfWon(state)) setPhase(state, 'discussion', now);
}

export function submitAction(state, userId, target, now) {
  const player = state.players.find((entry) => entry.id === userId);
  requireRule(player?.alive && player.role, '只有本局存活玩家可以操作唷～');
  requireRule(!TERMINAL.has(state.phase) && now < state.deadline, '這個階段已經結束，請重新開啟面板。');
  const selected = state.players.find((entry) => entry.id === target);
  if (state.phase === 'wolves') {
    requireRule(player.role === 'wolf', '現在是狼人行動時間。');
    requireRule(target === 'skip' || (selected?.alive && selected.role !== 'wolf'), '請選擇存活的好人。');
    state.actions.wolves ??= {};
    state.actions.wolves[userId] = target;
  } else if (state.phase === 'seer') {
    requireRule(player.role === 'seer', '現在是預言家行動時間。');
    requireRule(target === 'skip' || (selected?.alive && selected.id !== userId), '請查驗其他存活玩家。');
    state.actions.seer = target === 'skip' ? null : target;
  } else if (state.phase === 'witch') {
    requireRule(player.role === 'witch', '現在是女巫行動時間。');
    if (target === 'save') {
      requireRule(state.antidote && state.victim, '沒有可救的目標或解藥已用完。');
      state.actions.witch = { type: 'save' };
    } else if (target === 'skip') {
      state.actions.witch = null;
    } else {
      requireRule(state.poison && selected?.alive && target !== userId, '請選擇其他存活玩家，並確認還有毒藥。');
      state.actions.witch = { type: 'poison', target };
    }
  } else if (state.phase === 'vote') {
    requireRule(target === 'skip' || (selected?.alive && target !== userId), '請投給其他存活玩家或棄票。');
    state.actions.vote ??= {};
    state.actions.vote[userId] = target;
  } else {
    throw new GameRuleError('目前沒有可提交的行動。');
  }
  state.activity += 1;
}
