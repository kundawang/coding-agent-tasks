import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgementFor, findHit, collectMissed } from '../src/judge.js';
import { scoreFor, accuracyFromCounts, rankFor, ScoreBoard } from '../src/score.js';
import { computeCalibration, median } from '../src/calibrate.js';
import { normalizeChart } from '../src/chart.js';
import { Transport } from '../src/transport.js';

test('判定窗口边界（含等号）', () => {
  assert.equal(judgementFor(0), 'perfect');
  assert.equal(judgementFor(30), 'perfect');
  assert.equal(judgementFor(-30), 'perfect');
  assert.equal(judgementFor(31), 'great');
  assert.equal(judgementFor(60), 'great');
  assert.equal(judgementFor(61), 'good');
  assert.equal(judgementFor(100), 'good');
  assert.equal(judgementFor(101), 'miss');
  assert.equal(judgementFor(-101), 'miss');
});

test('findHit 选同轨最近且窗口内的音符', () => {
  const notes = [
    { timeMs: 1000, lane: 0 },
    { timeMs: 1050, lane: 0 },
    { timeMs: 1040, lane: 1 },
  ];
  const states = new Uint8Array(3);
  const hit = findHit(notes, states, 0, 1041, 100);
  assert.equal(hit.index, 1);
  assert.equal(hit.delta, -9);
  assert.equal(hit.judgement, 'perfect');

  states[1] = 1;
  assert.equal(findHit(notes, states, 0, 1041, 100).index, 0);
  assert.equal(findHit(notes, states, 1, 1041, 100).index, 2);
  assert.equal(findHit(notes, states, 2, 1041, 100), null);
});

test('collectMissed 只推进游标、只标未处理音符', () => {
  const notes = [
    { timeMs: 0, lane: 0 },
    { timeMs: 50, lane: 0 },
    { timeMs: 200, lane: 0 },
  ];
  const states = new Uint8Array(3);
  states[1] = 1; // 已击中
  const res = collectMissed(notes, states, 0, 301, 100);
  assert.equal(res.cursor, 3);
  assert.deepEqual(res.missed, [0, 2]);
  assert.equal(states[0], 2);
  assert.equal(states[1], 1);
});

test('计分：基础分 + 连击加成，Miss 清零', () => {
  assert.equal(scoreFor('perfect', 0), 1002);
  assert.equal(scoreFor('perfect', 49), 1100);
  assert.equal(scoreFor('perfect', 500), 1100); // cap
  assert.equal(scoreFor('great', 0), 602);
  assert.equal(scoreFor('good', 2), 306);
  assert.equal(scoreFor('miss', 99), 0);

  const board = new ScoreBoard();
  board.add('perfect');
  board.add('miss');
  board.add('great');
  assert.equal(board.combo, 1);
  assert.equal(board.maxCombo, 1);
  const r = board.result();
  assert.deepEqual(r.counts, { perfect: 1, great: 1, good: 0, miss: 1 });
});

test('准确率与评级', () => {
  assert.ok(
    Math.abs(
      accuracyFromCounts({ perfect: 7, great: 1, good: 1, miss: 1 }) -
        (7 + 0.6 + 0.3) / 10,
    ) < 1e-9,
  );
  assert.equal(rankFor(1), 'S');
  assert.equal(rankFor(0.95), 'A');
  assert.equal(rankFor(0.9), 'B');
  assert.equal(rankFor(0.75), 'C');
  assert.equal(rankFor(0.1), 'D');
});

test('校准中位数：正偏移表示按晚', () => {
  assert.equal(median([30, 40, 20, 35]), 32.5);
  const r = computeCalibration([1032, 1075, 1122, 1165], [1000, 1047, 1094, 1141]);
  assert.equal(r.offsetMs, 28);
  assert.deepEqual(r.deviations, [32, 28, 28, 24]);
});

test('校准异常点（>250ms）不参与中位数但保留展示', () => {
  const r = computeCalibration([1030, 1077, 2000, 1171], [1000, 1047, 1094, 1141]);
  assert.equal(r.offsetMs, 30);
  assert.equal(r.deviations.length, 4);
});

test('谱面归一化：别名字段 / 数组音符 / 去重排序', () => {
  const chart = normalizeChart({
    bpm: 120,
    offset_ms: 1000,
    notes: [
      { time: 2000, column: 2 },
      [1500, 0],
      { time: 1500, column: 0 },
      { time: 500, lane: 9 },
    ],
  });
  assert.equal(chart.offsetMs, 1000);
  assert.equal(chart.beatMs, 500);
  assert.equal(chart.notes.length, 2);
  assert.equal(chart.notes[0].timeMs, 1500);
  assert.equal(chart.notes[1].lane, 2);
});

test('Transport：播放换算 + 暂停区间不计时 + 恢复后对齐', () => {
  const t = new Transport();
  t.start(10, 100000); // ctx 10s / perf 100s 为歌曲 0
  assert.ok(Math.abs(t.songTimeAtCtx(11) - 1000) < 1e-9);
  assert.ok(Math.abs(t.songTimeAtPerf(101000) - 1000) < 1e-9);

  t.pause(12); // 歌曲时间 2000ms
  assert.equal(t.songTimeAtPerf(105000), 2000); // 暂停后输入时间冻结在 2000
  t.resume(15, 103000); // 真实世界停了 3s
  assert.ok(Math.abs(t.pausedSec - 3) < 1e-9);
  // resume 后再走 1s，歌曲应是 3000ms 而不是 6000ms
  assert.ok(Math.abs(t.songTimeAtCtx(16) - 3000) < 1e-9);
  // 调度未来事件：歌曲 3000ms 排到 ctx 16s（10 + 3暂停 + 3歌曲）
  assert.ok(Math.abs(t.ctxTimeForSongMs(3000) - 16) < 1e-9);
});
