// 纯逻辑引擎：createMatch + step。
// 唯一的推进方式是 step(state, inputs)，dt 固定 = 1000/tickRate。
// 不读时钟、不读 DOM、不调 Math.random，同输入必出同结果（可逐帧重放）。

import { COMBAT, INPUT } from './config.js';
import { nextRng, hashSeed } from './prng.js';

export const PHASE = { COUNTDOWN: 'countdown', LIVE: 'live', OVER: 'over' };
export const TEAM_NAME = ['p1', 'p2'];

export function createMatch(arena, rules, seedStr) {
  const totalTicks = Math.round(rules.matchMs * rules.tickRate / 1000);
  const countdownTicks = Math.round(COMBAT.countdownMs * rules.tickRate / 1000);
  const state = {
    arena,
    rules,
    tick: 0,
    totalTicks,
    countdownTicks,
    phase: PHASE.COUNTDOWN,
    rng: hashSeed(seedStr || String(Date.now())),
    players: [
      makePlayer(0, arena.spawns.p1, 1),
      makePlayer(1, arena.spawns.p2, -1),
    ],
    points: arena.points.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      owner: -1,
      contender: -1,
      progressMs: 0,
    })),
    events: [],
  };
  pushEvent(state, { type: 'start', seed: seedStr || null });
  return state;
}

function makePlayer(team, spawn, facing) {
  return {
    team,
    x: spawn[0],
    y: spawn[1],
    vx: 0,
    vy: 0,
    facingX: facing,
    facingY: 0,
    hp: COMBAT.maxHp,
    alive: true,
    immuneMs: 0,
    stunMs: 0,
    attackCooldownMs: 0,
    attackActiveMs: 0,
    attackHitIds: [],
    respawnMs: 0,
    score: 0,
  };
}

// inputs: [p1bits, p2bits]
export function step(state, inputs) {
  state.events = [];
  const { rules } = state;
  const dt = 1000 / rules.tickRate;

  if (state.phase === PHASE.OVER) return state;

  if (state.phase === PHASE.COUNTDOWN) {
    state.tick++;
    if (state.tick >= state.countdownTicks) {
      state.phase = PHASE.LIVE;
      pushEvent(state, { type: 'go' });
    }
    return state;
  }

  state.tick++;
  const secs = dt / 1000;
  const isFinalLiveTick = state.tick >= state.totalTicks + state.countdownTicks;

  for (const p of state.players) {
    tickTimers(p, dt);
    if (!p.alive && p.respawnMs <= 0 && !isFinalLiveTick) respawn(state, p);
  }

  for (let i = 0; i < 2; i++) {
    movePlayer(state, state.players[i], inputs[i], dt, secs);
  }
  collidePlayers(state);

  for (let i = 0; i < 2; i++) {
    tryStartAttack(state, state.players[i], inputs[i]);
  }
  resolveAttacks(state);

  for (const point of state.points) tickPoint(state, point, dt, secs);

  if (state.tick % rules.tickRate === 0) {
    pushEvent(state, {
      type: 'score',
      t: state.tick,
      s: [round3(state.players[0].score), round3(state.players[1].score)],
    });
  }

  // 最后一个 live tick 结算完毕即结束，不存在 OVER 冻结 tick。
  if (isFinalLiveTick) {
    state.phase = PHASE.OVER;
    pushEvent(state, {
      type: 'end',
      s: [round3(state.players[0].score), round3(state.players[1].score)],
    });
  }
  return state;
}

function tickTimers(p, dt) {
  if (p.immuneMs > 0) p.immuneMs = Math.max(0, p.immuneMs - dt);
  if (p.stunMs > 0) p.stunMs = Math.max(0, p.stunMs - dt);
  if (p.attackCooldownMs > 0) p.attackCooldownMs = Math.max(0, p.attackCooldownMs - dt);
  if (p.attackActiveMs > 0) {
    p.attackActiveMs = Math.max(0, p.attackActiveMs - dt);
    if (p.attackActiveMs === 0) p.attackHitIds = [];
  }
  if (!p.alive && p.respawnMs > 0) p.respawnMs = Math.max(0, p.respawnMs - dt);
}

