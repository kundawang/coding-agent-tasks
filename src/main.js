import { loadConfig } from './config.js';
import { createMatch, step, PHASE } from './engine.js';
import { Recorder, Playback, expandEvent } from './replay.js';
import { Keyboard } from './input.js';
import { render } from './render.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const el = (id) => document.getElementById(id);

let arena;
let rules;
let keyboard;
let mode = 'menu'; // 'menu' | 'live' | 'spectate'

// ---------------- 实时对局 ----------------

class LiveGame {
  constructor() {
    this.seed = `${Date.now().toString(36)}-${Math.floor(performance.now() * 1000).toString(36)}`;
    this.state = createMatch(arena, rules, this.seed);
    this.recorder = new Recorder(arena, rules, this.seed, new Date().toISOString());
    this.recorder.init(this.state);
    this.acc = 0;
    this.last = performance.now();
    this.paused = false;
    this.ended = false;
    this.replay = null;
    this.raf = 0;
  }

  frame = (now) => {
    if (mode !== 'live') return;
    this.raf = requestAnimationFrame(this.frame);

    let elapsed = now - this.last;
    this.last = now;
    if (elapsed > 250) elapsed = 250; // 切后台回来不追一大堆 tick

    if (!this.paused && !this.ended) {
      this.acc += elapsed;
      const dt = 1000 / rules.tickRate;
      // 固定步长螺旋追平：渲染再快/再慢，每个 tick 的输入与步长都固定。
      let guard = 0;
      while (this.acc >= dt && !this.ended && guard < 1000) {
        const inputs = keyboard.sample();
        step(this.state, inputs);
        this.recorder.record(this.state, inputs);
        this.acc -= dt;
        guard++;
        if (this.state.phase === PHASE.OVER) this.onEnd();
      }
    }

    render(ctx, this.state);
    updateHud(this.state, this.paused);
  };

  togglePause() {
    if (this.ended) return;
    this.paused = !this.paused;
    this.last = performance.now();
  }

  onEnd() {
    this.ended = true;
    this.replay = this.recorder.toReplay();
    showResult(this.state);
  }
}

let live = null;

function startLive() {
  stopSpectate();
  hideOverlays();
  el('hud').classList.remove('hidden');
  el('replay-bar').classList.add('hidden');
  mode = 'live';
  live = new LiveGame();
  keyboard.onTogglePause = () => live.togglePause();
  live.raf = requestAnimationFrame(live.frame);
}

function stopLive() {
  if (live) cancelAnimationFrame(live.raf);
  live = null;
}

// ---------------- 观战 / 回放 ----------------

class Spectator {
  constructor(replay) {
    this.pb = new Playback(replay);
    this.replay = replay;
    this.targetTick = 0;
    this.playing = true;
    this.speed = 1;
    this.acc = 0;
    this.last = performance.now();
    this.raf = 0;
    setupReplayUi(this);
    this.pb.seekTo(0);
  }

  frame = (now) => {
    if (mode !== 'spectate') return;
    this.raf = requestAnimationFrame(this.frame);

    let elapsed = now - this.last;
    this.last = now;
    if (elapsed > 250) elapsed = 250;

    if (this.playing) {
      this.acc += elapsed * this.speed;
      const dt = 1000 / rules.tickRate;
      while (this.acc >= dt && this.targetTick < this.pb.tickCount) {
        this.targetTick++;
        this.acc -= dt;
      }
      if (this.targetTick >= this.pb.tickCount) {
        this.targetTick = this.pb.tickCount;
        this.playing = false;
        el('rp-play').textContent = '▶';
      }
    }

    this.pb.seekTo(this.targetTick);
    render(ctx, this.pb.state);
    updateHud(this.pb.state, false);
    syncReplayUi(this);
  };

  destroy() {
    cancelAnimationFrame(this.raf);
  }
}

let spec = null;

function startSpectate(replay) {
  stopLive();
  hideOverlays();
  el('hud').classList.remove('hidden');
  el('replay-bar').classList.remove('hidden');
  mode = 'spectate';
  spec = new Spectator(replay);
  keyboard.onTogglePause = toggleSpecPlay;
  spec.raf = requestAnimationFrame(spec.frame);
}

function stopSpectate() {
  spec?.destroy();
  spec = null;
}

function toggleSpecPlay() {
  if (!spec) return;
  if (spec.targetTick >= spec.pb.tickCount) spec.targetTick = 0;
  spec.playing = !spec.playing;
  spec.last = performance.now();
  el('rp-play').textContent = spec.playing ? '⏸' : '▶';
}

function setupReplayUi(s) {
  const seek = el('seek');
  seek.max = s.pb.tickCount;
  seek.value = 0;
  seek.oninput = () => {
    s.targetTick = Number(seek.value);
    s.playing = false;
    s.acc = 0;
    el('rp-play').textContent = '▶';
  };

  el('rp-play').onclick = toggleSpecPlay;
  el('rp-step-fwd').onclick = () => stepN(1);
  el('rp-step-back').onclick = () => stepN(-1);
  document.querySelectorAll('input[name="rp-speed"]').forEach((radio) => {
    radio.onchange = () => {
      s.speed = Number(radio.value);
      s.acc = 0;
    };
  });
  el('rp-export').onclick = () => downloadReplay(s.replay);
  el('rp-close').onclick = backToMenu;

  buildEventList(s.replay);
}

function stepN(n) {
  if (!spec) return;
  spec.playing = false;
  spec.acc = 0;
  el('rp-play').textContent = '▶';
  spec.targetTick = Math.max(0, Math.min(spec.pb.tickCount, spec.targetTick + n));
}

