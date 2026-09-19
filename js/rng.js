// 确定性随机源：mulberry32。整局游戏只有这一个随机源，
// 洗牌、抽牌、重洗全部从这里取数，状态就是一个 32 位整数，可序列化。

export function hashSeed(input) {
  const str = String(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seedInput) {
  return { s: hashSeed(seedInput) };
}

export function nextFloat(rng) {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextInt(rng, n) {
  return Math.floor(nextFloat(rng) * n);
}

// Fisher-Yates，原地洗牌
export function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
