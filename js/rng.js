// 确定性随机源：FNV-1a 把种子字符串散成 32 位整数，再用 mulberry32 生成序列。
// rng 就是一个普通对象 { s }，可以直接 JSON 序列化/恢复，整局共用一个实例。

export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed) {
  return { s: hashSeed(String(seed)) };
}

// 返回 [0, 1) 的浮点数，推进状态
export function nextFloat(rng) {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// 返回 [0, n) 的整数
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
