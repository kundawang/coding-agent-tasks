// 计分与准确率（纯计算）。
export const NOTE_SCORE = Object.freeze({
  perfect: 1000,
  great: 650,
  good: 300,
  miss: 0,
});

const ACC_WEIGHT = Object.freeze({
  perfect: 1,
  great: 0.65,
  good: 0.3,
  miss: 0,
});

export function emptyCounts() {
  return { perfect: 0, great: 0, good: 0, miss: 0 };
}

export function totalScore(counts) {
  let sum = 0;
  for (const grade of Object.keys(NOTE_SCORE)) {
    sum += (counts[grade] || 0) * NOTE_SCORE[grade];
  }
  return sum;
}

// 0-100 的百分比
export function accuracy(counts) {
  let total = 0;
  let weight = 0;
  for (const grade of Object.keys(ACC_WEIGHT)) {
    const n = counts[grade] || 0;
    total += n;
    weight += n * ACC_WEIGHT[grade];
  }
  return total === 0 ? 0 : (weight / total) * 100;
}

export function rank(acc) {
  if (acc >= 98) return 'SS';
  if (acc >= 94) return 'S';
  if (acc >= 88) return 'A';
  if (acc >= 78) return 'B';
  return 'C';
}
