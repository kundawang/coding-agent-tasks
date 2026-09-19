// 游戏主循环：Canvas 渲染 + 键盘判定。
//
// 时间轴纪律：每帧只从 engine.songMs()（音频时钟）取时间，
// 不用 performance.now() 推位置，掉帧只会让画面少画几帧，
// 不会让音符位置和判定产生偏移。

import { WINDOWS, SCORE, judgeDelta, summarize, findHittableNote } from './judge.js';

const KEY_TO_LANE = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
const LANE_KEYS = ['D', 'F', 'J', 'K'];
const LANE_COLORS = ['#ff5d7e', '#ffc44d', '#4ddb8a', '#4da6ff'];
const APPROACH_MS = 1600; // 音符从出现到判定线的时长（恒定，与分辨率无关）

export class Game {
  constructor(canvas, engine, chart, calibrationMs, onFinish) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d');
    this.engine = engine;
    this.chart = chart;
    this.calibrationMs = calibrationMs;
    this.onFinish = onFinish;

    this.notes = chart.notes.map((n) => ({ t: n.t, lane: n.lane, state: 0 })); // 0待判定 1命中 2漏掉
    this.lastNoteT = this.notes.length ? this.notes[this.notes.length - 1].t : 0;

    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.combo = 0;
    this.maxCombo = 0;
    this.score = 0;

