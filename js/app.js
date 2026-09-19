// 页面主控：菜单 / 实时对战 / 暂停 / 结算 / 观战回放。
// 实时对战用「固定步长累加器」：渲染帧率多少都不影响判定。

import { loadConfig } from './config.js';
import { createMatch, step } from './sim.js';
import { Keyboard } from './input.js';
import { drawFrame } from './render.js';
import { Recorder, parseReplay, reconstruct, inputStream, replayToText } from './replay.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');

let config = null;
const keyboard = new Keyboard(window);

// mode: menu | live | paused | finished | spectator
let mode = 'menu';
let match = null;
let recorder = null;
let exportedReplay = null;

// 实时对战的固定步长累加器
let acc = 0;
let lastTime = 0;

// 观战状态
let spec = null;
let specPos = 0; // 浮点回放位置
let specLast = 0;
let specOrigin = 'menu'; // 进入观战之前在哪：menu | finished
let finishedMatch = null; // 结算时的 match，观战回来后恢复
let specMatch = null; // 观战专用模拟实例（与实时 match 隔离）

// HUD / 渲染当前该读哪一局
function activeMatch() {
  return mode === 'spectator' ? specMatch : match;
}

function fmtTime(ms) {
  ms = Math.max(0, ms);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const d = Math.floor((ms % 1000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}

function resultText() {
  if (!match || match.winner === null) return '';
  return match.winner === 'draw' ? '平局！' : `玩家${match.winner === 0 ? '一 (P1)' : '二 (P2)'} 胜`;
}

function updateHud() {
  if (match) {
    $('score0').innerHTML = `P1&nbsp;${Math.floor(match.score[0])}`;
    $('score1').innerHTML = `${Math.floor(match.score[1])}&nbsp;P2`;
    $('timer').textContent = fmtTime((match.totalTicks - match.tick) * match.tickMs);
  }
  const labels = {
    menu: '未开始',
    live: `对战中 · tick ${match ? match.tick : 0}`,
    paused: '已暂停（P 继续）',
    finished: resultText(),
    spectator: spec && !spec.paused ? `观战回放 ${spec.speed}×` : '回放已暂停',
  };
  $('status').textContent = labels[mode] ?? '';
}

// ---------- 实时对战 ----------

function startLive() {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
  match = createMatch(config.arena, config.rules, seed);
  recorder = new Recorder(seed, match.totalTicks, config.arena, config.rules);
  exportedReplay = null;
  mode = 'live';
  acc = 0;
  lastTime = performance.now();
  keyboard.clear();

  $('overlay').classList.add('hidden');
  $('specbar').classList.remove('on');
  $('importBox').classList.add('hidden');
  $('btnPause').classList.remove('hidden');
  $('btnResume').classList.add('hidden');
  $('btnExport').classList.add('hidden');
  $('btnSpec').classList.add('hidden');
  $('verify').textContent = '';
  $('verify').className = '';
  drawFrame(ctx, match);
  updateHud();
}

function pauseLive() {
  if (mode !== 'live') return;
  mode = 'paused';
  $('btnPause').classList.add('hidden');
  $('btnResume').classList.remove('hidden');
  updateHud();
}

function resumeLive() {
  if (mode !== 'paused') return;
  mode = 'live';
  // 暂停期间不累积，避免恢复瞬间补一大堆步
  acc = 0;
  lastTime = performance.now();
  $('btnPause').classList.remove('hidden');
  $('btnResume').classList.add('hidden');
  updateHud();
}

function finishLive() {
  mode = 'finished';
  exportedReplay = recorder.finish(match);
  finishedMatch = match;
  $('btnPause').classList.add('hidden');
  $('btnResume').classList.add('hidden');
  $('btnExport').classList.remove('hidden');
  $('btnExport').disabled = false;
  $('btnSpec').classList.remove('hidden');
  $('btnSpec').disabled = false;

  $('ovTitle').textContent = match.winner === 'draw' ? '平局！' : resultText();
  $('ovBody').innerHTML =
    `P1 <b>${Math.floor(match.score[0])}</b> : <b>${Math.floor(match.score[1])}</b> P2<br>` +
    `共 ${match.totalTicks} tick · 种子 ${exportedReplay.seed} · ${exportedReplay.events.length} 个事件`;
  $('btnStart').textContent = '再来一局';
  $('btnSpecOverlay').classList.remove('hidden');
  $('btnExportOverlay').classList.remove('hidden');
  $('overlay').classList.remove('hidden');
  updateHud();
}

function exportReplay() {
  if (!exportedReplay) return;
  const blob = new Blob([replayToText(exportedReplay)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tickwars-${exportedReplay.seed.toString(16)}-${exportedReplay.totalTicks}.twr.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- 观战 ----------

function enterSpectator(replay) {
  const rebuilt = reconstruct(replay);
  const tag = $('verify');
  tag.className = rebuilt.consistent ? 'ok' : 'bad';
  tag.textContent = rebuilt.consistent
    ? `回放校验通过：${replay.events.length} 个事件逐一对上（种子 ${replay.seed}）`
    : '回放校验失败：' + rebuilt.problems.join('；');

  spec = {
    replay,
    inputAt: inputStream(replay),
    totalTicks: replay.totalTicks,
    paused: true,
    speed: 1,
  };
  specOrigin = exportedReplay && mode === 'finished' ? 'finished' : 'menu';
  specPos = 0;
  specLast = 0;
  mode = 'spectator';
  const spectatorMatch = createMatch(replay.arena, replay.rules, replay.seed);
  // 观战用的 match 独立于结算 match：seek 重建不影响结算画面。
  match = spectatorMatch;

  $('overlay').classList.add('hidden');
  $('importBox').classList.add('hidden');
  $('btnPause').classList.add('hidden');
  $('btnResume').classList.add('hidden');
  $('btnExport').classList.add('hidden');
  $('btnSpec').classList.add('hidden');
  $('specbar').classList.add('on');
  $('seek').max = spec.totalTicks;
  $('seek').value = 0;
  $('speed').value = '1';
  $('btnPlay').textContent = '▶';
  drawFrame(ctx, match, { caption: `tick 0 / ${spec.totalTicks}` });
  $('ticklabel').textContent = `0 / ${spec.totalTicks}`;
  updateHud();
}

// 拖到任意 tick：从零确定性重放到该 tick（10800 步仅几毫秒）
function seekSpectator(targetTick) {
  if (!spec) return;
  const t = Math.max(0, Math.min(spec.totalTicks, Math.floor(targetTick)));
  match = createMatch(spec.replay.arena, spec.replay.rules, spec.replay.seed);
  while (match.tick < t && match.status === 'running') {
    step(match, spec.inputAt(match.tick + 1));
  }
  specPos = t;
  $('seek').value = match.tick;
  $('ticklabel').textContent = `${match.tick} / ${spec.totalTicks}`;
  drawFrame(ctx, match, { caption: `tick ${match.tick} / ${spec.totalTicks}（${(match.tick / spec.totalTicks * 100).toFixed(1)}%）` });
  updateHud();
}

function toggleSpecPlay() {
  if (!spec) return;
  if (!spec.paused && specPos >= spec.totalTicks) return;
  if (spec.paused && specPos >= spec.totalTicks) seekSpectator(0);
  spec.paused = !spec.paused;
  $('btnPlay').textContent = spec.paused ? '▶' : '⏸';
  specLast = 0;
  updateHud();
}

function showImport() {
  $('importBox').classList.remove('hidden');
  $('replayText').focus();
}

function exitSpectator() {
  spec = null;
  specPos = 0;
  $('specbar').classList.remove('on');
  if (specOrigin === 'finished') {
    mode = 'finished';
    $('overlay').classList.remove('hidden');
  } else {
    mode = 'menu';
    match = createMatch(config.arena, config.rules, 0);
    $('ovTitle').textContent = 'tickwars';
    $('ovBody').textContent = '两人共用一个键盘抢三个据点。占点要连续站 2.5 秒，占着的据点每秒加分，三分钟结算。';
    $('btnStart').textContent = '开始对战';
    $('btnSpecOverlay').classList.add('hidden');
    $('btnExportOverlay').classList.add('hidden');
    $('score0').innerHTML = 'P1&nbsp;0';
    $('score1').innerHTML = '0&nbsp;P2';
    $('timer').textContent = '3:00.0';
    $('overlay').classList.remove('hidden');
  }
  drawFrame(ctx, match);
  updateHud();
}

// ---------- 主循环 ----------

function frame(now) {
  requestAnimationFrame(frame);

  if (mode === 'live') {
    let frameMs = now - lastTime;
    lastTime = now;
    // 切后台/极端卡顿（>250ms）：丢弃积压时间，不补“过去”
    if (frameMs > 250) frameMs = 0;
    acc += frameMs;
    const stepMs = 1000 / config.rules.tickRate;
    // 安全上限：单帧最多补 10 步，防止螺旋死亡
    let steps = 0;
    while (acc + 1e-9 >= stepMs && steps < 10 && match.status === 'running') {
      const masks = keyboard.snapshot();
      recorder.noteInputs(match.tick + 1, masks);
      step(match, masks);
      acc -= stepMs;
      // 浮点吸附：165/144 等帧率下单帧是 tick 的分数倍，
      // 累积到整秒时残量会因浮点误差差 1e-10ms 凑不上一个整步，
      // 导致 165Hz 比 60Hz 少跑 1 tick。残量几乎为 0 时归零。
      if (Math.abs(acc) < 1e-9) acc = 0;
      steps += 1;
    }
    drawFrame(ctx, match);
    updateHud();
    if (match.status === 'finished') finishLive();
  } else if (mode === 'spectator' && spec && !spec.paused) {
    if (!specLast) specLast = now;
    const dt = Math.min(100, now - specLast);
    specLast = now;
    specPos += (dt / 1000) * spec.replay.rules.tickRate * spec.speed;
    if (specPos >= spec.totalTicks) {
      specPos = spec.totalTicks;
      spec.paused = true;
      $('btnPlay').textContent = '▶';
    }
    const target = Math.floor(specPos);
    while (match.tick < target && match.status === 'running') {
      step(match, spec.inputAt(match.tick + 1));
    }
    $('seek').value = match.tick;
    $('ticklabel').textContent = `${match.tick} / ${spec.totalTicks}`;
    drawFrame(ctx, match, { caption: `tick ${match.tick} / ${spec.totalTicks} · ${spec.speed}×` });
    updateHud();
  }
}

// ---------- 事件接线 ----------

$('btnStart').addEventListener('click', startLive);
$('btnSpecOverlay').addEventListener('click', () => enterSpectator(exportedReplay));
$('btnExportOverlay').addEventListener('click', exportReplay);
$('btnImport').addEventListener('click', showImport);
$('btnPause').addEventListener('click', pauseLive);
$('btnResume').addEventListener('click', resumeLive);
$('btnExport').addEventListener('click', exportReplay);
$('btnSpec').addEventListener('click', () => enterSpectator(exportedReplay));
$('btnCancelImport').addEventListener('click', () => $('importBox').classList.add('hidden'));
$('btnLoadReplay').addEventListener('click', () => {
  const parsed = parseReplay($('replayText').value);
  if (parsed.error) {
    $('verify').className = 'bad';
    $('verify').textContent = parsed.error;
    return;
  }
  enterSpectator(parsed.replay);
});
$('btnPlay').addEventListener('click', toggleSpecPlay);
$('speed').addEventListener('change', (e) => {
  if (spec) spec.speed = Number(e.target.value);
});
$('seek').addEventListener('input', (e) => seekSpectator(Number(e.target.value)));
$('btnExitSpec').addEventListener('click', exitSpectator);

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') {
    if (mode === 'live') pauseLive();
    else if (mode === 'paused') resumeLive();
    else if (mode === 'spectator') toggleSpecPlay();
  } else if (e.code === 'Space' && mode === 'spectator') {
    e.preventDefault();
    toggleSpecPlay();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && mode === 'live') pauseLive();
});

// ---------- 启动 ----------

async function boot() {
  try {
    config = await loadConfig();
  } catch {
    $('ovTitle').textContent = '配置加载失败';
    $('ovBody').textContent =
      '读不到 samples/arena.json 或 samples/rules.json。请用 python -m http.server 从项目根目录打开，不要 file:// 直接双击。';
    return;
  }
  match = createMatch(config.arena, config.rules, 0);
  drawFrame(ctx, match);
  updateHud();
  requestAnimationFrame(frame);

}

boot();

// 临时测试钩子（自测后删除）
window.__tw = {
  get mode() { return mode; },
  get match() { return match; },
  startLive,
  finishLive,
  enterSpectator,
  get exported() { return exportedReplay; },
};
