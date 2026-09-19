#!/usr/bin node
// 纯计算部分的命令行入口，Node 直接跑，不依赖浏览器：
//   node tools/cli.mjs selfcheck [seed...]   跑整局自检（确定性、快照校验）
//   node tools/cli.mjs verify <record.json>  校验导出的对战记录
//   node tools/cli.mjs emit <seed>           输出一整局自演记录（JSON）
//   node tools/cli.mjs dump <seed>           逐步打印状态（人肉对账用）

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as Engine from '../src/engine.js';
import { hashSeed } from '../src/rng.js';
import { newReplay, recordStep, runEnemyTurn, verifyReplay } from '../src/replay.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadData() {
  const cardDefs = JSON.parse(readFileSync(join(root, 'samples/cards.json'), 'utf8')).cards;
  const encounter = JSON.parse(readFileSync(join(root, 'samples/encounter.json'), 'utf8'));
  Engine.validateCardDefs(cardDefs);
  return { cardDefs, lookup: Object.fromEntries(cardDefs.map((c) => [c.id, c])), encounter };
}

// 模拟玩家策略（仅用于自检/产样例，不参与真实游戏随机源）：
// 能出就出，优先伤害牌，再优先费用高的；并列时取手牌中最靠左的。
function choosePlayerAction(game, lookup) {
  const me = game.sides.player;
  const playable = [];
  for (const uid of me.hand) {
    const card = lookup[game.cards[uid]];
    if (card && card.cost <= me.energy) playable.push({ uid, card });
  }
  if (playable.length === 0) return null;
  playable.sort((a, b) => {
    const da = a.card.effects.some((e) => e.kind === 'damage') ? 1 : 0;
    const db = b.card.effects.some((e) => e.kind === 'damage') ? 1 : 0;
    if (da !== db) return db - da;
    return b.card.cost - a.card.cost;
  });
  const pick = playable[0];
  return {
    type: 'playCard',
    cardUid: pick.uid,
    targetSide: pick.card.target === 'enemy' ? 'enemy' : null,
  };
}

function playOneGame(seed, lookup, encounter, cardDefs, { verbose = false } = {}) {
  const game = Engine.createGame(encounter, lookup, seed);
  const replay = newReplay(seed, encounter, cardDefs, game);
  let safety = 10000;
  const applyEnemy = () => {
    for (const item of runEnemyTurn(game, lookup)) {
      recordStep(replay, item.step.kind, game, item.step);
      if (verbose) printStep(game, lookup, item.step, item.result);
    }
  };
  while (!game.over && safety-- > 0) {
    const action = choosePlayerAction(game, lookup);
    if (!action) {
      const end = Engine.finishTurn(game, 'player');
      recordStep(replay, 'endTurn', game, { side: 'player' });
      if (verbose) printStep(game, lookup, { kind: 'endTurn', side: 'player' }, end);
      applyEnemy();
      continue;
    }
    const result = Engine.playCard(game, 'player', action.cardUid, action.targetSide, lookup);
    recordStep(replay, 'playCard', game, { side: 'player', cardUid: action.cardUid, target: action.targetSide });
    if (verbose) printStep(game, lookup, { kind: 'playCard', side: 'player', cardUid: action.cardUid, target: action.targetSide }, result);
  }
  if (safety <= 0) throw new Error('自检局超过步数上限，疑似死循环');
  return { game, replay };
}

const STATUS_LABEL = { strength: '力量', vulnerable: '易伤', weak: '虚弱' };

