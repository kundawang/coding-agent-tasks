import { attachRng } from './engine.js';

// AI 决策。和玩家走完全相同的通道：只读自己手上的牌，只返回“出哪张”，
// 由引擎负责结算（不能也无法直接扣血/看牌堆）。
// 策略：有能量支付的牌就打；同费用下优先带 damage 的；并列时走游戏 RNG 随机选。

export function chooseAiAction(game, cardMap) {
  if (game.over || game.active !== 'enemy') return null;
  const me = game.sides.enemy;
  const playable = [];
  for (const uid of me.hand) {
    const card = cardMap[game.cards[uid]];
    if (card && card.cost <= me.energy) playable.push({ uid, card });
  }
  if (playable.length === 0) return null;

  const hasDamage = (card) => card.effects.some((eff) => eff.kind === 'damage');
  const attackers = playable.filter((p) => hasDamage(p.card));
  const pool = attackers.length > 0 ? attackers : playable;

  // 并列时按“费用最高”贪心：愿意把能量花光（能量不够的牌已过滤）。
  let bestCost = -1;
  let best = pool;
  for (const p of pool) {
    if (p.card.cost > bestCost) {
      bestCost = p.card.cost;
      best = [p];
    } else if (p.card.cost === bestCost) {
      best.push(p);
    }
  }
  const rng = attachRng(game);
  const pick = best[rng.nextInt(best.length)];
  return {
    type: 'playCard',
    cardUid: pick.uid,
    targetSide: 'player',
  };
}
