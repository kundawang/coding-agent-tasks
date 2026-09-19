// WebAudio 引擎：8-bit 伴奏合成 + 全局唯一时间轴。
//
// 时间轴约定（全游戏唯一事实来源）：
//   songMs = (ctx.currentTime - startCtxTime) * 1000
// 渲染、判定、校准全部换算到这条轴上；requestAnimationFrame 只负责画。
// 暂停用 ctx.suspend()：currentTime 被冻结，恢复后从原值继续，天然零漂移。

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCHED_INTERVAL_MS = 25;   // 调度器唤醒间隔
const SCHED_LOOKAHEAD_S = 0.15; // 提前调度窗口

// A 小调进行: Am - F - C - G
const BASS_ROOTS = [110.0, 87.31, 130.81, 98.0]; // A2 F2 C3 G2
const LEAD_SCALE = [440.0, 523.25, 587.33, 659.25, 783.99, 880.0]; // A4 C5 D5 E5 G5 A5

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.startCtxTime = 0;   // 歌曲起点对应的 ctx.currentTime
    this.durationMs = 0;
    this.events = [];        // 预生成的音乐事件（相对歌曲起点，秒）
    this.nextEventIdx = 0;
    this.timer = null;
    this.liveSources = new Set();
    this.onEnded = null;
    this.playing = false;
  }

  ensure() {
    if (this.ctx) return;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    const rand = mulberry32(7);
    for (let i = 0; i < len; i++) data[i] = rand() * 2 - 1;
  }

  // ---- 时间轴 ----

  nowSongMs() {
    if (!this.ctx) return 0;
    return (this.ctx.currentTime - this.startCtxTime) * 1000;
  }

  // 把键盘事件的时间戳换算到歌曲时间轴。
  // 优先用 getOutputTimestamp 建立 performance.now() <-> audio clock 的精确映射，
  // 不支持的浏览器退化为当前音频时钟（误差由校准吸收）。
  eventToSongMs(eventTimeStamp) {
    const ctx = this.ctx;
    if (typeof ctx.getOutputTimestamp === 'function') {
      const ts = ctx.getOutputTimestamp();
      if (ts && Number.isFinite(ts.contextTime) && Number.isFinite(ts.performanceNow)) {
        const audioAtEvent = ts.contextTime + (eventTimeStamp - ts.performanceNow) / 1000;
        return (audioAtEvent - this.startCtxTime) * 1000;
      }
    }
    return this.nowSongMs() - (performance.now() - eventTimeStamp);
  }

  // ---- 合成器 ----

  _track(node, stopAt) {
    this.liveSources.add(node);
    node.onended = () => this.liveSources.delete(node);
    node.stop(stopAt);
  }

  _tone(t, freq, dur, type, vol) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    this._track(osc, t + dur + 0.02);
  }

  _kick(t) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    this._track(osc, t + 0.16);
  }

  _noise(t, dur, filterType, freq, vol) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
    this._track(src, t + dur + 0.02);
  }

  _scheduleEvent(ev) {
    const t = this.startCtxTime + ev.t;
    switch (ev.kind) {
      case 'kick': this._kick(t); break;
      case 'snare': this._noise(t, 0.12, 'bandpass', 1800, 0.35); break;
      case 'hat': this._noise(t, 0.04, 'highpass', 7000, 0.14); break;
      case 'bass': this._tone(t, ev.freq, 0.22, 'triangle', 0.4); break;
      case 'lead': this._tone(t, ev.freq, 0.16, 'square', 0.16); break;
      case 'click': this._tone(t, ev.freq, 0.05, 'square', 0.4); break;
    }
  }

  // 预生成整首伴奏事件（确定性种子，每次播放完全一致）
  _buildSongEvents(bpm, offsetMs, durationMs) {
    const beat = 60 / bpm;
    const events = [];
    const rand = mulberry32(150);
    const totalBeats = Math.ceil((durationMs / 1000 - offsetMs / 1000) / beat);
    let prevDeg = 0;
    for (let i = 0; i < totalBeats; i++) {
      const t = offsetMs / 1000 + i * beat;
      const bar = Math.floor(i / 4);
      const beatInBar = i % 4;
      const chord = bar % 4;

      if (beatInBar === 0 || beatInBar === 2) events.push({ t, kind: 'kick' });
      if (beatInBar === 1 || beatInBar === 3) events.push({ t, kind: 'snare' });
      events.push({ t, kind: 'hat' });
      events.push({ t: t + beat / 2, kind: 'hat' });

      const root = BASS_ROOTS[chord];
      events.push({ t, kind: 'bass', freq: root });
      events.push({ t: t + beat / 2, kind: 'bass', freq: beatInBar % 2 ? root * 1.5 : root });

      // 主旋律：随机游走在五声音阶上，每 8 分 60% 概率发声
      for (let e = 0; e < 2; e++) {
        if (rand() < 0.6) {
          prevDeg = Math.max(0, Math.min(LEAD_SCALE.length - 1,
            prevDeg + (rand() < 0.5 ? -1 : 1) * (rand() < 0.8 ? 1 : 2)));
          events.push({ t: t + e * beat / 2, kind: 'lead', freq: LEAD_SCALE[prevDeg] });
        }
      }
    }
    events.sort((a, b) => a.t - b.t);
    return events;
  }

  _tick = () => {
    const horizon = this.ctx.currentTime + SCHED_LOOKAHEAD_S;
    while (this.nextEventIdx < this.events.length
        && this.startCtxTime + this.events[this.nextEventIdx].t < horizon) {
      this._scheduleEvent(this.events[this.nextEventIdx]);
      this.nextEventIdx++;
    }
    if (this.playing && this.nowSongMs() > this.durationMs + 300) {
      const cb = this.onEnded;
      this.stop();
      if (cb) cb();
    }
  };

  _startScheduler() {
    this.timer = setInterval(this._tick, SCHED_INTERVAL_MS);
    this._tick();
  }

  // 开始一首歌：bpm / offsetMs 来自谱面，durationMs 为歌曲总时长
  startSong({ bpm, offsetMs, durationMs, onEnded }) {
    this.ensure();
    this.stop();
    this.durationMs = durationMs;
    this.onEnded = onEnded || null;
    this.events = this._buildSongEvents(bpm, offsetMs, durationMs);
    this.nextEventIdx = 0;
    this.startCtxTime = this.ctx.currentTime + 0.2;
    this.playing = true;
    this._startScheduler();
  }

  // 校准用节拍器：count 拍，间隔 intervalMs；返回每拍在歌曲轴上的时刻
  startMetronome(intervalMs, count) {
    this.ensure();
    this.stop();
    this.durationMs = intervalMs * count + 500;
    this.events = [];
    for (let i = 0; i < count; i++) {
      this.events.push({ t: (i * intervalMs) / 1000, kind: 'click', freq: i === 0 ? 1760 : 880 });
    }
    this.nextEventIdx = 0;
    this.startCtxTime = this.ctx.currentTime + 0.2;
    this.playing = true;
    this._startScheduler();
  }

  // 暂停：suspend 会冻结 currentTime，歌曲轴随之停走，恢复后严丝合缝
  async pause() {
    if (!this.ctx || !this.playing) return;
    clearInterval(this.timer);
    this.timer = null;
    await this.ctx.suspend();
  }

  async resume() {
    if (!this.ctx || !this.playing) return;
    await this.ctx.resume();
    if (!this.timer) this._startScheduler();
  }

  stop() {
    this.playing = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const src of this.liveSources) {
      try { src.stop(); } catch { /* 已停止 */ }
    }
    this.liveSources.clear();
  }
}
