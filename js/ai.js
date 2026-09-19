// AI 策略：纯函数，只看公开状态（自己的手牌和能量），
// 返回一个动作，由调用方走和玩家完全一样的 playCard/endTurn 接口执行。

import { otherSide } from './engine.js';

// 返回 {type:'play', handIndex, target}，没有能打的牌则返回 null（调用方去 endTurn）。
// 策略：手上能打的牌就打，优先打带 damage 的（取手牌里最左边的一张），能量不够就停。
export function aiNextAction(state, side) {
  if (state.phase !== 'play' || state.active !== side) return null;
  const s = state.sides[side];
  const playable = [];
  for (let i = 0; i < s.hand.length; i++) {
    const card = state.cards[s.hand[i]];
    if (card && card.cost <= s.energy) playable.push({ i, card });
  }
  if (playable.length === 0) return null;
  const withDamage = playable.filter(p => p.card.effects.some(e => e.kind === 'damage'));
  const pick = (withDamage.length > 0 ? withDamage : playable)[0];
  const target = pick.card.target === 'enemy'
    ? otherSide(side)
    : pick.card.target === 'self'
      ? side
      : null;
  return { type: 'play', handIndex: pick.i, target };
}
