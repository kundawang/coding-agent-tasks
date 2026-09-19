// 无头模拟整曲：用假 AudioContext 时钟驱动 Transport，
// 验证判定/计分/Miss/暂停在密集谱面上账目正确。
// node tests/simulate.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeChart } from '../src/chart.js';
import { Transport } from '../src/transport.js';
import { judgementFor, collectMissed } from '../src/judge.js';
import { ScoreBoard } from '../src/score.js';
import { MISS_AFTER_MS, END_HOLD_MS } from '../src/config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const chart = normalizeChart(
  JSON.parse(readFileSync(join(root, 'samples', 'chart.json'), 'utf8')),
);

function simulate({ pauseSongMs, pauseForSec, skill } = {}) {
  const t = new Transport();
  t.start(1, 0); // ctx 1s == perf 0 == song 0
  const states = new Uint8Array(chart.notes.length);
  const board = new ScoreBoard();
  let cursor = 0;

  let ctxNow = 1;
  let pausedDone = false;
  const stepMs = 4; // 模拟 250fps 帧步进
  const endMs = chart.durationMs + END_HOLD_MS;

  while (true) {
    const songMs = t.songTimeAtCtx(ctxNow);

    // 在指定歌曲时间暂停一段
    if (!pausedDone && songMs >= pauseSongMs) {
      t.pause(ctxNow);
      t.resume(ctxNow + pauseForSec, (ctxNow - 1) * 1000 + pauseForSec * 1000);
      pausedDone = true;
    }

    // 完美玩家：音符到达 (time + skill) 的那一帧精确击打该音符
    for (let i = 0; i < chart.notes.length; i += 1) {
      if (states[i] !== 0) continue;
      const n = chart.notes[i];
      const target = n.timeMs + skill;
      if (target >= songMs && target < songMs + stepMs && Math.abs(skill) <= 100) {
        states[i] = 1;
        board.add(judgementFor(skill));
      }
    }

    const res = collectMissed(chart.notes, states, cursor, songMs, MISS_AFTER_MS);
    cursor = res.cursor;
    for (const idx of res.missed) board.add('miss');

    if (songMs >= endMs) break;
    ctxNow += stepMs / 1000;
  }

  const accounted =
    board.counts.perfect + board.counts.great + board.counts.good + board.counts.miss;
  return { board, accounted, pausedSec: t.pausedSec };
}

// 场景 1：无暂停、0ms 抖动 -> 全 Perfect
{
  const { board, accounted } = simulate({ pauseSongMs: Infinity, skill: 0 });
  console.log('[全 Perfect]', board.counts, '记账', accounted, '总分', board.score);
  if (accounted !== chart.notes.length) throw new Error('有音符漏账');
  if (board.counts.perfect !== chart.notes.length) throw new Error('不是全 Perfect');
  if (board.counts.miss !== 0) throw new Error('不该有 Miss');
}

// 场景 2：中间暂停 10 秒，账目仍全对，暂停时长被正确扣除
{
  const { board, accounted, pausedSec } = simulate({
    pauseSongMs: 60000,
    pauseForSec: 10,
    skill: 0,
  });
  console.log('[暂停10s]', board.counts, '记账', accounted, 'pausedSec', pausedSec);
  if (accounted !== chart.notes.length) throw new Error('暂停导致漏账');
  if (board.counts.perfect !== chart.notes.length) throw new Error('暂停导致判定漂移');
  if (Math.abs(pausedSec - 10) > 0.01) throw new Error('暂停时长错误');
}

// 场景 3：手残玩家固定 +90ms -> 全 Good，零 Miss
{
  const { board, accounted } = simulate({ pauseSongMs: Infinity, skill: 90 });
  console.log('[固定+90ms]', board.counts, '准确率', board.result().accuracy.toFixed(2));
  if (accounted !== chart.notes.length) throw new Error('有音符漏账');
  if (board.counts.good !== chart.notes.length) throw new Error('+90ms 应全是 Good');
}

// 场景 4：不按键 -> 全 Miss
{
  const chart2 = chart;
  const states = new Uint8Array(chart2.notes.length);
  const board = new ScoreBoard();
  const res = collectMissed(chart2.notes, states, 0, chart2.durationMs + 99999, MISS_AFTER_MS);
  for (const idx of res.missed) board.add('miss');
  console.log('[挂机]', board.counts);
  if (board.counts.miss !== chart2.notes.length) throw new Error('挂机应全 Miss');
}

console.log('全部模拟通过 ✓');
