const NS = 'rhythm-game:';
const CALIB_KEY = `${NS}calibration.v1`;
const SCORES_KEY = `${NS}scores.v1`;
const NAME_KEY = `${NS}name.v1`;
const MAX_SCORES = 200;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式 / 配额满了就静默失败 */
  }
}

export function getCalibration() {
  return read(CALIB_KEY, null);
}

export function saveCalibration(cal) {
  write(CALIB_KEY, cal);
}

export function clearCalibration() {
  try {
    localStorage.removeItem(CALIB_KEY);
  } catch {
    /* ignore */
  }
}

export function getName() {
  return read(NAME_KEY, '');
}

export function saveName(name) {
  write(NAME_KEY, name);
}

export function getScores() {
  const list = read(SCORES_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function addScore(entry) {
  const list = getScores();
  list.push({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...entry,
  });
  list.sort((a, b) => b.score - a.score);
  write(SCORES_KEY, list.slice(0, MAX_SCORES));
  return list;
}

export function clearScores() {
  write(SCORES_KEY, []);
}

// 导出：一段可直接发群的 JSON 字符串
export function exportScores() {
  return JSON.stringify(
    { format: 'rhythm-game-scores', version: 1, exportedAt: new Date().toISOString(), scores: getScores() },
    null,
    2,
  );
}

// 合并别人贴回来的 JSON（对象或字符串均可）。
// 以 id 去重；无法识别时抛错，让 UI 提示。
export function mergeScores(payload) {
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const incoming = Array.isArray(data) ? data : data && data.scores;
  if (!Array.isArray(incoming)) throw new Error('内容不是成绩文件');
  const seen = new Set(getScores().map((s) => s.id));
  const valid = incoming.filter((s) => s && typeof s.score === 'number' && s.playerName);
  const fresh = valid.filter((s) => !s.id || !seen.has(s.id));
  const list = [...getScores(), ...fresh].sort((a, b) => b.score - a.score).slice(0, MAX_SCORES);
  write(SCORES_KEY, list);
  return { list, added: fresh.length };
}
