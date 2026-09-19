// 页面流程编排：菜单 / 校准 / 游戏 / 暂停 / 结算 / 排行榜。

import { AudioEngine } from './game/audio.js';
import { Game } from './game/game.js';
import { Input } from './game/input.js';
import { Renderer } from './game/renderer.js';
import {
  loadSettings,
  saveSettings,
  loadScores,
  saveScores,
  makeRecord,
  mergeScores,
  exportPayload,
} from './game/storage.js';
import { computeOffset, calibrationBeatTimes, CALIBRATION_TAPS } from './core/calibration.js';

const $ = (id) => document.getElementById(id);

const screens = {
  menu: $('screen-menu'),
  calibrate: $('screen-calibrate'),
  pause: $('screen-pause'),
  result: $('screen-result'),
  board: $('screen-board'),
};

let chart = null;
const audio = new AudioEngine();
const canvas = $('stage');
const idleRenderer = new Renderer(canvas);
let settings = loadSettings();
let scores = loadScores();
let game = null;
let calib = null;
let mode = 'idle'; // idle | calibrating | playing

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('hidden', key !== name);
  }
}

function refreshCalibBadges() {
  const text = settings.calibrated
    ? `已校准 ${settings.offsetMs >= 0 ? '+' : ''}${settings.offsetMs}ms`
    : '未校准';
  $('menu-calib').textContent = text;
  $('menu-calib').className = `calib-badge ${settings.calibrated ? 'ok' : 'warn'}`;
}

// ---- 空闲画面（菜单/结算/榜单背后） ----
let idleStart = performance.now();
function idleLoop(now) {
  if (mode === 'idle') {
    const t = (now - idleStart) / 1000;
    idleRenderer.clear();
    idleRenderer.drawIdle(t * 1000);
  }
  requestAnimationFrame(idleLoop);
}
requestAnimationFrame(idleLoop);

// ---- 输入路由 ----
const input = new Input({
  getAudioTimeMs: () => audio.ctx ? audio.ctx.currentTime * 1000 : null,
  onLaneDown: (lane, audioTimeMs) => {
    if (mode === 'playing' && game) game.onLaneDown(lane, audioTimeMs);
    else if (mode === 'calibrating') calib?.onTap(audioTimeMs);
  },
  onLaneUp: (lane) => {
    if (mode === 'playing' && game) game.onLaneUp(lane);
  },
  onSystemKey: (key) => {
    if (key === 'mute') {
      if (audio.ctx) audio.setMuted(!audio.muted);
      return;
    }
    if (key === 'escape') {
      if (mode === 'playing') void pauseGame();
      else if (mode === 'calibrating') abortCalibration();
    }
  },
});
input.attach();

// ---- 开始 / 退出一局 ----
async function startGame() {
  if (game) {
    await game.abort();
    game = null;
  }
  mode = 'playing';
  showScreen('none');
  game = new Game({
    chart,
    renderer: idleRenderer,
    audio,
    offsetMs: settings.offsetMs,
    calibrated: settings.calibrated,
    onFinish: finishGame,
    onPauseChange: (paused) => {
      if (paused) showScreen('pause');
      else showScreen('none');
    },
  });
  input.setEnabled(true);
  try {
    await game.start();
  } catch (err) {
    console.error(err);
    mode = 'idle';
    showScreen('menu');
    alert('启动音频失败，请换个浏览器或检查音频设备。');
  }
}

async function pauseGame() {
  if (game && game.state === 'playing') {
    await game.togglePause();
    input.setEnabled(false);
  }
}

async function resumeGame() {
  if (game && game.state === 'paused') {
    showScreen('none');
    input.setEnabled(true);
    await game.togglePause();
  }
}

async function quitToMenu() {
  if (game) await game.abort();
  game = null;
  mode = 'idle';
  input.setEnabled(false);
  showScreen('menu');
}

let lastResult = null;
let lastSaved = false;

function finishGame(result) {
  mode = 'idle';
  input.setEnabled(false);
  lastResult = result;
  lastSaved = false;
  renderResult(result);
  showScreen('result');
  setTimeout(() => $('player-name').focus(), 50);
}

function renderResult(r) {
  $('result-rank').textContent = r.rank;
  $('result-score').textContent = String(r.score);
  $('result-acc').textContent = `准确率 ${(r.accuracy * 100).toFixed(2)}%`;
  $('r-perfect').textContent = r.counts.perfect;
  $('r-great').textContent = r.counts.great;
  $('r-good').textContent = r.counts.good;
  $('r-miss').textContent = r.counts.miss;
  $('r-combo').textContent = r.maxCombo;
  $('r-offset').textContent = settings.calibrated
    ? `${settings.offsetMs >= 0 ? '+' : ''}${settings.offsetMs}ms`
    : '未校准';
  $('save-hint').textContent = settings.calibrated
    ? ''
    : '提示：这台机器还没校准，成绩里会保留“未校准”标记，排名时建议留意。';
  $('player-name').value = '';
  $('save-form').querySelector('button').disabled = false;
}