function syncReplayUi(s) {
  const seek = el('seek');
  if (document.activeElement !== seek) seek.value = s.targetTick;

  const totalMs = Math.round(s.pb.tickCount / rules.tickRate * 1000);
  const curMs = Math.round(s.targetTick / rules.tickRate * 1000);
  el('rp-tick').textContent =
    `${formatMs(curMs)} / ${formatMs(totalMs)}（tick ${s.targetTick}/${s.pb.tickCount}）`;

  // 定期校验最近快照：重放状态必须和录制时哈希一致。
  if (s.targetTick % 60 === 0) {
    const v = s.pb.verifyNear(s.targetTick);
    const badge = el('rp-verify');
    if (!v) {
      badge.textContent = '';
      badge.className = '';
    } else {
      badge.textContent = v.ok
        ? `✓ 快照校验一致 @tick ${v.t}`
        : `✗ 回放与录制不一致 @tick ${v.t}`;
      badge.className = v.ok ? 'ok' : 'bad';
    }
  }
}

function buildEventList(replay) {
  const box = el('rp-events');
  box.innerHTML = '';
  for (const row of replay.events) {
    const ev = expandEvent(row);
    const div = document.createElement('div');
    div.className = `ev ${ev.team === 0 ? 'p1' : ev.team === 1 ? 'p2' : 'sys'}`;
    const ms = Math.round(ev.t / rules.tickRate * 1000);
    div.textContent = `${formatMs(ms)}  ${describeEvent(ev)}`;
    div.onclick = () => {
      if (!spec) return;
      spec.targetTick = ev.t;
      spec.acc = 0;
      spec.playing = false;
      el('rp-play').textContent = '▶';
    };
    box.appendChild(div);
  }
}

function describeEvent(ev) {
  const who = ev.team === 0 ? 'P1' : ev.team === 1 ? 'P2' : '';
  switch (ev.type) {
    case 'start': return `对局开始（种子 ${ev.seed ?? '无'}）`;
    case 'go': return '开战';
    case 'swing': return `${who} 挥击`;
    case 'hit': return `${who} 命中，对方剩 ${ev.hp} HP`;
    case 'kill': return `${who} 击倒了 P${ev.victim + 1}`;
    case 'respawn': return `${who} 复活（出生无敌 ${rules.spawnImmunityMs}ms）`;
    case 'capture': return `${who} 占领了据点 ${ev.point}`;
    case 'score': return `分数对账 P1 ${ev.s[0]} : ${ev.s[1]} P2`;
    case 'end': return `终局 P1 ${ev.s[0]} : ${ev.s[1]} P2`;
    default: return ev.type;
  }
}

// ---------------- HUD ----------------

function updateHud(state, paused) {
  const [p1, p2] = state.players;
  el('p1-score').textContent = String(Math.floor(p1.score));
  el('p2-score').textContent = String(Math.floor(p2.score));
  el('p1-hp').textContent = p1.alive ? '♥'.repeat(p1.hp) : '☠';
  el('p2-hp').textContent = p2.alive ? '♥'.repeat(p2.hp) : '☠';

  let remain;
  if (state.phase === PHASE.COUNTDOWN) {
    remain = rules.matchMs;
  } else {
    const liveTicks = Math.min(state.totalTicks,
      Math.max(0, state.tick - state.countdownTicks));
    remain = Math.max(0, rules.matchMs - liveTicks / rules.tickRate * 1000);
  }
  el('hud-timer').textContent = (paused ? '⏸ ' : '') + formatMs(remain);
  el('hud-points').textContent = state.points.map((pt) => {
    const tag = pt.owner === -1 ? '·' : pt.owner === 0 ? '1' : '2';
    return `${pt.id}:${tag}`;
  }).join('   ');
}

// ---------------- 菜单 / 结算 / 文件 ----------------

function hideOverlays() {
  el('menu').classList.add('hidden');
  el('result').classList.add('hidden');
}

function showResult(state) {
  const [s1, s2] = state.players.map((p) => Math.floor(p.score));
  el('result-title').textContent = s1 === s2 ? '平局' : s1 > s2 ? 'P1 获胜' : 'P2 获胜';
  el('result-detail').textContent = `${s1} : ${s2}`;
  el('result').classList.remove('hidden');
}

function downloadReplay(replay) {
  const blob = new Blob([JSON.stringify(replay)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tickwars-${replay.startedAt.replace(/[:.]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importReplayFile(file) {
  try {
    const replay = JSON.parse(await file.text());
    startSpectate(replay);
  } catch (err) {
    alert(`回放文件打不开：${err.message}`);
  }
}

function backToMenu() {
  stopLive();
  stopSpectate();
  el('menu').classList.remove('hidden');
  el('hud').classList.add('hidden');
  el('replay-bar').classList.add('hidden');
  mode = 'menu';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function formatMs(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------------- 启动 ----------------

async function main() {
  const cfg = await loadConfig();
  arena = cfg.arena;
  rules = cfg.rules;
  keyboard = new Keyboard();

  el('btn-play').onclick = startLive;
  el('btn-rematch').onclick = startLive;
  el('btn-menu').onclick = backToMenu;
  el('btn-watch').onclick = () => {
    if (live?.replay) startSpectate(live.replay);
  };
  el('btn-export').onclick = () => live?.replay && downloadReplay(live.replay);
  el('btn-load').onclick = () => el('replay-file').click();
  el('replay-file').onchange = (e) => {
    if (e.target.files[0]) importReplayFile(e.target.files[0]);
    e.target.value = '';
  };

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) importReplayFile(e.dataTransfer.files[0]);
  });
}

main().catch((err) => {
  document.body.innerHTML =
    `<pre style="color:#ff8080;padding:20px">启动失败：${err.message}\n\n请用 python -m http.server 之类的静态服务器打开，不要直接双击 html。</pre>`;
});