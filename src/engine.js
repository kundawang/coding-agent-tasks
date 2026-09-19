// 纯计算战斗引擎：不碰 DOM、不碰 localStorage，浏览器和 Node 都能直接 import。
// 所有写操作遵循“先完整校验、再一次性改状态”，非法输入抛 GameError，状态不留半成品。

import { createRng, shuffle } from './rng.js';

export const HAND_LIMIT = 10;

export class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}

const STATUS_NAMES = ['strength', 'vulnerable', 'weak'];

export function validateCardDefs(cardDefs) {
  for (const card of cardDefs) {
    if (!card || typeof card.id !== 'string') throw new Error('卡表存在缺少 id 的牌');
    if (!Number.isInteger(card.cost) || card.cost < 0) throw new Error(`${card.id}：cost 必须是非负整数`);
    if (!['enemy', 'self', 'none'].includes(card.target)) throw new Error(`${card.id}：target 非法`);
    if (!Array.isArray(card.effects)) throw new Error(`${card.id}：effects 必须是数组`);
    for (const eff of card.effects) validateEffect(card.id, eff);
  }
}

function validateEffect(cardId, eff) {
  const amount = (label) => {
    if (!Number.isInteger(eff.amount) || eff.amount < 0) {
      throw new Error(`${cardId}：${label} 的 amount 必须是非负整数`);
    }
  };
  switch (eff.kind) {
    case 'damage':
      amount('damage');
      if (eff.times !== undefined && (!Number.isInteger(eff.times) || eff.times < 1)) {
        throw new Error(`${cardId}：damage.times 必须是正整数`);
      }
      break;
    case 'block':
    case 'draw':
    case 'energy':
    case 'heal':
    case 'loseHp':
      amount(eff.kind);
      break;
    case 'apply':
      amount('apply');
      if (!['self', 'enemy'].includes(eff.who)) throw new Error(`${cardId}：apply.who 非法`);
      if (!STATUS_NAMES.includes(eff.status)) throw new Error(`${cardId}：apply.status 非法`);
      break;
    default:
      throw new Error(`${cardId}：未知效果 kind=${eff.kind}（新效果在引擎注册后即可使用）`);
  }
}

function makeSide(conf) {
  return {
    name: conf.name,
    hp: conf.hp,
    maxHp: conf.maxHp,
    energy: 0,
    maxEnergy: conf.energyPerTurn,
    handSize: conf.handSize,
    block: 0,
    statuses: { strength: 0, vulnerable: 0, weak: 0 },
    drawPile: [],
    hand: [],
    discard: [],
    exhaust: [],
  };
}

// 新建一局：洗牌顺序固定为玩家→敌方，同种子必然同序。
export function createGame(encounter, cardMap, seed) {
  const cards = {};
  let nextUid = 1;
  const buildDeck = (idList) =>
    idList.map((id) => {
      if (!cardMap[id]) throw new GameError('BAD_DECK', `牌组引用了卡表里不存在的牌：${id}`);
      const uid = nextUid++;
      cards[uid] = id;
      return uid;
    });

  const game = {
    version: 1,
    seed,
    name: encounter.name,
    rngState: 0,
    nextUid,
    turn: 0,
    active: 'enemy',
    over: false,
    winner: null,
    sides: {
      player: makeSide(encounter.player),
      enemy: makeSide(encounter.enemy),
    },
    cards,
  };

  const rng = createRng(seed);
  game._rng = rng;
  game.sides.player.drawPile = shuffle(buildDeck(encounter.player.deck), rng);
  game.sides.enemy.drawPile = shuffle(buildDeck(encounter.enemy.deck), rng);
  game.nextUid = nextUid;
  beginTurn(game, 'player');
  return game;
}

