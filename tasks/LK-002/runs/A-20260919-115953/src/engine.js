import { createRng } from './rng.js';

export const TICK_MS = 1000 / 60;
export const TICK_SECONDS = 1 / 60;
export const WORLD_WIDTH = 480;
export const WORLD_HEIGHT = 720;

export const INPUT_DOWN = 1;
export const INPUT_UP = 2;
export const INPUT_LEFT = 4;
export const INPUT_RIGHT = 8;
export const INPUT_SHOOT = 16;

export const ENEMY_FAN = 0;
export const ENEMY_AIMED = 1;
export const ENEMY_RING = 2;
export const ENEMY_SPIRAL = 3;

export const BULLET_COLORS = ['#58D7FF', '#FF5C8A', '#FFD166', '#B98CFF'];
export const BULLET_RADII = [5, 4.5, 5, 4.5];

const ENEMY_KINDS = { fan: 0, aimed: 1, ring: 2, spiral: 3 };
const ENEMY_COOLDOWNS = [130, 105, 170, 5];
const ENEMY_JITTER = [0.075, 0.05, 0.045, 0.035];
const DEFAULT_BULLET_CAPACITY = 65536;
const PLAYER_BULLET_CAPACITY = 4096;
const ENEMY_CAPACITY = 256;
const PLAYER_INVINCIBLE_TICKS = 150;
const PLAYER_BULLET_SPEED = 620;

export function createSimulation({ stage, ship, seed, bulletCapacity = DEFAULT_BULLET_CAPACITY }) {
  if (!stage || !Array.isArray(stage.waves)) throw new Error('stage.waves must be an array');
  if (!ship) throw new Error('ship parameters are required');

  const rng = createRng(seed);
  const waves = stage.waves.map((wave, index) => ({ ...wave, index }))
    .sort((left, right) => left.at - right.at);
  const endTick = Math.ceil(stage.durationMs / TICK_MS);
  const bullets = createEntityArrays(bulletCapacity, [
    ['x', Float32Array], ['y', Float32Array],
    ['prevX', Float32Array], ['prevY', Float32Array],
    ['vx', Float32Array], ['vy', Float32Array],
    ['radius', Float32Array], ['kind', Uint8Array],
  ]);
  const playerBullets = createEntityArrays(PLAYER_BULLET_CAPACITY, [
    ['x', Float32Array], ['y', Float32Array],
    ['prevX', Float32Array], ['prevY', Float32Array],
    ['vy', Float32Array],
  ]);
  const enemies = createEntityArrays(ENEMY_CAPACITY, [
    ['x', Float32Array], ['y', Float32Array],
    ['prevX', Float32Array], ['prevY', Float32Array],
    ['targetX', Float32Array], ['targetY', Float32Array],
    ['hp', Float32Array], ['maxHp', Float32Array], ['count', Uint16Array],
    ['spreadRad', Float32Array], ['speed', Float32Array],
    ['baseAngle', Float32Array], ['age', Float32Array],
    ['nextFire', Float32Array], ['kind', Uint8Array],
  ]);

  return {
    stage, ship, seed: String(seed), rng,
    tick: 0, timeMs: 0, endTick, waveCursor: 0, waves,
    input: 0, score: 0, lives: ship.lives, status: 'playing',
    player: {
      x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT * 0.82,
      prevX: WORLD_WIDTH * 0.5, prevY: WORLD_HEIGHT * 0.82,
      shootClock: 0, invincible: 0,
    },
    bullets, playerBullets, enemies,
    stats: { fired: 0, killed: 0, maxBullets: 0 },
  };
}

