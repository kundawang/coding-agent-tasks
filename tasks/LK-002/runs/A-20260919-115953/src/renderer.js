import {
  BULLET_COLORS,
  ENEMY_AIMED,
  ENEMY_FAN,
  ENEMY_RING,
  ENEMY_SPIRAL,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './engine.js';

const BULLET_SPRITE_SIZE = 16;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const bulletSprites = BULLET_COLORS.map((color) => createBulletSprite(color));
  const shotSprite = createShotSprite();
  const playerSprite = createPlayerSprite();
  const stars = createStars();

  return {
    render(sim, alpha) {
      drawBackground(ctx, stars, sim.timeMs);
      drawEnemies(ctx, sim, alpha);
      drawPlayerShots(ctx, sim, alpha, shotSprite);
      drawEnemyBullets(ctx, sim, alpha, bulletSprites);
      drawPlayer(ctx, sim, alpha, playerSprite);
    },
  };
}

function createBulletSprite(color) {
  const canvas = document.createElement('canvas');
  canvas.width = BULLET_SPRITE_SIZE;
  canvas.height = BULLET_SPRITE_SIZE;
  const ctx = canvas.getContext('2d');
  const center = BULLET_SPRITE_SIZE / 2;

  const glow = ctx.createRadialGradient(center, center, 0, center, center, 7.5);
  glow.addColorStop(0, 'rgba(255,255,255,0.9)');
  glow.addColorStop(0.28, color);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(center, center, 7.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(center, center, 1.8, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

function createShotSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 26;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 26);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.45, '#9FFBFF');
  gradient.addColorStop(1, '#FFFFFF');
  ctx.fillStyle = gradient;
  ctx.fillRect(3, 0, 2, 26);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(2, 2, 4, 8);
  return canvas;
}

function createPlayerSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  ctx.translate(24, 24);

  ctx.shadowColor = '#4DF7FF';
  ctx.shadowBlur = 12;
  ctx.strokeStyle = '#7CF9FF';
  ctx.fillStyle = 'rgba(35, 132, 190, 0.82)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(13, 12);
  ctx.lineTo(6, 8);
  ctx.lineTo(0, 15);
  ctx.lineTo(-6, 8);
  ctx.lineTo(-13, 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(0, 0, 2.4, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

function createStars() {
  const rows = 46;
  const x = new Float32Array(rows);
  const y = new Float32Array(rows);
  const speed = new Float32Array(rows);
  const size = new Float32Array(rows);
  let state = 0x12345678;
  const random = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    return ((Math.imul(state ^ (state >>> 15), state | 1) >>> 0) % 10000) / 10000;
  };

  for (let index = 0; index < rows; index += 1) {
    x[index] = random() * WORLD_WIDTH;
    y[index] = random() * WORLD_HEIGHT;
    speed[index] = 18 + random() * 70;
    size[index] = random() > 0.82 ? 2 : 1;
  }
  return { x, y, speed, size, count: rows };
}

function drawBackground(ctx, stars, timeMs) {
  ctx.fillStyle = '#050713';
  ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  const timeSeconds = timeMs / 1000;
  ctx.fillStyle = '#9EB7FF';
  for (let index = 0; index < stars.count; index += 1) {
    const y = (stars.y[index] + stars.speed[index] * timeSeconds) % WORLD_HEIGHT;
    ctx.globalAlpha = 0.22 + stars.size[index] * 0.16;
    ctx.fillRect(stars.x[index], y, stars.size[index], stars.size[index] * 2.2);
  }
  ctx.globalAlpha = 1;
}

function drawEnemies(ctx, sim, alpha) {
  const enemies = sim.enemies;
  for (let index = 0; index < enemies.count; index += 1) {
    const x = interpolate(enemies.prevX[index], enemies.x[index], alpha);
    const y = interpolate(enemies.prevY[index], enemies.y[index], alpha);
    drawEnemy(ctx, x, y, enemies.kind[index]);

    const hpRatio = clamp01(enemies.hp[index] / enemies.maxHp[index]);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(x - 16, y - 25, 32, 3);
    ctx.fillStyle = '#FF5C8A';
    ctx.fillRect(x - 16, y - 25, 32 * hpRatio, 3);
  }
}

function drawEnemy(ctx, x, y, kind) {
  const radius = 17;
  const color = BULLET_COLORS[kind];
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = 'rgba(22, 23, 52, 0.94)';
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.beginPath();

  if (kind === ENEMY_FAN) {
    polygon(ctx, 0, 0, radius, 3, Math.PI / 2);
  } else if (kind === ENEMY_AIMED) {
    polygon(ctx, 0, 0, radius, 4, Math.PI / 4);
  } else if (kind === ENEMY_RING) {
    polygon(ctx, 0, 0, radius, 6, 0);
  } else if (kind === ENEMY_SPIRAL) {
    polygon(ctx, 0, 0, radius, 8, Math.PI / 8);
  }

  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function polygon(ctx, x, y, radius, sides, rotation) {
  for (let side = 0; side < sides; side += 1) {
    const angle = rotation + side * Math.PI * 2 / sides;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (side === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawEnemyBullets(ctx, sim, alpha, sprites) {
  const bullets = sim.bullets;
  const half = BULLET_SPRITE_SIZE / 2;
  for (let index = 0; index < bullets.count; index += 1) {
    const x = interpolate(bullets.prevX[index], bullets.x[index], alpha);
    const y = interpolate(bullets.prevY[index], bullets.y[index], alpha);
    ctx.drawImage(sprites[bullets.kind[index]], x - half, y - half);
  }
}

function drawPlayerShots(ctx, sim, alpha, sprite) {
  const bullets = sim.playerBullets;
  for (let index = 0; index < bullets.count; index += 1) {
    const x = interpolate(bullets.prevX[index], bullets.x[index], alpha);
    const y = interpolate(bullets.prevY[index], bullets.y[index], alpha);
    ctx.drawImage(sprite, x - 4, y - 13);
  }
}

function drawPlayer(ctx, sim, alpha, sprite) {
  const player = sim.player;
  if (sim.status === 'gameover') return;
  const x = interpolate(player.prevX, player.x, alpha);
  const y = interpolate(player.prevY, player.y, alpha);

  if (player.invincible > 0 && Math.floor(sim.timeMs / 100) % 2 === 0) {
    ctx.globalAlpha = 0.32;
  }
  ctx.drawImage(sprite, x - 24, y - 24);
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#FF335E';
  ctx.beginPath();
  ctx.arc(x, y, sim.ship.hitRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function interpolate(previous, current, alpha) {
  return previous + (current - previous) * alpha;
}

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
