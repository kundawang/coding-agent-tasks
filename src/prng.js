// 可复现随机源：mulberry32 + 可序列化状态。
// 整局所有随机操作（洗牌、以后可能扩展的随机效果）都必须经过这里。

export function hashSeed(seed) {
  const str = String(seed ?? '');
  // xfnv1a，把任意字符串压成 32 位无符号整数
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  // state 是 mulberry32 当前的 32 位状态；calls 仅用于记录与排错
  constructor(state, calls = 0) {
    this.state = state >>> 0;
    this.calls = calls;
  }

  static fromSeed(seed) {
    return new Rng(hashSeed(seed), 0);
  }

  next() {
    // mulberry32
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    this.calls++;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // [0, n) 的整数
  nextInt(n) {
    return Math.floor(this.next() * n);
  }

  // Fisher–Yates，原地洗牌，返回同一个数组
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  toJSON() {
    return { state: this.state >>> 0, calls: this.calls };
  }

  static fromJSON(json) {
    return new Rng(json.state >>> 0, json.calls);
  }
}
