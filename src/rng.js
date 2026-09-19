// 唯一的随机源：整局游戏（洗牌、AI 抉择）都走这一个 stateful RNG。
// mulberry32，32 位整数状态，可序列化、可恢复。

export function createRng(seed) {
  const rng = {
    state: seed >>> 0,
    next() {
      rng.state = (rng.state + 0x6d2b79f5) | 0;
      let t = Math.imul(rng.state ^ (rng.state >>> 15), 1 | rng.state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    nextInt(n) {
      return Math.floor(rng.next() * n);
    },
  };
  return rng;
}

// 种子允许填数字（?seed=12345）或任意字符串，字符串走 FNV-1a 哈希。
export function hashSeed(input) {
  if (typeof input === 'number' && Number.isFinite(input)) return input >>> 0;
  const str = String(input);
  if (/^\d+$/.test(str.trim())) return Number(str.trim()) >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Fisher–Yates，随机数全部来自传入的 rng。
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