function sideLine(game, side) {
  const s = game.sides[side];
  const st = Object.entries(s.statuses)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${STATUS_LABEL[k]}${v}`)
    .join(' ');
  return `${s.name} HP${s.hp}/${s.maxHp} 甲${s.block} 能${s.energy} 手${s.hand.length} 抽${s.drawPile.length} 弃${s.discard.length}${st ? ' ' + st : ''}`;
}

function printStep(game, lookup, step, result) {
  let text;
  if (step.kind === 'playCard') {
    const card = lookup[game.cards[step.cardUid]];
    const bits = [];
    for (const eff of result.effects) {
      if (eff.kind === 'damage') {
        bits.push(`伤害[${eff.hits.map((h) => `${h.amount}${h.blocked ? `(甲${h.blocked})` : ''}${h.hpLoss ? `(血-${h.hpLoss})` : ''}`).join(',')}]`);
      } else if (eff.kind === 'block') bits.push(`护甲+${eff.amount}`);
      else if (eff.kind === 'draw') bits.push(`抽${eff.drawn.length}${eff.reshuffled ? '(洗牌)' : ''}`);
      else if (eff.kind === 'energy') bits.push(`能量+${eff.amount}`);
      else if (eff.kind === 'apply') bits.push(`${STATUS_LABEL[eff.status]}+${eff.amount}@${eff.target}`);
      else if (eff.kind === 'heal') bits.push(`回血${eff.amount}`);
      else if (eff.kind === 'loseHp') bits.push(`失血${eff.amount}`);
    }
    text = `${step.side === 'player' ? '你' : 'AI'} 打出 ${card.name} ${bits.join(' ')}`;
  } else if (step.kind === 'endTurn') {
    text = `${step.side === 'player' ? '你' : 'AI'} 结束回合`;
  } else {
    text = `${step.side === 'player' ? '你' : 'AI'} 回合开始`;
  }
  console.log(`T${game.turn} ${text}`);
  console.log(`   ${sideLine(game, 'enemy')}`);
  console.log(`   ${sideLine(game, 'player')}`);
}

function cmdSelfcheck(seeds) {
  const { lookup, encounter, cardDefs } = loadData();
  const list = seeds.length ? seeds : [1, 12345, 42, 999999999, 'hello', ''];
  let allOk = true;
  for (const raw of list) {
    const seed = hashSeed(raw === '' ? Date.now() : raw);
    const first = playOneGame(seed, lookup, encounter, cardDefs);
    const second = playOneGame(seed, lookup, encounter, cardDefs);
    const same = JSON.stringify(first.replay) === JSON.stringify(second.replay);
    const verified = verifyReplay(first.replay);
    const finalA = `${first.game.winner}@${first.game.sides.player.hp}/${first.game.sides.enemy.hp}`;
    const ok = same && verified.ok;
    allOk = allOk && ok;
    console.log(
      `seed=${seed} 步骤=${first.replay.steps.length} 结果=${finalA} 确定性=${same ? 'OK' : 'FAIL'} 快照校验=${verified.ok ? 'OK' : 'FAIL'}`
    );
    if (!verified.ok) for (const e of verified.errors) console.log(`   ! [${e.index}] ${e.message}`);
  }
  console.log(allOk ? 'SELFCHECK PASS' : 'SELFCHECK FAIL');
  process.exit(allOk ? 0 : 1);
}

function cmdVerify(file) {
  const replay = JSON.parse(readFileSync(file, 'utf8'));
  const result = verifyReplay(replay);
  if (result.ok) {
    const g = result.game;
    console.log(`VERIFY OK：${replay.steps.length} 步，胜方=${g.winner}，剩余血量 玩家${g.sides.player.hp} / 敌方${g.sides.enemy.hp}`);
  } else {
    console.log(`VERIFY FAIL（${result.errors.length} 处不一致）：`);
    for (const e of result.errors) console.log(`  [步骤 ${e.index}] ${e.message}`);
    process.exit(1);
  }
}

function cmdEmit(seedRaw) {
  const { lookup, encounter, cardDefs } = loadData();
  const { replay } = playOneGame(hashSeed(seedRaw), lookup, encounter, cardDefs);
  const json = JSON.stringify(replay);
  const out = process.env.EMIT_OUT;
  if (out) {
    writeFileSync(out, json, 'utf8');
    console.log(`已写入 ${out}（${replay.steps.length} 步）`);
  } else {
    process.stdout.write(json);
  }
}

function cmdDump(seedRaw) {
  const { lookup, encounter, cardDefs } = loadData();
  const { game } = playOneGame(hashSeed(seedRaw), lookup, encounter, cardDefs, { verbose: true });
  console.log(`\n胜方：${game.winner}`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'selfcheck') cmdSelfcheck(args);
else if (cmd === 'verify') cmdVerify(args[0]);
else if (cmd === 'emit') { process.env.EMIT_OUT = args[1] || process.env.EMIT_OUT; cmdEmit(args[0]); }
else if (cmd === 'dump') cmdDump(args[0]);
else {
  console.log('用法: node tools/cli.mjs <selfcheck|verify|emit|dump> [参数]');
  process.exit(2);
}