export function step(sim, input = sim.input) {
  if (sim.status !== 'playing') {
    sim.input = input;
    return sim;
  }

  sim.input = input;
  copyPlayerPrevious(sim);
  copyEntityPrevious(sim.enemies);
  copyEntityPrevious(sim.bullets);
  copyEntityPrevious(sim.playerBullets);
  spawnScheduledWaves(sim);
  movePlayer(sim);
  updateEnemies(sim);
  moveBullets(sim.bullets);
  movePlayerBullets(sim);
  cullEntities(sim);
  updatePlayerShots(sim);
  collidePlayerShots(sim);
  collidePlayer(sim);

  sim.tick += 1;
  sim.timeMs = sim.tick * TICK_MS;
  if (sim.tick >= sim.endTick) sim.status = sim.lives > 0 ? 'cleared' : 'gameover';
  return sim;
}

function createEntityArrays(capacity, definitions) {
  const store = { capacity, count: 0 };
  for (const [name, TypedArray] of definitions) store[name] = new TypedArray(capacity);
  return store;
}

function copyPlayerPrevious(sim) {
  sim.player.prevX = sim.player.x;
  sim.player.prevY = sim.player.y;
}

function copyEntityPrevious(entities) {
  for (let index = 0; index < entities.count; index += 1) {
    entities.prevX[index] = entities.x[index];
    entities.prevY[index] = entities.y[index];
  }
}

function spawnScheduledWaves(sim) {
  const atMs = sim.tick * TICK_MS;
  while (sim.waveCursor < sim.waves.length && sim.waves[sim.waveCursor].at <= atMs) {
    spawnEnemy(sim, sim.waves[sim.waveCursor]);
    sim.waveCursor += 1;
  }
}

function spawnEnemy(sim, wave) {
  const enemies = sim.enemies;
  if (enemies.count >= enemies.capacity) return;
  const kind = ENEMY_KINDS[wave.kind];
  if (kind === undefined) throw new Error(`unknown wave kind: ${wave.kind}`);

  const index = enemies.count;
  const targetX = clamp(wave.from[0] * WORLD_WIDTH, 28, WORLD_WIDTH - 28);
  const targetY = wave.from[1] <= 0
    ? 76
    : clamp(wave.from[1] * WORLD_HEIGHT, 52, WORLD_HEIGHT * 0.45);

  enemies.x[index] = targetX;
  enemies.y[index] = -36;
  enemies.prevX[index] = targetX;
  enemies.prevY[index] = -36;
  enemies.targetX[index] = targetX;
  enemies.targetY[index] = targetY;
  enemies.hp[index] = wave.hp;
  enemies.maxHp[index] = wave.hp;
  enemies.count[index] = wave.count;
  enemies.spreadRad[index] = (wave.spreadDeg ?? 0) * Math.PI / 180;
  enemies.speed[index] = wave.speed;
  enemies.kind[index] = kind;
  enemies.age[index] = 0;
  enemies.baseAngle[index] = sim.rng.next() * Math.PI * 2;
  enemies.nextFire[index] = ENEMY_COOLDOWNS[kind] * (0.85 + sim.rng.next() * 0.3);
  enemies.count += 1;
}

function movePlayer(sim) {
  const player = sim.player;
  let moveX = 0;
  let moveY = 0;
  if (sim.input & INPUT_LEFT) moveX -= 1;
  if (sim.input & INPUT_RIGHT) moveX += 1;
  if (sim.input & INPUT_UP) moveY -= 1;
  if (sim.input & INPUT_DOWN) moveY += 1;
  if (moveX !== 0 && moveY !== 0) {
    const inverseDiagonal = 1 / Math.sqrt(2);
    moveX *= inverseDiagonal;
    moveY *= inverseDiagonal;
  }

  player.x = clamp(player.x + moveX * sim.ship.speed * TICK_SECONDS, 10, WORLD_WIDTH - 10);
  player.y = clamp(player.y + moveY * sim.ship.speed * TICK_SECONDS, 16, WORLD_HEIGHT - 18);
  if (player.invincible > 0) player.invincible -= 1;
}

