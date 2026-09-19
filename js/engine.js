// 纯计算引擎：不碰 DOM、不碰 localStorage，浏览器和 Node 都能跑。
// 所有卡牌效果都按 cards.json 里的数据逐条结算，没有任何针对单张牌的特殊逻辑。

import { createRng, shuffle } from './rng.js';

export const HAND_LIMIT = 10;
export const STATUS_KEYS = ['strength', 'vulnerable', 'weak', 'block'];

export function otherSide(side) {
  return side === 'player' ? 'enemy' : 'player';
}

// 单次命中伤害 = floor((牌面伤害 + 力量) × 易伤 × 虚弱)
// 1.5 / 0.75 都是二进制精确值，整数乘它们再 floor 不会有浮点误差。
export function calcHitDamage(base, attackerStatuses, defenderStatuses) {
  let dmg = base + (attackerStatuses.strength || 0);
  if ((defenderStatuses.vulnerable || 0) > 0) dmg *= 1.5;
  if ((attackerStatuses.weak || 0) > 0) dmg *= 0.75;
  return Math.floor(dmg);
}

function makeSide(cfg) {
  return {
    name: cfg.name,
    hp: cfg.hp,
    maxHp: cfg.maxHp,
    energy: 0,
    energyPerTurn: cfg.energyPerTurn,
    handSize: cfg.handSize,
    deck: cfg.deck.slice(),
    hand: [],
    discard: [],
    exhaust: [],
    st: { strength: 0, vulnerable: 0, weak: 0, block: 0 },
  };
}

// cardsDb: { [id]: card }。encounter 原样存进 state，导出记录时自带。
export function createGame(cardsDb, encounter, seedInput) {
  for (const key of ['player', 'enemy']) {
    for (const id of encounter[key].deck) {
      if (!cardsDb[id]) throw new Error(`未知卡牌: ${id}`);
    }
  }
  const state = {
    version: 1,
    seed: String(seedInput),
    rng: createRng(seedInput),
    turn: 1,
    active: 'player',
    phase: 'play', // 'play' | 'over'
    winner: null,
    cards: cardsDb,
    encounter,
    sides: {
      player: makeSide(encounter.player),
      enemy: makeSide(encounter.enemy),
    },
    log: [],
  };
  shuffle(state.rng, state.sides.player.deck);
  shuffle(state.rng, state.sides.enemy.deck);
  const events = [];
  startTurn(state, 'player', events);
  return { state, events };
}

function drawCards(state, side, n, events) {
  const s = state.sides[side];
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (s.deck.length === 0) {
      if (s.discard.length === 0) break; // 两边都没得抽就少抽，不报错
      s.deck = s.discard;
      s.discard = [];
      shuffle(state.rng, s.deck); // 重洗也走同一个随机源
      events.push({ type: 'reshuffle', side });
    }
    const id = s.deck.pop();
    if (s.hand.length >= HAND_LIMIT) {
      s.discard.push(id); // 手牌满了，多抽的直接进弃牌堆
      events.push({ type: 'overdraw', side, card: id });
    } else {
      s.hand.push(id);
      drawn++;
    }
  }
  if (drawn > 0) events.push({ type: 'draw', side, count: drawn });
}

function startTurn(state, side, events) {
  const s = state.sides[side];
  s.st.block = 0; // 自己回合开始时护甲清零
  s.energy = s.energyPerTurn;
  events.push({ type: 'turn-start', side, turn: state.turn });
  drawCards(state, side, s.handSize, events);
}

function fail(reason) {
  return { ok: false, reason };
}

// 只校验，不改状态。reason 用于界面提示。
export function checkPlay(state, side, handIndex, target) {
  if (state.phase !== 'play') return fail('游戏已结束');
  if (state.active !== side) return fail('还没轮到这一方');
  const s = state.sides[side];
  if (!Number.isInteger(handIndex) || handIndex < 0 || handIndex >= s.hand.length) {
    return fail('手牌序号无效');
  }
  const card = state.cards[s.hand[handIndex]];
  if (!card) return fail('未知卡牌');
  if (s.energy < card.cost) return fail('能量不足');
  const foe = otherSide(side);
  if (card.target === 'enemy' && target !== foe) return fail('目标必须是敌人');
  if (card.target === 'self' && target !== side) return fail('目标必须是自己');
  if (card.target === 'none' && target !== null && target !== undefined) return fail('这张牌不需要目标');
  return { ok: true, card };
}

function dealDamage(state, sideKey, dmg, events) {
  const t = state.sides[sideKey];
  const blocked = Math.min(t.st.block, dmg);
  t.st.block -= blocked;
  const toHp = dmg - blocked;
  t.hp -= toHp;
  events.push({ type: 'damage', side: sideKey, amount: toHp, blocked });
}

