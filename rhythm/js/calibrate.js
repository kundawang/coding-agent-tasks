// 输入延迟校准（纯计算）。
// 用户跟着节拍点按键，deltas = 每次击打时刻 - 节拍时刻（ms，正=晚）。
// 取中位数，抗偶发手滑；机器延迟是系统性偏移，中位数即可估计。
export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 返回 { offsetMs, spreadMs }；offsetMs 之后从每次击打时刻中减去
export function computeOffset(deltas) {
  const offsetMs = median(deltas);
  const spreadMs = deltas.length === 0
    ? 0
    : median(deltas.map(d => Math.abs(d - offsetMs)));
  return { offsetMs, spreadMs };
}
