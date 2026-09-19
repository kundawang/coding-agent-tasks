// 确定性随机数。种子存进存档，保证离线补算过程可以复现，
// 且模拟逻辑在 Node 测试和浏览器里行为一致。

// mulberry32：输出 [0,1)，状态是一个 32 位无符号整数
export function nextState(state) {
  let s = state >>> 0;
  s = (s + 0x6D2B79F5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state: s, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

export function random(state) {
  return nextState(state);
}

// [0, n) 整数
export function randInt(state, n) {
  const r = nextState(state);
  return { state: r.state, value: Math.floor(r.value * n) };
}

// 均值为 lambda 的泊松抽样（Knuth），顾客到达数用它
export function poisson(state, lambda) {
  if (lambda <= 0) return { state, value: 0 };
  const L = Math.exp(-lambda);
  let s = state >>> 0;
  let k = 0;
  let p = 1;
  do {
    k += 1;
    const r = nextState(s);
    s = r.state;
    p *= r.value;
  } while (p > L);
  return { state: s, value: k - 1 };
}