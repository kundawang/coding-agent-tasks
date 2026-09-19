// 本地榜单：纯计算（排序/合并/序列化）+ localStorage 存取。

const STORAGE_KEY = 'neon-commute:scores:v1';
const MAX_ENTRIES = 100;

export function sortScores(scores) {
  return [...scores].sort((a, b) => b.score - a.score || b.accuracy - a.accuracy);
}

export function makeEntry({ name, score, accuracy, maxCombo, counts, calibrationMs }) {
  return {
    id: (crypto.randomUUID && crypto.randomUUID()) ||
        `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    name: String(name || '匿名').slice(0, 24),
    score,
    accuracy: Math.round(accuracy * 100) / 100,
    maxCombo,
    counts,
    calibrationMs,
    date: new Date().toISOString(),
  };
}

// 合并两组成绩，按 id 去重，返回截断后的新数组。
export function mergeScores(local, incoming, max = MAX_ENTRIES) {
  const seen = new Map();
  for (const s of [...local, ...incoming]) {
    if (!s || typeof s.score !== 'number') continue;
    const id = s.id || `${s.name}|${s.date}|${s.score}`;
    if (!seen.has(id)) seen.set(id, s);
  }
  return sortScores([...seen.values()]).slice(0, max);
}

export function serialize(scores) {
  return JSON.stringify({ game: 'neon-commute', version: 1, scores }, null, 2);
}

// 解析导入的 JSON，容忍直接给数组或包一层对象。非法输入抛异常。
export function parse(jsonText) {
  const data = JSON.parse(jsonText);
  const arr = Array.isArray(data) ? data : data.scores;
  if (!Array.isArray(arr)) throw new Error('JSON 里找不到 scores 数组');
  return arr.filter((s) => s && typeof s.score === 'number' && s.name);
}

// ---- 以下为浏览器存储封装（node 测试不触达） ----

export function loadScores() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

export function saveScores(scores) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scores.slice(0, MAX_ENTRIES)));
}

export function addScore(entry) {
  const next = sortScores([...loadScores(), entry]).slice(0, MAX_ENTRIES);
  saveScores(next);
  return next;
}
