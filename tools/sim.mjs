// 无依赖的命令行工具（Node），方便拿几个种子对答案：
//
//   node tools/sim.mjs auto 12345              AI vs AI 自动打完一局
//   node tools/sim.mjs auto 12345 --twice      连跑两遍，校验确定性（结果必须完全相同）
//   node tools/sim.mjs run 12345 p1 e0 p3 end  按脚本走动作，打印每步状态
//   node tools/sim.mjs verify record.json      校验导出的战报，逐步比对校验和
//
// 动作脚本（run 模式）：
//   p<手牌下标>  玩家出该下标（0 起）的牌，敌人牌自动指向对手
//   e<手牌下标>  敌人出牌（一般用不到，敌人回合交给自动策略）
//   end          结束当前回合
//   auto         当前行动方交给策略决定
// 不写 side 的出牌一律按当前行动方处理。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  createCardMap,
  createDocument,
  dispatch,
  checksumState
} from '../src/engine.js';
import { chooseAction } from '../src/ai.js';
import { replay, buildRecord } from '../src/replay.js';
import { writeFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadData() {
  const cardsJson = JSON.parse(readFileSync(resolve(root, 'samples/cards.json'), 'utf8'));
  const encounter = JSON.parse(readFileSync(resolve(root, 'samples/encounter.json'), 'utf8'));
  return { cardDefs: createCardMap(cardsJson.cards), cards: cardsJson.cards, encounter };
}

function describeSide(state, side, cardDefs) {
  const c = state.sides[side];
  const hand = c.hand.map((uid) => cardDefs[state.cards[uid].id].id).join(',');
  const s = c.statuses;
  return `${side} hp=${c.hp}/${c.maxHp} energy=${c.energy} block=${s.block} ` +
    `str=${s.strength} vuln=${s.vulnerable} weak=${s.weak} ` +
    `draw=${c.drawPile.length} hand=[${hand}] discard=${c.discard.length} exhaust=${c.exhaustPile.length}`;
}

function printState(state, cardDefs, label = '') {
  const tag = label ? ` ${label}` : '';
  console.log(`--- turn=${state.turn} active=${state.active}${tag} checksum=${checksumState(state)}`);
  console.log(describeSide(state, 'player', cardDefs));
  console.log(describeSide(state, 'enemy', cardDefs));
}

function actionFromToken(token, state) {
  if (token === 'end') return { type: 'endTurn', side: state.active };
  if (token === 'auto') return chooseAction(state, state.active, state._cardDefs) ??
    { type: 'endTurn', side: state.active };
  const match = /^([pe]?)(\d+)$/.exec(token);
  if (!match) throw new Error(`看不懂的动作: ${token}`);
  const index = Number(match[2]);
  let side;
  if (match[1] === 'p') side = 'player';
  else if (match[1] === 'e') side = 'enemy';
  else side = state.active;
  const uid = state.sides[side].hand[index];
  if (uid === undefined) throw new Error(`${token}：手牌下标不存在`);
  const def = state._cardDefs[state.cards[uid].id];
  const action = { type: 'playCard', side, handIndex: index };
  if (def.target === 'enemy') action.target = side === 'player' ? 'enemy' : 'player';
  return action;
}

function runAuto(cardDefs, cards, encounter, seed, { twice }) {
  const playOnce = () => {
    const doc = createDocument(cardDefs, encounter, seed);
    doc.state._cardDefs = cardDefs;
    const log = [];
    printState(doc.state, cardDefs, '开局');
    let guard = 0;
    while (!doc.state.winner && guard++ < 10000) {
      const action = chooseAction(doc.state, doc.state.active, cardDefs);
      if (!action) {
        dispatch(doc, { type: 'endTurn', side: doc.state.active }, cardDefs);
        log.push({ side: doc.state.active, type: 'endTurn' });
      } else {
        dispatch(doc, action, cardDefs);
        log.push(action);
      }
      printState(doc.state, cardDefs);
    }
    return { doc, finalChecksum: checksumState(doc.state), winner: doc.state.winner, logLength: log.length };
  };

  const first = playOnce();
  console.log(`\n结果: winner=${first.winner} steps=${first.logLength} checksum=${first.finalChecksum}`);
  const outIdx = rest.indexOf('--out');
  if (outIdx !== -1 && rest[outIdx + 1]) {
    writeFileSync(resolve(rest[outIdx + 1]), JSON.stringify(buildRecord(first.doc, cards, encounter), null, 2));
    console.log(`战报已导出: ${rest[outIdx + 1]}`);
  }
  if (twice) {
    const second = playOnce();
    const same = JSON.stringify(first) === JSON.stringify(second);
    console.log(same ? '确定性校验：通过（两遍结果完全一致）' : '确定性校验：失败！');
    if (!same) process.exitCode = 1;
  }
}

function runScript(cardDefs, cards, encounter, seed, tokens) {
  const doc = createDocument(cardDefs, encounter, seed);
  doc.state._cardDefs = cardDefs;
  printState(doc.state, cardDefs, '开局');
  let outPath = null;
  const seq = [];
  for (const token of tokens) {
    if (token === '--out') { outPath = 'NEXT'; continue; }
    if (outPath === 'NEXT') { outPath = token; continue; }
    seq.push(token);
  }
  for (const token of seq) {
    const action = actionFromToken(token, doc.state);
    dispatch(doc, action, cardDefs);
    printState(doc.state, cardDefs, token);
    if (doc.state.winner) break;
  }
  console.log(`\nchecksum=${checksumState(doc.state)} winner=${doc.state.winner ?? '未分胜负'}`);
  return { doc, outPath };
}

function runVerify(path) {
  const record = JSON.parse(readFileSync(resolve(path), 'utf8'));
  const result = replay(record);
  for (const step of result.steps) {
    const mark = step.match ? 'ok ' : 'BAD';
    const who = step.action ? `${step.action.side}:${step.action.type}` : 'init';
    console.log(`[${mark}] #${step.index} ${who} ${step.actual}` +
      (step.error ? ` error=${step.error}` : '') +
      (!step.match && !step.error ? ` expected=${step.checksum}` : ''));
  }
  console.log(result.ok
    ? `\n战报校验通过：${result.steps.length - 1} 个动作全部对得上`
    : `\n战报校验失败：从第 ${result.mismatchAt} 步开始不一致`);
  if (!result.ok) process.exitCode = 1;
}

const [, , mode, seed, ...rest] = process.argv;
const { cardDefs, cards, encounter } = loadData();

if (mode === 'auto') {
  runAuto(cardDefs, cards, encounter, seed ?? '1', { twice: rest.includes('--twice') });
} else if (mode === 'run') {
  if (seed === undefined) throw new Error('用法: node tools/sim.mjs run <seed> [actions...]');
  const { doc, outPath } = runScript(cardDefs, cards, encounter, seed, rest);
  if (outPath) {
    writeFileSync(resolve(outPath), JSON.stringify(buildRecord(doc, cards, encounter), null, 2));
    console.log(`战报已导出: ${outPath}`);
  }
} else if (mode === 'verify') {
  if (!seed) throw new Error('用法: node tools/sim.mjs verify <record.json>');
  runVerify(seed);
} else {
  console.log('用法: node tools/sim.mjs <auto|run|verify> ...');
  process.exitCode = 1;
}