function movePlayer(state, p, bits, dt, secs) {
  if (p.alive && p.stunMs <= 0) {
    let dx = 0;
    let dy = 0;
    if (bits & INPUT.UP) dy -= 1;
    if (bits & INPUT.DOWN) dy += 1;
    if (bits & INPUT.LEFT) dx -= 1;
    if (bits & INPUT.RIGHT) dx += 1;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
      p.facingX = dx;
      p.facingY = dy;
    }
    p.x += dx * state.rules.speed * secs;
    p.y += dy * state.rules.speed * secs;
  }

  if (p.vx !== 0 || p.vy !== 0) {
    p.x += p.vx * secs;
    p.y += p.vy * secs;
    const drag = Math.exp(-COMBAT.knockbackDrag * secs);
    p.vx *= drag;
    p.vy *= drag;
    if (Math.hypot(p.vx, p.vy) < 4) {
      p.vx = 0;
      p.vy = 0;
    }
  }

  collideWorld(state, p);
}

// 与地图边界、矩形障碍的碰撞。
function collideWorld(state, p) {
  const r = COMBAT.playerRadius;
  const { width, height } = state.arena;

  p.x = clamp(p.x, r, width - r);
  p.y = clamp(p.y, r, height - r);

  for (const [ox, oy, ow, oh] of state.arena.obstacles) {
    if (!circleRectOverlap(p.x, p.y, r, ox, oy, ow, oh)) continue;
    const nearestX = clamp(p.x, ox, ox + ow);
    const nearestY = clamp(p.y, oy, oy + oh);
    const dx = p.x - nearestX;
    const dy = p.y - nearestY;
    const d2 = dx * dx + dy * dy;
    if (d2 > 0.000001) {
      const d = Math.sqrt(d2);
      const push = r - d;
      p.x += (dx / d) * push;
      p.y += (dy / d) * push;
    } else {
      // 圆心卡进矩形里（极端挤压）：沿穿透最浅的轴弹出
      const left = p.x - ox;
      const rightP = ox + ow - p.x;
      const top = p.y - oy;
      const bottom = oy + oh - p.y;
      const minPen = Math.min(left, rightP, top, bottom);
      if (minPen === left) p.x = ox - r;
      else if (minPen === rightP) p.x = ox + ow + r;
      else if (minPen === top) p.y = oy - r;
      else p.y = oy + oh + r;
    }
  }
}

// 玩家互相是实心圆（无敌中/倒下可穿过），迭代两次消解重叠。
function collidePlayers(state) {
  const a = state.players[0];
  const b = state.players[1];
  for (let iter = 0; iter < 2; iter++) {
    if (!a.alive || !b.alive) return;
    if (a.immuneMs > 0 || b.immuneMs > 0) return;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let dist = Math.hypot(dx, dy);
    const minDist = COMBAT.playerRadius * 2;
    if (dist >= minDist) return;
    if (dist < 0.0001) {
      dx = a.team === 0 ? -1 : 1;
      dy = 0;
      dist = 1;
    }
    const nx = dx / dist;
    const ny = dy / dist;
    const push = (minDist - dist) / 2;
    a.x -= nx * push;
    a.y -= ny * push;
    b.x += nx * push;
    b.y += ny * push;
    collideWorld(state, a);
    collideWorld(state, b);
  }
}

function tryStartAttack(state, p, bits) {
  if (!p.alive || p.stunMs > 0) return;
  if (p.attackCooldownMs > 0 || p.attackActiveMs > 0) return;
  if (!(bits & INPUT.ATTACK)) return;
  p.attackCooldownMs = COMBAT.attackCooldownMs;
  p.attackActiveMs = COMBAT.attackActiveMs;
  p.attackHitIds = [];
  pushEvent(state, { type: 'swing', team: p.team, t: state.tick });
}

