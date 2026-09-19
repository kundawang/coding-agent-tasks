// 纯渲染：把某一时刻的模拟状态画到 Canvas。不推进逻辑、不改状态。

import { PLAYER_RADIUS } from './sim.js';

export const COLORS = ['#e74c3c', '#3498db'];

export function drawFrame(ctx, match, opts = {}) {
  const { width, height, obstacles } = match.arena;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = '#10161f';
  ctx.fillRect(0, 0, width, height);

  // 网格
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 40; x < width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 40; y < height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  for (const [ox, oy, ow, oh] of obstacles) {
    roundRect(ctx, ox, oy, ow, oh, 6);
    ctx.fillStyle = '#3b4759';
    ctx.fill();
    ctx.strokeStyle = '#5a6b84';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (const point of match.points) drawPoint(ctx, match, point);
  for (let i = 0; i < 2; i++) drawPlayer(ctx, match, i);

  if (opts.caption) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, width, 28);
    ctx.fillStyle = '#d7e3f4';
    ctx.font = '15px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.caption, width / 2, 15);
  }
}

function drawPoint(ctx, match, point) {
  const r = match.rules.captureRadius;
  const ownerColor = point.owner === null ? 'rgba(255,255,255,0.10)' : COLORS[point.owner] + '33';
  ctx.beginPath();
  ctx.arc(point.x, point.y, r, 0, Math.PI * 2);
  ctx.fillStyle = ownerColor;
  ctx.fill();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = point.owner === null ? '#7f8ea3' : COLORS[point.owner];
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  // 占领进度环
  if (point.contender !== null && point.progress > 0) {
    const frac = Math.min(1, point.progress / match.rules.captureMs);
    ctx.beginPath();
    ctx.arc(point.x, point.y, r - 8, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.strokeStyle = COLORS[point.contender];
    ctx.lineWidth = 5;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(point.x, point.y, 16, 0, Math.PI * 2);
  ctx.fillStyle = point.owner === null ? '#222c3a' : COLORS[point.owner];
  ctx.fill();
  ctx.strokeStyle = '#d7e3f4';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#f2f6fc';
  ctx.font = 'bold 16px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(point.id, point.x, point.y + 1);
}

function drawPlayer(ctx, match, index) {
  const p = match.players[index];
  if (!p.alive) return;
  const color = COLORS[index];

  if (p.immunityTicks > 0) {
    const blink = Math.floor(match.tick / 3) % 2 === 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_RADIUS + 6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(250, 220, 90, 0.12)';
    ctx.fill();
    ctx.strokeStyle = blink ? '#fadc5a' : 'rgba(250, 220, 90, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(p.x, p.y, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 朝向小标记
  if (p.vx !== 0 || p.vy !== 0) {
    const len = Math.hypot(p.vx, p.vy);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + (p.vx / len) * (PLAYER_RADIUS - 4), p.y + (p.vy / len) * (PLAYER_RADIUS - 4));
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px ui-monospace, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(index === 0 ? 'P1' : 'P2', p.x, p.y - PLAYER_RADIUS - 8);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
