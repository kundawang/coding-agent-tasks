// 游戏主循环：Canvas 渲染 + 键盘判定。
// 原则：所有时序只读音频时钟（audio.nowSongMs / eventToSongMs），
// requestAnimationFrame 纯粹用于把当前歌曲位置画出来——掉帧只影响画面流畅度，
// 不影响判定结果。
import { WINDOWS, judgeDelta, MISS_AFTER_MS } from './judge.js';
import { emptyCounts, totalScore, accuracy, rank } from './score.js';

export const KEY_TO_LANE = Object.freeze({ d: 0, f: 1, j: 2, k: 3 });
export const LANE_KEYS = ['D', 'F', 'J', 'K'];
const LANE_COLORS = ['#ff5d7e', '#ffb84d', '#4dd2ff', '#7dff6a'];
const LEAD_MS = 1600;        // 音符从出现到判定线的时长（恒定 => 与分辨率无关）
const HIT_FX_MS = 300;
const JUDGE_TEXT_MS = 500;

export class Game {
  constructor({ canvas, chart, audio, calibrationMs, onFinish, onPauseChange }) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.chart = chart;
    this.audio = audio;
    this.calibrationMs = calibrationMs;
    this.onFinish = onFinish;
    this.onPauseChange = onPauseChange || (() => {});

    this.notes = chart.notes.map(n => ({ time: n.time, lane: n.lane, judged: false, grade: null, delta: 0 }));
    this.durationMs = this.notes[this.notes.length - 1].time + 2000;
    this.laneCursor = [0, 0, 0, 0]; // 每条轨道第一个未判定音符的下标（按时间有序）
    this.laneNotes = [[], [], [], []];
    this.notes.forEach((n, i) => this.laneNotes[n.lane].push(i));

