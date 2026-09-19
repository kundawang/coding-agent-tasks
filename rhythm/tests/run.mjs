// 纯计算模块测试：node rhythm/tests/run.mjs
import assert from 'node:assert/strict';
import { judgeDelta, WINDOWS, MISS_AFTER_MS } from '../js/judge.js';
import { totalScore, accuracy, rank, emptyCounts } from '../js/score.js';
import { median, computeOffset } from '../js/calibrate.js';
import {
  mergeEntries, exportJSON, parseImport, loadBoard, saveBoard, addEntry,
} from '../js/leaderboard.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

// ---- 判定窗口 ----
test('判定窗口边界 ±30/±60/±100', () => {
  assert.equal(judgeDelta(0), 'perfect');
  assert.equal(judgeDelta(-30), 'perfect');
  assert.equal(judgeDelta(30), 'perfect');
  assert.equal(judgeDelta(31), 'great');
  assert.equal(judgeDelta(-60), 'great');
  assert.equal(judgeDelta(61), 'good');
  assert.equal(judgeDelta(-100), 'good');
  assert.equal(judgeDelta(101), 'miss');
  assert.equal(judgeDelta(-500), 'miss');
  assert.equal(MISS_AFTER_MS, WINDOWS.good);
});

// ---- 计分 ----
test('计分与准确率', () => {
  const counts = { perfect: 2, great: 1, good: 1, miss: 1 };
  assert.equal(totalScore(counts), 2 * 1000 + 650 + 300);
  // (2*1 + 1*0.65 + 1*0.3) / 5 = 0.59
  assert.ok(Math.abs(accuracy(counts) - 59) < 1e-9);
  assert.equal(accuracy(emptyCounts()), 0);
  assert.equal(totalScore(emptyCounts()), 0);
});

test('评级阈值', () => {
  assert.equal(rank(99), 'SS');
  assert.equal(rank(98), 'SS');
  assert.equal(rank(94), 'S');
  assert.equal(rank(88), 'A');
  assert.equal(rank(78), 'B');
  assert.equal(rank(50), 'C');
});

// ---- 校准 ----
test('中位数（奇偶个数）', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([10, 4]), 7);
  assert.equal(median([]), 0);
});

test('校准取中位数，抗离群', () => {
  // 模拟机器延迟约 +12ms，其中一下手滑
  const { offsetMs, spreadMs } = computeOffset([11, 13, 12, 180]);
  assert.equal(offsetMs, 12.5);
  assert.ok(spreadMs < 2);
});

// ---- 榜单 ----
function mockStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  };
}

test('榜单合并：排序 + 去重 + 上限', () => {
  const a = [{ name: 'A', score: 100, date: 1 }, { name: 'B', score: 200, date: 2 }];
  const b = [{ name: 'B', score: 200, date: 2 }, { name: 'C', score: 300, date: 3 }];
  const merged = mergeEntries(a, b);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map(e => e.name), ['C', 'B', 'A']);
  const capped = mergeEntries([], Array.from({ length: 60 }, (_, i) => ({
    name: `n${i}`, score: i, date: i,
  })));
  assert.equal(capped.length, 50);
});

test('导出/导入往返 + 非法输入报错', () => {
  const entries = [{ name: 'A', score: 100, date: 1 }];
  const round = parseImport(exportJSON(entries));
  assert.deepEqual(round, entries);
  assert.throws(() => parseImport('not json'), /JSON/);
  assert.throws(() => parseImport('{"format":"other","entries":[]}'), /榜单/);
  assert.throws(() => parseImport(JSON.stringify({
    format: 'dfjk-leaderboard', version: 1, entries: [{ name: 1 }],
  })), /格式/);
});

test('localStorage 存取（mock）', () => {
  const storage = mockStorage();
  assert.deepEqual(loadBoard(storage), []);
  addEntry({ name: 'A', score: 100, date: 1 }, storage);
  addEntry({ name: 'B', score: 300, date: 2 }, storage);
  const board = loadBoard(storage);
  assert.deepEqual(board.map(e => e.name), ['B', 'A']);
  saveBoard([{ name: 'C', score: 1, date: 3 }], storage);
  assert.deepEqual(loadBoard(storage).map(e => e.name), ['C']);
});

console.log(`\n${passed} 个测试全部通过`);
