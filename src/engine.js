// 纯计算战斗引擎：不碰 DOM / localStorage / fetch，可直接在 Node 里跑。
// 所有卡牌行为都由 cards.json 里的 effects 驱动；想加新效果种类才需要改这里。

import { Rng } from './prng.js';

export const HAND_LIMIT = 10;
export const FORMAT_VERSION = 1;

export class GameError extends Error {}

const SIDES = ['player', 'enemy'];
const KNOWN_EFFECTS = new Set(['damage', 'block', 'draw', 'energy', 'apply', 'heal', 'loseHp']);
const APPLY_STATUSES = new Set(['strength', 'vulnerable', 'weak', 'block']);

export function otherSide(side) {
  return side === 'player' ? 'enemy' : 'player';
}

export function createCardMap(cardList) {
  const map = {};
  for (const card of cardList) map[card.id] = card;
  return map;
}

function makeSide(cfg) {
  return {
    name: cfg.name,
    hp: cfg.hp,
    maxHp: cfg.maxHp,
    energyPerTurn: cfg.energyPerTurn ?? 3,
    handSize: cfg.handSize ?? 5,
    energy: 0,
    drawPile: [],
    hand: [],
    discard: [],
    exhaustPile: [],
    statuses: { strength: 0, vulnerable: 0, weak: 0, block: 0 }
  };
}

export function createState(cardDefs, encounter, seed) {
  const state = {
    version: FORMAT_VERSION,
    seed: String(seed),
    rng: Rng.fromSeed(seed),
    turn: 1,
    active: 'player',
    winner: null,
    handLimit: HAND_LIMIT,
    sides: {},
    cards: {},
    nextUid: 1
  };

  for (const side of SIDES) {
    const cfg = encounter[side];
    const combatant = makeSide(cfg);
    for (const cardId of cfg.deck) {
      if (!cardDefs[cardId]) throw new Error(`卡表里找不到卡牌: ${cardId}`);
      const uid = state.nextUid++;
      state.cards[uid] = { id: cardId };
      combatant.drawPile.push(uid);
    }
    state.sides[side] = combatant;
  }

  // 双方初始牌堆都走同一个随机源：先玩家后敌人
  state.rng.shuffle(state.sides.player.drawPile);
  state.rng.shuffle(state.sides.enemy.drawPile);

  beginTurn(state, 'player');
  return state;
}

function beginTurn(state, side) {
  const combatant = state.sides[side];
  combatant.statuses.block = 0; // 护甲在自己回合开始时清零
  combatant.energy = combatant.energyPerTurn;
  const events = [{ type: 'turnStart', side, turn: state.turn }];
  drawCards(state, side, combatant.handSize, events);
  return events;
}

function drawCards(state, side, amount, events) {
  const combatant = state.sides[side];
  const drawn = [];
  const overflow = [];
  let reshuffles = 0;
  for (let i = 0; i < amount; i++) {
    if (combatant.drawPile.length === 0) {
      if (combatant.discard.length === 0) break; // 两边都不够抽就少抽
      state.rng.shuffle(combatant.discard);
      combatant.drawPile = combatant.discard;
      combatant.discard = [];
      reshuffles++;
    }
    const uid = combatant.drawPile.pop();
    if (combatant.hand.length >= state.handLimit) {
      combatant.discard.push(uid); // 超过手牌上限直接进弃牌堆
      overflow.push(uid);
    } else {
      combatant.hand.push(uid);
      drawn.push(uid);
    }
  }
  if (drawn.length || overflow.length) {
    events.push({ type: 'draw', side, drawn, overflow, reshuffles });
  }
}

// ---------- 校验（只读，绝不改状态） ----------