function updateEnemies(sim) {
  const enemies = sim.enemies;
  for (let index = 0; index < enemies.count; index += 1) {
    enemies.age[index] += TICK_MS;
    if (enemies.y[index] < enemies.targetY[index]) {
      enemies.y[index] = Math.min(enemies.targetY[index], enemies.y[index] + 115 * TICK_SECONDS);
    }
    if (enemies.age[index] >= enemies.nextFire[index]) {
      fireEnemyPattern(sim, index);
      const kind = enemies.kind[index];
      enemies.baseAngle[index] += kind === ENEMY_SPIRAL ? 0.34 : 0.22;
      const jitter = ENEMY_JITTER[kind];
      enemies.nextFire[index] = enemies.age[index]
        + ENEMY_COOLDOWNS[kind] * (1 - jitter + sim.rng.next() * jitter * 2);
    }
  }
}

function fireEnemyPattern(sim, enemyIndex) {
  const enemies = sim.enemies;
  const kind = enemies.kind[enemyIndex];
  const count = enemies.count[enemyIndex];
  const originX = enemies.x[enemyIndex];
  const originY = enemies.y[enemyIndex];
  const speed = enemies.speed[enemyIndex];
  const baseAngle = enemies.baseAngle[enemyIndex];
  const spread = enemies.spreadRad[enemyIndex];

  if (kind === ENEMY_SPIRAL) {
    emitEnemyBullet(sim, originX, originY, baseAngle, speed, kind);
    return;
  }

  let centerAngle;
  if (kind === ENEMY_AIMED) {
    centerAngle = Math.atan2(sim.player.y - originY, sim.player.x - originX);
  } else if (kind === ENEMY_FAN) {
    centerAngle = Math.PI / 2;
  } else {
    centerAngle = baseAngle;
  }

  const startAngle = centerAngle - spread / 2;
  const denominator = count > 1 ? count - 1 : 1;
  for (let bulletIndex = 0; bulletIndex < count; bulletIndex += 1) {
    const fraction = count > 1 ? bulletIndex / denominator : 0.5;
    const jitter = (sim.rng.next() - 0.5) * ENEMY_JITTER[kind];
    emitEnemyBullet(
      sim, originX, originY,
      startAngle + spread * fraction + jitter,
      speed * (0.97 + sim.rng.next() * 0.06),
      kind,
    );
  }
}

function emitEnemyBullet(sim, x, y, angle, speed, kind) {
  const bullets = sim.bullets;
  if (bullets.count >= bullets.capacity) return;
  const index = bullets.count;
  bullets.x[index] = x;
  bullets.y[index] = y;
  bullets.prevX[index] = x;
  bullets.prevY[index] = y;
  bullets.vx[index] = Math.cos(angle) * speed;
  bullets.vy[index] = Math.sin(angle) * speed;
  bullets.radius[index] = BULLET_RADII[kind];
  bullets.kind[index] = kind;
  bullets.count += 1;
  sim.stats.fired += 1;
}

function moveBullets(bullets) {
  for (let index = 0; index < bullets.count; index += 1) {
    bullets.x[index] += bullets.vx[index] * TICK_SECONDS;
    bullets.y[index] += bullets.vy[index] * TICK_SECONDS;
  }
}

function movePlayerBullets(sim) {
  const bullets = sim.playerBullets;
  for (let index = 0; index < bullets.count; index += 1) {
    bullets.y[index] += bullets.vy[index] * TICK_SECONDS;
  }
}

function cullEntities(sim) {
  cullOffscreen(sim.bullets, 40);
  cullVertical(sim.playerBullets, 24);
  if (sim.bullets.count > sim.stats.maxBullets) sim.stats.maxBullets = sim.bullets.count;
}

function cullOffscreen(bullets, margin) {
  let index = 0;
  while (index < bullets.count) {
    const x = bullets.x[index];
    const y = bullets.y[index];
    if (x < -margin || x > WORLD_WIDTH + margin || y < -margin || y > WORLD_HEIGHT + margin) {
      removeEntity(bullets, index);
    } else {
      index += 1;
    }
  }
}

