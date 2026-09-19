// 把一个引擎结算结果翻译成人话，CLI / 战斗日志 / 回放进度条共用。

export const STATUS_LABEL = { strength: '力量', vulnerable: '易伤', weak: '虚弱' };
export const SIDE_LABEL = { player: '你', enemy: 'AI' };

export function describeEffects(result) {
  const parts = [];
  for (const eff of result.effects) {
    if (eff.kind === 'damage') {
      const hits = eff.hits.map((h) => {
        let s = `${h.amount}`;
        if (h.blocked) s += `（甲挡${h.blocked}）`;
        if (h.hpLoss) s += `（血-${h.hpLoss}）`;
        return s;
      });
      parts.push(`造成 ${hits.length > 1 ? `${hits.length} 段：` : ''}${hits.join('、')} 伤害`);
    } else if (eff.kind === 'block') {
      parts.push(`获得 ${eff.amount} 护甲`);
    } else if (eff.kind === 'draw') {
      let s = `抽 ${eff.drawn.length} 张`;
      if (eff.overflow.length) s += `（${eff.overflow.length} 张爆手牌进弃牌堆）`;
      if (eff.reshuffled) s += '（弃牌堆洗回）';
      parts.push(s);
    } else if (eff.kind === 'energy') {
      parts.push(`能量 +${eff.amount}`);
    } else if (eff.kind === 'apply') {
      parts.push(`${SIDE_LABEL[eff.target]}获得 ${eff.amount} 层${STATUS_LABEL[eff.status]}`);
    } else if (eff.kind === 'heal') {
      parts.push(`回复 ${eff.amount} 点生命`);
    } else if (eff.kind === 'loseHp') {
      parts.push(`失去 ${eff.amount} 点生命（无视护甲）`);
    }
  }
  return parts.join('；');
}

export function describeStep(step, cardMap) {
  if (step.kind === 'start') return '开局';
  if (step.kind === 'beginTurn') return `${SIDE_LABEL[step.side]}的回合开始`;
  if (step.kind === 'endTurn') return `${SIDE_LABEL[step.side]}结束回合`;
  if (step.kind === 'playCard') {
    const card = cardMap[step.snapshot.cards[step.cardUid]];
    return `${SIDE_LABEL[step.side]}打出「${card ? card.name : step.cardUid}」`;
  }
  return String(step.kind);
}