$('save-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (lastSaved || !lastResult) return;
  const name = $('player-name').value.trim() || 'Player';
  const record = makeRecord(name, lastResult, chart.title, settings.offsetMs, settings.calibrated);
  scores = mergeScores(scores, [record]);
  saveScores(scores);
  lastSaved = true;
  $('save-hint').textContent = `已保存，当前第 ${scores.findIndex((s) => s.id === record.id) + 1} 名。`;
  $('save-form').querySelector('button').disabled = true;
});

// ---- 校准会话 ----
// 时序：startAudioTime 为“歌曲 0 点”（音频时钟，秒）。拍点歌曲时间对齐谱面网格，
// 点击时刻同样换算成音频时钟。computeOffset 得到往返偏移，存进 settings。
class CalibrationSession {
  constructor() {
    this.startAudioTime = 0;
    this.beatSongMs = calibrationBeatTimes(chart.offsetMs, 60000 / chart.bpm);
    this.beatAudioMs = [];
    this.taps = [];
    this.tapMarks = new Array(CALIBRATION_TAPS).fill(false);
    this.rafId = 0;
    this.done = false;
  }

  async start() {
    await audio.ensureContext();
    // 让第一拍落在约 1.2 秒后：最后一拍 = offsetMs，故 0 点相对现在提前到 offsetMs 之前。
    const leadToFirstBeatMs = 1200;
    this.startAudioTime =
      audio.ctx.currentTime +
      (leadToFirstBeatMs - this.beatSongMs[0]) / 1000;
    audio.startCalibrationClicks(chart, this.startAudioTime);
    this.beatAudioMs = this.beatSongMs.map((t) => this.startAudioTime * 1000 + t);
    this.rafId = requestAnimationFrame(() => this._loop());
    $('calib-status').textContent = '听到一声就按 D / F / J / K 任意一个，共四下。';
    $('calib-readout').textContent = '0 / 4';
    $('btn-calib-start').disabled = true;
    $('btn-calib-retry').disabled = true;
  }

  onTap(audioTimeMs) {
    if (this.done || this.taps.length >= CALIBRATION_TAPS || audioTimeMs == null) return;
    this.taps.push(audioTimeMs);
    // 标记最近拍点的环，纯视觉用。
    let nearest = 0;
    let best = Infinity;
    this.beatAudioMs.forEach((b, i) => {
      const d = Math.abs(audioTimeMs - b);
      if (d < best) { best = d; nearest = i; }
    });
    this.tapMarks[nearest] = true;
    $('calib-readout').textContent = `${this.taps.length} / 4`;
    if (this.taps.length === CALIBRATION_TAPS) this.finish();
  }

  _loop() {
    if (this.done) return;
    const songMs = audio.audioTimeToSongMs(audio.ctx.currentTime);
    idleRenderer.drawCalibration(this.beatSongMs, this.tapMarks, songMs);
    // 最后一拍之后 0.9 秒还没点满，自动结束尝试。
    if (songMs > chart.offsetMs + 900 && this.taps.length < CALIBRATION_TAPS) {
      this.fail('timeout');
      return;
    }
    this.rafId = requestAnimationFrame(() => this._loop());
  }

  finish() {
    const r = computeOffset(this.beatAudioMs, this.taps);
    if (!r.ok) {
      this.fail(r.error);
      return;
    }
    this.done = true;
    cancelAnimationFrame(this.rafId);
    settings = {
      offsetMs: r.offsetMs,
      calibrated: true,
      calibratedAt: new Date().toISOString(),
    };
    saveSettings(settings);
    refreshCalibBadges();
    const sign = r.offsetMs >= 0 ? '+' : '';
    $('calib-status').textContent =
      `完成：偏移 ${sign}${r.offsetMs}ms，已保存到本机。` +
      '之后伴奏会整体提前该毫秒数起播；不满意可重测或直接开始。';
    $('calib-readout').textContent = `${sign}${r.offsetMs} ms`;
    $('btn-calib-start').disabled = true;
    $('btn-calib-retry').disabled = false;
    mode = 'idle';
    input.setEnabled(false);
  }

  fail(reason) {
    this.done = true;
    cancelAnimationFrame(this.rafId);
    const msg = reason === 'timeout'
      ? '没点满四下，本次无效。'
      : '点得离拍点太远，本次无效。';
    $('calib-status').textContent = `${msg} 点“重测”再来一次。`;
    $('calib-readout').textContent = '无效';
    $('btn-calib-start').disabled = true;
    $('btn-calib-retry').disabled = false;
    mode = 'idle';
    input.setEnabled(false);
  }

