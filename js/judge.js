// 判定与计分：纯计算，不依赖 DOM / Audio，可在 node 里单测。

// 判定窗口（毫秒，按 |偏差| 取档）。改这里即可整体调宽/调严。
export const WINDOWS = Object.freeze({
  perfect: 30,
  great: 60,
  good: 100,
});

// 每档基础分
export const SCORE = Object.freeze({
  perfect: 1000,
  great: 600,
  good: 300,
  miss: 0,
});

// 准确率权重：Perfect=1，Great=0.7，Good=0.4，Miss=0
export const ACC_WEIGHT = Object.freeze({
  perfect: 1,
  great: 0.7,
  good: 0.4,
  miss: 0,
});

// deltaMs 为带符号偏差（按键时间 - 音符时间，已扣除校准偏移）。
// 返回 'perfect' | 'great' | 'good' | 'miss'
export function judgeDelta(deltaMs) {
  const a = Math.abs(deltaMs);
  if (a <= WINDOWS.perfect) return 'perfect';
  if (a <= WINDOWS.great) return 'great';
  if (a <= WINDOWS.good) return 'good';
  return 'miss';
}

// 汇总成绩。counts: {perfect, great, good, miss}
export function summarize(counts, maxCombo) {
  const total = counts.perfect + counts.great + counts.good + counts.miss;
  let score = 0;
  let accSum = 0;
  for (const k of ['perfect', 'great', 'good', 'miss']) {
    score += SCORE[k] * counts[k];
    accSum += ACC_WEIGHT[k] * counts[k];
  }
  const accuracy = total === 0 ? 0 : (accSum / total) * 100;
  return { score, accuracy, maxCombo, total };
}

// 在音符表里找某条轨道上、离 calibratedMs 最近且尚未判定的音符下标。
// notes 按 t 升序；返回 -1 表示 ±good 窗口内没有可判定音符。
export function findHittableNote(notes, lane, calibratedMs) {
  let best = -1;
  let bestAbs = Infinity;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.lane !== lane || n.state !== 0) continue;
    const d = calibratedMs - n.t;
    if (d < -WINDOWS.good) break; // 后面只会更远，提前结束
    const a = Math.abs(d);
    if (a <= WINDOWS.good && a < bestAbs) {
      bestAbs = a;
      best = i;
    }
  }
  return best;
}
