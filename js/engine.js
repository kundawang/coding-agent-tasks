// 纯计算层：不碰 DOM、不碰 fetch/localStorage，只依赖 rng.js。
// 所有规则（结算、取整、洗牌、状态）都在这里，卡牌完全由 cards.json 的 effects 驱动，
// 没有任何针对单张牌的特殊逻辑。新增卡牌只需要改 JSON。

import { createRng, shuffle } from './rng.js';

export const HAND_LIMIT = 10;

const OTHER = { player: 'enemy', enemy: 'player' };

export function other(side) {
  return OTHER[side];
}

function indexCards(cardsJson) {
  const map = {};
  for (const card of cardsJson.cards) map[card.id] = card;
  return map;
}

function makeSide(cfg, tag) {
  return {
    name: cfg.name,
    hp: cfg.hp,
    maxHp: cfg.maxHp,
    energyPerTurn: cfg.energyPerTurn,
    handSize: cfg.handSize,
    energy: 0,
    block: 0,
    statuses: { strength: 0, vulnerable: 0, weak: 0 },
    draw: [],
    hand: [],
    discard: [],
    exhaust: [],
    tag,
  };
}

// 创建一局。seed 是任意字符串，从这一刻起所有随机都走 state.rng。
export function createGame({ cards, encounter, seed }) {
  const state = {
    seed: String(seed),
    rng: createRng(seed),
    turn: 0,
    phase: 'player', // 'player' | 'enemy' | 'over'
    active: 'player',
    winner: null,
    cards: indexCards(cards),
    players: {
      player: makeSide(encounter.player, 'p'),
      enemy: makeSide(encounter.enemy, 'e'),
    },
  };
  for (const side of ['player', 'enemy']) {
    const me = state.players[side];
    const deck = encounter[side].deck.map((id, i) => ({ uid: `${me.tag}${i}`, id }));
    if (!deck.every((c) => state.cards[c.id])) {
      throw new Error('牌组里出现了卡表中没有的 id');
    }
    me.draw = shuffle(state.rng, deck);
  }
  const events = [];
  startTurn(state, 'player', events);
  state.openingEvents = events;
  return state;
}

export function cardDef(state, uidOrCard) {
  const id = typeof uidOrCard === 'string' ? uidOrCard : uidOrCard.id;
  return state.cards[id];
}

// ---------- 抽牌 / 洗牌 ----------

function drawOne(state, side, events) {
  const me = state.players[side];
  if (me.draw.length === 0) {
    if (me.discard.length === 0) return null; // 两边都空：少抽，不报错
    me.draw = shuffle(state.rng, me.discard);
    me.discard = [];
    events.push({ type: 'shuffle', side });
  }
  return me.draw.shift();
}

export function drawCards(state, side, n, events) {
  const me = state.players[side];
  let drawn = 0;
  let overflow = 0;
  for (let i = 0; i < n; i++) {
    const card = drawOne(state, side, events);
    if (!card) break;
    if (me.hand.length >= HAND_LIMIT) {
      me.discard.push(card); // 手牌满了，超出的直接进弃牌堆
      overflow++;
    } else {
      me.hand.push(card);
      drawn++;
    }
  }
  if (drawn || overflow) events.push({ type: 'draw', side, drawn, overflow });
}

// ---------- 伤害计算 ----------

// 单次命中：floor((牌面 + 力量) × 易伤1.5 × 虚弱0.75)，全程整数运算，最后一步取整。
export function computeHit(state, atkSide, defSide, amount) {
  const atk = state.players[atkSide];
  const def = state.players[defSide];
  let num = amount + atk.statuses.strength;
  let den = 1;
  if (num < 0) num = 0;
  if (def.statuses.vulnerable > 0) { num *= 3; den *= 2; }
  if (atk.statuses.weak > 0) { num *= 3; den *= 4; }
  return Math.floor(num / den);
}

function dealDamage(state, defSide, amount, events) {
  const def = state.players[defSide];
  const blocked = Math.min(def.block, amount);
  def.block -= blocked;
  const hpLoss = amount - blocked;
  def.hp -= hpLoss;
  events.push({ type: 'damage', side: defSide, amount, blocked, hpLoss });
  checkDeath(state, events);
}

function checkDeath(state, events) {
  if (state.winner) return;
  for (const side of ['player', 'enemy']) {
    if (state.players[side].hp <= 0) {
      state.players[side].hp = 0;
      state.winner = other(side);
      state.phase = 'over';
      events.push({ type: 'gameOver', winner: state.winner });
      return;
    }
  }
}

// ---------- 效果结算（数据驱动） ----------

