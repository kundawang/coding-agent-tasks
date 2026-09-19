// 回放的录制、序列化、重放。
// 一局的全部“真相”只有：初始配置 + 种子 + 每个 tick 的输入。
// events/snapshots 只是从真相推导出来的对账与快进用副本。

import { createMatch, step, PHASE } from './engine.js';

export const REPLAY_VERSION = 1;
export const SNAPSHOT_EVERY = 300; // 每 5 秒一个快照（60 tick 时）

// ---------------- 录制 ----------------

export class Recorder {
  constructor(arena, rules, seed, startedAt) {
    this.arena = arena;
    this.rules = rules;
    this.seed = seed;
    this.startedAt = startedAt;
    this.inputs = [];        // 每个 tick 一对 [p1, p2]（含倒计时 tick）
    this.events = [];        // 事件（带 tick）
    this.snapshots = [];
  }

  // state0: createMatch 的初始状态（t=0 的 start 事件挂在它上面）
  init(state0) {
    this.snapshots = [{ t: 0, state: serializeState(state0) }];
    for (const ev of state0.events) this.events.push({ ...ev, t: 0 });
  }

  record(state, inputs) {
    this.inputs.push(inputs[0], inputs[1]);
    for (const ev of state.events) {
      this.events.push({ ...ev, t: state.tick });
    }
    if (state.tick % SNAPSHOT_EVERY === 0 || state.phase === PHASE.OVER) {
      this.snapshots.push({ t: state.tick, state: serializeState(state) });
    }
    this.lastTick = state.tick;
  }

  toReplay() {
    return {
      format: 'tickwars-replay',
      version: REPLAY_VERSION,
      startedAt: this.startedAt,
      seed: this.seed,
      arena: this.arena,
      rules: this.rules,
      tickCount: this.lastTick,
      inputs: encodeInputs(this.inputs),
      events: this.events.map(compactEvent),
      snapshots: this.snapshots,
    };
  }
}

// ---------------- 重放 ----------------

export class Playback {
  constructor(replay) {
    if (replay.format !== 'tickwars-replay') {
      throw new Error('不是 tickwars 回放文件');
    }
    if (replay.version !== REPLAY_VERSION) {
      throw new Error(`回放版本不支持: ${replay.version}`);
    }
    this.replay = replay;
    this.inputs = decodeInputs(replay.inputs); // 扁平数组，长度 2*tickCount
    this.tickCount = replay.tickCount;
    this.state = createMatch(replay.arena, replay.rules, replay.seed);
    this.tick = 0;
  }

  // 推到第 targetTick 个 tick（含）。借助快照快进。
  seekTo(targetTick) {
    targetTick = Math.max(0, Math.min(this.tickCount, targetTick));
    let base = null;
    for (const snap of this.replay.snapshots) {
      if (snap.t <= targetTick) base = snap;
      else break;
    }
    const needRestore = !base
      || base.t !== this.tick
      || (this.state.phase === PHASE.OVER && targetTick < this.tick);
    if (needRestore) {
      if (base) {
        this.state = restoreState(base.state, this.replay.arena, this.replay.rules);
        this.tick = base.t;
      } else {
        this.state = createMatch(this.replay.arena, this.replay.rules, this.replay.seed);
        this.tick = 0;
      }
    }
    while (this.tick < targetTick) this.advance();
    return this.state;
  }

  advance() {
    if (this.tick >= this.tickCount) return this.state;
    const i = this.tick * 2;
    step(this.state, [this.inputs[i], this.inputs[i + 1]]);
    this.tick++;
    return this.state;
  }

  // 重算离 targetTick 最近的快照，比对录制时哈希；
  // 校验前后都把播放位置恢复到 targetTick，不影响画面。
  verifyNear(targetTick) {
    let base = null;
    for (const snap of this.replay.snapshots) {
      if (snap.t <= targetTick) base = snap;
      else break;
    }
    if (!base) return null;
    const saved = this.tick;
    const state = this.seekTo(base.t);
    const ok = hashState(state) === base.state.h;
    this.seekTo(saved);
    return { t: base.t, ok };
  }
}

// ---------------- 快照序列化 ----------------

