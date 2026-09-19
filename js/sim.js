// 纯确定性模拟：不读真实时间、不用 Math.random、不碰 DOM。
// 所有随机只走种子 PRNG（mulberry32），同种子 + 同输入序列必得同结果。

export const INPUT = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8 };

// 手感常量（samples 里没有，固定写死并在 README 记录）。
export const PLAYER_RADIUS = 16;
const SPAWN_JITTER = 12; // 出生点随机抖动半径（像素），避免每局完全重合

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createMatch(arena, rules, seed) {
  const tickMs = 1000 / rules.tickRate;
  const totalTicks = Math.round(rules.matchMs / tickMs);
  const match = {
    arena,
    rules,
    seed: seed >>> 0,
    tickMs,
    totalTicks,
    tick: 0, // 已完成的逻辑步数
    rand: mulberry32(seed >>> 0),
    players: [null, null],
    points: arena.points.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      progress: 0, // 当前正在累积的占领毫秒数
      contender: null, // 正在占领的玩家索引（0/1），争夺中为 null
      owner: null,
    })),
    score: [0, 0],
    status: 'running', // running | finished
    winner: null, // null | 0 | 1 | 'draw'
    events: [],
  };
  for (let i = 0; i < 2; i++) match.players[i] = spawnPlayer(match, i, -1);
  return match;
}

function spawnPlayer(match, index, deathTick) {
  const [sx, sy] = match.arena.spawns[index === 0 ? 'p1' : 'p2'];
  let x = sx;
  let y = sy;
  // 最多试 8 次抖动位置，都不合法就用精确出生点。
  for (let attempt = 0; attempt < 8; attempt++) {
    const jx = (match.rand() * 2 - 1) * SPAWN_JITTER;
    const jy = (match.rand() * 2 - 1) * SPAWN_JITTER;
    const nx = sx + jx;
    const ny = sy + jy;
    if (positionFree(match, nx, ny)) {
      x = nx;
      y = ny;
      break;
    }
  }
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    alive: true,
    immunityTicks: Math.ceil(match.rules.spawnImmunityMs / match.tickMs),
    deathTick,
  };
}

function positionFree(match, x, y) {
  const r = PLAYER_RADIUS;
  const { width, height, obstacles } = match.arena;
  if (x - r < 0 || y - r < 0 || x + r > width || y + r > height) return false;
  for (const [ox, oy, ow, oh] of obstacles) {
    if (circleHitsRect(x, y, r, ox, oy, ow, oh)) return false;
  }
  return true;
}

function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

function canStand(match, self, x, y) {
  if (!positionFree(match, x, y)) return false;
  const other = match.players[self ^ 1];
  if (other && other.alive) {
    const dx = x - other.x;
    const dy = y - other.y;
    if (dx * dx + dy * dy < (2 * PLAYER_RADIUS) * (2 * PLAYER_RADIUS)) return false;
  }
  return true;
}

function movePlayer(match, index, mask) {
  const p = match.players[index];
  if (!p.alive) {
    p.vx = 0;
    p.vy = 0;
    return;
  }
  let dx = 0;
  let dy = 0;
  if (mask & INPUT.UP) dy -= 1;
  if (mask & INPUT.DOWN) dy += 1;
  if (mask & INPUT.LEFT) dx -= 1;
  if (mask & INPUT.RIGHT) dx += 1;
  if (dx !== 0 && dy !== 0) {
    const inv = 1 / Math.sqrt(2);
    dx *= inv;
    dy *= inv;
  }
  const step = (match.rules.speed * match.tickMs) / 1000;
  p.vx = dx * step;
  p.vy = dy * step;
  // 分轴移动：撞墙/撞人时沿另一轴滑动。
  if (dx !== 0 && canStand(match, index, p.x + p.vx, p.y)) p.x += p.vx;
  if (dy !== 0 && canStand(match, index, p.x, p.y + p.vy)) p.y += p.vy;
}

