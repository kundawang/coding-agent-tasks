// 无头校验：node tools/simulate.mjs [seed ...]
// 双方都用 AI 策略自动打完，验证：
//   1) 同一个种子跑两遍，动作序列和每步哈希完全一致（确定性）；
//   2) 导出的记录重放后每步哈希对得上（记录可复现）。
// 结算、取整、洗牌、AI 决策全在 js/ 里的纯模块，这里只是驱动。

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createGame, playCard, endTurn, exportLog, replayLog, hashState } from '../js/engine.js';
import { aiNextAction } from '../js/ai.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cardsData = JSON.parse(await readFile(join(root, 'samples/cards.json'), 'utf8'));
const encounter = JSON.parse(await readFile(join(root, 'samples/encounter.json'), 'utf8'));
const cardsDb = Object.fromEntries(cardsData.cards.map(c => [c.id, c]));

const MAX_ACTIONS = 2000;

function runGame(seed) {
  const { state } = createGame(cardsDb, encounter, seed);
  let guard = 0;
  while (state.phase === 'play' && guard < MAX_ACTIONS) {
    const side = state.active;
    const action = aiNextAction(state, side);
    const res = action
      ? playCard(state, side, action.handIndex, action.target)
      : endTurn(state, side);
    if (!res.ok) throw new Error(`动作被拒绝: ${res.reason}`);
    guard++;
  }
  if (state.phase !== 'over') throw new Error(`种子 ${seed}: 超过 ${MAX_ACTIONS} 步还没打完`);
  return state;
}

let failed = false;
const seeds = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['1', '2', '3', '42', '12345'];

for (const seed of seeds) {
  const a = runGame(seed);
  const b = runGame(seed);
  const logA = exportLog(a);
  const logB = exportLog(b);

  const sameActions = JSON.stringify(logA.actions) === JSON.stringify(logB.actions);
  const sameHashes = JSON.stringify(logA.hashes) === JSON.stringify(logB.hashes);

  const rep = replayLog(logA);
  let replayOk = rep.ok;
  if (replayOk) {
    for (let i = 1; i < rep.states.length; i++) {
      if (hashState(rep.states[i]) !== logA.hashes[i - 1]) {
        replayOk = false;
        break;
      }
    }
  }

  const ok = sameActions && sameHashes && replayOk;
  if (!ok) failed = true;
  console.log(
    `seed=${seed}  胜方=${logA.result.winner}  回合=${logA.result.turns}  步数=${logA.actions.length}  ` +
    `末态哈希=${logA.hashes[logA.hashes.length - 1]}  ` +
    `确定性=${sameActions && sameHashes ? 'OK' : 'FAIL'}  重放=${replayOk ? 'OK' : 'FAIL'}`
  );
}

process.exit(failed ? 1 : 0);
