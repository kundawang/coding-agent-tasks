// samples/*.json 原样加载，本游戏不改它们。

export async function loadConfig() {
  const [arenaRes, rulesRes] = await Promise.all([
    fetch('./samples/arena.json'),
    fetch('./samples/rules.json'),
  ]);
  if (!arenaRes.ok || !rulesRes.ok) {
    throw new Error('读取 samples/arena.json 或 samples/rules.json 失败，请用静态服务器打开');
  }
  const arena = await arenaRes.json();
  const rules = await rulesRes.json();
  validate(arena, rules);
  return { arena, rules };
}

function validate(arena, rules) {
  for (const key of ['width', 'height', 'obstacles', 'points', 'spawns']) {
    if (!(key in arena)) throw new Error(`arena.json 缺字段: ${key}`);
  }
  for (const key of ['tickRate', 'matchMs', 'captureRadius', 'captureMs',
    'scorePerSecond', 'speed', 'spawnImmunityMs']) {
    if (!(key in rules)) throw new Error(`rules.json 缺字段: ${key}`);
  }
}

// 以下是 samples 未给出的战斗常量（README 有说明），
// 全部写死、确定性，不随帧率变化。
export const COMBAT = {
  maxHp: 3,               // 挨 3 下倒下
  attackReach: 52,        // 攻击距离（从圆心算起）
  attackArc: Math.PI / 4, // 攻击扇形半角（共约 90 度）
  attackCooldownMs: 450,
  attackActiveMs: 140,    // 出伤害的判定窗口
  respawnMs: 1200,
  playerRadius: 18,
  knockback: 260,         // 被击退后初始速度 px/s
  knockbackStunMs: 260,   // 击退硬直
  knockbackDrag: 6.0,     // 击退速度衰减系数
  countdownMs: 3000,      // 开局倒计时
};

// 输入位掩码（每个玩家一个 16 位整数，直接进回放）
export const INPUT = {
  UP: 1 << 0,
  DOWN: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  ATTACK: 1 << 4,
};