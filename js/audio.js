// WebAudio 8-bit 伴奏合成 + 全局唯一时间轴。
//
// 核心约定：整首歌只有一个时钟 —— AudioContext.currentTime。
// 画面、判定、校准全部换算成"歌曲毫秒"（songMs）后对齐，
// 暂停用 ctx.suspend() 直接冻结音频时钟，恢复后天然不错位。

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// A 小调进行：Am - F - C - G，每小节一个和弦
const CHORDS = [
  { root: 33, tones: [57, 60, 64] }, // A1 / A3 C4 E4
  { root: 29, tones: [53, 57, 60] }, // F1 / F3 A3 C4
  { root: 36, tones: [60, 64, 67] }, // C2 / C4 E4 G4
  { root: 31, tones: [55, 59, 62] }, // G1 / G3 B3 D4
];
const ARP_PATTERN = [0, 1, 2, 1, 0, 2, 1, 2]; // 16 分琶音

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.songStartCtx = 0; // 歌曲 0 点对应的 ctx.currentTime
    this.playing = false;
    this._timer = null;
    this._nextStep = 0;
    this._stepCount = 0;
    this._stepMs = 0;
    this._offsetMs = 0;
  }

  // 必须在用户手势里调用
  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    // 噪声 buffer 给 hi-hat / snare 用
    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  async resume() {
    if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume();
  }

  async suspend() {
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
  }

  // 当前歌曲位置（毫秒）。开始前为负值（倒计时），暂停时冻结。
  songMs() {
    if (!this.ctx) return -Infinity;
    return (this.ctx.currentTime - this.songStartCtx) * 1000;
  }

  // ---------- 打击乐/合成音色 ----------

  _kick(t) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.13);
  }

  _hat(t, open = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    const dur = open ? 0.09 : 0.03;
    g.gain.setValueAtTime(open ? 0.16 : 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.01);
  }

  _snare(t) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + 0.13);
  }

  _square(t, midi, dur, vol) {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = midiHz(midi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.01);
  }

  // 调度一个 16 分音符步进。stepMs / offsetMs 来自谱面 bpm 与 offset。
  _scheduleStep(step, tCtx) {
    const bar = Math.floor(step / 16);
    const inBar = step % 16;
    const chord = CHORDS[bar % CHORDS.length];

    if (inBar % 4 === 0) this._kick(tCtx); // 四四底鼓
    if (inBar === 4 || inBar === 12) this._snare(tCtx); // 2、4 拍军鼓
    if (inBar % 2 === 1) this._hat(tCtx, inBar === 14); // 反拍 hi-hat

    // 贝斯：八分音符，根音为主，句尾加五音
    if (inBar % 2 === 0) {
      const midi = inBar === 14 ? chord.root + 7 : chord.root;
      this._square(tCtx, midi + 12, this._stepMs / 1000 * 1.8, 0.16);
    }

    // 琶音 lead：16 分，奇数小节高八度
    const tone = chord.tones[ARP_PATTERN[inBar % ARP_PATTERN.length]];
    const oct = bar % 2 === 1 ? 12 : 0;
    this._square(tCtx, tone + oct, this._stepMs / 1000 * 0.9, 0.07);
  }

  // 开始整首歌：leadInMs 后才到歌曲 0 点，给玩家准备时间。
  // 采用 lookahead 调度；暂停时 currentTime 冻结，调度器自然停摆，不错位。
  startSong({ bpm, offsetMs, bars }, leadInMs = 1500) {
    this.stopSong();
    this._stepMs = 60000 / bpm / 4; // 16 分音符
    this._offsetMs = offsetMs;
    this._stepCount = bars * 16 + 8; // 结尾多留两拍余韵
    this._nextStep = 0;
    this.songStartCtx = this.ctx.currentTime + leadInMs / 1000;
    this.playing = true;

    const tick = () => {
      if (!this.playing) return;
      const aheadMs = this.songMs() + 120; // 提前 120ms 调度
      while (this._nextStep < this._stepCount) {
        const stepSongMs = this._offsetMs + this._nextStep * this._stepMs;
        if (stepSongMs > aheadMs) break;
        const tCtx = this.songStartCtx + stepSongMs / 1000;
        if (tCtx >= this.ctx.currentTime - 0.005) this._scheduleStep(this._nextStep, tCtx);
        this._nextStep++;
      }
    };
    tick();
    this._timer = setInterval(tick, 25);
  }

  stopSong() {
    this.playing = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // 校准用的单击声（比伴奏更"干"的一声，方便对拍）
  blip(delayMs = 0, freq = 880) {
    const t = this.ctx.currentTime + delayMs / 1000;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.09);
    return t;
  }
}
