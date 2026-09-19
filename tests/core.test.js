import test from 'node:test';
import assert from 'node:assert/strict';

import { gradeError, NoteField, JUDGMENT_WINDOWS_MS } from '../src/core/judgment.js';
import { pointsFor, accuracyOf, rankOf, Scoreboard } from '../src/core/score.js';
import { computeOffset, median, calibrationBeatTimes, CALIBRATION_TAPS } from '../src/core/calibration.js';

test('gradeError 档位与边界', () => {
  assert.equal(gradeError(0), 'perfect');
  assert.equal(gradeError(30), 'perfect');
  assert.equal(gradeError(-30), 'perfect');
  assert.equal(gradeError(31), 'great');
  assert.equal(gradeError(-60), 'great');
  assert.equal(gradeError(61), 'good');
  assert.equal(gradeError(-100), 'good');
  assert.equal(gradeError(101), 'miss');
  assert.equal(gradeError(-500), 'miss');
});

test('NoteField 命中窗口内最近音符', () => {
  const notes = [
    { t: 1000, lane: 0 },
    { t: 1400, lane: 0 },
    { t: 1000, lane: 1 },
  ];
  const field = new NoteField(notes, 2);
  const r1 = field.hit(0, 1005);
  assert.equal(r1.note.t, 1000);
  assert.equal(r1.judgment, 'perfect');
  assert.equal(r1.errorMs, 5);
  // 同一音符不能被再打一次
  assert.equal(field.hit(0, 1000), null);
  // 第二颗仍在
  const r2 = field.hit(0, 1398);
  assert.equal(r2.note.t, 1400);
});

test('NoteField 空打返回 null 且不消耗音符', () => {
  const field = new NoteField([{ t: 5000, lane: 0 }], 1);
  assert.equal(field.hit(0, 1000), null);
  assert.equal(field.remaining, 1);
});

test('NoteField 设备偏移补正：offset=40 时晚按 40 仍 Perfect', () => {
  const field = new NoteField([{ t: 2000, lane: 0 }], 1);
  const r = field.hit(0, 2040, 40);
  assert.equal(r.judgment, 'perfect');
  assert.equal(r.errorMs, 0);
});

test('NoteField sweep 只按时间判 Miss，与调用频率无关', () => {
  const field = new NoteField(
    [
      { t: 1000, lane: 0 },
      { t: 1200, lane: 0 },
      { t: 3000, lane: 1 },
    ],
    2,
  );
  // 模拟掉帧：一次性跳到 10 秒后，两颗应都 Miss
  const missed = field.sweep(10000);
  assert.equal(missed.length, 3);
  assert.ok(missed.every((n) => n.judgment === 'miss'));
  assert.equal(field.remaining, 0);
});

test('NoteField 命中后不会被 sweep 翻案', () => {
  const field = new NoteField([{ t: 1000, lane: 0 }], 1);
  field.hit(0, 1000);
  assert.equal(field.sweep(5000).length, 0);
  assert.equal(field.complete, true);
});

test('计分：连击奖励与 Miss 清零', () => {
  const board = new Scoreboard(4);
  assert.equal(board.apply('perfect'), 1000); // combo 0，无奖励，累计 1000
  assert.equal(board.apply('perfect'), 2010); // 第二次 +1010
  assert.equal(board.apply('perfect'), 3030); // 第三次 +1020
  board.apply('miss');
  assert.equal(board.combo, 0);
  assert.equal(board.apply('great'), 3730); // miss 后连击重置，+700
  assert.equal(board.maxCombo, 3);
  assert.equal(board.counts.miss, 1);
});

test('pointsFor 连击奖励封顶 100', () => {
  assert.equal(pointsFor('perfect', 50), 1100);
  assert.equal(pointsFor('perfect', 5), 1050);
  assert.equal(pointsFor('miss', 99), 0);
});

test('准确率与评级', () => {
  assert.equal(accuracyOf({ perfect: 8, great: 1, good: 1, miss: 0 }, 10), 0.915);
  assert.equal(rankOf(1), 'SS');
  assert.equal(rankOf(0.96), 'S');
  assert.equal(rankOf(0.49), 'F');
});

test('Scoreboard.summary 字段完整', () => {
  const board = new Scoreboard(2);
  board.apply('good', 80);
  board.apply('miss', 200);
  const s = board.summary();
  assert.equal(s.maxCombo, 1);
  assert.equal(s.score, 300);
  assert.equal(s.rank, 'F');
  assert.equal(s.early, 0);
  assert.equal(s.late, 1);
});

test('median 奇偶个数', () => {
  assert.equal(median([30, 40, 20, 10]), 25);
  assert.equal(median([5, 1, 9]), 5);
});

test('校准：均匀晚 40ms 推出 offset=40', () => {
  const beats = calibrationBeatTimes(120, 468.75);
  const taps = beats.map((t) => t + 40);
  const r = computeOffset(beats, taps);
  assert.equal(r.ok, true);
  assert.equal(r.offsetMs, 40);
  assert.equal(beats.length, CALIBRATION_TAPS);
  assert.equal(beats[3], 120); // 最后一拍对齐下拍
});

test('校准：中位数抗抖动（含一次早拍）', () => {
  const beats = [0, 468.75, 937.5, 1406.25];
  const taps = [50, 468.75 + 52, 937.5 + 48, 1406.25 - 90];
  const r = computeOffset(beats, taps);
  assert.equal(r.ok, true);
  assert.equal(r.offsetMs, 49);
});

test('校准：漏点 / 乱点被拒绝', () => {
  const beats = [0, 468.75, 937.5, 1406.25];
  assert.equal(computeOffset(beats, [10, 480]).ok, false);
  const wild = [0, 2000, 5000, 9000];
  assert.equal(computeOffset(beats, wild).error, 'off-beat');
});
