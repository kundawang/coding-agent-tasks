// 校准界面：音频时钟发出 4 个拍点，玩家跟敲 4 下。
// 拍点的“performance 时间”由 AudioContext 时间反解，
// 这样敲击偏差完全不依赖 setTimeout 的触发时刻。
import { createAudioContext } from './audio.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { computeCalibration } from './calibrate.js';

const CALIB_BPM = 120;
const LEAD_MS = 2000; // 开始后 2s 出第一拍

export async function runCalibration(canvas, { onDone, onCancel }) {
  const ctx = createAudioContext();
  await ctx.resume();
  const renderer = new Renderer(canvas);
  const input = new Input(window);
  input.attach();

  const beatMs = 60000 / CALIB_BPM;
  const startCtx = ctx.currentTime + 0.1;
  const startPerf = performance.now();
  const beatCtxTimes = [0, 1, 2, 3].map((i) => startCtx + (LEAD_MS + i * beatMs) / 1000);
  const beatPerfTimes = beatCtxTimes.map(
    (t) => startPerf + (t - startCtx) * 1000,
  );

  // 拍点声（方波 blip，最后一拍高音）
  beatCtxTimes.forEach((t, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = i === 3 ? 1320 : 880;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.15);
  });

  const taps = [];
  let finished = false;

  function cleanup() {
    cancelAnimationFrame(raf);
    input.detach();
    window.removeEventListener('resize', onResize);
    ctx.close().catch(() => {});
  }

  function complete() {
    if (finished) return;
    finished = true;
    const result = computeCalibration(taps, beatPerfTimes);
    cleanup();
    onDone(result);
  }

  function cancel() {
    if (finished) return;
    finished = true;
    cleanup();
    onCancel();
  }

  input.onPress = () => {
    if (finished || taps.length >= 4) return;
    taps.push(performance.now());
    if (taps.length === 4) {
      // 等最后一拍视觉反馈走完再算
      setTimeout(complete, 500);
    }
  };
  input.onEsc = () => {
    cancel();
  };

  const onResize = () => renderer.resize();
  window.addEventListener('resize', onResize);

  // 到最后一拍 +800ms 还没敲满也结束（一下都没敲则返回，不算结果）
  const hardStopAt = beatPerfTimes[3] + 800;
  let raf = 0;
  const loop = () => {
    const now = performance.now();
    const deviations = taps.map((t, i) => Math.round(t - beatPerfTimes[i]));
    renderer.drawCalibration(beatPerfTimes, now, deviations, beatMs);
    if (now > hardStopAt) (taps.length > 0 ? complete : cancel)();
    if (finished) return;
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}
