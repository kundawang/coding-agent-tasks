// WebAudio 8-bit 伴奏合成器。
//
// 时间轴约定（和判定共用同一条）：
//   歌曲 0 点 = AudioContext 时钟上的 startAudioTime（由 start() 设定）。
//   所有音符、鼓点、长音都换算到 AudioContext 绝对时间后用 osc.start(when) 排程，
//   不用 setTimeout 决定节奏；setInterval 只负责“提前叫醒调度器”。
//   暂停用 ctx.suspend()/resume()：挂起期间 currentTime 冻结，
//   songTime = (currentTime - startAudioTime) 天然把暂停时间排除在外。

const SCHEDULER_INTERVAL_MS = 25;
const SCHEDULE_AHEAD_S = 0.15;

// 四小节循环。chord 为 pad 和弦音，arp 为琶音音阶。
const PROGRESSION = [
  { root: 110.0, chord: [220.0, 261.63, 329.63], arp: [220.0, 261.63, 329.63, 392.0] },
  { root: 87.31, chord: [174.61, 220.0, 261.63], arp: [174.61, 220.0, 261.63, 329.63] },
  { root: 98.0, chord: [196.0, 246.94, 293.66], arp: [196.0, 246.94, 293.66, 392.0] },
  { root: 65.41, chord: [130.81, 196.0, 246.94], arp: [130.81, 164.81, 196.0, 246.94] },
];