  abort() {
    this.done = true;
    cancelAnimationFrame(this.rafId);
  }
}

async function beginCalibration() {
  showScreen('calibrate');
  mode = 'calibrating';
  input.setEnabled(true);
  calib = new CalibrationSession();
  $('btn-calib-retry').disabled = true;
  try {
    await calib.start();
  } catch (err) {
    console.error(err);
    abortCalibration();
  }
}

function abortCalibration() {
  calib?.abort();
  calib = null;
  mode = 'idle';
  input.setEnabled(false);
  showScreen('menu');
}

// ---- 排行榜 / 导入导出 ----
function renderBoard() {
  const tbody = $('board-table').querySelector('tbody');
  tbody.innerHTML = '';
  if (scores.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 8;
    td.textContent = '还没有成绩，先去打一把。';
    td.style.color = 'var(--muted)';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  scores.forEach((r, i) => {
    const tr = document.createElement('tr');
    const cells = [
      String(i + 1),
      r.name + (r.calibrated ? '' : '（未校准）'),
      String(r.score),
      `${(r.accuracy * 100).toFixed(2)}%`,
      `${r.counts.perfect}/${r.counts.great}/${r.counts.good}/${r.counts.miss}`,
      String(r.maxCombo),
      r.calibrated ? `${r.offsetMs >= 0 ? '+' : ''}${r.offsetMs}ms` : '—',
      r.date || '',
    ];
    cells.forEach((text, idx) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (idx === 2) td.className = 'score-cell';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

$('btn-board').addEventListener('click', () => {
  renderBoard();
  showScreen('board');
});
$('btn-result-board').addEventListener('click', () => {
  renderBoard();
  showScreen('board');
});
$('btn-board-back').addEventListener('click', () => showScreen('menu'));
$('btn-result-menu').addEventListener('click', () => {
  game = null;
  showScreen('menu');
});
$('btn-retry').addEventListener('click', () => void startGame());
$('btn-start').addEventListener('click', () => void startGame());
$('btn-calibrate').addEventListener('click', () => void beginCalibration());
$('btn-calib-retry').addEventListener('click', () => void beginCalibration());
$('btn-calib-back').addEventListener('click', () => abortCalibration());
$('btn-resume').addEventListener('click', () => void resumeGame());
$('btn-quit').addEventListener('click', () => void quitToMenu());

$('btn-fullscreen').addEventListener('click', async () => {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen?.();
  } else {
    await document.exitFullscreen?.();
  }
});

$('btn-export').addEventListener('click', () => {
  const area = $('io-text');
  area.classList.remove('hidden');
  area.value = exportPayload(scores);
  area.select();
  navigator.clipboard?.writeText(area.value).catch(() => {});
});

$('btn-import').addEventListener('click', () => {
  const area = $('io-text');
  const text = area.value.trim();
  if (!text) {
    area.classList.remove('hidden');
    area.focus();
    return;
  }
  try {
    const incoming = JSON.parse(text);
    const before = scores.length;
    scores = mergeScores(scores, incoming);
    saveScores(scores);
    renderBoard();
    area.value = '';
    area.classList.add('hidden');
    alert(`合并完成：新增 ${Math.max(0, scores.length - before)} 条，当前共 ${scores.length} 条。`);
  } catch {
    alert('JSON 解析失败，检查一下粘贴的内容。');
  }
});

$('btn-clear').addEventListener('click', () => {
  if (confirm('确定清空本机所有成绩？此操作不可恢复。')) {
    scores = [];
    saveScores(scores);
    renderBoard();
  }
});

// ---- 切后台自动暂停：标签页隐藏时音频上下文会被系统挂起 ----
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game && game.state === 'playing') {
    void pauseGame();
  }
});

// ---- 启动：加载谱面 ----
async function boot() {
  refreshCalibBadges();
  try {
    const res = await fetch('samples/chart.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    chart = await res.json();
    $('menu-title').textContent = chart.title;
    const minutes = Math.floor(chart.notes[chart.notes.length - 1].t / 60000);
    $('menu-meta').textContent =
      `${chart.bpm} BPM · offset ${chart.offsetMs}ms · ${chart.notes.length} 音符 · 约 ${minutes} 分钟`;
  } catch (err) {
    $('menu-meta').textContent =
      '谱面加载失败：请用 python -m http.server 在项目根目录起服务，不要直接双击 HTML（file:// 下 fetch 会被拦）。';
    $('btn-start').disabled = true;
    $('btn-calibrate').disabled = true;
    console.error(err);
  }
}

void boot();