function cullVertical(bullets, margin) {
  let index = 0;
  while (index < bullets.count) {
    if (bullets.y[index] < -margin) removeEntity(bullets, index);
    else index += 1;
  }
}

function updatePlayerShots(sim) {
  const player = sim.player;
  if (!(sim.input & INPUT_SHOOT)) {
    player.shootClock = 0;
    return;
  }
  player.shootClock += TICK_MS;
  while (player.shootClock >= sim.ship.shotIntervalMs) {
    player.shootClock -= sim.ship.shotIntervalMs;
    emitPlayerBullet(sim, player.x - 8, player.y - 18);
    emitPlayerBullet(sim, player.x + 8, player.y - 18);
  }
}

function emitPlayerBullet(sim, x, y) {
  const bullets = sim.playerBullets;
  if (bullets.count >= bullets.capacity) return;
  const index = bullets.count;
  bullets.x[index] = x;
  bullets.y[index] = y;
  bullets.prevX[index] = x;
  bullets.prevY[index] = y;
  bullets.vy[index] = -PLAYER_BULLET_SPEED;
  bullets.count += 1;
}

function collidePlayerShots(sim) {
  const shots = sim.playerBullets;
  const enemies = sim.enemies;
  let shotIndex = 0;
  while (shotIndex < shots.count) {
    const shotX = shots.x[shotIndex];
    const shotY = shots.y[shotIndex];
    let hit = false;

    let enemyIndex = 0;
    while (enemyIndex < enemies.count) {
      const dx = shotX - enemies.x[enemyIndex];
      const dy = shotY - enemies.y[enemyIndex];
      if (dx * dx + dy * dy <= 18 * 18) {
        enemies.hp[enemyIndex] -= sim.ship.shotDamage;
        if (enemies.hp[enemyIndex] <= 0) {
          sim.score += 100;
          sim.stats.killed += 1;
          removeEntity(enemies, enemyIndex);
        } else {
          enemyIndex += 1;
        }
        hit = true;
        break;
      }
      enemyIndex += 1;
    }

    if (hit) removeEntity(shots, shotIndex);
    else shotIndex += 1;
  }
}

function collidePlayer(sim) {
  const player = sim.player;
  if (player.invincible > 0 || sim.lives <= 0) return;

  const hitRadius = sim.ship.hitRadius;
  const enemyBullets = sim.bullets;
  for (let index = 0; index < enemyBullets.count; index += 1) {
    const dx = enemyBullets.x[index] - player.x;
    const dy = enemyBullets.y[index] - player.y;
    const collisionRadius = hitRadius + enemyBullets.radius[index];
    if (dx * dx + dy * dy <= collisionRadius * collisionRadius) {
      hitPlayer(sim);
      return;
    }
  }

  const enemies = sim.enemies;
  for (let index = 0; index < enemies.count; index += 1) {
    const dx = enemies.x[index] - player.x;
    const dy = enemies.y[index] - player.y;
    const collisionRadius = hitRadius + 18;
    if (dx * dx + dy * dy <= collisionRadius * collisionRadius) {
      hitPlayer(sim);
      return;
    }
  }
}

function hitPlayer(sim) {
  sim.lives -= 1;
  sim.bullets.count = 0;
  sim.player.x = WORLD_WIDTH * 0.5;
  sim.player.y = WORLD_HEIGHT * 0.82;
  sim.player.prevX = sim.player.x;
  sim.player.prevY = sim.player.y;

  if (sim.lives <= 0) {
    sim.lives = 0;
    sim.status = 'gameover';
    return;
  }
  sim.player.invincible = PLAYER_INVINCIBLE_TICKS;
}

function removeEntity(entities, index) {
  const last = entities.count - 1;
  if (index !== last) {
    for (const key of Object.keys(entities)) {
      if (key === 'count' || key === 'capacity') continue;
      entities[key][index] = entities[key][last];
    }
  }
  entities.count = last;
}

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
