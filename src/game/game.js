// 一局游戏：以 AudioContext 时钟为唯一时间基准。
// 判定用的时间在 keydown 当下直接从音频时钟换算；rAF 只负责画。

import { NoteField } from '../core/judgment.js';
import { Scoreboard } from '../core/score.js';
import { AudioEngine } from './audio.js';
import { FALL_TIME_MS } from './renderer.js';

export class Game {
  constructor({ chart, renderer, audio, offsetMs, calibrated, onFinish, onPauseChange }) {
    this.chart = chart;
    this.audio = audio || new AudioEngine();
    this.renderer = renderer;
    this.offsetMs = offsetMs;
    this.calibrated = calibrated;
    this.onFinish = onFinish;
    this.onPauseChange = onPauseChange;

    this.field = new NoteField(chart.notes, chart.lanes || 4);
    this.board = new Scoreboard(chart.notes.length);
    this.state = 'idle'; // idle | playing | paused | finished
    this.rafId = 0;
    this.activeLanes = new Set();
    this.effects = [];
    this.lastJudgment = null;
    this.lastJudgmentAt = 0;
    this.durationMs = chart.notes[chart.notes.length - 1].t + 1500;
    this._finishAtMs = null;
    this._boundLoop = this._loop.bind(this);
  }

  async start() {
    await this.audio.ensureContext();
    // 设备偏移 = 输出延迟 + 输入延迟。音频整体提前 offsetMs 起播：
    // 声音经声卡延迟后“准点”到达耳朵，视觉/判定共用同一条感知时间轴。
    this.audio.start(this.chart, { leadMs: FALL_TIME_MS - this.offsetMs });
    this.state = 'playing';
    this._finishAtMs = null;
    this.rafId = requestAnimationFrame(this._boundLoop);
  }

  // 击打时间由调用方（input）在 keydown 当下给出（音频时钟毫秒），
  // 万一是 null（极少数情况）才退回 ctx.currentTime。
  onLaneDown(lane, audioTimeMs) {
    if (this.state !== 'playing') return;
    this.activeLanes.add(lane);
    const songMs = audioTimeMs != null
      ? this.audio.audioTimeToSongMs(audioTimeMs / 1000)
      : this.audio.nowSongMs();

    // 音频已提前起播，songMs 即“听到的歌曲时间”，直接与音符 t 比较。
    // 先把超时音符清扫成 Miss，再在剩余窗口里找目标，避免边界串判。
    const missed = this.field.sweep(songMs);
    for (const note of missed) this._registerMiss(note);

    const hit = this.field.hit(lane, songMs);
    if (hit) {
      this.board.apply(hit.judgment, hit.errorMs);
      this.effects.push({ kind: 'hit', lane, bornAt: songMs });
      this.audio.playHitBlip(lane);
      this.lastJudgment = hit.judgment;
      this.lastJudgmentAt = songMs;
    }
  }

  onLaneUp(lane) {
    this.activeLanes.delete(lane);
  }

  _registerMiss(note) {
    this.board.apply('miss', note.errorMs || 0);
    this.effects.push({ kind: 'miss', lane: note.lane, bornAt: this.audio.nowSongMs() });
    this.lastJudgment = 'miss';
    this.lastJudgmentAt = this.audio.nowSongMs();
  }

  isDown(lane) {
    return this.activeLanes.has(lane);
  }

  async togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused';
      cancelAnimationFrame(this.rafId);
      await this.audio.pause();
      this.onPauseChange?.(true);
    } else if (this.state === 'paused') {
      await this.audio.resume();
      this.state = 'playing';
      this.onPauseChange?.(false);
      this.rafId = requestAnimationFrame(this._boundLoop);
    }
  }

  async abort() {
    if (this.state === 'finished') return;
    this.state = 'finished';
    cancelAnimationFrame(this.rafId);
    this.audio.stop();
  }

  _loop() {
    if (this.state !== 'playing') return;
    const songMs = this.audio.nowSongMs();

    const missed = this.field.sweep(songMs);
    for (const note of missed) this._registerMiss(note);

    const { renderer } = this;
    renderer.clear();
    renderer.drawBackground(songMs);
    renderer.drawNotes(this.chart.notes, songMs);
    renderer.drawLanes(this.activeLanes);
    renderer.drawEffects(this.effects, songMs);
    this.effects = this.effects.filter((fx) => songMs - fx.bornAt < 260);
    renderer.drawJudgment(this.lastJudgment, this.lastJudgmentAt, songMs);
    renderer.drawCombo(this.board.combo);
    renderer.drawHud({
      score: this.board.score,
      counts: this.board.counts,
      songMs,
      durationMs: this.durationMs,
      offsetMs: this.offsetMs,
      calibrated: this.calibrated,
      muted: this.audio.muted,
    });
    renderer.drawCountIn(songMs, this.chart.offsetMs, this.chart.bpm);

    if (this.field.complete && this._finishAtMs == null) {
      this._finishAtMs = songMs;
    }
    if (this._finishAtMs != null && songMs > this._finishAtMs + 1200) {
      this._finish();
      return;
    }
    this.rafId = requestAnimationFrame(this._boundLoop);
  }

  _finish() {
    if (this.state === 'finished') return;
    this.state = 'finished';
    cancelAnimationFrame(this.rafId);
    this.audio.stop();
    this.onFinish?.(this.board.summary());
  }
}