function resolveEffect(state, side, effect, targetSide, events) {
  const me = state.players[side];
  switch (effect.kind) {
    case 'damage': {
      const times = effect.times || 1;
      for (let i = 0; i < times; i++) {
        if (state.winner) return;
        const hit = computeHit(state, side, targetSide, effect.amount);
        dealDamage(state, targetSide, hit, events);
      }
      return;
    }
    case 'block':
      me.block += effect.amount;
      events.push({ type: 'block', side, amount: effect.amount });
      return;
    case 'draw':
      drawCards(state, side, effect.amount, events);
      return;
    case 'energy':
      me.energy += effect.amount;
      events.push({ type: 'energy', side, amount: effect.amount });
      return;
    case 'apply': {
      const who = effect.who === 'self' ? side : targetSide;
      const st = state.players[who].statuses;
      st[effect.status] = (st[effect.status] || 0) + effect.amount;
      events.push({ type: 'status', side: who, status: effect.status, amount: effect.amount, total: st[effect.status] });
      return;
    }
    case 'heal': {
      const before = me.hp;
      me.hp = Math.min(me.maxHp, me.hp + effect.amount);
      events.push({ type: 'heal', side, amount: me.hp - before });
      return;
    }
    case 'loseHp':
      me.hp -= effect.amount; // 无视护甲
      events.push({ type: 'loseHp', side, amount: effect.amount });
      checkDeath(state, events);
      return;
    default:
      throw new Error(`未知的效果 kind: ${effect.kind}`);
  }
}

// ---------- 出牌 ----------

// 只校验，不改动任何状态。返回 { ok, reason?, def?, index? }
export function canPlay(state, side, uid, targetSide) {
  if (state.winner || state.phase === 'over') return { ok: false, reason: '对局已结束' };
  if (state.active !== side || state.phase !== side) return { ok: false, reason: '还没轮到你' };
  const me = state.players[side];
  const index = me.hand.findIndex((c) => c.uid === uid);
  if (index === -1) return { ok: false, reason: '这张牌不在手上' };
  const def = state.cards[me.hand[index].id];
  if (me.energy < def.cost) return { ok: false, reason: '能量不足' };
  if (def.target === 'enemy' && targetSide !== other(side)) return { ok: false, reason: '目标不合法：这张牌要打敌人' };
  if (def.target === 'self' && targetSide !== side) return { ok: false, reason: '目标不合法：这张牌只能对自己用' };
  return { ok: true, def, index };
}

// 出牌。先完整校验，非法直接返回 { ok:false }，状态一个字节都不动。
export function playCard(state, side, uid, targetSide = null) {
  const check = canPlay(state, side, uid, targetSide);
  if (!check.ok) return { ok: false, reason: check.reason, events: [] };

  const me = state.players[side];
  const def = check.def;
  const events = [{ type: 'play', side, uid, id: def.id, name: def.name, target: targetSide }];

  me.energy -= def.cost;
  const [card] = me.hand.splice(check.index, 1);

  for (const effect of def.effects) {
    if (state.winner) break;
    resolveEffect(state, side, effect, def.target === 'none' ? side : targetSide, events);
  }

  if (def.exhaust) {
    me.exhaust.push(card);
    events.push({ type: 'exhaust', side, uid, id: def.id });
  } else {
    me.discard.push(card);
  }
  return { ok: true, events };
}

// ---------- 回合 ----------

function startTurn(state, side, events) {
  const me = state.players[side];
  state.active = side;
  state.phase = side;
  if (side === 'player') state.turn += 1;
  me.block = 0; // 自己回合开始时护甲清零
  me.energy = me.energyPerTurn;
  events.push({ type: 'turnStart', side, turn: state.turn });
  drawCards(state, side, me.handSize, events);
}

export function endTurn(state, side) {
  if (state.winner || state.phase === 'over') return { ok: false, reason: '对局已结束', events: [] };
  if (state.active !== side || state.phase !== side) return { ok: false, reason: '还没轮到你', events: [] };
  const me = state.players[side];
  const events = [];

  me.discard.push(...me.hand); // 剩余手牌全部进弃牌堆
  me.hand = [];
  for (const st of ['vulnerable', 'weak']) {
    if (me.statuses[st] > 0) {
      me.statuses[st] -= 1; // 每过完自己的一回合减 1
      events.push({ type: 'statusTick', side, status: st, total: me.statuses[st] });
    }
  }
  events.push({ type: 'turnEnd', side });
  startTurn(state, other(side), events);
  return { ok: true, events };
}

// ---------- 快照（用于记录 / 校验 / 重放） ----------

function sideSnapshot(me) {
  return {
    hp: me.hp,
    energy: me.energy,
    block: me.block,
    st: { ...me.statuses },
    hand: me.hand.map((c) => `${c.uid}:${c.id}`),
    draw: me.draw.map((c) => c.uid),
    discard: me.discard.map((c) => c.uid),
    exhaust: me.exhaust.map((c) => c.uid),
  };
}

export function snapshot(state) {
  return {
    turn: state.turn,
    phase: state.phase,
    winner: state.winner,
    player: sideSnapshot(state.players.player),
    enemy: sideSnapshot(state.players.enemy),
  };
}
