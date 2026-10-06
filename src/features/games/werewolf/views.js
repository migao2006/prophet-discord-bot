import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { ROLE_NAMES, TERMINAL, requireRule } from './domain.js';

const PHASE_NAMES = {
  lobby: '等待玩家', wolves: '夜晚・狼人行動', seer: '夜晚・預言家行動',
  witch: '夜晚・女巫行動', discussion: '白天討論', vote: '白天投票', ended: '遊戲結束', cancelled: '已取消',
};

export function componentId(room, action) {
  return `ww:${room.id}:${room.revision}:${action}`;
}

function button(room, action, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(componentId(room, action)).setLabel(label).setStyle(style);
}

export function publicPayload(room) {
  const { state } = room;
  const finished = TERMINAL.has(state.phase);
  const roster = state.players.map((player, index) => {
    const role = state.phase === 'ended' ? `｜${ROLE_NAMES[player.role]}` : '';
    return `${index + 1}. ${player.alive ? '🌱' : '🪦'} <@${player.id}>${role}`;
  }).join('\n');
  const history = state.history.slice(-10).map((event) => {
    const names = event.deaths.map((id) => `<@${id}>`).join('、');
    return `第 ${event.round} ${event.kind === 'night' ? '夜' : '天投票'}：${names || (event.kind === 'night' ? '平安夜 🌙' : '無人出局')}`;
  }).join('\n');
  let description = roster;
  if (state.phase === 'lobby') {
    description = `房主：<@${state.hostId}>\n${state.players.length} / 10 人・滿 6 人就能開始\n\n${roster}`;
  } else if (state.phase === 'ended') {
    description = `${state.winner === 'draw' ? '🌙 平局，這次沒有經驗獎勵。' : `🎉 ${state.winner === 'wolf' ? '狼人' : '好人'}陣營獲勝！勝方每人 +100 XP（含已死亡隊友）。`}\n\n${roster}`;
  } else if (state.phase === 'cancelled') {
    description = `${state.reason}\n這局沒有經驗獎勵。\n\n${roster}`;
  }
  if (history) description += `\n\n${history}`;
  if (!finished) description += `\n\n截止：<t:${Math.floor(state.deadline / 1000)}:R>`;
  const embed = new EmbedBuilder().setColor(0x746CC0)
    .setTitle(`🐺 狼人殺｜${state.round ? `第 ${state.round} 天・` : ''}${PHASE_NAMES[state.phase]}`)
    .setDescription(description)
    .setFooter({ text: '身分與夜晚行動僅本人可見｜死亡玩家請停止參與推理' });
  let components = [];
  if (state.phase === 'lobby') {
    components = [new ActionRowBuilder().addComponents(
      button(room, 'join', '加入', ButtonStyle.Success), button(room, 'leave', '退出'),
      button(room, 'start', '開始', ButtonStyle.Primary), button(room, 'cancel', '取消', ButtonStyle.Danger),
    )];
  } else if (!finished) {
    components = [new ActionRowBuilder().addComponents(
      button(room, 'identity', '我的身分'),
      button(room, 'panel', state.phase === 'vote' ? '投票' : '夜晚行動', ButtonStyle.Primary)
        .setDisabled(state.phase === 'discussion'),
      button(room, 'cancel', '取消', ButtonStyle.Danger),
    )];
  }
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

function seatLabel(state, id, guild) {
  const index = state.players.findIndex((player) => player.id === id);
  const member = guild?.members?.cache?.get(id);
  return `${index + 1} 號・${member?.displayName ?? id}`.slice(0, 100);
}

export function privatePayload(room, userId, action, guild, now = Date.now()) {
  const { state } = room;
  const player = state.players.find((entry) => entry.id === userId);
  requireRule(player?.role, '身分只提供給已開始遊戲的參賽玩家。');
  requireRule(!TERMINAL.has(state.phase), '這局已經結束囉～');
  const roleName = ROLE_NAMES[player.role];
  let content = `你的身分是 **${roleName}** ${player.alive ? '🌱' : '（已死亡）🪦'}`;
  if (player.role === 'wolf') {
    content += `\n狼人隊友：${state.players.filter((entry) => entry.role === 'wolf' && entry.id !== userId).map((entry) => `<@${entry.id}>`).join('、')}`;
  }
  if (player.role === 'seer') {
    const results = Object.entries(state.inspections).slice(-15).map(([round, result]) => (
      `第 ${round} 夜：<@${result.target}> 是 **${result.alignment === 'wolf' ? '狼人' : '好人'}**`
    ));
    content += `\n查驗紀錄：\n${results.join('\n') || '還沒有查驗結果；結果會在查驗階段結束後出現。'}`;
  }
  if (player.role === 'witch') content += `\n解藥：${state.antidote ? '1' : '0'} 瓶｜毒藥：${state.poison ? '1' : '0'} 瓶`;
  const payload = { content, components: [], allowedMentions: { parse: [] } };
  if (action === 'identity') return payload;
  requireRule(player.alive && now < state.deadline, '你已死亡或此階段已結束。');
  const eligible = state.phase === 'vote'
    || (state.phase === 'wolves' && player.role === 'wolf')
    || (state.phase === 'seer' && player.role === 'seer')
    || (state.phase === 'witch' && player.role === 'witch');
  requireRule(eligible, '現在還不是你的行動時間，先幫其他人加油吧～🌙');
  let options = [{ label: state.phase === 'vote' ? '棄票' : '不行動', value: 'skip' }];
  const targets = state.players.filter((entry) => entry.alive && entry.id !== userId
    && (state.phase !== 'wolves' || entry.role !== 'wolf'));
  if (state.phase === 'witch') {
    if (state.antidote) {
      payload.content += state.victim ? `\n今晚被襲擊：<@${state.victim}>` : '\n今晚沒有人被襲擊。';
      if (state.victim) options.push({ label: '使用解藥（可自救）', value: 'save' });
    }
    if (state.poison) options.push(...targets.map((entry) => ({
      label: `毒殺 ${seatLabel(state, entry.id, guild)}`.slice(0, 100), value: entry.id,
    })));
  } else {
    options.push(...targets.map((entry) => ({ label: seatLabel(state, entry.id, guild), value: entry.id })));
  }
  const selected = state.phase === 'wolves' ? state.actions.wolves?.[userId]
    : state.phase === 'vote' ? state.actions.vote?.[userId]
      : state.phase === 'seer' ? state.actions.seer
        : state.actions.witch?.type === 'save' ? 'save' : state.actions.witch?.target;
  payload.content += `\n目前選擇：${selected === 'save' ? '使用解藥' : selected && selected !== 'skip' ? `<@${selected}>` : '不行動／棄票'}\n截止前可更改，以最後一次提交為準。`;
  payload.components = [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(componentId(room, 'choose')).setPlaceholder('選擇你的行動').addOptions(options))];
  return payload;
}