export function validateAction(state, action, cardDefs) {
  if (!action || typeof action !== 'object') throw new GameError('非法操作：动作不存在');
  if (state.winner) throw new GameError('战斗已经结束');
  if (!SIDES.includes(action.side)) throw new GameError('非法操作：未知阵营');
  if (action.side !== state.active) {
    throw new GameError(action.side === 'player' ? '还没轮到你的回合' : '对方正在行动');
  }

  if (action.type === 'endTurn') return;
  if (action.type !== 'playCard') throw new GameError('非法操作：未知动作类型');

  const combatant = state.sides[action.side];
  const idx = action.handIndex;
  if (!Number.isInteger(idx) || idx < 0 || idx >= combatant.hand.length) {
    throw new GameError('非法操作：这张手牌不存在');
  }
  const uid = combatant.hand[idx];
  const def = cardDefs[state.cards[uid].id];
  if (!def) throw new GameError('非法操作：卡牌定义缺失');

  if (combatant.energy < def.cost) {
    throw new GameError(`能量不足：${def.name} 需要 ${def.cost} 点`);
  }

  const opponent = otherSide(action.side);
  if (def.target === 'enemy') {
    if (action.target !== opponent) throw new GameError('目标不合法：这张牌必须打向对手');
  } else if (def.target === 'self') {
    if (action.target != null && action.target !== action.side) {
      throw new GameError('目标不合法：这张牌只能对自己使用');
    }
  } else if (action.target != null) {
    throw new GameError('目标不合法：这张牌不需要目标');
  }

  for (const eff of def.effects) {
    if (!KNOWN_EFFECTS.has(eff.kind)) throw new GameError(`卡牌数据错误：未知效果 ${eff.kind}`);
    if (eff.kind === 'apply') {
      if (!APPLY_STATUSES.has(eff.status)) {
        throw new GameError(`卡牌数据错误：未知状态 ${eff.status}`);
      }
      if (eff.who !== 'self' && eff.who !== 'enemy') {
        throw new GameError('卡牌数据错误：apply.who 非法');
      }
    }
  }
}

export function canPlay(state, action, cardDefs) {
  try {
    validateAction(state, action, cardDefs);
    return true;
  } catch (err) {
    return false;
  }
}

// 给 UI 高亮和 AI 用的只读清单
export function handOptions(state, side, cardDefs) {
  const combatant = state.sides[side];
  return combatant.hand.map((uid, index) => {
    const def = cardDefs[state.cards[uid].id];
    const action = def.target === 'enemy'
      ? { type: 'playCard', side, handIndex: index, target: otherSide(side) }
      : { type: 'playCard', side, handIndex: index };
    let reason = null;
    try {
      validateAction(state, action, cardDefs);
    } catch (err) {
      reason = err.message;
    }
    return { index, uid, cardId: def.id, def, playable: reason === null, reason };
  });
}

// ---------- 结算 ----------

// floor((牌面伤害 + 力量) × 易伤(1.5) × 虚弱(0.75))，导出方便单测/对答案
export function hitDamage(base, attackerStatuses, defenderStatuses) {
  let damage = base + (attackerStatuses.strength || 0);
  if (defenderStatuses.vulnerable > 0) damage *= 1.5;
  if (attackerStatuses.weak > 0) damage *= 0.75;
  return Math.floor(damage); // 最后一步向下取整
}

function checkDeath(state, events) {
  for (const side of SIDES) {
    if (state.sides[side].hp <= 0) {
      state.winner = otherSide(side);
      events.push({ type: 'gameOver', winner: state.winner });
      return true;
    }
  }
  return false;
}

function executeEffects(state, def, side, events) {
  const me = state.sides[side];
  const foe = state.sides[otherSide(side)];

  for (const eff of def.effects) {
    if (eff.kind === 'damage') {
      const times = eff.times ?? 1;
      for (let hit = 0; hit < times; hit++) {
        const amount = hitDamage(eff.amount, me.statuses, foe.statuses); // 每段单独算
        const blocked = Math.min(foe.statuses.block, amount); // 每段单独扣护甲
        foe.statuses.block -= blocked;
        const hpLost = Math.min(foe.hp, amount - blocked);
        foe.hp -= hpLost;
        events.push({
          type: 'hit',
          from: side,
          to: otherSide(side),
          index: hit + 1,
          times,
          base: eff.amount,
          strength: me.statuses.strength,
          vulnerable: foe.statuses.vulnerable > 0,
          weak: me.statuses.weak > 0,
          amount,
          blocked,
          hpLost
        });
        if (checkDeath(state, events)) return;
      }
    } else if (eff.kind === 'block') {
      me.statuses.block += eff.amount;
      events.push({ type: 'block', side, amount: eff.amount, total: me.statuses.block });
    } else if (eff.kind === 'energy') {
      me.energy += eff.amount;
      events.push({ type: 'energy', side, amount: eff.amount, total: me.energy });
    } else if (eff.kind === 'draw') {
      drawCards(state, side, eff.amount, events);
    } else if (eff.kind === 'apply') {
      const targetSide = eff.who === 'self' ? side : otherSide(side);
      const statuses = state.sides[targetSide].statuses;
      statuses[eff.status] = (statuses[eff.status] || 0) + eff.amount;
      events.push({
        type: 'apply',
        side: targetSide,
        status: eff.status,
        amount: eff.amount,
        total: statuses[eff.status]
      });
    } else if (eff.kind === 'heal') {
      me.hp = Math.min(me.maxHp, me.hp + eff.amount);
      events.push({ type: 'heal', side, amount: eff.amount, total: me.hp });
    } else if (eff.kind === 'loseHp') {
      me.hp = Math.max(0, me.hp - eff.amount); // 无视护甲
      events.push({ type: 'loseHp', side, amount: eff.amount, total: me.hp });
    }
    if (checkDeath(state, events)) return;
  }
}

