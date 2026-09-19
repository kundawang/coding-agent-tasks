// localStorage 读写。损坏的 JSON 不直接清档：隔离备份后开新档，
// 并把事件记进异常列表，方便排查。

import { SAVE_KEY } from './config.js';

export function loadRawSave(storage = localStorage) {
  let text = null;
  try {
    text = storage.getItem(SAVE_KEY);
  } catch {
    return { raw: undefined, error: 'localStorage 不可读' };
  }
  if (text == null) return { raw: undefined, error: null };
  try {
    return { raw: JSON.parse(text), error: null };
  } catch (e) {
    try {
      storage.setItem(`${SAVE_KEY}.corrupt.${Date.now()}`, text);
      storage.removeItem(SAVE_KEY);
    } catch {
      // 存储被禁用也不影响玩（只是存不下）
    }
    return { raw: undefined, error: `存档 JSON 损坏，已隔离备份：${e.message}` };
  }
}

export function writeSave(state, storage = localStorage) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(storage = localStorage) {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}