// 快照必须无损：所有 double 原样存储。
// 这里看似“冗长”，但快进恢复后要逐 bit 等价地继续模拟，
// 任何四舍五入都会经碰撞解算放大成可见分叉。
function snapshotData(state) {
  return {
    tick: state.tick,
    phase: state.phase,
    rng: state.rng,
    players: state.players.map((p) => ({
      x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      fx: p.facingX, fy: p.facingY,
      hp: p.hp, a: p.alive ? 1 : 0,
      im: p.immuneMs, st: p.stunMs,
      cd: p.attackCooldownMs, aa: p.attackActiveMs,
      rs: p.respawnMs, s: p.score,
    })),
    points: state.points.map((pt) => ({
      o: pt.owner, c: pt.contender, p: pt.progressMs,
    })),
  };
}

function serializeState(state) {
  const data = snapshotData(state);
  return { ...data, h: hashData(data) };
}

function restoreState(saved, arena, rules) {
  const state = createMatch(arena, rules, undefined);
  state.events = [];
  state.tick = saved.tick;
  state.phase = saved.phase;
  state.rng = saved.rng;
  state.players.forEach((p, i) => {
    const sp = saved.players[i];
    p.x = sp.x; p.y = sp.y; p.vx = sp.vx; p.vy = sp.vy;
    p.facingX = sp.fx; p.facingY = sp.fy;
    p.hp = sp.hp; p.alive = !!sp.a;
    p.immuneMs = sp.im; p.stunMs = sp.st;
    p.attackCooldownMs = sp.cd; p.attackActiveMs = sp.aa;
    p.respawnMs = sp.rs; p.score = sp.s;
    p.attackHitIds = [];
  });
  state.points.forEach((pt, i) => {
    const sp = saved.points[i];
    pt.owner = sp.o; pt.contender = sp.c; pt.progressMs = sp.p;
  });
  return state;
}

// FNV-1a 校验哈希：重放出的状态必须和录制时逐字段一致。
export function hashState(state) {
  return hashData(snapshotData(state));
}

function hashData(data) {
  const str = JSON.stringify(data);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------------- 输入编码：Uint16 数组 -> base64 ----------------

export function encodeInputs(flat) {
  const words = new Uint16Array(flat);
  const bytes = new Uint8Array(words.buffer);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const len = words.length >>> 0;
  const head = String.fromCharCode(len & 255, (len >> 8) & 255,
    (len >> 16) & 255, (len >>> 24) & 255);
  return btoa(head) + btoa(bin);
}

export function decodeInputs(str) {
  const lenBin = atob(str.slice(0, 8));
  const len = lenBin.charCodeAt(0) | (lenBin.charCodeAt(1) << 8)
    | (lenBin.charCodeAt(2) << 16) | (lenBin.charCodeAt(3) << 24);
  const bin = atob(str.slice(8));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const words = new Uint16Array(bytes.buffer);
  return Array.from(words.subarray(0, len));
}

// ---------------- 事件压缩 ----------------

function compactEvent(ev) {
  switch (ev.type) {
    case 'start': return ['start', ev.t, ev.seed];
    case 'go': return ['go', ev.t];
    case 'swing': return ['swing', ev.t, ev.team];
    case 'hit': return ['hit', ev.t, ev.team, ev.hp];
    case 'kill': return ['kill', ev.t, ev.team, ev.victim];
    case 'respawn': return ['respawn', ev.t, ev.team];
    case 'capture': return ['capture', ev.t, ev.team, ev.point];
    case 'score': return ['score', ev.t, ev.s[0], ev.s[1]];
    case 'end': return ['end', ev.t, ev.s[0], ev.s[1]];
    default: return ['unknown', ev.t];
  }
}

export function expandEvent(row) {
  const [type, t] = row;
  const ev = { type, t };
  switch (type) {
    case 'start': ev.seed = row[2]; break;
    case 'swing': ev.team = row[2]; break;
    case 'hit': ev.team = row[2]; ev.hp = row[3]; break;
    case 'kill': ev.team = row[2]; ev.victim = row[3]; break;
    case 'respawn': ev.team = row[2]; break;
    case 'capture': ev.team = row[2]; ev.point = row[3]; break;
    case 'score': ev.s = [row[2], row[3]]; break;
    case 'end': ev.s = [row[2], row[3]]; break;
  }
  return ev;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}