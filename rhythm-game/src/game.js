// 一局游戏的完整生命周期：启动音频时钟 -> 前瞻合成 -> 每帧按音频时钟渲染与判 Miss。
// 判定时间全部来自 AudioContext.currentTime（通过 Transport 换算），
// rAF/键盘事件只提供 performance.now 域时间戳，再换算过去。
import {
  MISS_AFTER_MS,
  END_HOLD_MS,
  WINDOWS,
} from './config.js';
import { Transport } from './transport.js';
import { MusicEngine, createAudioContext } from './audio.js';
import { findHit, collectMissed } from './judge.js';
import { ScoreBoard } from './score.js';
import { Renderer } from './render.js';
import { Input } from './input.js';

export class Game {
  constructor({ chart, offsetMs = 0, canvas, onExit, onFinish }) {
    this.chart = chart;
    this.offsetMs = offsetMs; // 本机校准，判定时减掉
    this.canvas = canvas;
    this.onExit = onExit;
    this.onFinish = onFinish;

    this.states = new Uint8Array(chart.notes.length);
    this.missCursor = 0;
    this.board = new ScoreBoard();
    this.phase = 'start'; // start | countdown | play | paused | finish
    this.raf = 0;
    this.endMs = chart.durationMs + END_HOLD_MS;

    this.renderer = new Renderer(canvas);
    this.input = new Input(window);
    this._onResize = () => this.renderer.resize();
    this._onVisibility = () => {
      if (document.hidden && this.phase === 'play') this.pause();
    };
  }

  async start() {
    this.ctx = createAudioContext();
    await this.ctx.resume();

    const compressor = this.ctx.createDynamicsCompressor();
    compressor.connect(this.ctx.destination);
    this.music = new MusicEngine(this.ctx, this.chart, null, compressor);

    // 歌曲 0ms 对应 0.15s 后；拍点 0（offsetMs 处）因此在 offsetMs+0.15s，
    // 倒计时四拍在其之前。所有合成事件共用这套映射。
    const startCtx = this.ctx.currentTime + 0.15;
    this.transport = new Transport();
    this.transport.start(startCtx, performance.now());
    this.music.transport = this.transport;
    this.music.start();

    this.phase = 'countdown';
    this.input.attach();
    this.input.onPress = (lane, ts) => this.press(lane, ts);
    this.input.onEsc = () => this.togglePause();
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);

    const loop = (ts) => {
      if (this.phase === 'finish') return;
      this.frame(ts);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  frame(perfMs) {
    let songTimeMs = this.transport.songTimeAtPerf(perfMs);

    if (this.phase !== 'paused') {
      // 过期未击音符自动 Miss（只沿时间轴前进扫描，O(n) 全程一次）
      const res = collectMissed(
        this.chart.notes,
        this.states,
        this.missCursor,
        songTimeMs,
        MISS_AFTER_MS,
      );
      this.missCursor = res.cursor;
      for (const idx of res.missed) {
        this.board.add('miss');
        this.renderer.addPopup(this.chart.notes[idx].lane, 'miss');
      }
      if (this.phase === 'countdown' && songTimeMs >= 0) this.phase = 'play';
      if (songTimeMs >= this.endMs) {
        this.finish();
        return;
      }
    } else {
      // 暂停时画面冻结：按暂停瞬间的歌曲时间渲染
      songTimeMs = this.transport.songTimeAtCtx(this.transport.pauseCtx);
    }

    this.renderer.draw({
      notes: this.chart.notes,
      states: this.states,
      songTimeMs,
      held: this.input.held,
      score: this.board.score,
      combo: this.board.combo,
      offsetMs: this.offsetMs,
      phase: this.phase,
      beatMs: this.chart.beatMs,
      endMs: this.endMs,
    });
  }

  press(lane, eventPerfMs) {
    if (this.phase === 'paused' || this.phase === 'finish') return;
    if (this.phase === 'countdown') {
      this.renderer.flashLane(lane);
      return;
    }

    // 按键的“歌曲时间”= 音频时钟换算结果 - 本机校准偏移。
    // 校准偏移为正（按晚）时，相当于把按键时刻往前挪再比窗口。
    const songTimeRaw = this.transport.songTimeAtPerf(eventPerfMs);
    const hitTimeMs = songTimeRaw - this.offsetMs;
    const hit = findHit(this.chart.notes, this.states, lane, hitTimeMs, WINDOWS.good);

    this.renderer.flashLane(lane);
    if (!hit) return; // 空按不扣分不断连

    this.states[hit.index] = 1;
    this.board.add(hit.judgement);
    this.renderer.addPopup(lane, hit.judgement);
    if (this.phase !== 'paused') {
      this.music.hitSound(this.transport.ctxTimeAtPerf(eventPerfMs), hit.judgement);
    }
  }

  togglePause() {
    if (this.phase === 'paused') this.resume();
    else if (this.phase === 'countdown' || this.phase === 'play') this.pause();
  }

  pause() {
    if (this.phase === 'paused') return;
    const ctxNow = this.ctx.currentTime;
    this.transport.pause(ctxNow);
    this.music.pause();
    this.phase = 'paused';
    this.onPaused?.();
  }

  resume() {
    if (this.phase !== 'paused') return;
    const ctxNow = this.ctx.currentTime;
    this.transport.resume(ctxNow, performance.now());
    this.music.resume();
    this.phase = this.transport.songTimeAtCtx(ctxNow) < 0 ? 'countdown' : 'play';
    this.onResumed?.();
  }

  finish() {
    if (this.phase === 'finish') return;
    this.phase = 'finish';
    cancelAnimationFrame(this.raf);
    this.input.detach();
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.music?.timer) clearInterval(this.music.timer);
    // 兜底：扫描时可能有极个别音符在音效 finish 后仍未记账
    const tail = collectMissed(
      this.chart.notes,
      this.states,
      this.missCursor,
      this.endMs + 1000,
      MISS_AFTER_MS,
    );
    for (const idx of tail.missed) this.board.add('miss');
    this.onFinish?.(this.board.result(), this);
  }

  // 中途退出（暂停菜单里的“放弃”）
  destroy() {
    cancelAnimationFrame(this.raf);
    this.input.detach();
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.music?.timer) clearInterval(this.music.timer);
    this.ctx?.close().catch(() => {});
  }
}