function playCard(state, action, cardDefs, events) {
  const side = action.side;
  const combatant = state.sides[side];
  const uid = combatant.hand[action.handIndex];
  const def = cardDefs[state.cards[uid].id];

  events.push({ type: 'cardPlayed', side, uid, cardId: def.id, cost: def.cost });

  combatant.energy -= def.cost;
  const [playedUid] = combatant.hand.splice(action.handIndex, 1);
  const pile = def.exhaust ? combatant.exhaustPile : combatant.discard;
  pile.push(playedUid);

  executeEffects(state, def, side, events);
}

function endTurn(state, action, events) {
  const side = action.side;
  const combatant = state.sides[side];

  const discarded = combatant.hand.splice(0);
  for (const uid of discarded) combatant.discard.push(uid);
  events.push({ type: 'handDiscarded', side, cards: discarded });

  // 易伤/虚弱：自己的回合结束时各掉 1 层
  for (const key of ['vulnerable', 'weak']) {
    if (combatant.statuses[key] > 0) combatant.statuses[key]--;
  }
  events.push({ type: 'turnEnd', side });

  if (state.winner) return;

  const next = otherSide(side);
  if (next === 'player') state.turn++;
  state.active = next;
  for (const evt of beginTurn(state, next)) events.push(evt);
}

// 校验通过后才结算；校验抛错时不会执行到任何写操作
export function applyAction(state, action, cardDefs) {
  validateAction(state, action, cardDefs);
  const events = [];
  if (action.type === 'playCard') {
    playCard(state, action, cardDefs, events);
  } else {
    endTurn(state, action, events);
  }
  return events;
}

// ---------- 整局文档（动作序列 + 每步校验和） ----------

export function createDocument(cardDefs, encounter, seed) {
  const state = createState(cardDefs, encounter, seed);
  return {
    version: FORMAT_VERSION,
    seed: String(seed),
    state,
    actions: [],
    checksums: [checksumState(state)]
  };
}

export function dispatch(doc, action, cardDefs) {
  const events = applyAction(doc.state, action, cardDefs);
  doc.actions.push(action);
  doc.checksums.push(checksumState(doc.state));
  return events;
}

// ---------- 序列化 / 校验和 ----------

export function snapshotState(state) {
  return {
    version: state.version,
    seed: state.seed,
    rng: state.rng.toJSON(),
    turn: state.turn,
    active: state.active,
    winner: state.winner,
    handLimit: state.handLimit,
    nextUid: state.nextUid,
    // 深拷贝：存档快照必须与活动状态完全隔离
    sides: JSON.parse(JSON.stringify(state.sides)),
    cards: JSON.parse(JSON.stringify(state.cards))
  };
}

export function restoreState(snapshot) {
  return {
    version: snapshot.version,
    seed: snapshot.seed,
    rng: Rng.fromJSON(snapshot.rng),
    turn: snapshot.turn,
    active: snapshot.active,
    winner: snapshot.winner,
    handLimit: snapshot.handLimit,
    nextUid: snapshot.nextUid,
    sides: snapshot.sides,
    cards: snapshot.cards
  };
}

// key 排序后的规范化 JSON，保证不同机器、不同插入顺序算出同一个值
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

// FNV-1a 32 位，输出 8 位十六进制
export function checksumState(state) {
  const str = canonical(snapshotState(state));
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
