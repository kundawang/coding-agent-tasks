// 主流程：菜单 / 校准 / 游戏 / 结算 / 排行榜 的串联。

import { AudioEngine } from './audio.js';
import { Game } from './game.js';
import { computeOffset } from './calibrate.js';
import {
  makeEntry, addScore, loadScores, saveScores,
  mergeScores, serialize, parse,
} from './leaderboard.js';

const $ = (id) => document.getElementById(id);
const CALIB_KEY = 'neon-commute:calibration:v1';
const NAME_KEY = 'neon-commute:last-name';

const engine = new AudioEngine();
let chart = null;
let game = null;
let lastResult = null; // { summary, counts }

// ---------- 通用 ----------

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
  if (id) $(id).classList.remove('hidden');
}

function getCalibration() {
  try {
    const c = JSON.parse(localStorage.getItem(CALIB_KEY));
    return c && typeof c.offsetMs === 'number' ? c.offsetMs : 0;
  } catch {
    return 0;
  }
}

function refreshCalibStatus() {
  const off = getCalibration();
  $('calib-status').textContent = off
    ? `当前校准偏移：${off > 0 ? '+' : ''}${off}ms（判定已自动补偿）`
    : '尚未校准键盘延迟（按 0ms 处理）';
}

async function ensureAudio() {
  engine.init();
  await engine.resume();
}

// ---------- 游戏 ----------

async function startGame() {
  await ensureAudio();
  show(null);
  game = new Game($('game-canvas'), engine, chart, getCalibration(), onFinish);
  game.start();
}

function onFinish(summary, counts) {
  lastResult = { summary, counts };
  const cells = [
    ['PERFECT', counts.perfect, '#ffd94d'],
    ['GREAT', counts.great, '#4ddb8a'],
    ['GOOD', counts.good, '#4da6ff'],
    ['MISS', counts.miss, '#ff5d5d'],
    ['最大连击', summary.maxCombo, '#e8ecff'],
    ['准确率', summary.accuracy.toFixed(2) + '%', '#e8ecff'],
    ['总分', summary.score, '#ffc44d'],
  ];
  $('result-table').innerHTML = cells
    .map(([lbl, num, color]) =>
      `<div class="cell"><div class="num" style="color:${color}">${num}</div><div class="lbl">${lbl}</div></div>`)
    .join('');
  $('input-name').value = localStorage.getItem(NAME_KEY) || '';
  $('save-hint').textContent = '';
  $('btn-save').disabled = false;
  show('screen-result');
}

// ---------- 校准 ----------
// 流程：2 拍预备（低音）+ 4 拍计测（高音），节拍时刻全部来自音频时钟。
// 用户敲键时刻与节拍时刻求差，取中位数作为设备输入延迟。

const CALIB_BEATS = 6;
const CALIB_MEASURED = 4; // 最后 4 拍计测
let calib = null;

function startCalibration() {
  const beatMs = 60000 / chart.bpm;
  const t0 = engine.ctx.currentTime + 0.8; // 留 0.8s 准备
  const beats = [];
  for (let i = 0; i < CALIB_BEATS; i++) {
    const tCtx = t0 + (i * beatMs) / 1000;
    const isMeasured = i >= CALIB_BEATS - CALIB_MEASURED;
    engine.blip((tCtx - engine.ctx.currentTime) * 1000, isMeasured ? 880 : 440);
    if (isMeasured) beats.push((tCtx - t0) * 1000);
  }
  calib = { t0, beats, taps: [], done: false };
  $('calib-info').textContent = '听节拍，跟着最后 4 声高音敲键…';
  $('btn-calib-go').disabled = true;

  const totalMs = (CALIB_BEATS + 1) * beatMs;
  const pulse = $('calib-pulse');
  const pulseTimer = setInterval(() => {
    if (!calib) {
      clearInterval(pulseTimer);
      pulse.classList.remove('hit');
      return;
    }
    const elapsed = (engine.ctx.currentTime - calib.t0) * 1000;
    const phase = ((elapsed % beatMs) + beatMs) % beatMs;
    pulse.classList.toggle('hit', elapsed >= 0 && phase < 90);
  }, 30);

  setTimeout(finishCalibration, totalMs + 600);
}

