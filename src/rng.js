// 确定性随机源：字符串种子 -> xmur3 派生 4 个 32 位状态字 -> sfc32 序列。
// 全程只用整数运算（Math.imul / 位运算），结果与平台、浮点实现无关。
// 注意：不使用 Math.random()、Date.now() 等任何环境相关输入。

// xmur3：把字符串混入成一个不断产出 32 位整数的函数。
// 按 UTF-16 码元（charCodeAt）逐个混入；任何 JS 引擎里同一个字符串
// 的码元序列都相同，因此不依赖文件/URL 的字节编码方式。
export function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function nextWord() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

// sfc32：Small Fast Counter PRNG，输出 [0, 1)。
export function sfc32(a, b, c, d) {
  return function nextFloat() {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export class Random {
  constructor(seedString) {
    const seedWords = xmur3(seedString == null ? '' : String(seedString));
    this._next = sfc32(seedWords(), seedWords(), seedWords(), seedWords());
    this.next = this.next.bind(this);
  }

  // [0, 1)
  next() {
    return this._next();
  }

  // [min, max] 闭区间整数
  int(min, max) {
    return min + ((this._next() * (max - min + 1)) | 0);
  }

  pick(values) {
    return values[(this._next() * values.length) | 0];
  }

  // Fisher-Yates，原地洗牌，返回同一个数组。
  shuffle(values) {
    for (let i = values.length - 1; i > 0; i--) {
      const j = (this._next() * (i + 1)) | 0;
      const tmp = values[i];
      values[i] = values[j];
      values[j] = tmp;
    }
    return values;
  }
}
