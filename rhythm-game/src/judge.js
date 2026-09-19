import { WINDOWS } from './config.js';

// 根据 |按键时刻 - 音符时刻| 返回档位
export function judgementFor(absDeltaMs, windows = WINDOWS) {
  const d = Math.abs(absDeltaMs);
  if (d <= windows.perfect) return 'perfect';
  if (d <= windows.great) return 'great';
  if (d <= windows.good) return 'good';
  return 'miss';
}

// 在指定轨道上找当前可以被击中的、距离最近的空闲音符。
// notes: [{timeMs, lane}]，states: Uint8Array（0 空闲 / 1 已击中 / 2 Miss）
// 返回 null 或 { index, delta, judgement }，delta = 按键时刻 - 音符时刻（ms）
export function findHit(notes, states, lane, hitTimeMs, goodWindow = WINDOWS.good) {
  let bestIndex = -1;
  let bestAbs = Infinity;
  for (let i = 0; i < notes.length; i += 1) {
    const note = notes[i];
    if (note.lane !== lane || states[i] !== 0) continue;
    const abs = Math.abs(note.timeMs - hitTimeMs);
    if (abs <= goodWindow && abs < bestAbs) {
      bestAbs = abs;
      bestIndex = i;
    }
  }
  if (bestIndex < 0) return null;
  return {
    index: bestIndex,
    delta: Math.round(hitTimeMs - notes[bestIndex].timeMs),
    judgement: judgementFor(bestAbs),
  };
}

// 收集所有已经早于 (songTimeMs - missAfterMs) 仍未被处理的音符，判 Miss。
// fromCursor 只会单调前进，返回 { cursor, missed: [index...] }。
export function collectMissed(notes, states, fromCursor, songTimeMs, missAfterMs) {
  const missed = [];
  let cursor = fromCursor;
  const limit = songTimeMs - missAfterMs;
  while (cursor < notes.length && notes[cursor].timeMs <= limit) {
    if (states[cursor] === 0) {
      states[cursor] = 2;
      missed.push(cursor);
    }
    cursor += 1;
  }
  return { cursor, missed };
}
