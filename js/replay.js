// 回放格式（JSON，.twr.json）：
// {
//   format: "tickwars-replay", version: 1,
//   seed: <mulberry32 种子>,
//   totalTicks: <整局逻辑步数>,
//   arena: {...samples/arena.json 的内容},
//   rules: {...samples/rules.json 的内容},
//   inputs: [[tick, p1Mask, p2Mask], ...],  // 只在按键状态变化时记录，tick 起生效
//   events: [ {type, tick, ...}, ... ],    // 占领/击杀/复活/结算（含每 tick 分数）
//   result: { score: [p1, p2], winner }
// }
// 位置、据点归属、分数一律不存，全部由 seed + inputs 重算；
// 重算出的 events/result 会与文件里记录的做逐事件比对，不一致就标记 desync。

import { createMatch, step } from './sim.js';

export const REPLAY_FORMAT = 'tickwars-replay';
export const REPLAY_VERSION = 1;

export class Recorder {
  constructor(seed, totalTicks, arena, rules) {
    this.seed = seed >>> 0;
    this.totalTicks = totalTicks;
    this.arena = arena;
    this.rules = rules;
    this.entries = []; // [[tick, m0, m1], ...]
    this._last = [0, 0];
  }

  // tick 是这组输入生效的逻辑步编号（1 起）。
  noteInputs(tick, masks) {
    const m0 = masks[0] & 0b1111;
    const m1 = masks[1] & 0b1111;
    if (m0 !== this._last[0] || m1 !== this._last[1]) {
      this.entries.push([tick, m0, m1]);
      this._last[0] = m0;
      this._last[1] = m1;
    }
  }

  finish(match) {
    return {
      format: REPLAY_FORMAT,
      version: REPLAY_VERSION,
      seed: this.seed,
      totalTicks: this.totalTicks,
      arena: this.arena,
      rules: this.rules,
      inputs: this.entries,
      events: match.events,
      result: {
        score: [match.score[0], match.score[1]],
        winner: match.winner,
      },
    };
  }
}

export function parseReplay(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { error: '不是合法 JSON：' + err.message };
  }
  if (data.format !== REPLAY_FORMAT || data.version !== REPLAY_VERSION) {
    return { error: '格式标识或版本不对（应为 tickwars-replay v1）' };
  }
  if (!data.arena || !data.rules || !Array.isArray(data.inputs) || !Array.isArray(data.events)) {
    return { error: '缺少 arena / rules / inputs / events 字段' };
  }
  return { replay: data };
}

// 返回函数：inputAt(tick) -> [m0, m1]
export function inputStream(replay) {
  const entries = replay.inputs;
  return function inputAt(tick) {
    // 二分找最后一条 t <= tick
    let lo = 0;
    let hi = entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (entries[mid][0] <= tick) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return [0, 0];
    const e = entries[lo - 1];
    return [e[1] & 0b1111, e[2] & 0b1111];
  };
}

// 用 replay 从零重跑一整局，并和记录的事件流逐事件对账。
export function reconstruct(replay) {
  const match = createMatch(replay.arena, replay.rules, replay.seed);
  const inputAt = inputStream(replay);
  while (match.status === 'running') {
    step(match, inputAt(match.tick + 1));
  }
  const problems = compareEvents(replay.events, match.events);
  const scoreOk =
    Math.abs(match.score[0] - replay.result.score[0]) < 1e-6 &&
    Math.abs(match.score[1] - replay.result.score[1]) < 1e-6;
  if (!scoreOk) problems.push('最终分数不一致');
  if (match.winner !== replay.result.winner) problems.push('胜负不一致');
  return { match, consistent: problems.length === 0, problems };
}

function compareEvents(expected, actual) {
  const problems = [];
  if (expected.length !== actual.length) {
    problems.push(`事件数量不一致（记录 ${expected.length}，重放 ${actual.length}）`);
    return problems;
  }
  for (let i = 0; i < expected.length; i++) {
    const a = expected[i];
    const b = actual[i];
    if (a.type !== b.type || a.tick !== b.tick) {
      problems.push(`事件 #${i} 类型/tick 不一致`);
      continue;
    }
    switch (a.type) {
      case 'capture':
        if (a.point !== b.point || a.owner !== b.owner) problems.push(`事件 #${i} 占领内容不一致`);
        break;
      case 'kill':
        if (a.victim !== b.victim || a.killer !== b.killer) problems.push(`事件 #${i} 击杀内容不一致`);
        break;
      case 'spawn':
        if (a.player !== b.player) problems.push(`事件 #${i} 复活内容不一致`);
        if (Math.abs(a.x - b.x) > 1e-9 || Math.abs(a.y - b.y) > 1e-9) {
          problems.push(`事件 #${i} 复活位置不一致（疑似种子/PRNG 不同）`);
        }
        break;
      case 'result':
        if (
          Math.abs(a.score[0] - b.score[0]) > 1e-6 ||
          Math.abs(a.score[1] - b.score[1]) > 1e-6
        ) {
          problems.push(`事件 #${i} 结算分数不一致`);
        }
        break;
      default:
        problems.push(`事件 #${i} 未知类型 ${a.type}`);
    }
  }
  return problems;
}

export function replayToText(replay) {
  return JSON.stringify(replay);
}