function resolveContact(match) {
  const a = match.players[0];
  const b = match.players[1];
  if (!a.alive || !b.alive) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // 硬碰撞让两人最近只能贴到 2r，且一 tick 最多逼近一个步长（4px）。
  // 容差取 2r + 2.5：移动中逼近的一击必触发，静止时只在圆真正重叠
  // 超过 2.5px 才算接触。
  const touch = 2 * PLAYER_RADIUS + 2.5;
  if (dx * dx + dy * dy > touch * touch) return;

  const aImmune = a.immunityTicks > 0;
  const bImmune = b.immunityTicks > 0;
  let killer = null;
  let victims = [];
  if (!aImmune && !bImmune) {
    victims = [0, 1];
  } else if (aImmune && !bImmune) {
    victims = [1];
    killer = 0;
  } else if (!aImmune && bImmune) {
    victims = [0];
    killer = 1;
  }
  // 双无敌：只被身体挡住，不出命。
  for (const v of victims) {
    const p = match.players[v];
    p.alive = false;
    p.vx = 0;
    p.vy = 0;
    p.deathTick = match.tick;
    p.immunityTicks = 0;
    match.events.push({
      type: 'kill',
      tick: match.tick,
      victim: v,
      killer: killer === v ? null : killer,
      x: p.x,
      y: p.y,
    });
    // 立刻在出生点复活（下一行移动判定前仍是同一 tick）。
    match.players[v] = spawnPlayer(match, v, match.tick);
    match.events.push({
      type: 'spawn',
      tick: match.tick,
      player: v,
      x: match.players[v].x,
      y: match.players[v].y,
    });
  }
}

function updateCaptures(match) {
  const inside = [
    playerInsidePoint(match, 0),
    playerInsidePoint(match, 1),
  ];
  for (const point of match.points) {
    const p0 = inside[0].has(point);
    const p1 = inside[1].has(point);
    if (p0 && p1) {
      // 争夺：进度冻结、不改变占领者候选，人走后继续涨。
      continue;
    }
    if (!p0 && !p1) {
      point.progress = 0;
      point.contender = null;
      continue;
    }
    const who = p0 ? 0 : 1;
    if (point.owner === who) {
      // 自家据点上站着：进度无意义。
      point.progress = 0;
      point.contender = null;
      continue;
    }
    // 不是同一个占领者在连续累积（换人、或之前没人）→ 从头算。
    if (point.contender !== who) point.progress = 0;
    point.contender = who;
    point.progress += match.tickMs;
    if (point.progress + 1e-9 >= match.rules.captureMs) {
      point.owner = who;
      point.progress = 0;
      point.contender = null;
      match.events.push({
        type: 'capture',
        tick: match.tick,
        point: point.id,
        owner: who,
        score: [match.score[0], match.score[1]],
      });
    }
  }
}

function playerInsidePoint(match, index) {
  const p = match.players[index];
  const set = new Set();
  if (!p.alive) return set;
  const r2 = match.rules.captureRadius * match.rules.captureRadius;
  for (const point of match.points) {
    const dx = p.x - point.x;
    const dy = p.y - point.y;
    if (dx * dx + dy * dy <= r2) set.add(point);
  }
  return set;
}

function awardScore(match) {
  const gain = (match.rules.scorePerSecond * match.tickMs) / 1000;
  for (const point of match.points) {
    if (point.owner === 0 || point.owner === 1) match.score[point.owner] += gain;
  }
}

// 推进一步。inputs = [p1Mask, p2Mask]，由外部（实时键盘或回放）提供。
export function step(match, inputs) {
  if (match.status !== 'running') return;
  match.tick += 1;
  for (let i = 0; i < 2; i++) {
    const p = match.players[i];
    if (p.immunityTicks > 0) p.immunityTicks -= 1;
  }
  movePlayer(match, 0, (inputs[0] | 0) & 0b1111);
  movePlayer(match, 1, (inputs[1] | 0) & 0b1111);
  resolveContact(match);
  updateCaptures(match);
  awardScore(match);
  if (match.tick >= match.totalTicks) {
    match.status = 'finished';
    match.winner =
      match.score[0] > match.score[1] ? 0 : match.score[1] > match.score[0] ? 1 : 'draw';
    match.events.push({
      type: 'result',
      tick: match.tick,
      score: [match.score[0], match.score[1]],
      winner: match.winner,
    });
  }
}

// 不推进、只把模拟跑到第 targetTick 步（回放拖动用）。
export function seekTo(match, targetTick, inputAt) {
  while (match.tick < targetTick && match.status === 'running') {
    step(match, inputAt(match.tick + 1));
  }
}
