// localStorage 持久化：校准设置 + 排行榜。导出/导入 JSON 用于群里合并。

const SETTINGS_KEY = 'neon-commute.settings.v1';
const SCORES_KEY = 'neon-commute.scores.v1';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { offsetMs: 0, calibrated: false };
    const parsed = JSON.parse(raw);
    return {
      offsetMs: Number.isFinite(parsed.offsetMs) ? parsed.offsetMs : 0,
      calibrated: Boolean(parsed.calibrated),
      calibratedAt: parsed.calibratedAt || null,
    };
  } catch {
    return { offsetMs: 0, calibrated: false };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      offsetMs: settings.offsetMs,
      calibrated: settings.calibrated,
      calibratedAt: settings.calibratedAt || new Date().toISOString(),
    }),
  );
}

export function loadScores() {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveScores(list) {
  localStorage.setItem(SCORES_KEY, JSON.stringify(list));
}

let idCounter = 0;

export function makeRecord(name, result, chartTitle, offsetMs, calibrated) {
  idCounter += 1;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    id: `${now.getTime().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 7)}`,
    name: String(name || 'Player').slice(0, 16),
    chartTitle,
    score: result.score,
    accuracy: Number(result.accuracy.toFixed(4)),
    rank: result.rank,
    maxCombo: result.maxCombo,
    counts: { ...result.counts },
    offsetMs,
    calibrated: Boolean(calibrated),
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

// 合并外部 JSON：按 id 去重，分数降序。容错解析单个记录或一个数组/导出包。
export function mergeScores(existing, incoming) {
  const incomingList = Array.isArray(incoming)
    ? incoming
    : Array.isArray(incoming?.records)
      ? incoming.records
      : incoming && typeof incoming === 'object'
        ? [incoming]
        : [];
  const valid = incomingList.filter(
    (r) => r && typeof r === 'object' && Number.isFinite(r.score) && r.name,
  );
  const byId = new Map();
  for (const r of [...existing, ...valid]) {
    const key = r.id || `${r.name}|${r.score}|${r.date}|${r.accuracy}`;
    byId.set(key, r);
  }
  return [...byId.values()].sort((a, b) => b.score - a.score);
}

export function exportPayload(scores) {
  return JSON.stringify({
    app: 'neon-commute',
    version: 1,
    exportedAt: new Date().toISOString(),
    records: scores,
  });
}
