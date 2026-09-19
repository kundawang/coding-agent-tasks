// 对战记录（replay）：每一步后都附完整状态快照，可逐步重放、可自动校验。
// 同一份记录既能在网页里“贴回来一步步看”，也能在 Node 里跑 verify 对结果。

import * as Engine from './engine.js';
import { chooseAiAction } from './ai.js';

export const REPLAY_FORMAT = 'emberdeck-replay';
export const REPLAY_VERSION = 1;

// 深快照：剔除运行时方法 _rng，但把它的 state 同步进 rngState，保证可复现。
export function snapshotGame(game) {
  const state = game._rng ? game._rng.state >>> 0 : game.rngState >>> 0;
  const snap = JSON.parse(
    JSON.stringify(game, (key, value) => (key === '_rng' ? undefined : value))
  );
  snap.rngState = state >>> 0;
  return snap;
}

export function newReplay(seed, encounter, cardDefs, game) {
  return {
    format: REPLAY_FORMAT,
    formatVersion: REPLAY_VERSION,
    seed,
    encounter,
    cards: cardDefs,
    winner: null,
    steps: [{ kind: 'start', snapshot: snapshotGame(game) }],
  };
}

// 每一步：做了什么（重放只需要这些输入）+ 做完之后的完整状态（复盘/对账用）。
export function recordStep(replay, kind, game, action = {}) {
  replay.steps.push({ kind, ...action, snapshot: snapshotGame(game) });
  if (game.over) replay.winner = game.winner;
}

// 敌方回合驱动器：直播、中途刷新恢复都走这里，保证两条路径结算顺序完全一致。
// begin=false 用于恢复时已经处在敌方回合中（beginTurn 那步之前已经发生过）。
export function* runEnemyTurn(game, cardMap, { begin = true } = {}) {
  if (begin) {
    yield { step: { kind: 'beginTurn', side: 'enemy' }, result: Engine.beginTurn(game, 'enemy') };
  }
  while (!game.over) {
    const action = chooseAiAction(game, cardMap);
    if (!action) break;
    const result = Engine.playCard(game, 'enemy', action.cardUid, action.targetSide, cardMap);
    yield {
      step: { kind: 'playCard', side: 'enemy', cardUid: action.cardUid, target: 'player' },
      result,
    };
  }
  if (!game.over) {
    yield { step: { kind: 'endTurn', side: 'enemy' }, result: Engine.finishTurn(game, 'enemy') };
    yield { step: { kind: 'beginTurn', side: 'player' }, result: Engine.beginTurn(game, 'player') };
  }
}

// 按记录逐步重算，并核对：动作合法、AI 决策一致、每步快照与记录完全相同。
// 返回 { ok, errors:[{index, message}], game }。
export function verifyReplay(replay) {
  const errors = [];
  const fail = (index, message) => errors.push({ index, message });

  if (!replay || replay.format !== REPLAY_FORMAT) {
    return { ok: false, errors: [{ index: -1, message: '不是 emberdeck 对战记录' }], game: null };
  }
  const lookup = Object.fromEntries(replay.cards.map((c) => [c.id, c]));
  let game;
  try {
    Engine.validateCardDefs(replay.cards);
    game = Engine.createGame(replay.encounter, lookup, replay.seed >>> 0);
  } catch (err) {
    return { ok: false, errors: [{ index: -1, message: `开局失败：${err.message}` }], game: null };
  }

  const steps = replay.steps || [];
  if (steps.length === 0 || steps[0].kind !== 'start') {
    fail(0, '缺少 start 步骤');
  } else {
    assertSnapshot(steps[0].snapshot, snapshotGame(game), 0, fail);
  }

  for (let i = 1; i < steps.length; i++) {
    const step = steps[i];
    try {
      if (step.kind === 'playCard') {
        if (step.side === 'enemy') {
          const ai = chooseAiAction(game, lookup);
          if (!ai) fail(i, '记录里敌方还在出牌，但 AI 此时已经选择停止');
          else if (ai.cardUid !== step.cardUid || ai.targetSide !== step.target) {
            fail(i, `AI 决策不一致：重算为 uid=${ai.cardUid}→${ai.targetSide}，记录为 uid=${step.cardUid}→${step.target}`);
          }
        }
        Engine.playCard(game, step.side, step.cardUid, step.target, lookup);
      } else if (step.kind === 'endTurn') {
        Engine.finishTurn(game, step.side);
      } else if (step.kind === 'beginTurn') {
        Engine.beginTurn(game, step.side);
      } else {
        fail(i, `未知步骤类型：${step.kind}`);
        continue;
      }
      assertSnapshot(step.snapshot, snapshotGame(game), i, fail);
    } catch (err) {
      fail(i, `重放抛错：${err.message}`);
      break;
    }
  }

  if (replay.winner !== (game.over ? game.winner : null)) {
    fail(steps.length - 1, `最终胜负不一致：重算=${game.winner} 记录=${replay.winner}`);
  }
  return { ok: errors.length === 0, errors, game };
}

function assertSnapshot(expected, actual, index, fail) {
  if (!expected) {
    fail(index, '该步骤缺少快照');
    return;
  }
  const diff = firstDiff(expected, actual, '$');
  if (diff) fail(index, `状态快照不一致 @ ${diff.path}：记录=${diff.a} 重算=${diff.b}`);
}

function firstDiff(a, b, path) {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return { path, a: JSON.stringify(a), b: JSON.stringify(b) };
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return { path, a: JSON.stringify(a), b: JSON.stringify(b) };
    }
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!(key in a) || !(key in b)) return { path: `${path}.${key}`, a: JSON.stringify(a[key]), b: JSON.stringify(b[key]) };
    const d = firstDiff(a[key], b[key], `${path}.${key}`);
    if (d) return d;
  }
  return null;
}