// 从 localStorage / 回放记录恢复时，把 rngState 重新包成带方法的对象。
export function attachRng(game, fallbackRng = null) {
  if (game._rng) return game._rng;
  const rng = fallbackRng || createRng(game.rngState || game.seed);
  if (!fallbackRng) rng.state = game.rngState >>> 0;
  game._rng = rng;
  return rng;
}

export function detachRng(game) {
  if (game._rng) game.rngState = game._rng.state >>> 0;
  delete game._rng;
  return game;
}

const other = (side) => (side === 'player' ? 'enemy' : 'player');

function assertLive(game) {
  if (game.over) throw new GameError('GAME_OVER', '本局已经结束');
}

// 回合开始：护甲清零 → 易伤/虚弱各掉 1 → 能量回满 → 抽牌。
export function beginTurn(game, side) {
  assertLive(game);
  if (side !== 'player' && side !== 'enemy') throw new GameError('BAD_SIDE', '不存在的一方');
  if (side === 'player') game.turn += 1;
  const s = game.sides[side];
  s.block = 0;
  s.statuses.vulnerable = Math.max(0, s.statuses.vulnerable - 1);
  s.statuses.weak = Math.max(0, s.statuses.weak - 1);
  s.energy = s.maxEnergy;
  game.active = side;
  const draw = drawCards(game, side, s.handSize);
  return { type: 'beginTurn', side, ...draw };
}

// 结束回合：手牌全部进弃牌堆。不自动开下一方回合——下一方的回合开始
// （beginTurn）也是一条可记录、可重放的步骤。
export function finishTurn(game, side) {
  assertLive(game);
  if (game.active !== side) throw new GameError('NOT_YOUR_TURN', '还没轮到这一方结束回合');
  const s = game.sides[side];
  s.discard.push(...s.hand);
  s.hand = [];
  game.active = other(side);
  return { type: 'endTurn', side };
}

// 抽牌：抽空了把弃牌堆洗回去；洗回去还不够就少抽，绝不报错。
// 手牌上限 10，第 11 张起抽到手后立刻进弃牌堆。
export function drawCards(game, side, amount) {
  const s = game.sides[side];
  const rng = attachRng(game);
  const drawn = [];
  const overflow = [];
  let reshuffled = false;
  for (let i = 0; i < amount; i++) {
    if (s.drawPile.length === 0) {
      if (s.discard.length === 0) break;
      s.drawPile = shuffle(s.discard, rng);
      s.discard = [];
      reshuffled = true;
    }
    const uid = s.drawPile.pop();
    if (s.hand.length >= HAND_LIMIT) {
      s.discard.push(uid);
      overflow.push(uid);
    } else {
      s.hand.push(uid);
      drawn.push(uid);
    }
  }
  return { type: 'draw', side, drawn, overflow, reshuffled };
}

// 出牌。校验全部通过之前不动任何字段；通过后按 effects 顺序结算。
export function playCard(game, side, cardUid, targetSide, cardMap) {
  assertLive(game);
  if (game.active !== side) throw new GameError('NOT_YOUR_TURN', '还没轮到你出牌');
  const s = game.sides[side];
  const idx = s.hand.indexOf(cardUid);
  if (idx === -1) throw new GameError('NOT_IN_HAND', '这张牌不在手上');
  const cardId = game.cards[cardUid];
  const card = cardMap[cardId];
  if (!card) throw new GameError('BAD_CARD', `找不到牌定义：${cardId}`);
  if (s.energy < card.cost) throw new GameError('NOT_ENOUGH_ENERGY', `能量不足：需要 ${card.cost}，当前 ${s.energy}`);

  let resolvedTarget = null;
  if (card.target === 'enemy') resolvedTarget = other(side);
  else if (card.target === 'self') resolvedTarget = side;
  if (card.target !== 'none') {
    if (!targetSide || (targetSide !== 'player' && targetSide !== 'enemy')) {
      throw new GameError('BAD_TARGET', '必须指定目标');
    }
    if (resolvedTarget !== targetSide) {
      throw new GameError('BAD_TARGET', '这张牌不能指向该目标');
    }
  }

  // ---- 校验通过，开始一次性结算 ----
  s.energy -= card.cost;
  const effects = card.effects.map((eff) => applyEffect(game, side, resolvedTarget, eff));
  s.hand.splice(idx, 1);
  if (card.exhaust) s.exhaust.push(cardUid);
  else s.discard.push(cardUid);

  const result = {
    type: 'playCard',
    side,
    cardUid,
    cardId,
    target: card.target === 'none' ? null : resolvedTarget,
    effects,
  };
  finalizeDeath(game);
  return result;
}

