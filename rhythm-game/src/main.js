import { loadChart } from './chart.js';
import { Game } from './game.js';
import { runCalibration } from './calibration-screen.js';
import {
  getCalibration,
  saveCalibration,
  getName,
  saveName,
  getScores,
  addScore,
  clearScores,
  exportScores,
  mergeScores,
} from './storage.js';

const $ = (id) => document.getElementById(id);

const screens = {
  menu: $('screen-menu'),
  game: $('screen-game'),
  calibrate: $('screen-calibrate'),
  result: $('screen-result'),
};

let chart = null;
let game = null;
let lastResult = null;
let lastScoreSaved = false;
let pendingCalib = null;

function show(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('hidden', key !== name);
  }
}

function fmtTime(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderBoard() {
  const tbody = document.querySelector('#leaderboard tbody');
  const scores = getScores();
  if (scores.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">还没有成绩，先来一把吧</td></tr>';
    return;
  }
  tbody.innerHTML = scores
    .slice(0, 50)
    .map((s, i) => {
      const cal = s.offsetMs === 0 ? '—' : `${s.offsetMs > 0 ? '+' : ''}${s.offsetMs}`;
      return `<tr>
        <td class="rank-cell">${i + 1}</td>
        <td>${escapeHtml(s.playerName)}</td>
        <td>${s.score}</td>
        <td>${(s.accuracy * 100).toFixed(2)}%</td>
        <td>${s.maxCombo}</td>
        <td>${cal}</td>
        <td>${fmtTime(s.createdAt)}</td>
      </tr>`;
    })
    .join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function renderCalibState() {
  const cal = getCalibration();
  const el = $('calib-state');
  if (cal && cal.offsetMs !== 0) {
    el.textContent = `已校准：${cal.offsetMs > 0 ? '+' : ''}${cal.offsetMs}ms（${cal.calibratedAt?.slice(0, 10) ?? ''}）`;
    el.className = 'badge ok';
  } else if (cal && cal.offsetMs === 0) {
    el.textContent = '已校准：0ms（本机无明显偏移）';
    el.className = 'badge ok';
  } else {
    el.textContent = '未校准（按 0ms 判定，成绩会吃亏）';
    el.className = 'badge warn';
  }
}

function renderSongMeta() {
  if (!chart) return;
  $('song-title').textContent = chart.title;
  const mins = Math.floor(chart.durationMs / 60000);
  const secs = Math.round((chart.durationMs % 60000) / 1000);
  $('song-info').textContent =
    `${chart.artist} · ${chart.bpm} BPM · ${chart.notes.length} 音符 · ${mins}:${String(secs).padStart(2, '0')}`;
}

async function boot() {
  try {
    chart = await loadChart('samples/chart.json');
  } catch (err) {
    $('song-title').textContent = '谱面加载失败';
    $('song-info').textContent = err.message;
    $('btn-start').disabled = true;
    $('btn-calibrate').disabled = true;
    return;
  }
  renderSongMeta();
  renderCalibState();
  renderBoard();
  bindUI();
}

function startGame() {
  if (!chart) return;
  $('player-name').value = getName();
  show('game');
  const offsetMs = getCalibration()?.offsetMs ?? 0;
  game = new Game({
    chart,
    offsetMs,
    canvas: $('game-canvas'),
    onFinish: handleFinish,
  });
  game.onPaused = () => $('pause-overlay').classList.remove('hidden');
  game.onResumed = () => $('pause-overlay').classList.add('hidden');
  // 等屏幕切过来再量尺寸
  requestAnimationFrame(() => {
    game.renderer.resize();
    window.__game = game; // 开发/自动化探针
    game.start().catch((err) => alert(`启动失败：${err.message}`));
  });
}

function quitToMenu() {
  $('pause-overlay').classList.add('hidden');
  game?.destroy();
  game = null;
  window.__game = null;
  renderBoard();
  renderCalibState();
  show('menu');
}

function handleFinish(result) {
  lastResult = result;
  lastScoreSaved = false;
  $('r-perfect').textContent = result.counts.perfect;
  $('r-great').textContent = result.counts.great;
  $('r-good').textContent = result.counts.good;
  $('r-miss').textContent = result.counts.miss;
  $('r-combo').textContent = result.maxCombo;
  $('r-acc').textContent = `${(result.accuracy * 100).toFixed(2)}%`;
  $('r-score').textContent = result.score;
  $('r-rank').textContent = result.rank;
  $('result-rank-line').textContent = `演奏结束 · 评级 ${result.rank}`;
  $('save-hint').textContent = '';
  $('btn-save-score').disabled = false;
  show('result');
}

function saveCurrentScore() {
  if (!lastResult || lastScoreSaved) return;
  const name = $('player-name').value.trim() || '匿名同事';
  const cal = getCalibration();
  addScore({
    playerName: name,
    score: lastResult.score,
    accuracy: lastResult.accuracy,
    maxCombo: lastResult.maxCombo,
    counts: lastResult.counts,
    rank: lastResult.rank,
    offsetMs: cal?.offsetMs ?? 0,
    bpm: chart.bpm,
    title: chart.title,
  });
  saveName(name);
  lastScoreSaved = true;
  $('btn-save-score').disabled = true;
  $('save-hint').textContent = '已上榜 ✓';
}

function doExport() {
  const json = exportScores();
  const ta = $('io-textarea');
  ta.value = json;
  ta.classList.remove('hidden');
  ta.focus();
  ta.select();
  let copied = false;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(json).then(
      () => { copied = true; },
      () => {},
    );
  }
  setTimeout(() => {
    if (ta.classList.contains('hidden')) return;
    if (confirm(`${copied ? 'JSON 已复制到剪贴板；' : ''}内容也在页面底部文本框里。\n点“确定”关闭，点“取消”继续查看。`)) {
      ta.classList.add('hidden');
    }
  }, 100);
}

function doImport() {
  const ta = $('io-textarea');
  ta.value = '';
  ta.placeholder = '把群里复制的成绩 JSON 粘贴到这里，然后点文本框外任意位置';
  ta.classList.remove('hidden');
  ta.focus();

  const handler = () => {
    ta.removeEventListener('blur', handler);
    const text = ta.value.trim();
    ta.classList.add('hidden');
    if (!text) return;
    try {
      const { added } = mergeScores(text);
      renderBoard();
      alert(`合并成功：新增 ${added} 条成绩。`);
    } catch (err) {
      alert(`合并失败：${err.message}`);
    }
  };
  ta.addEventListener('blur', handler);
}

function openCalibration() {
  show('calibrate');
  $('calib-result').classList.add('hidden');
  requestAnimationFrame(() => {
    const canvas = $('calib-canvas');
    runCalibration(canvas, {
      onDone: (result) => {
        pendingCalib = result;
        $('calib-offset').textContent = `${result.offsetMs > 0 ? '+' : ''}${result.offsetMs}`;
        $('calib-taps').textContent = result.deviations
          .map((d) => `${d > 0 ? '+' : ''}${d}ms`)
          .join('，');
        $('calib-mean').textContent = result.meanAbsMs;
        $('calib-tip').textContent =
          result.meanAbsMs <= 30
            ? '跟得很稳，保存后判定会明显更准。'
            : '偏差有点大，可以重校一次；不过中位数偏移仍会自动补上。';
        $('calib-result').classList.remove('hidden');
      },
      onCancel: () => {
        renderCalibState();
        show('menu');
      },
    });
  });
}

function bindUI() {
  $('btn-start').onclick = startGame;
  $('btn-calibrate').onclick = openCalibration;
  $('btn-fullscreen').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  $('btn-resume').onclick = () => {
    $('pause-overlay').classList.add('hidden');
    game.resume();
  };
  $('btn-quit').onclick = quitToMenu;
  $('btn-retry').onclick = startGame;
  $('btn-back-menu').onclick = () => {
    renderBoard();
    renderCalibState();
    show('menu');
  };
  $('btn-save-score').onclick = saveCurrentScore;
  $('player-name').onkeydown = (e) => e.key === 'Enter' && saveCurrentScore();
  $('btn-export').onclick = doExport;
  $('btn-import').onclick = doImport;
  $('btn-clear-scores').onclick = () => {
    if (confirm('确定清空本机全部成绩？此操作不可恢复。')) {
      clearScores();
      renderBoard();
    }
  };
  $('btn-calib-save').onclick = () => {
    saveCalibration({
      offsetMs: pendingCalib.offsetMs,
      deviations: pendingCalib.deviations,
      meanAbsMs: pendingCalib.meanAbsMs,
      calibratedAt: new Date().toISOString(),
    });
    renderCalibState();
    show('menu');
  };
  $('btn-calib-redo').onclick = openCalibration;
  $('btn-calib-back').onclick = () => {
    renderCalibState();
    show('menu');
  };

  window.addEventListener('keydown', (e) => {
    if (screens.menu.classList.contains('hidden')) return;
    if (e.code === 'Enter') startGame();
    if (e.code === 'KeyC') openCalibration();
  });

}

boot();
