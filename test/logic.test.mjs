// 纯逻辑测试：node test/logic.test.mjs
import assert from 'node:assert/strict';
import { WINDOWS, SCORE, judgeDelta, summarize, findHittableNote } from '../js/judge.js';
import { matchTaps, median, computeOffset } from '../js/calibrate.js';
import { sortScores, mergeScores, serialize, parse, makeEntry } from '../js/leaderboard.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// ---- 判定窗口 ----
test('判定窗口边界', () => {
  assert.equal(judgeDelta(0), 'perfect');
  assert.equal(judgeDelta(WINDOWS.perfect), 'perfect');
  assert.equal(judgeDelta(-WINDOWS.perfect), 'perfect');
  assert.equal(judgeDelta(WINDOWS.perfect + 1), 'great');
  assert.equal(judgeDelta(-WINDOWS.great), 'great');
  assert.equal(judgeDelta(WINDOWS.great + 1), 'good');
  assert.equal(judgeDelta(-WINDOWS.good), 'good');
  assert.equal(judgeDelta(WINDOWS.good + 1), 'miss');
  assert.equal(judgeDelta(-500), 'miss');
});

// ---- 计分与准确率 ----
test('计分与准确率', () => {
  const counts = { perfect: 2, great: 1, good: 1, miss: 1 };
  const r = summarize(counts, 3);
  assert.equal(r.score, 2 * SCORE.perfect + SCORE.great + SCORE.good);
  assert.equal(r.total, 5);
  assert.ok(Math.abs(r.accuracy - ((2 + 0.7 + 0.4) / 5) * 100) < 1e-9);
  assert.equal(r.maxCombo, 3);
  assert.equal(summarize({ perfect: 0, great: 0, good: 0, miss: 0 }, 0).accuracy, 0);
});

// ---- 音符匹配 ----
test('findHittableNote 找最近未判定音符', () => {
  const notes = [
    { t: 1000, lane: 0, state: 0 },
    { t: 1050, lane: 0, state: 0 },
    { t: 2000, lane: 1, state: 0 },
  ];
  assert.equal(findHittableNote(notes, 0, 1040), 1); // 离 1050 更近
  assert.equal(findHittableNote(notes, 0, 1010), 0);
  assert.equal(findHittableNote(notes, 1, 1010), -1); // 轨道不对
  notes[0].state = 1;
  assert.equal(findHittableNote(notes, 0, 1000), 1); // 已判定的跳过
  assert.equal(findHittableNote(notes, 0, 2000), -1); // 窗口外
});

// ---- 校准 ----
test('matchTaps 最近匹配且不重复使用敲击', () => {
  const beats = [1000, 1500, 2000, 2500];
  const taps = [1012, 1518, 1995, 2510];
  assert.deepEqual(matchTaps(taps, beats), [12, 18, -5, 10]);
  assert.equal(matchTaps([1012], beats).length, 1); // 一次敲击只能配一拍
});

test('computeOffset 取中位数，样本不足则失败', () => {
  const beats = [0, 500, 1000, 1500];
  const offset = 15;
  const taps = beats.map((b) => b + offset + [2, -3, 1, 0][beats.indexOf(b)]);
  const r = computeOffset(taps, beats);
  assert.ok(r.ok);
  assert.ok(Math.abs(r.offsetMs - offset) <= 3);
  assert.equal(computeOffset([10], beats).ok, false);
});

test('median 奇偶长度', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), 0);
});

// ---- 排行榜 ----
test('排序：分数优先，同分比准确率', () => {
  const s = sortScores([
    { score: 100, accuracy: 90 },
    { score: 200, accuracy: 80 },
    { score: 100, accuracy: 95 },
  ]);
  assert.deepEqual(s.map((x) => x.accuracy), [80, 95, 90]);
});

test('mergeScores 按 id 去重并保持降序', () => {
  const local = [{ id: 'a', score: 100, accuracy: 90 }];
  const incoming = [
    { id: 'a', score: 100, accuracy: 90 }, // 重复
    { id: 'b', score: 300, accuracy: 88 },
  ];
  const merged = mergeScores(local, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'b');
});

test('serialize/parse 往返，非法输入抛错', () => {
  const entry = makeEntry({
    name: '测试', score: 123, accuracy: 98.765, maxCombo: 20,
    counts: { perfect: 1, great: 0, good: 0, miss: 0 }, calibrationMs: 15,
  });
  const back = parse(serialize([entry]));
  assert.equal(back.length, 1);
  assert.equal(back[0].score, 123);
  assert.equal(back[0].accuracy, 98.77);
  assert.throws(() => parse('{"foo":1}'));
  assert.throws(() => parse('not json'));
});

console.log(`\n${passed} 个测试全部通过`);
