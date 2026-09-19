// 纯判定逻辑：不依赖 DOM / AudioContext，可直接在 Node 中测试。
// 时间单位统一为毫秒（相对于歌曲 0 点）。

export const JUDGMENT_WINDOWS_MS = Object.freeze({
  perfect: 30,
  great: 60,
  good: 100,
});

export const JUDGMENT_ORDER = Object.freeze(['perfect', 'great', 'good', 'miss']);

// 根据“已经扣除设备偏移”的误差给出判定档位。
// 边界约定：|e| <= 30 perfect，<= 60 great，<= 100 good，再往外 miss。
export function gradeError(errorMs) {
  const abs = Math.abs(errorMs);
  if (abs <= JUDGMENT_WINDOWS_MS.perfect) return 'perfect';
  if (abs <= JUDGMENT_WINDOWS_MS.great) return 'great';
  if (abs <= JUDGMENT_WINDOWS_MS.good) return 'good';
  return 'miss';
}

// 谱面音符状态机：按轨道维护，负责按键匹配与超时 Miss 清扫。
// offsetMs 为设备校准值：判定误差 = 击打时刻 - 音符时刻 - offsetMs。
export class NoteField {
  constructor(notes, laneCount = 4, windows = JUDGMENT_WINDOWS_MS) {
    this.laneCount = laneCount;
    this.goodWindow = windows.good;
    this.lanes = Array.from({ length: laneCount }, () => []);
    for (const note of notes) {
      this.lanes[note.lane].push({
        t: note.t,
        lane: note.lane,
        state: 'active', // active | hit | missed
        judgment: null,
        errorMs: null,
      });
    }
    for (const list of this.lanes) list.sort((a, b) => a.t - b.t);
    this.heads = new Array(laneCount).fill(0);
    this.total = notes.length;
    this.resolved = 0;
  }

  get remaining() {
    return this.total - this.resolved;
  }

  get complete() {
    return this.resolved >= this.total;
  }

  _skipResolved(lane) {
    const list = this.lanes[lane];
    while (this.heads[lane] < list.length && list[this.heads[lane]].state !== 'active') {
      this.heads[lane] += 1;
    }
  }

  // 把“当前时刻已经越过 good 窗口”的音符判为 Miss。
  // 只依赖时间，渲染掉帧也不会漏判 / 错判。
  sweep(nowSongMs, offsetMs = 0) {
    const now = nowSongMs - offsetMs;
    const missed = [];
    for (let lane = 0; lane < this.laneCount; lane += 1) {
      this._skipResolved(lane);
      const list = this.lanes[lane];
      while (this.heads[lane] < list.length) {
        const note = list[this.heads[lane]];
        if (note.state !== 'active' || note.t + this.goodWindow >= now) break;
        note.state = 'missed';
        note.judgment = 'miss';
        note.errorMs = Math.round(now - note.t);
        missed.push(note);
        this.heads[lane] += 1;
        this.resolved += 1;
      }
    }
    return missed;
  }

  // 一次按键：在 ±good 窗口内选误差绝对值最小的未判定音符。
  // 返回 { note, judgment, errorMs }，窗口内没有音符则返回 null（空打）。
  hit(lane, hitSongMs, offsetMs = 0) {
    const list = this.lanes[lane];
    if (lane < 0 || lane >= this.laneCount) return null;
    this._skipResolved(lane);
    const now = hitSongMs - offsetMs;
    let best = null;
    let bestAbs = Infinity;
    for (let i = this.heads[lane]; i < list.length; i += 1) {
      const note = list[i];
      if (note.state === 'active') {
        if (note.t > now + this.goodWindow) break;
        const errorMs = now - note.t;
        const abs = Math.abs(errorMs);
        if (abs <= this.goodWindow && abs < bestAbs) {
          best = note;
          bestAbs = abs;
        }
      } else if (note.t > now + this.goodWindow) {
        break;
      }
    }
    if (!best) return null;
    const errorMs = Math.round(now - best.t);
    best.state = 'hit';
    best.judgment = gradeError(errorMs);
    best.errorMs = errorMs;
    this.resolved += 1;
    return { note: best, judgment: best.judgment, errorMs };
  }
}