function applyEffect(state, side, eff, events) {
  const me = state.sides[side];
  const foeKey = otherSide(side);
  const foe = state.sides[foeKey];
  switch (eff.kind) {
    case 'damage': {
      const times = eff.times ?? 1;
      for (let i = 0; i < times; i++) {
        // 多段攻击每段单独算、单独扣护甲
        const dmg = calcHitDamage(eff.amount, me.st, foe.st);
        dealDamage(state, foeKey, dmg, events);
        if (foe.hp <= 0) break; // 目标已倒下，剩余段数不再结算
      }
      break;
    }
    case 'block':
      me.st.block += eff.amount;
      events.push({ type: 'block', side, amount: eff.amount });
      break;
    case 'draw':
      drawCards(state, side, eff.amount, events);
      break;
    case 'energy':
      me.energy += eff.amount;
      events.push({ type: 'energy', side, amount: eff.amount });
      break;
    case 'apply': {
      const tKey = eff.who === 'enemy' ? foeKey : side;
      const t = state.sides[tKey];
      t.st[eff.status] = (t.st[eff.status] || 0) + eff.amount;
      events.push({ type: 'status', side: tKey, status: eff.status, amount: eff.amount });
      break;
    }
    case 'heal': {
      const before = me.hp;
      me.hp = Math.min(me.maxHp, me.hp + eff.amount);
      events.push({ type: 'heal', side, amount: me.hp - before });
      break;
    }
    case 'loseHp':
      me.hp -= eff.amount; // 无视护甲
      events.push({ type: 'losehp', side, amount: eff.amount });
      break;
    default:
      throw new Error(`未知效果类型: ${eff.kind}`);
  }
}

function checkDeath(state, events) {
  if (state.phase !== 'play') return;
  for (const key of ['player', 'enemy']) {
    if (state.sides[key].hp <= 0) {
      state.sides[key].hp = 0;
      state.phase = 'over';
      state.winner = otherSide(key);
      events.push({ type: 'game-over', winner: state.winner });
      return;
    }
  }
}

// 出牌。非法操作原样返回 {ok:false}，状态一个字节都不动。
export function playCard(state, side, handIndex, target) {
  const chk = checkPlay(state, side, handIndex, target);
  if (!chk.ok) return chk;
  const events = [];
  const s = state.sides[side];
  const card = chk.card;
  s.energy -= card.cost;
  s.hand.splice(handIndex, 1);
  events.push({ type: 'play', side, card: card.id, target: target ?? null });
  for (const eff of card.effects) {
    applyEffect(state, side, eff, events);
  }
  (card.exhaust ? s.exhaust : s.discard).push(card.id);
  state.log.push({ side, type: 'play', handIndex, card: card.id, target: target ?? null });
  checkDeath(state, events);
  return { ok: true, events };
}

// 结束回合：弃掉手牌 -> 自己的易伤/虚弱 -1 -> 轮到对面并开始其回合。
export function endTurn(state, side) {
  if (state.phase !== 'play') return fail('游戏已结束');
  if (state.active !== side) return fail('还没轮到这一方');
  const events = [];
  const s = state.sides[side];
  while (s.hand.length > 0) s.discard.push(s.hand.shift());
  events.push({ type: 'discard-hand', side });
  for (const k of ['vulnerable', 'weak']) {
    if (s.st[k] > 0) s.st[k] -= 1;
  }
  state.log.push({ side, type: 'end' });
  const nxt = otherSide(side);
  state.active = nxt;
  if (nxt === 'player') state.turn += 1;
  startTurn(state, nxt, events);
  return { ok: true, events };
}

// ---- 记录 / 重放 ----

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// 对影响胜负的全部状态做哈希，用来校验重放是否一致。
export function hashState(state) {
  const core = {
    rng: state.rng.s,
    turn: state.turn,
    active: state.active,
    phase: state.phase,
    winner: state.winner,
    sides: state.sides,
  };
  return fnv1a(JSON.stringify(core));
}

function snapshot(state) {
  return JSON.parse(JSON.stringify(state));
}

// 重放一份记录，返回每一步之后的完整状态（含开局，共 actions.length + 1 个）。
export function replayLog(log) {
  if (!log || log.format !== 'emberdeck-log') {
    return { ok: false, reason: '不是 emberdeck 记录格式', states: [] };
  }
  let state;
  try {
    state = createGame(log.cards, log.encounter, log.seed).state;
  } catch (e) {
    return { ok: false, reason: String(e.message || e), states: [] };
  }
  const states = [snapshot(state)];
  for (let i = 0; i < log.actions.length; i++) {
    const a = log.actions[i];
    const res = a.type === 'play'
      ? playCard(state, a.side, a.handIndex, a.target)
      : endTurn(state, a.side);
    if (!res.ok) {
      return { ok: false, reason: `第 ${i + 1} 步无法执行: ${res.reason}`, errorAt: i, states };
    }
    states.push(snapshot(state));
  }
  return { ok: true, states };
}

// 导出整局记录：自带卡表和双方配置，贴到任何环境都能重放。
// hashes[i] 是第 i 步动作执行完后的状态哈希，重放时逐步对照。
export function exportLog(state) {
  const log = {
    format: 'emberdeck-log',
    version: 1,
    seed: state.seed,
    cards: state.cards,
    encounter: state.encounter,
    actions: state.log,
    result: { winner: state.winner, turns: state.turn },
    hashes: [],
  };
  const rep = replayLog(log);
  log.hashes = rep.states.slice(1).map(hashState);
  return log;
}
