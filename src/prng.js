// 确定性伪随机数。整局游戏只允许从这里拿随机数，
// 种子写进回放文件，保证回放逐 bit 一致（禁止 Math.random）。

// mulberry32：给定 state(uint32)，返回 [0,1) 随机数与新 state。
export function nextRng(state) {
  let s = state >>> 0;
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, s];
}

// 用字符串种子派生 uint32 初始状态：xmur3。
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h = (h ^= h >>> 16) >>> 0;
  return h || 0x9e3779b9;
}