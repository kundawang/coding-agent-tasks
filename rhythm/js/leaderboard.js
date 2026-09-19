// 本地榜单：localStorage 存取 + JSON 导出/导入/合并（合并与解析为纯计算，便于测试）。
export const BOARD_FORMAT = 'dfjk-leaderboard';
export const BOARD_VERSION = 1;
const STORAGE_KEY = 'dfjk.leaderboard.v1';
const MAX_ENTRIES = 50;

export function sortEntries(entries) {
  return [...entries].sort((a, b) => b.score - a.score || a.date - b.date);
}

function entryKey(e) {
  return `${e.name}|${e.score}|${e.date}`;
}

export function mergeEntries(local, incoming) {
  const seen = new Set(local.map(entryKey));
  const merged = [...local];
  for (const e of incoming) {
    if (!seen.has(entryKey(e))) {
      seen.add(entryKey(e));
      merged.push(e);
    }
  }
  return sortEntries(merged).slice(0, MAX_ENTRIES);
}

export function exportJSON(entries) {
  return JSON.stringify({ format: BOARD_FORMAT, version: BOARD_VERSION, entries }, null, 2);
}

// 解析并校验导入的 JSON，不合法时抛错
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('不是合法的 JSON');
  }
  if (!data || data.format !== BOARD_FORMAT || !Array.isArray(data.entries)) {
    throw new Error('不是本游戏导出的榜单数据');
  }
  for (const e of data.entries) {
    if (typeof e.name !== 'string' || typeof e.score !== 'number' || typeof e.date !== 'number') {
      throw new Error('榜单条目格式不正确');
    }
  }
  return data.entries;
}

export function loadBoard(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function saveBoard(entries, storage = globalThis.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(sortEntries(entries).slice(0, MAX_ENTRIES)));
}

export function addEntry(entry, storage = globalThis.localStorage) {
  const entries = mergeEntries(loadBoard(storage), [entry]);
  saveBoard(entries, storage);
  return entries;
}
