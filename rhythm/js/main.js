// 界面装配：菜单 / 校准 / 游戏 / 成绩 / 排行榜
import { AudioEngine } from './audio.js';
import { Game } from './game.js';
import { computeOffset } from './calibrate.js';
import {
  loadBoard, saveBoard, addEntry, mergeEntries, exportJSON, parseImport,
} from './leaderboard.js';

const CALIB_KEY = 'dfjk.calibMs.v1';
const NAME_KEY = 'dfjk.playerName.v1';
const CALIB_INTERVAL_MS = 600;
const CALIB_COUNT_IN = 4;
const CALIB_MEASURED = 4;

const $ = id => document.getElementById(id);
const screens = {
  menu: $('screen-menu'),
  calib: $('screen-calib'),
  game: $('screen-game'),
  result: $('screen-result'),
  board: $('screen-board'),
};

const audio = new AudioEngine();
let chart = null;
let game = null;
let lastResult = null;
let calibState = null; // 校准进行中的状态

function getCalibration() {
  return Number(localStorage.getItem(CALIB_KEY)) || 0;
}

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('hidden', key !== name);
  }
}

function fmtSigned(ms) {
  return `${ms >= 0 ? '+' : ''}${Math.round(ms)}`;
}

function updateCalibStatus() {
  const ms = getCalibration();
  $('calib-status').textContent = ms === 0
    ? '当前未校准（补偿 0 ms）'
    : `当前校准补偿 ${fmtSigned(ms)} ms`;
}

