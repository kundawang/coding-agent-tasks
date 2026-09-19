// 键盘延迟校准：纯计算部分。

// taps: 用户敲击时刻（音频时钟毫秒）数组
// beats: 节拍应有时刻（音频时钟毫秒）数组
// 每个节拍匹配 ±maxDelta 内最近的一次敲击，返回偏差（敲击 - 节拍）数组。
export function matchTaps(taps, beats, maxDelta = 250) {
  const used = new Set();
  const deltas = [];
  for (const b of beats) {
    let best = -1;
    let bestAbs = Infinity;
    for (let i = 0; i < taps.length; i++) {
      if (used.has(i)) continue;
      const d = taps[i] - b;
      const a = Math.abs(d);
      if (a <= maxDelta && a < bestAbs) {
        bestAbs = a;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      deltas.push(taps[best] - b);
    }
  }
  return deltas;
}

export function median(values) {
  if (values.length === 0) return 0;
  const s = [...values].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// 汇总一次校准。offsetMs > 0 表示按键事件比实际晚到（设备延迟），
// 判定时应从按键时刻减去它。至少匹配 minMatched 拍才算成功。
export function computeOffset(taps, beats, minMatched = 3) {
  const deltas = matchTaps(taps, beats);
  if (deltas.length < minMatched) {
    return { ok: false, offsetMs: 0, matched: deltas.length, samples: deltas };
  }
  return {
    ok: true,
    offsetMs: Math.round(median(deltas) * 10) / 10,
    matched: deltas.length,
    samples: deltas,
  };
}