function finishCalibration() {
  if (!calib || calib.done) return;
  calib.done = true;
  const result = computeOffset(calib.taps, calib.beats);
  $('btn-calib-go').disabled = false;
  if (!result.ok) {
    $('calib-info').textContent =
      `只匹配到 ${result.matched} 拍（至少 3 拍），没跟上节奏？再试一次。`;
    calib = null;
    return;
  }
  localStorage.setItem(CALIB_KEY, JSON.stringify({
    offsetMs: result.offsetMs,
    date: new Date().toISOString(),
  }));
  const off = result.offsetMs;
  $('calib-info').textContent =
    `测得设备偏移 ${off > 0 ? '+' : ''}${off}ms（${result.matched}/4 拍有效）。` +
    '之后判定会自动补偿，已记住，下次打开仍生效。';
  calib = null;
  refreshCalibStatus();
}

// ---------- 排行榜 ----------

function renderBoard() {
  const scores = loadScores();
  const tbody = $('board-table').querySelector('tbody');
  tbody.innerHTML = scores.map((s, i) => {
    const cal = s.calibrationMs ? `${s.calibrationMs > 0 ? '+' : ''}${s.calibrationMs}ms` : '未校准';
    return `<tr><td>${i + 1}</td><td>${escapeHtml(s.name)}</td><td>${s.score}</td>` +
      `<td>${Number(s.accuracy).toFixed(2)}%</td><td>${s.maxCombo}</td><td>${cal}</td></tr>`;
  }).join('') || '<tr><td colspan="6" style="color:#9aa3c0">还没有成绩，来打第一把！</td></tr>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 事件绑定 ----------

async function boot() {
  chart = await (await fetch('samples/chart.json')).json();
  refreshCalibStatus();

  $('btn-start').addEventListener('click', startGame);
  $('btn-calibrate').addEventListener('click', async () => {
    await ensureAudio();
    show('screen-calib');
    $('calib-info').textContent = '';
  });
  $('btn-board').addEventListener('click', () => {
    renderBoard();
    $('board-json').classList.add('hidden');
    show('screen-board');
  });

  $('btn-calib-go').addEventListener('click', startCalibration);
  $('btn-calib-back').addEventListener('click', () => { calib = null; show('screen-menu'); });

  $('btn-save').addEventListener('click', () => {
    if (!lastResult) return;
    const name = $('input-name').value.trim() || '匿名';
    localStorage.setItem(NAME_KEY, name);
    addScore(makeEntry({
      name,
      score: lastResult.summary.score,
      accuracy: lastResult.summary.accuracy,
      maxCombo: lastResult.summary.maxCombo,
      counts: lastResult.counts,
      calibrationMs: getCalibration(),
    }));
    $('btn-save').disabled = true;
    $('save-hint').textContent = '已存进本地排行榜。';
  });
  $('btn-retry').addEventListener('click', startGame);
  $('btn-result-menu').addEventListener('click', () => show('screen-menu'));

  $('btn-export').addEventListener('click', () => {
    const ta = $('board-json');
    ta.value = serialize(loadScores());
    ta.classList.remove('hidden');
    ta.select();
  });
  $('btn-import').addEventListener('click', () => {
    const ta = $('board-json');
    ta.classList.remove('hidden');
    const text = ta.value.trim();
    if (!text) {
      ta.placeholder = '把别人发的 JSON 粘贴到这里，再点一次「导入合并」';
      ta.value = '';
      return;
    }
    try {
      const merged = mergeScores(loadScores(), parse(text));
      saveScores(merged);
      renderBoard();
      ta.value = '';
      ta.placeholder = '合并完成！';
    } catch (err) {
      ta.placeholder = `导入失败：${err.message}`;
    }
  });
  $('btn-board-back').addEventListener('click', () => show('screen-menu'));

  // 校准期间的敲击
  window.addEventListener('keydown', (e) => {
    if (!calib || calib.done || e.repeat) return;
    if (!['KeyD', 'KeyF', 'KeyJ', 'KeyK', 'Space'].includes(e.code)) return;
    calib.taps.push((engine.ctx.currentTime - calib.t0) * 1000);
  });
}

boot();
