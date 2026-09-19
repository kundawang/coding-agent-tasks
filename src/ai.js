// AI 策略：和玩家走完全一样的接口——只读公开状态、只产出 action，
// 不直接扣血、不洗牌、不看牌堆。结算一律交给 engine.applyAction。

import { handOptions, otherSide } from './engine.js';

export function cardHasDamage(def) {
  return def.effects.some((eff) => eff.kind === 'damage');
}

// 返回一个 action；没有能打的牌时返回 null（调用方结束回合）。
// 规则（README）：有能打的牌就打，优先带 damage 的，能量不够就停，目标永远是对手。
// 并列时按手牌从左到右，保证同种子同结果。
export function chooseAction(state, side, cardDefs) {
  const options = handOptions(state, side, cardDefs).filter((opt) => opt.playable);
  if (options.length === 0) return null;

  const damageOption = options.find((opt) => cardHasDamage(opt.def));
  const chosen = damageOption ?? options[0];
  if (chosen.def.target === 'enemy') {
    return { type: 'playCard', side, handIndex: chosen.index, target: otherSide(side) };
  }
  return { type: 'playCard', side, handIndex: chosen.index };
}
