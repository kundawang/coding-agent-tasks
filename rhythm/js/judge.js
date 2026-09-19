// 判定窗口（纯计算，浏览器 / Node 通用）。
// deltaMs = 修正后的击打时刻 - 音符时刻，单位毫秒，正=晚，负=早。
export const WINDOWS = Object.freeze({
  perfect: 30,
  great: 60,
  good: 100,
});

export const GRADES = Object.freeze(['perfect', 'great', 'good', 'miss']);

// 返回 'perfect' | 'great' | 'good' | 'miss'
export function judgeDelta(deltaMs) {
  const abs = Math.abs(deltaMs);
  if (abs <= WINDOWS.perfect) return 'perfect';
  if (abs <= WINDOWS.good) return abs <= WINDOWS.great ? 'great' : 'good';
  return 'miss';
}

// 音符晚于此时刻仍未击打即判 miss
export const MISS_AFTER_MS = WINDOWS.good;
