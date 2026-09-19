import { SCORE, WEIGHTS } from './config.js';

// 单次判定得分：基础分 + 连击加成
export function scoreFor(judgement, comboBefore, cfg = SCORE) {
  const base = cfg[judgement] ?? 0;
  if (judgement === 'miss') return 0;
  const comboAfter = comboBefore + 1;
  return base + Math.min(comboAfter * cfg.comboStep, cfg.comboCap);
}

export function accuracyFromCounts(counts, weights = WEIGHTS) {
  const total =
    counts.perfect + counts.great + counts.good + counts.miss;
  if (total === 0) return 0;
  const got =
    counts.perfect * weights.perfect +
    counts.great * weights.great +
    counts.good * weights.good;
  return got / total;
}

export function rankFor(accuracy) {
  if (accuracy >= 0.98) return 'S';
  if (accuracy >= 0.93) return 'A';
  if (accuracy >= 0.85) return 'B';
  if (accuracy >= 0.70) return 'C';
  return 'D';
}

// 增量计分板，游戏过程中逐判定更新
export class ScoreBoard {
  constructor() {
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.combo = 0;
    this.maxCombo = 0;
    this.score = 0;
  }

  add(judgement) {
    this.counts[judgement] += 1;
    if (judgement === 'miss') {
      this.combo = 0;
      return;
    }
    this.score += scoreFor(judgement, this.combo);
    this.combo += 1;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
  }

  result() {
    const totalNotes =
      this.counts.perfect + this.counts.great + this.counts.good + this.counts.miss;
    return {
      counts: { ...this.counts },
      maxCombo: this.maxCombo,
      score: this.score,
      accuracy: accuracyFromCounts(this.counts),
      rank: rankFor(accuracyFromCounts(this.counts)),
      totalNotes,
    };
  }
}
