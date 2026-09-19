// 单槽位 localStorage 存档。每一步动作后整份快照覆盖保存，
// 中途关掉页面再打开（同 seed）就能接着打。

import { snapshotState, restoreState } from './engine.js';

const KEY = 'emberdeck-save-v1';

export function saveGame(doc) {
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    seed: doc.seed,
    state: snapshotState(doc.state),
    actions: doc.actions,
    checksums: doc.checksums
  };
  localStorage.setItem(KEY, JSON.stringify(payload));
  return payload;
}

export function loadGame() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    if (payload?.version !== 1 || !payload.state) return null;
    return {
      version: 1,
      savedAt: payload.savedAt,
      seed: payload.seed,
      state: restoreState(payload.state),
      actions: payload.actions ?? [],
      checksums: payload.checksums ?? []
    };
  } catch (err) {
    return null;
  }
}

export function clearSave() {
  localStorage.removeItem(KEY);
}

export function hasSave() {
  return localStorage.getItem(KEY) !== null;
}
