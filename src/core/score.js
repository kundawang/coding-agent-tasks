// 纯计分逻辑：档位分值 + 连击奖励，实时累加，打完汇总。

export const BASE_POINTS = Object.freeze({
  perfect: 1000,
  great: 700,
  good: 300,
  miss: 0,
});

// 用于准确率的“每音符权重”。
export const ACCURACY_WEIGHTS = Object.freeze({
  perfect: 1,
  great: 0.75,
  good: 0.4,
  miss: 0,
});

const COMBO_BONUS_STEP = 10;
const COMBO_BONUS_MAX = 100;

// 单次击打得分：基础分 + 连击奖励（Miss 为 0，且连击清零）。
// comboBefore 是本次击打之前的连击数。
export function pointsFor(judgment, comboBefore = 0) {
  if (judgment === 'miss') return 0;
  const bonus = Math.min(comboBefore * COMBO_BONUS_STEP, COMBO_BONUS_MAX);
  return BASE_POINTS[judgment] + bonus;
}

export function accuracyOf(counts, totalNotes) {
  if (!totalNotes) return 1;
  let weighted = 0;
  for (const key of Object.keys(ACCURACY_WEIGHTS)) {
    weighted += (counts[key] || 0) * ACCURACY_WEIGHTS[key];
  }
  return weighted / totalNotes;
}

export function rankOf(accuracy) {
  if (accuracy >= 0.995) return 'SS';
  if (accuracy >= 0.95) return 'S';
  if (accuracy >= 0.9) return 'A';
  if (accuracy >= 0.8) return 'B';
  if (accuracy >= 0.65) return 'C';
  if (accuracy >= 0.5) return 'D';
  return 'F';
}

export class Scoreboard {
  constructor(totalNotes) {
    this.totalNotes = totalNotes;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.combo = 0;
    this.maxCombo = 0;
    this.score = 0;
    this.early = 0; // perfect/great/good 中 errorMs < 0 的数量
    this.late = 0;
  }

  apply(judgment, errorMs = 0) {
    this.counts[judgment] += 1;
    if (judgment === 'miss') {
      this.combo = 0;
    } else {
      this.score += pointsFor(judgment, this.combo);
      this.combo += 1;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      if (errorMs < 0) this.early += 1;
      else if (errorMs > 0) this.late += 1;
    }
    return this.score;
  }

  get accuracy() {
    return accuracyOf(this.counts, this.totalNotes);
  }

  get rank() {
    return rankOf(this.accuracy);
  }

  summary() {
    return {
      counts: { ...this.counts },
      combo: this.maxCombo,
      maxCombo: this.maxCombo,
      score: this.score,
      accuracy: this.accuracy,
      rank: this.rank,
      totalNotes: this.totalNotes,
      early: this.early,
      late: this.late,
    };
  }
}
