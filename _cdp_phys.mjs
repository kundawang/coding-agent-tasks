import { createMatch, step, PLAYER_RADIUS as R } from './js/sim.js';
import { readFileSync } from 'node:fs';

const arena = JSON.parse(readFileSync('samples/arena.json', 'utf8'));
const rules = JSON.parse(readFileSync('samples/rules.json', 'utf8'));

function circleRectHit(cx, cy, r, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r - 1e-9;
}

let wallViolations = 0;
let playerOverlaps = 0;
let contactKills = 0;

// 多组不同种子 + 不同走位模式，跑完整局
for (const seed of [1, 2, 7, 42, 999, 2024]) {
  const m = createMatch(arena, rules, seed);
  while (m.status === 'running') {
    const t = m.tick;
    const m1 = [1, 2, 4, 8, 5, 10, 0][(t + seed) % 7];
    const m2 = [8, 4, 2, 1, 10, 5, 0][(t * 3 + seed) % 7];
    step(m, [m1, m2]);
    for (let i = 0; i < 2; i++) {
      const p = m.players[i];
      if (p.x - R < -1e-6 || p.y - R < -1e-6 || p.x + R > arena.width + 1e-6 || p.y + R > arena.height + 1e-6) {
        wallViolations++;
      }
      for (const [ox, oy, ow, oh] of arena.obstacles) {
        if (circleRectHit(p.x, p.y, R, ox, oy, ow, oh)) wallViolations++;
      }
    }
    const dx = m.players[0].x - m.players[1].x;
    const dy = m.players[0].y - m.players[1].y;
    // 允许接触到 2r+2.5（接触判定），小于 2r 的实质重叠才算穿人
    if (dx * dx + dy * dy < (2 * R) * (2 * R) - 1e-6) playerOverlaps++;
    contactKills += m.events.length;
  }
}

console.log('wall violations:', wallViolations);
console.log('player overlaps (<2r):', playerOverlaps);
console.log('total events over 6 matches:', contactKills);
process.exit(wallViolations === 0 && playerOverlaps === 0 ? 0 : 1);