function midiFreq(semitonesFromA4) {
  return 440 * 2 ** (semitonesFromA4 / 12);
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.noiseBuffer = null;
    this.startAudioTime = 0;
    this.events = [];
    this.cursor = 0;
    this.timer = null;
    this.running = false;
    this._muted = false;
  }

  async ensureContext() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 20;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.7;
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.musicBus.connect(compressor);
      this.sfxBus.connect(compressor);
      compressor.connect(this.master);
      this.master.connect(this.ctx.destination);

      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  // AudioContext 时间（秒）-> 歌曲毫秒。suspend 期间 currentTime 冻结，暂停自动剔除。
  audioTimeToSongMs(audioTimeSec) {
    return (audioTimeSec - this.startAudioTime) * 1000;
  }

  songMsToAudioTime(songMs) {
    return this.startAudioTime + songMs / 1000;
  }

  nowSongMs() {
    return this.audioTimeToSongMs(this.ctx.currentTime);
  }

  setMuted(muted) {
    this._muted = muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.02);
    }
  }

  get muted() {
    return this._muted;
  }

  // 按谱面 bpm / offsetMs 生成整首伴奏事件（时间为歌曲毫秒）。
  buildChartEvents(chart) {
    const beatMs = 60000 / chart.bpm;
    const barMs = beatMs * 4;
    const offsetMs = chart.offsetMs;
    const events = [];
    const push = (songMs, kind, opts = {}) => events.push({ tMs: songMs, kind, ...opts });

    for (let bar = 0; bar < chart.bars; bar += 1) {
      const chord = PROGRESSION[bar % PROGRESSION.length];
      const barStart = offsetMs + bar * barMs;
      // 前两小节 pad+kick 做引子；之后每 16 小节在“全编制 / 轻编制”之间轮换。
      const intensity = bar < 2 ? 0 : bar % 16 < 8 ? 2 : 1;

      push(barStart, 'pad', { freqs: chord.chord, dur: (barMs / 1000) * 0.94 });

      for (let b = 0; b < 4; b += 1) push(barStart + b * beatMs, 'kick');

      if (intensity > 0) {
        push(barStart + beatMs, 'snare');
        push(barStart + beatMs * 3, 'snare');
      }

      const hatCount = intensity >= 2 ? 16 : 8;
      for (let i = 0; i < hatCount; i += 1) {
        push(barStart + (i * beatMs) / 2, 'hat', { open: i % 4 === 2 && intensity > 0 });
      }

      if (intensity > 0) {
        // 根音上的 8-bit 走句（相对 A4 的半音偏移，再按本小节根音移位）。
        const bassPattern = [0, 0, 7, 0, 12, 0, 7, 0];
        for (let i = 0; i < 8; i += 1) {
          push(barStart + (i * beatMs) / 2, 'bass', {
            freq: midiFreq(bassPattern[i] - 24) * (chord.root / 110),
          });
        }
      }

      const arpCount = intensity === 2 ? 16 : intensity === 1 ? 8 : 4;
      for (let i = 0; i < arpCount; i += 1) {
        const freq = chord.arp[i % chord.arp.length] * (i >= 8 ? 2 : 1);
        push(barStart + (i * beatMs) / 4, 'arp', { freq });
      }

      if (intensity > 0 && bar % 8 === 7) {
        push(barStart + beatMs * 3 + beatMs / 2, 'tom', { freq: 180 });
        push(barStart + beatMs * 3 + (beatMs * 3) / 4, 'tom', { freq: 140 });
      }
    }

    push(offsetMs + chart.bars * barMs, 'crash');
    events.sort((a, b) => a.tMs - b.tMs);
    return events;
  }

  start(chart, { leadMs = 1600 } = {}) {
    this.events = this.buildChartEvents(chart);
    this.cursor = 0;
    // 歌曲 0 点放在“现在 + leadMs”，给倒计时和音符下落留时间。
    this.startAudioTime = this.ctx.currentTime + leadMs / 1000;
    this.running = true;

    const beatMs = 60000 / chart.bpm;
    for (let i = 0; i < 4; i += 1) {
      const when = this.songMsToAudioTime(chart.offsetMs - (3 - i) * beatMs);
      this._voiceClick(when, i === 3 ? 880 : 520);
    }

    this.timer = setInterval(() => this._tick(), SCHEDULER_INTERVAL_MS);
  }

  _tick() {
    if (!this.running || this.ctx.state !== 'running') return;
    const horizonMs = this.nowSongMs() + SCHEDULE_AHEAD_S * 1000;
    while (this.cursor < this.events.length && this.events[this.cursor].tMs <= horizonMs) {
      this._scheduleEvent(this.events[this.cursor]);
      this.cursor += 1;
    }
    if (this.cursor >= this.events.length) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  _scheduleEvent(ev) {
    const when = this.songMsToAudioTime(ev.tMs);
    if (when < this.ctx.currentTime - 0.05) return;
    switch (ev.kind) {
      case 'kick': this._voiceKick(when); break;
      case 'snare': this._voiceSnare(when); break;
      case 'hat': this._voiceHat(when, ev.open); break;
      case 'crash': this._voiceCrash(when); break;
      case 'tom': this._voiceTom(when, ev.freq); break;
      case 'bass': this._voiceBass(when, ev.freq); break;
      case 'arp': this._voiceArp(when, ev.freq); break;
      case 'pad': this._voicePad(when, ev.freqs, ev.dur); break;
      default: break;
    }
  }

  async pause() {
    if (!this.running) return;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.ctx.suspend();
  }

  async resume() {
    if (!this.running) return;
    await this.ctx.resume();
    if (!this.timer) {
      this.timer = setInterval(() => this._tick(), SCHEDULER_INTERVAL_MS);
    }
    this._tick();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.events = [];
    this.cursor = 0;
  }

  // 校准拍点：调用方给定歌曲 0 点的 AudioContext 时间（秒）。
  startCalibrationClicks(chart, audioStartTime) {
    const beatMs = 60000 / chart.bpm;
    for (let i = 0; i < 4; i += 1) {
      const when = audioStartTime + (chart.offsetMs - (3 - i) * beatMs) / 1000;
      this._voiceClick(when, i === 3 ? 880 : 520);
    }
  }

  // 击打音效：直接在“按键当下”排，延迟最低。
  playHitBlip(lane) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const freqs = [523.25, 587.33, 659.25, 783.99];
    this._blip(this.ctx.currentTime, freqs[lane], 0.06, 'square', 0.1, this.sfxBus);
  }

  _env(gain, when, peak, attack, decay) {
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  }

  _osc(when, { freq, type = 'square', dur = 0.15, peak = 0.2, freqEnd = null, bus = null }) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, freq), when);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), when + dur);
    this._env(gain, when, peak, 0.002, dur);
    osc.connect(gain);
    gain.connect(bus || this.musicBus);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  _noise(when, { dur = 0.1, peak = 0.15, hp = 6000, lp = null, bus = null }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hpFilter = this.ctx.createBiquadFilter();
    hpFilter.type = 'highpass';
    hpFilter.frequency.value = hp;
    src.connect(hpFilter);
    let node = hpFilter;
    if (lp) {
      const lpFilter = this.ctx.createBiquadFilter();
      lpFilter.type = 'lowpass';
      lpFilter.frequency.value = lp;
      node.connect(lpFilter);
      node = lpFilter;
    }
    const gain = this.ctx.createGain();
    this._env(gain, when, peak, 0.001, dur);
    node.connect(gain);
    gain.connect(bus || this.musicBus);
    src.start(when, Math.random() * 0.5);
    src.stop(when + dur + 0.05);
  }

  _voiceKick(when) {
    this._osc(when, { freq: 150, freqEnd: 45, type: 'sine', dur: 0.16, peak: 0.55 });
  }

  _voiceSnare(when) {
    this._noise(when, { dur: 0.12, peak: 0.2, hp: 1800 });
    this._osc(when, { freq: 200, freqEnd: 120, type: 'triangle', dur: 0.1, peak: 0.16 });
  }

  _voiceHat(when, open) {
    this._noise(when, {
      dur: open ? 0.18 : 0.04,
      peak: open ? 0.1 : 0.13,
      hp: 7000,
      lp: open ? 9000 : null,
    });
  }

  _voiceCrash(when) {
    this._noise(when, { dur: 0.9, peak: 0.22, hp: 4000, lp: 12000 });
  }

  _voiceTom(when, freq) {
    this._osc(when, { freq, freqEnd: freq * 0.7, type: 'sine', dur: 0.14, peak: 0.3 });
  }

  _voiceBass(when, freq) {
    this._osc(when, { freq, type: 'square', dur: 0.11, peak: 0.16 });
  }

  _voiceArp(when, freq) {
    this._osc(when, { freq, type: 'square', dur: 0.1, peak: 0.09 });
  }

  _voicePad(when, freqs, dur) {
    for (const freq of freqs) {
      this._osc(when, { freq, type: 'triangle', dur, peak: 0.06 });
    }
  }

  _voiceClick(when, freq) {
    this._blip(when, freq, 0.09, 'square', 0.25, this.sfxBus);
  }

  _blip(when, freq, dur, type, peak, bus) {
    this._osc(when, { freq, type, dur, peak, bus });
  }
}
