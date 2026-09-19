// AI 策略：和玩家走完全一样的接口（engine.playCard / engine.endTurn），
// 只看自己的手牌和能量，不碰牌堆、不改任何数。
// 策略（README）：能打的牌里优先打带 damage 的，能量不够就停，目标永远是玩家。

import { other } from './engine.js';

// 返回一个 action：{ type:'play', uid, target } 或 { type:'endTurn' }
export function chooseAiAction(state, side = 'enemy') {
  const me = state.players[side];
  const playable = me.hand.filter((c) => state.cards[c.id].cost <= me.energy);
  if (playable.length === 0) return { type: 'endTurn' };
  const attacks = playable.filter((c) =>
    state.cards[c.id].effects.some((e) => e.kind === 'damage')
  );
  const pick = (attacks.length > 0 ? attacks : playable)[0];
  const def = state.cards[pick.id];
  const target = def.target === 'enemy' ? other(side) : def.target === 'self' ? side : null;
  return { type: 'play', uid: pick.uid, target };
}
