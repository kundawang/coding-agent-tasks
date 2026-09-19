// 加载 samples/ 下的 arena.json 与 rules.json，只做简单校验与归一化。

export async function loadConfig() {
  const [arena, rules] = await Promise.all([
    fetch('samples/arena.json', { cache: 'no-store' }).then((r) => r.json()),
    fetch('samples/rules.json', { cache: 'no-store' }).then((r) => r.json()),
  ]);
  return { arena: normalizeArena(arena), rules: normalizeRules(rules) };
}

function normalizeArena(raw) {
  return {
    id: String(raw.id ?? 'arena'),
    width: Number(raw.width),
    height: Number(raw.height),
    obstacles: (raw.obstacles ?? []).map((o) => o.map(Number)),
    points: (raw.points ?? []).map((p) => ({ id: String(p.id), x: Number(p.x), y: Number(p.y) })),
    spawns: {
      p1: raw.spawns.p1.map(Number),
      p2: raw.spawns.p2.map(Number),
    },
  };
}

function normalizeRules(raw) {
  return {
    tickRate: Math.max(1, Math.floor(Number(raw.tickRate))),
    matchMs: Number(raw.matchMs),
    captureRadius: Number(raw.captureRadius),
    captureMs: Number(raw.captureMs),
    scorePerSecond: Number(raw.scorePerSecond),
    speed: Number(raw.speed),
    spawnImmunityMs: Number(raw.spawnImmunityMs),
  };
}
