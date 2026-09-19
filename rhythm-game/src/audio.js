// WebAudio 8-bit 合成伴奏。
// 关键约束：一切声音都按 chart 的 bpm / offsetMs 预先换算成歌曲时间，
// 再交给前瞻调度器排到 AudioContext 时钟上——音乐和判定是同一条时间轴。
import { LEAD_IN_BEATS, SCHED } from './config.js';

export function createAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  return new Ctx();
}

// A 小调四和弦循环：Am - F - C - G（根音频率，Hz）
const CHORDS = [
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
  [261.63, 329.63, 392.0],
  [196.0, 246.94, 293.66],
];
const ROOTS = [110.0, 87.31, 130.81, 98.0];

// 构造歌曲时间线上的全部合成事件
function buildEvents(chart) {
  const beatMs = chart.beatMs;
  const barMs = beatMs * 4;
  const totalMs = chart.durationMs;
  const barCount = Math.ceil(totalMs / barMs) + 1;
  const events = [];

  // 开场倒计时 4 拍（落在 offsetMs 之前）
  for (let b = 1; b <= LEAD_IN_BEATS; b += 1) {
    events.push({ t: chart.offsetMs - beatMs * b, type: 'tick', final: b === LEAD_IN_BEATS });
  }

  for (let bar = 0; bar < barCount; bar += 1) {
    const chord = CHORDS[bar % 4];
    const root = ROOTS[bar % 4];
    const section = Math.floor(bar / 8) % 4; // 0 平缓 / 1 起来 / 2 推进 / 3 高潮
    const bar0 = bar * barMs;
    if (bar0 - barMs > totalMs) break;

    // 鼓：四踩底鼓 + 2/4 拍军鼓；高潮段落加密反拍 hat
    for (let beat = 0; beat < 4; beat += 1) {
      events.push({ t: bar0 + beat * beatMs, type: 'kick' });
      if (beat === 1 || beat === 3) events.push({ t: bar0 + beat * beatMs, type: 'snare' });
      events.push({ t: bar0 + beat * beatMs, type: 'hat', loud: section >= 2 });
      if (section >= 2) {
        events.push({ t: bar0 + beat * beatMs + beatMs / 2, type: 'hat', loud: false });
      }
      if (section === 3) {
        events.push({ t: bar0 + beat * beatMs + beatMs / 4, type: 'kick' });
      }
    }

    // 贝斯：方波八分音符，根音 + 五度走动
    for (let i = 0; i < 8; i += 1) {
      events.push({
        t: bar0 + (i * beatMs) / 2,
        type: 'bass',
        freq: i % 4 === 3 ? root * 1.5 : root,
      });
    }

    // 琶音：和弦音 16 分音符轮播
    for (let i = 0; i < 16; i += 1) {
      const f = chord[i % 3] * 2;
      events.push({ t: bar0 + (i * beatMs) / 4, type: 'arp', freq: f });
    }

    // 旋律：高潮段落用三角波走一条和弦音小旋律
    if (section === 3) {
      const melody = [0, 2, 1, 2, 0, 1, 2, 1];
      for (let i = 0; i < 8; i += 1) {
        events.push({
          t: bar0 + (i * beatMs) / 2,
          type: 'lead',
          freq: chord[melody[i] % chord.length] * 4,
        });
      }
    }
  }

  events.sort((a, b) => a.t - b.t);
  return events;
}

export class MusicEngine {
  constructor(ctx, chart, transport, masterGain) {
    this.ctx = ctx;
    this.chart = chart;
    this.transport = transport;
    this.master = masterGain ?? ctx.destination;
    this.events = buildEvents(chart);
    this.cursor = 0;
    this.active = new Set();
    this.timer = null;

    const len = Math.floor(ctx.sampleRate * 0.3);
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  }

  start() {
    this.cursor = 0;
    this.timer = setInterval(() => this.pump(), SCHED.intervalMs);
    this.pump();
  }

  // 暂停：取消所有已排程但还没出声的音，cursor 回退到当前歌曲位置之后，
  // resume 后重新排——不重播暂停前的内容，也不丢拍。
  pause() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const nowSong = this.transport.songTimeAtCtx(this.transport.pauseCtx);
    for (const node of this.active) {
      try {
        node.stop(this.transport.pauseCtx);
      } catch {
        /* 已经开始发声的不能停，忽略 */
      }
      try {
        node.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.active.clear();
    while (this.cursor > 0 && this.events[this.cursor - 1].t > nowSong) this.cursor -= 1;
  }

  resume() {
    if (this.timer === null) {
      this.timer = setInterval(() => this.pump(), SCHED.intervalMs);
      this.pump();
    }
  }

  pump() {
    if (this.transport.paused) return;
    const nowCtx = this.ctx.currentTime;
    const horizonSong = this.transport.songTimeAtCtx(nowCtx + SCHED.lookaheadMs / 1000);
    while (this.cursor < this.events.length) {
      const ev = this.events[this.cursor];
      if (ev.t > horizonSong) break;
      this.cursor += 1;
      if (ev.t < this.transport.songTimeAtCtx(nowCtx) - 0.05) continue; // 已过期不补排
      const when = this.transport.ctxTimeForSongMs(ev.t);
      this.playEvent(ev, when);
    }
  }

  playEvent(ev, when) {
    switch (ev.type) {
      case 'kick': this.kick(when); break;
      case 'snare': this.snare(when); break;
      case 'hat': this.hat(when, ev.loud); break;
      case 'bass': this.bass(when, ev.freq); break;
      case 'arp': this.arp(when, ev.freq); break;
      case 'lead': this.lead(when, ev.freq); break;
      case 'tick': this.tick(when, ev.final); break;
      default: break;
    }
  }

  osc(freq, when, dur, { type = 'square', gain = 0.2, slideTo = null, dest = null }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), when + dur);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(dest ?? this.master);
    o.start(when);
    o.stop(when + dur + 0.02);
    this.active.add(o);
    o.onended = () => this.active.delete(o);
  }

  noise(when, dur, { gain = 0.15, hp = 1000, lp = null }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    let node = src;
    if (hp) {
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = hp;
      node.connect(f);
      node = f;
    }
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(this.master);
    src.start(when);
    src.stop(when + dur + 0.02);
    this.active.add(src);
    src.onended = () => this.active.delete(src);
  }

  kick(when) {
    this.osc(150, when, 0.16, { type: 'sine', gain: 0.5, slideTo: 45 });
  }

  snare(when) {
    this.noise(when, 0.14, { gain: 0.18, hp: 1500 });
    this.osc(190, when, 0.08, { type: 'triangle', gain: 0.18 });
  }

  hat(when, loud) {
    this.noise(when, 0.045, { gain: loud ? 0.12 : 0.07, hp: 7000 });
  }

  bass(when, freq) {
    this.osc(freq, when, 0.16, { type: 'square', gain: 0.12 });
  }

  arp(when, freq) {
    this.osc(freq, when, 0.1, { type: 'square', gain: 0.055 });
  }

  lead(when, freq) {
    this.osc(freq, when, 0.2, { type: 'triangle', gain: 0.13 });
  }

  tick(when, finalBeat) {
    this.osc(finalBeat ? 1320 : 880, when, 0.09, { type: 'square', gain: 0.2 });
  }

  // 击中音效（轻微短促 blip，和歌曲在同一 ctx 时钟域）
  hitSound(when, judgement) {
    const gain = judgement === 'perfect' ? 0.16 : judgement === 'great' ? 0.11 : 0.07;
    this.osc(judgement === 'perfect' ? 990 : 740, when, 0.05, {
      type: 'square',
      gain,
    });
  }
}