// ---- 谱面加载 ----
async function loadChart() {
  try {
    const resp = await fetch('../samples/chart.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    chart = await resp.json();
    $('chart-status').textContent =
      `${chart.title || 'chart'} ｜ ${chart.bpm} BPM ｜ ${chart.notes.length} 音符`;
    $('btn-start').disabled = false;
  } catch (err) {
    $('chart-status').textContent =
      `谱面加载失败：${err.message}（请用 python -m http.server 从仓库根目录启动）`;
  }
}

// ---- 游戏 ----
function startGame() {
  if (!chart) return;
  showScreen('game');
  $('pause-overlay').classList.add('hidden');
  game = new Game({
    canvas: $('game-canvas'),
    chart,
    audio,
    calibrationMs: getCalibration(),
    onPauseChange: paused => $('pause-overlay').classList.toggle('hidden', !paused),
    onFinish: result => {
      lastResult = result;
      game.destroy();
      game = null;
      showResult(result);
    },
  });
  game.start();
}

// ---- 成绩 ----
function showResult(r) {
  showScreen('result');
  $('result-rank').textContent = r.rank;
  $('result-score').textContent = String(r.score).padStart(7, '0');
  const rows = [
    ['Perfect', r.counts.perfect],
    ['Great', r.counts.great],
    ['Good', r.counts.good],
    ['Miss', r.counts.miss],
    ['最大连击', r.maxCombo],
    ['准确率', `${r.accuracy.toFixed(2)}%`],
  ];
  $('result-table').innerHTML =
    rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
  $('result-calib').textContent = r.calibrationMs === 0
    ? '本次未应用输入校准'
    : `本次判定已应用校准补偿 ${fmtSigned(r.calibrationMs)} ms`;
  $('result-uncalibrated').textContent = r.calibrationMs === 0 ? '' :
    `若不做校准（估算）：Perfect ${r.uncalibratedCounts.perfect} / Great ${r.uncalibratedCounts.great}`
    + ` / Good ${r.uncalibratedCounts.good} / Miss ${r.uncalibratedCounts.miss}`;
  $('save-status').textContent = '';
  $('input-name').value = localStorage.getItem(NAME_KEY) || '';
}

// ---- 排行榜 ----
function renderBoard() {
  const entries = loadBoard();
  const head = '<tr><th>#</th><th>名字</th><th>分数</th><th>准确率</th><th>最大连击</th><th>日期</th></tr>';
  const body = entries.slice(0, 20).map((e, i) =>
    `<tr><td>${i + 1}</td><td>${e.name}</td><td>${e.score}</td>`
    + `<td>${Number(e.acc).toFixed(2)}%</td><td>${e.maxCombo}</td>`
    + `<td>${new Date(e.date).toLocaleDateString()}</td></tr>`
  ).join('');
  $('board-table').innerHTML = head + body;
  $('board-export').value = exportJSON(entries);
}

// ---- 校准 ----
function runCalibration() {
  audio.ensure();
  const total = CALIB_COUNT_IN + CALIB_MEASURED;
  calibState = { deltas: [], usedBeats: new Set(), raf: 0, done: false };
  $('calib-result').textContent = '';
  $('btn-calib-run').disabled = true;
  audio.startMetronome(CALIB_INTERVAL_MS, total);

  const pulse = $('calib-pulse');
  const tick = () => {
    if (!calibState || calibState.done) return;
    const t = audio.nowSongMs();
    const phase = ((t % CALIB_INTERVAL_MS) + CALIB_INTERVAL_MS) % CALIB_INTERVAL_MS;
    pulse.classList.toggle('beat', t >= 0 && phase < 120);
    const measuredDone = Math.min(
      CALIB_MEASURED,
      Math.max(0, Math.floor(t / CALIB_INTERVAL_MS) - CALIB_COUNT_IN + 1),
    );
    $('calib-progress').textContent =
      t < CALIB_COUNT_IN * CALIB_INTERVAL_MS ? '预备拍…' : `第 ${measuredDone} / ${CALIB_MEASURED} 拍`;
    if (t > (total - 1) * CALIB_INTERVAL_MS + 400) {
      finishCalibration();
      return;
    }
    calibState.raf = requestAnimationFrame(tick);
  };
  tick();
}

function finishCalibration() {
  if (!calibState) return;
  calibState.done = true;
  cancelAnimationFrame(calibState.raf);
  $('btn-calib-run').disabled = false;
  $('calib-progress').textContent = '';
  const deltas = calibState.deltas;
  calibState = null;
  if (deltas.length < 3) {
    $('calib-result').textContent = `只记录到 ${deltas.length} 次击打，至少跟上 3 拍才算数，再试一次`;
    return;
  }
  const { offsetMs, spreadMs } = computeOffset(deltas);
  localStorage.setItem(CALIB_KEY, String(Math.round(offsetMs)));
  updateCalibStatus();
  $('calib-result').textContent =
    `校准完成：补偿 ${fmtSigned(offsetMs)} ms（抖动 ±${Math.round(spreadMs)} ms），已记住`;
}

function handleCalibKey(e) {
  if (!calibState || calibState.done) return;
  const key = e.key.toLowerCase();
  if (!['d', 'f', 'j', 'k', ' '].includes(key)) return;
  e.preventDefault();
  const t = audio.eventToSongMs(e.timeStamp); // 注意：不减旧校准，测的是原始延迟
  for (let i = CALIB_COUNT_IN; i < CALIB_COUNT_IN + CALIB_MEASURED; i++) {
    const beatTime = i * CALIB_INTERVAL_MS;
    if (!calibState.usedBeats.has(i) && Math.abs(t - beatTime) <= CALIB_INTERVAL_MS / 2) {
      calibState.usedBeats.add(i);
      calibState.deltas.push(t - beatTime);
      break;
    }
  }
}

// ---- 全局按键 ----
document.addEventListener('keydown', e => {
  if (game) {
    if (e.key === 'Escape') {
      game.togglePause();
      e.preventDefault();
      return;
    }
    if (game.handleKey(e)) e.preventDefault();
    return;
  }
  if (!screens.calib.classList.contains('hidden')) handleCalibKey(e);
});

// ---- 按钮接线 ----
$('btn-start').addEventListener('click', startGame);
$('btn-calib').addEventListener('click', () => { showScreen('calib'); updateCalibStatus(); });
$('btn-board').addEventListener('click', () => { renderBoard(); showScreen('board'); });
$('btn-calib-run').addEventListener('click', runCalibration);
$('btn-calib-clear').addEventListener('click', () => {
  localStorage.removeItem(CALIB_KEY);
  updateCalibStatus();
  $('calib-result').textContent = '已清除，补偿归零';
});
$('btn-calib-back').addEventListener('click', () => {
  if (calibState) { calibState.done = true; cancelAnimationFrame(calibState.raf); calibState = null; }
  audio.stop();
  $('btn-calib-run').disabled = false;
  showScreen('menu');
});
$('btn-save-score').addEventListener('click', () => {
  if (!lastResult) return;
  const name = $('input-name').value.trim() || '无名氏';
  localStorage.setItem(NAME_KEY, name);
  addEntry({
    name,
    score: lastResult.score,
    acc: Number(lastResult.accuracy.toFixed(2)),
    maxCombo: lastResult.maxCombo,
    perfect: lastResult.counts.perfect,
    great: lastResult.counts.great,
    good: lastResult.counts.good,
    miss: lastResult.counts.miss,
    calibMs: lastResult.calibrationMs,
    date: Date.now(),
  });
  $('save-status').textContent = `已保存：${name} ${lastResult.score} 分`;
});
$('btn-retry').addEventListener('click', startGame);
$('btn-result-board').addEventListener('click', () => { renderBoard(); showScreen('board'); });
$('btn-result-menu').addEventListener('click', () => showScreen('menu'));
$('btn-board-back').addEventListener('click', () => showScreen('menu'));
$('btn-merge').addEventListener('click', () => {
  try {
    const incoming = parseImport($('board-import').value);
    const merged = mergeEntries(loadBoard(), incoming);
    saveBoard(merged);
    renderBoard();
    $('merge-status').textContent = `合并完成，导入 ${incoming.length} 条，当前共 ${merged.length} 条`;
  } catch (err) {
    $('merge-status').textContent = `导入失败：${err.message}`;
  }
});
$('btn-fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
});

updateCalibStatus();
loadChart();
