import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 用最小桩替身跑浏览器 WebAudio，验证事件生成与时序逻辑。
class FakeParam {
  constructor() { this.value = 0; }
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  setTargetAtTime() {}
}

class FakeNode {
  constructor(ctx) { this.ctx = ctx; this.gain = new FakeParam(); this.frequency = new FakeParam(); this.threshold = new FakeParam(); this.knee = new FakeParam(); this.ratio = new FakeParam(); this.attack = new FakeParam(); this.release = new FakeParam(); }
  connect(n) { return n; }
}

class FakeOsc extends FakeNode {
  start(when) { this.ctx.started.push(when); }
  stop() {}
}

class FakeBufferSource extends FakeNode {
  start(when) { this.ctx.started.push(when); }
  stop() {}
}

class FakeCtx {
  constructor() {
    this.state = 'running';
    this.currentTime = 10;
    this.sampleRate = 44100;
    this.destination = new FakeNode(this);
    this.started = [];
  }
  createGain() { return new FakeNode(this); }
  createDynamicsCompressor() { return new FakeNode(this); }
  createOscillator() { return new FakeOsc(this); }
  createBufferSource() { return new FakeBufferSource(this); }
  createBiquadFilter() { return new FakeNode(this); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
}

global.window = { AudioContext: FakeCtx };

const { AudioEngine } = await import('../src/game/audio.js');

const chart = JSON.parse(readFileSync(new URL('../samples/chart.json', import.meta.url), 'utf8'));

test('整曲事件：覆盖 3 分钟、严格升序、第一事件在引子之后', () => {
  const engine = new AudioEngine();
  const events = engine.buildChartEvents(chart);
  assert.ok(events.length > 3000);
  for (let i = 1; i < events.length; i += 1) {
    assert.ok(events[i].tMs >= events[i - 1].tMs, 'events not sorted');
  }
  const lastBarEnd = chart.offsetMs + chart.bars * (60000 / chart.bpm) * 4;
  assert.ok(events[events.length - 1].tMs >= lastBarEnd - 1);
  // 下拍（120ms）处应有 kick 与 pad
  const atDownbeat = events.filter((e) => e.tMs === chart.offsetMs);
  assert.ok(atDownbeat.some((e) => e.kind === 'kick'));
  assert.ok(atDownbeat.some((e) => e.kind === 'pad'));
});

test('start 后 0 点映射正确，倒计时拍点排到 startAudioTime 之前', async () => {
  const engine = new AudioEngine();
  await engine.ensureContext();
  engine.start(chart, { leadMs: 1600 });
  assert.ok(Math.abs(engine.startAudioTime - 11.6) < 1e-9);
  // 拍点换算：第一拍 = 120 - 3*beat
  const beatMs = 60000 / chart.bpm;
  const firstBeatSec = engine.songMsToAudioTime(chart.offsetMs - 3 * beatMs);
  assert.ok(firstBeatSec > 10, 'count-in should be in the future');
  assert.equal(engine.audioTimeToSongMs(engine.startAudioTime), 0);
  engine.stop();
});

test('调度器：只排 horizon 以内事件，suspend 时不推进', async () => {
  const engine = new AudioEngine();
  await engine.ensureContext();
  engine.start(chart, { leadMs: 1000 });
  const scheduledAtStart = engine.cursor;
  // 把 currentTime 推到歌曲约 10 秒处，tick 一次
  engine.ctx.currentTime = engine.startAudioTime + 10;
  engine._tick();
  assert.ok(engine.cursor > scheduledAtStart);
  const scheduledUpTo = engine.events[engine.cursor - 1]?.tMs ?? 0;
  assert.ok(scheduledUpTo <= 10 * 1000 + 200);
  // suspend 后再推进时间，_tick 应直接返回
  await engine.pause();
  engine.ctx.currentTime += 60;
  const cursorBefore = engine.cursor;
  engine._tick();
  assert.equal(engine.cursor, cursorBefore);
  engine.stop();
});