    this.state = 'idle'; // idle | playing | paused | done
    this.effects = []; // {lane, songMs, kind} 命中闪光
    this.lastJudge = null; // {kind, songMs}
    this._missPtr = 0;
    this._raf = 0;
    this._onKeyDown = this._handleKey.bind(this);
    this._boundLoop = this._loop.bind(this);
  }

  start() {
    this.state = 'playing';
    this.engine.startSong(this.chart);
    window.addEventListener('keydown', this._onKeyDown);
    this._raf = requestAnimationFrame(this._boundLoop);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._onKeyDown);
    this.engine.stopSong();
  }

  async togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      await this.engine.suspend(); // 冻结音频时钟，songMs 停在原地
    } else if (this.state === 'paused') {
      await this.engine.resume();
      this.state = 'playing';
    }
  }

  _handleKey(e) {
    if (e.repeat) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      this.togglePause();
      return;
    }
    if (this.state !== 'playing') return;
    const lane = KEY_TO_LANE[e.code];
    if (lane === undefined) return;

    // 判定时刻：音频时钟 - 校准偏移（补偿设备输入延迟）
    const now = this.engine.songMs() - this.calibrationMs;
    const idx = findHittableNote(this.notes, lane, now);
    if (idx < 0) return; // 空敲不惩罚

    const note = this.notes[idx];
    const kind = judgeDelta(now - note.t);
    note.state = 1;
    this.counts[kind]++;
    this.combo++;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.score += SCORE[kind];
    this.lastJudge = { kind, songMs: this.engine.songMs() };
    this.effects.push({ lane, songMs: this.engine.songMs() });
  }

  _applyMisses(songMs) {
    // 超过 good 窗口仍未击中的音符判 Miss，连击归零
    while (this._missPtr < this.notes.length) {
      const n = this.notes[this._missPtr];
      if (n.state !== 0) {
        this._missPtr++;
        continue;
      }
      if (songMs - n.t <= WINDOWS.good) break;
      n.state = 2;
      this.counts.miss++;
      this.combo = 0;
      this.lastJudge = { kind: 'miss', songMs };
      this._missPtr++;
    }
  }

  _loop() {
    if (this.state === 'done') return;
    const songMs = this.engine.songMs();
    if (this.state === 'playing') {
      this._applyMisses(songMs);
      if (songMs > this.lastNoteT + 1500) {
        this.state = 'done';
        this.destroy();
        this.onFinish(summarize(this.counts, this.maxCombo), this.counts);
        return;
      }
    }
    this._render(songMs);
    this._raf = requestAnimationFrame(this._boundLoop);
  }

  // ---------- 渲染（全部按当前画布尺寸即时计算，拖拽/全屏不影响判定） ----------

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  _render(songMs) {
    const { w, h } = this._resize();
    const g = this.ctx2d;
    g.clearRect(0, 0, w, h);

    // 轨道几何：居中，宽度随窗口缩放
    const laneW = Math.min(110, w / 8);
    const fieldW = laneW * 4;
    const x0 = (w - fieldW) / 2;
    const lineY = h - Math.max(90, h * 0.14);
    const topY = -40;
    const pxPerMs = (lineY - topY) / APPROACH_MS;

    // 背景与轨道
    g.fillStyle = '#0d0f1a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#121526' : '#161a30';
      g.fillRect(x0 + i * laneW, 0, laneW, h);
    }

    // 判定线
    g.fillStyle = '#e8ecff';
    g.fillRect(x0 - 6, lineY - 2, fieldW + 12, 4);

    // 按键提示 + 命中闪光
    for (let i = 0; i < 4; i++) {
      const cx = x0 + i * laneW + laneW / 2;
      g.beginPath();
      g.arc(cx, lineY, laneW * 0.3, 0, Math.PI * 2);
      g.strokeStyle = LANE_COLORS[i];
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = '#9aa3c0';
      g.font = 'bold 16px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(LANE_KEYS[i], cx, lineY + laneW * 0.3 + 22);
    }

    // 命中闪光（存活 180ms）
    this.effects = this.effects.filter((fx) => songMs - fx.songMs < 180);
    for (const fx of this.effects) {
      const p = (songMs - fx.songMs) / 180;
      const cx = x0 + fx.lane * laneW + laneW / 2;
      g.beginPath();
      g.arc(cx, lineY, laneW * (0.3 + p * 0.35), 0, Math.PI * 2);
      g.strokeStyle = LANE_COLORS[fx.lane];
      g.globalAlpha = 1 - p;
      g.lineWidth = 4;
      g.stroke();
      g.globalAlpha = 1;
    }

    // 音符：只画可视窗口内的
    const noteH = Math.max(14, laneW * 0.22);
    for (const n of this.notes) {
      const until = n.t - songMs;
      if (until > APPROACH_MS) break; // 还没到出现时间
      if (n.state === 1) continue; // 已命中，消失
      const sinceMiss = n.state === 2 ? songMs - n.t - WINDOWS.good : 0;
      if (n.state === 2 && sinceMiss > 250) continue; // 漏掉的淡出后不再画
      const y = lineY - until * pxPerMs;
      if (y < topY - noteH) continue;
      const x = x0 + n.lane * laneW + 4;
      g.globalAlpha = n.state === 2 ? Math.max(0, 1 - sinceMiss / 250) : 1;
      g.fillStyle = LANE_COLORS[n.lane];
      g.beginPath();
      g.roundRect(x, y - noteH / 2, laneW - 8, noteH, 6);
      g.fill();
      g.globalAlpha = 1;
    }

    // 判定文字（存活 500ms）
    if (this.lastJudge && songMs - this.lastJudge.songMs < 500) {
      const p = (songMs - this.lastJudge.songMs) / 500;
      const label = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' }[this.lastJudge.kind];
      const color = { perfect: '#ffd94d', great: '#4ddb8a', good: '#4da6ff', miss: '#ff5d5d' }[this.lastJudge.kind];
      g.globalAlpha = 1 - p * p;
      g.fillStyle = color;
      g.font = `bold ${Math.round(laneW * 0.32)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText(label, w / 2, lineY - h * 0.18 - p * 20);
      g.globalAlpha = 1;
    }

    // 连击
    if (this.combo >= 2) {
      g.fillStyle = '#ffffff';
      g.font = `bold ${Math.round(laneW * 0.5)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText(String(this.combo), w / 2, lineY - h * 0.32);
      g.font = `${Math.round(laneW * 0.16)}px system-ui, sans-serif`;
      g.fillStyle = '#9aa3c0';
      g.fillText('COMBO', w / 2, lineY - h * 0.32 + laneW * 0.38);
    }

    // 顶栏：分数 + 进度
    g.fillStyle = '#ffffff';
    g.font = 'bold 22px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText(String(this.score).padStart(7, '0'), w - 20, 34);
    g.textAlign = 'left';
    g.fillStyle = '#9aa3c0';
    g.font = '14px system-ui, sans-serif';
    g.fillText(this.chart.title, 20, 32);
    const prog = Math.min(1, Math.max(0, songMs / this.lastNoteT));
    g.fillStyle = '#2a2f4d';
    g.fillRect(0, 0, w, 4);
    g.fillStyle = '#4da6ff';
    g.fillRect(0, 0, w * prog, 4);

    // 暂停遮罩
    if (this.state === 'paused') {
      g.fillStyle = 'rgba(8, 10, 20, 0.72)';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.font = 'bold 40px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('已暂停', w / 2, h / 2 - 10);
      g.font = '18px system-ui, sans-serif';
      g.fillStyle = '#9aa3c0';
      g.fillText('按 Esc 继续', w / 2, h / 2 + 30);
    }
  }
}