function resolveAttacks(state) {
  for (const p of state.players) {
    if (p.attackActiveMs <= 0 || !p.alive) continue;
    const target = state.players[1 - p.team];
    if (!target.alive || target.immuneMs > 0) continue;
    if (p.attackHitIds.includes(target.team)) continue;

    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist > COMBAT.attackReach + COMBAT.playerRadius) continue;
    const angle = Math.atan2(dy, dx);
    const facing = Math.atan2(p.facingY, p.facingX);
    if (angleDiff(angle, facing) > COMBAT.attackArc) continue;

    p.attackHitIds.push(target.team);
    target.hp -= 1;

    // 击退偏角由种子 PRNG 决定（状态写进回放，可重放）。
    const [jitter, next] = nextRng(state.rng);
    state.rng = next;
    const jitterAngle = (jitter - 0.5) * 0.6;
    const ka = angle + jitterAngle;
    target.vx += Math.cos(ka) * COMBAT.knockback;
    target.vy += Math.sin(ka) * COMBAT.knockback;
    target.stunMs = COMBAT.knockbackStunMs;

    pushEvent(state, { type: 'hit', team: p.team, t: state.tick, hp: target.hp });
    if (target.hp <= 0) killPlayer(state, target, p.team);
  }
}

function killPlayer(state, dead, killerTeam) {
  dead.alive = false;
  dead.hp = 0;
  dead.respawnMs = COMBAT.respawnMs;
  dead.vx = 0;
  dead.vy = 0;
  dead.stunMs = 0;
  dead.attackActiveMs = 0;
  dead.attackHitIds = [];
  pushEvent(state, { type: 'kill', team: killerTeam, victim: dead.team, t: state.tick });
}

function respawn(state, p) {
  const spawn = state.arena.spawns[TEAM_NAME[p.team]];
  p.x = spawn[0];
  p.y = spawn[1];
  p.vx = 0;
  p.vy = 0;
  p.hp = COMBAT.maxHp;
  p.alive = true;
  p.immuneMs = state.rules.spawnImmunityMs;
  p.stunMs = 0;
  p.attackCooldownMs = 0;
  p.attackActiveMs = 0;
  p.attackHitIds = [];
  pushEvent(state, { type: 'respawn', team: p.team, t: state.tick });
}

// 据点规则：
// - 圈内只有一方（对方不在圈内）-> 该方读条；读满则占领/易主
// - 双方都在圈内 -> 争夺，读条冻结
// - 没人在圈内 -> 进度保留，回来接着读
function tickPoint(state, point, dt, secs) {
  let p1Inside = false;
  let p2Inside = false;
  for (const p of state.players) {
    if (!p.alive) continue;
    if (Math.hypot(p.x - point.x, p.y - point.y) <= state.rules.captureRadius) {
      if (p.team === 0) p1Inside = true;
      else p2Inside = true;
    }
  }

  let occupant = -1;
  if (p1Inside && !p2Inside) occupant = 0;
  else if (p2Inside && !p1Inside) occupant = 1;

  if (occupant !== -1) {
    if (point.contender === occupant) {
      point.progressMs += dt;
    } else {
      point.contender = occupant;
      point.progressMs = dt;
    }
    if (point.progressMs >= state.rules.captureMs && point.owner !== occupant) {
      point.owner = occupant;
      point.contender = -1;
      point.progressMs = 0;
      pushEvent(state, { type: 'capture', team: occupant, point: point.id, t: state.tick });
    }
  }

  if (point.owner !== -1) {
    state.players[point.owner].score += state.rules.scorePerSecond * secs;
  }
}

export function pushEvent(state, ev) {
  state.events.push(ev);
}

function circleRectOverlap(cx, cy, r, x, y, w, h) {
  const nx = clamp(cx, x, x + w);
  const ny = clamp(cy, y, y + h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

function angleDiff(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}