    this.counts = emptyCounts();
    this.combo = 0;
    this.maxCombo = 0;
    this.hitFx = [];        // {lane, songMs}
    this.judgeText = null;  // {grade, songMs}
    this.paused = false;
    this.finished = false;
    this.rafId = 0;
    this._loopBound = this._loop.bind(this);
    this._resizeBound = this._resize.bind(this);
  }

  start() {
    this._resize();
    window.addEventListener('resize', this._resizeBound);
    this.audio.startSong({
      bpm: this.chart.bpm,
      offsetMs: this.chart.offsetMs || 0,
      durationMs: this.durationMs,
      onEnded: () => this._finish(),
    });
    this.rafId = requestAnimationFrame(this._loopBound);
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this._resizeBound);
    this.audio.stop();
  }

  async togglePause() {
    if (this.finished) return;
    if (this.paused) {
      this.paused = false;
      this.onPauseChange(false);
      await this.audio.resume();
      this.rafId = requestAnimationFrame(this._loopBound);
    } else {
      this.paused = true;
      cancelAnimationFrame(this.rafId);
      await this.audio.pause(); // suspend 冻结音频时钟，画面停在同一歌曲位置
      this._render();           // 静止帧
      this.onPauseChange(true);
    }
  }

  // 返回 true 表示该按键被游戏消费
  handleKey(event) {
    if (this.paused || this.finished || event.repeat) return false;
    const lane = KEY_TO_LANE[event.key.toLowerCase()];
    if (lane === undefined) return false;
    const songMs = this.audio.eventToSongMs(event.timeStamp) - this.calibrationMs;
    this._judgeLane(lane, songMs);
    return true;
  }

  _judgeLane(lane, songMs) {
    const list = this.laneNotes[lane];
    let bestIdx = -1;
    let bestAbs = Infinity;
    for (let i = this.laneCursor[lane]; i < list.length; i++) {
      const note = this.notes[list[i]];
      if (note.time > songMs + WINDOWS.good) break;
      if (note.judged) continue;
      const abs = Math.abs(songMs - note.time);
      if (abs < bestAbs) { bestAbs = abs; bestIdx = list[i]; }
    }
    if (bestIdx < 0) return; // 窗口外空敲，不计
    const note = this.notes[bestIdx];
    const delta = songMs - note.time;
    this._applyGrade(note, judgeDelta(delta), delta);
  }

  _applyGrade(note, grade, delta) {
    note.judged = true;
    note.grade = grade;
    note.delta = delta;
    this.counts[grade]++;
    if (grade === 'miss') {
      this.combo = 0;
    } else {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.hitFx.push({ lane: note.lane, songMs: this.audio.nowSongMs() });
    }
    this.judgeText = { grade, songMs: this.audio.nowSongMs() };
  }

  _loop() {
    if (this.paused || this.finished) return;
    const songMs = this.audio.nowSongMs();
    // 超时未击打的音符判 miss
    for (let lane = 0; lane < 4; lane++) {
      const list = this.laneNotes[lane];
      while (this.laneCursor[lane] < list.length) {
        const note = this.notes[list[this.laneCursor[lane]]];
        if (note.judged) { this.laneCursor[lane]++; continue; }
        if (note.time < songMs - MISS_AFTER_MS) {
          this._applyGrade(note, 'miss', 0);
          this.laneCursor[lane]++;
        } else break;
      }
    }
    if (songMs > this.durationMs) { this._finish(); return; }
    this._render();
    this.rafId = requestAnimationFrame(this._loopBound);
  }

  _finish() {
    if (this.finished) return;
    this.finished = true;
    cancelAnimationFrame(this.rafId);
    // 未校准对照：把每次击打的修正量加回去重新判一次（miss 保持 miss）
    const raw = emptyCounts();
    raw.miss = this.counts.miss;
    for (const note of this.notes) {
      if (note.judged && note.grade !== 'miss') {
        raw[judgeDelta(note.delta + this.calibrationMs)]++;
      }
    }
    this.onFinish({
      counts: this.counts,
      uncalibratedCounts: raw,
      maxCombo: this.maxCombo,
      score: totalScore(this.counts),
      accuracy: accuracy(this.counts),
      rank: rank(accuracy(this.counts)),
      calibrationMs: this.calibrationMs,
    });
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _render() {
    const ctx = this.ctx2d;
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const songMs = this.audio.nowSongMs();

    // 布局全部按当前帧尺寸现算：拖窗口 / 切全屏不会积累任何误差
    const laneW = Math.min(110, W / 7);
    const fieldW = laneW * 4;
    const x0 = (W - fieldW) / 2;
    const judgeY = H * 0.85;
    const speed = (judgeY + 60) / LEAD_MS; // px per ms
    const noteH = Math.max(14, laneW * 0.22);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d0f1a';
    ctx.fillRect(0, 0, W, H);

    // 轨道
    for (let lane = 0; lane < 4; lane++) {
      ctx.fillStyle = lane % 2 ? '#121526' : '#161a30';
      ctx.fillRect(x0 + lane * laneW, 0, laneW, H);
      ctx.strokeStyle = '#2a2f4d';
      ctx.strokeRect(x0 + lane * laneW, 0, laneW, H);
    }

    // 判定线
    ctx.fillStyle = '#e8ecff';
    ctx.fillRect(x0, judgeY - 2, fieldW, 4);

    // 按键提示
    ctx.font = `bold ${Math.round(laneW * 0.3)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5a618f';
    for (let lane = 0; lane < 4; lane++) {
      ctx.fillText(LANE_KEYS[lane], x0 + lane * laneW + laneW / 2, judgeY + laneW * 0.45);
    }

    // 音符（只画可见窗口内的）
    for (const note of this.notes) {
      const untilHit = note.time - songMs;
      if (untilHit > LEAD_MS + 100) break; // 按时间排序，后面的更靠上
      if (note.judged || untilHit < -MISS_AFTER_MS - 50) continue;
      const y = judgeY - untilHit * speed;
      ctx.fillStyle = LANE_COLORS[note.lane];
      const nx = x0 + note.lane * laneW + 4;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(nx, y - noteH / 2, laneW - 8, noteH, 6);
        ctx.fill();
      } else {
        ctx.fillRect(nx, y - noteH / 2, laneW - 8, noteH);
      }
    }

    // 命中特效
    this.hitFx = this.hitFx.filter(fx => songMs - fx.songMs < HIT_FX_MS);
    for (const fx of this.hitFx) {
      const p = (songMs - fx.songMs) / HIT_FX_MS;
      ctx.strokeStyle = LANE_COLORS[fx.lane];
      ctx.globalAlpha = 1 - p;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x0 + fx.lane * laneW + laneW / 2, judgeY, 10 + p * laneW * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 判定文字
    if (this.judgeText && songMs - this.judgeText.songMs < JUDGE_TEXT_MS) {
      const p = (songMs - this.judgeText.songMs) / JUDGE_TEXT_MS;
      const colors = { perfect: '#ffd94d', great: '#4dd2ff', good: '#7dff6a', miss: '#ff5d5d' };
      ctx.globalAlpha = 1 - p * p;
      ctx.font = `bold ${Math.round(laneW * 0.34)}px monospace`;
      ctx.fillStyle = colors[this.judgeText.grade];
      ctx.fillText(this.judgeText.grade.toUpperCase(), W / 2, judgeY - H * 0.18 - p * 20);
      ctx.globalAlpha = 1;
    }

    // 连击 / 分数 / 进度
    if (this.combo >= 2) {
      ctx.font = `bold ${Math.round(laneW * 0.5)}px monospace`;
      ctx.fillStyle = '#e8ecff';
      ctx.fillText(String(this.combo), W / 2, H * 0.3);
      ctx.font = `${Math.round(laneW * 0.18)}px monospace`;
      ctx.fillStyle = '#8a91bd';
      ctx.fillText('COMBO', W / 2, H * 0.3 + laneW * 0.3);
    }
    ctx.textAlign = 'right';
    ctx.font = `bold ${Math.round(laneW * 0.24)}px monospace`;
    ctx.fillStyle = '#e8ecff';
    ctx.fillText(String(totalScore(this.counts)).padStart(7, '0'), W - 20, 40);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#2a2f4d';
    ctx.fillRect(0, 0, W, 5);
    ctx.fillStyle = '#4dd2ff';
    ctx.fillRect(0, 0, W * Math.min(1, songMs / this.durationMs), 5);
  }
}