// 单次命中：(牌面伤害 + 力量) × 易伤1.5 × 虚弱0.75，最后向下取整。
function computeHit(attacker, defender, base) {
  const strength = attacker.statuses.strength || 0;
  let dmg = base + strength;
  if (defender.statuses.vulnerable > 0) dmg *= 1.5;
  if (attacker.statuses.weak > 0) dmg *= 0.75;
  return Math.floor(dmg);
}

function dealDamage(game, attackerSide, defenderSide, base) {
  const attacker = game.sides[attackerSide];
  const defender = game.sides[defenderSide];
  const amount = computeHit(attacker, defender, base);
  let absorbed = 0;
  let hpLoss = 0;
  if (defender.block > 0) {
    absorbed = Math.min(defender.block, amount);
    defender.block -= absorbed;
  }
  const remain = amount - absorbed;
  if (remain > 0) {
    hpLoss = Math.min(remain, defender.hp);
    defender.hp -= hpLoss;
  }
  return { amount, blocked: absorbed, hpLoss };
}

function applyEffect(game, casterSide, targetSide, eff) {
  const caster = game.sides[casterSide];
  switch (eff.kind) {
    case 'damage': {
      const hits = [];
      const times = eff.times ?? 1;
      for (let i = 0; i < times; i++) {
        hits.push(dealDamage(game, casterSide, targetSide, eff.amount));
      }
      return { kind: 'damage', target: targetSide, hits };
    }
    case 'block': {
      caster.block += eff.amount;
      return { kind: 'block', target: casterSide, amount: eff.amount };
    }
    case 'draw': {
      const draw = drawCards(game, casterSide, eff.amount);
      return { kind: 'draw', target: casterSide, drawn: draw.drawn, overflow: draw.overflow, reshuffled: draw.reshuffled };
    }
    case 'energy': {
      caster.energy += eff.amount;
      return { kind: 'energy', target: casterSide, amount: eff.amount };
    }
    case 'apply': {
      const who = eff.who === 'self' ? casterSide : targetSide;
      const side = game.sides[who];
      side.statuses[eff.status] += eff.amount;
      return { kind: 'apply', target: who, status: eff.status, amount: eff.amount };
    }
    case 'heal': {
      const before = caster.hp;
      caster.hp = Math.min(caster.maxHp, caster.hp + eff.amount);
      return { kind: 'heal', target: casterSide, amount: caster.hp - before };
    }
    case 'loseHp': {
      const amount = Math.min(eff.amount, caster.hp);
      caster.hp -= amount;
      return { kind: 'loseHp', target: casterSide, amount };
    }
    default:
      throw new GameError('BAD_EFFECT', `未知效果：${eff.kind}`);
  }
}

function finalizeDeath(game) {
  const playerDead = game.sides.player.hp <= 0;
  const enemyDead = game.sides.enemy.hp <= 0;
  if (playerDead || enemyDead) {
    game.over = true;
    game.winner = playerDead && enemyDead ? null : playerDead ? 'enemy' : 'player';
  }
}

// 可安全 JSON.stringify 的快照（深拷贝 + rng 状态落盘）。
export function serializeGame(game) {
  detachRng(game);
  return JSON.stringify(game);
}

export function deserializeGame(text) {
  const game = JSON.parse(text);
  attachRng(game);
  return game;
}
