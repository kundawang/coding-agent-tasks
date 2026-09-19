// 纯渲染：读 state 画 canvas。绝不推进逻辑。

import { COMBAT } from './config.js';
import { PHASE } from './engine.js';

const TEAM_COLORS = ['#5ea0ff', '#ff6b5e'];

export function render(ctx, state) {
  const { arena } = state;
  drawGrid(ctx, arena);
  for (const point of state.points) drawPoint(ctx, point, state.rules);
  for (const [x, y, w, h] of arena.obstacles) {
    ctx.fillStyle = '#3a4250';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#525d70';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  for (const p of state.players) {
    if (p.alive) drawPlayer(ctx, p, state.tick);
    else drawRespawnTimer(ctx, p);
  }

  if (state.phase === PHASE.COUNTDOWN) drawCountdown(ctx, state);
  if (state.phase === PHASE.OVER) drawEndBanner(ctx, state);
}

function drawGrid(ctx, arena) {
  ctx.fillStyle = '#1b2029';
  ctx.fillRect(0, 0, arena.width, arena.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  for (let x = 40; x < arena.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, arena.height);
    ctx.stroke();
  }
  for (let y = 40; y < arena.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(arena.width, y);
    ctx.stroke();
  }
}

function drawPoint(ctx, point, rules) {
  const color = point.owner === -1 ? '#8b97a8' : TEAM_COLORS[point.owner];

  ctx.beginPath();
  ctx.arc(point.x, point.y, rules.captureRadius, 0, Math.PI * 2);
  ctx.fillStyle = point.owner === -1
    ? 'rgba(255,255,255,0.04)'
    : (point.owner === 0 ? 'rgba(94,160,255,0.10)' : 'rgba(255,107,94,0.10)');
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.setLineDash([8, 6]);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.setLineDash([]);

  // 占领读条
  if (point.contender !== -1 && point.progressMs > 0) {
    const frac = Math.min(1, point.progressMs / rules.captureMs);
    ctx.beginPath();
    ctx.arc(point.x, point.y, rules.captureRadius - 6,
      -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.strokeStyle = TEAM_COLORS[point.contender];
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  ctx.fillStyle = color;
  ctx.font = 'bold 22px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(point.id, point.x, point.y);
}

function drawPlayer(ctx, p, tick) {
  const r = COMBAT.playerRadius;
  const color = TEAM_COLORS[p.team];

  // 出生无敌：闪烁护盾
  if (p.immuneMs > 0) {
    const blink = Math.floor(tick / 6) % 2 === 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
    ctx.strokeStyle = blink ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 攻击扇形（判定窗口内可见）
  if (p.attackActiveMs > 0) {
    const facing = Math.atan2(p.facingY, p.facingX);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, COMBAT.attackReach + r,
      facing - COMBAT.attackArc, facing + COMBAT.attackArc);
    ctx.closePath();
    ctx.fillStyle = p.team === 0 ? 'rgba(94,160,255,0.25)' : 'rgba(255,107,94,0.25)';
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = p.stunMs > 0 ? '#7d8594' : color;
  ctx.fill();
  ctx.strokeStyle = '#0e1117';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 朝向小点
  const tx = p.x + p.facingX * (r - 4);
  const ty = p.y + p.facingY * (r - 4);
  ctx.beginPath();
  ctx.arc(tx, ty, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#0e1117';
  ctx.fill();

  // 名字 + 血条
  ctx.fillStyle = color;
  ctx.font = 'bold 12px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(p.team === 0 ? 'P1' : 'P2', p.x, p.y - r - 16);
  drawHp(ctx, p.x, p.y - r - 10, r * 2, p.hp);
}

function drawHp(ctx, cx, y, width, hp) {
  const segW = (width - 2 * (COMBAT.maxHp - 1)) / COMBAT.maxHp;
  for (let i = 0; i < COMBAT.maxHp; i++) {
    ctx.fillStyle = i < hp ? '#57d18a' : 'rgba(255,255,255,0.15)';
    ctx.fillRect(cx - width / 2 + i * (segW + 2), y, segW, 3);
  }
}

function drawRespawnTimer(ctx, p) {
  const secs = Math.ceil(p.respawnMs / 1000);
  ctx.fillStyle = TEAM_COLORS[p.team];
  ctx.globalAlpha = 0.7;
  ctx.font = 'bold 16px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${p.team === 0 ? 'P1' : 'P2'} ${secs}`, p.x, p.y);
  ctx.globalAlpha = 1;
}

function drawCountdown(ctx, state) {
  const remain = state.countdownTicks - state.tick;
  const secs = Math.ceil(remain / state.rules.tickRate);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, state.arena.width, state.arena.height);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 72px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(secs), state.arena.width / 2, state.arena.height / 2);
}

function drawEndBanner(ctx, state) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, state.arena.width, state.arena.height);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 46px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const [s1, s2] = state.players.map((p) => Math.floor(p.score));
  const text = s1 === s2 ? '平局' : (s1 > s2 ? 'P1 胜' : 'P2 胜');
  ctx.fillText(text, state.arena.width / 2, state.arena.height / 2 - 10);
  ctx.font = '22px Consolas, monospace';
  ctx.fillText(`${s1} : ${s2}`, state.arena.width / 2, state.arena.height / 2 + 40);
}