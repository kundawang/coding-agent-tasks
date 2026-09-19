// 纯逻辑自测，不依赖 DOM：node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { toYuan, parseYuan } from '../js/money.js';
import { poisson, nextState } from '../js/rng.js';
import { migrateSave } from '../js/migrate.js';
import {
  buildCatalog,
  makeInitialState,
  advanceTime,
  buyGoods,
  priceAttractiveness,
  simulateCustomers,
  batchFreshOn,
  usedSlots,
} from '../js/game.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const goodsJson = JSON.parse(readFileSync(join(root, 'samples/goods.json'), 'utf8'));
const storeJson = JSON.parse(readFileSync(join(root, 'samples/store.json'), 'utf8'));

const DAY = storeJson.dayLengthMs;

function freshState(overrides = {}, now = 1_000_000_000_000) {
  const s = makeInitialState(storeJson, now);
  Object.assign(s, overrides);
  return s;
}

test('钱：分转元只用字符串，无浮点误差', () => {
  assert.equal(toYuan(0), '0.00');
  assert.equal(toYuan(5), '0.05');
  assert.equal(toYuan(10), '0.10');
  assert.equal(toYuan(1234), '12.34');
  assert.equal(toYuan(50_000_000), '500000.00');
  assert.equal(toYuan(-7), '-0.07');
});

test('钱：元解析回分，支持一位小数，拒绝非法输入', () => {
  assert.equal(parseYuan('12.34'), 1234);
  assert.equal(parseYuan('¥5.5'), 550);
  assert.equal(parseYuan('0.1'), 10);
  assert.equal(parseYuan('abc'), null);
  assert.equal(parseYuan('1.234'), null);
});

test('rng：同种子序列确定，泊松均值合理', () => {
  assert.equal(nextState(123).state, nextState(123).state);
  let st = 7;
  let sum = 0;
  const N = 4000;
  for (let i = 0; i < N; i += 1) {
    const r = poisson(st, 5);
    st = r.state;
    sum += r.value;
  }
  assert.ok(Math.abs(sum / N - 5) < 0.2, `均值异常：${sum / N}`);
});

test('迁移：无版本号的老存档补缺字段，不清档', () => {
  const old = {
    cashCents: 12345,
    stock: [{ goodsId: 'milk', qty: 2 }],
  };
  const { state, warnings } = migrateSave(old, freshState());
  assert.equal(state.version, 1);
  assert.equal(state.cashCents, 12345);
  assert.equal(state.shelfSlots, storeJson.shelfSlots);
  assert.equal(state.day, 1);
  assert.equal(state.stock[0].boughtOnDay, 1);
  assert.ok(Array.isArray(state.history));
  assert.ok(Array.isArray(state.anomalies));
  assert.ok(warnings.some((w) => w.includes('版本号')));
});

test('迁移：非法字段逐个修复而不是报错清档', () => {
  const bad = {
    version: 1,
    cashCents: -9,
    shelfSlots: 'many',
    prices: { milk: 'oops' },
    stock: [{ qty: 3 }, 'garbage', { goodsId: 'cola', qty: 1, boughtOnDay: 2 }],
  };
  const { state } = migrateSave(bad, freshState());
  assert.equal(state.cashCents, storeJson.cashCents);
  assert.equal(state.shelfSlots, storeJson.shelfSlots);
  assert.deepEqual(state.prices, {});
  assert.equal(state.stock.length, 1);
  assert.equal(state.stock[0].goodsId, 'cola');
});

test('定价曲线：成本价好卖，1.8 倍归零，中间有明显落差', () => {
  assert.ok(Math.abs(priceAttractiveness(320, 320) - 1) < 1e-9);
  assert.equal(priceAttractiveness(Math.round(320 * 1.8), 320), 0);
  const atCost = priceAttractiveness(320, 320);
  const at140 = priceAttractiveness(Math.round(320 * 1.4), 320);
  const at170 = priceAttractiveness(Math.round(320 * 1.7), 320);
  assert.ok(atCost > at140);
  assert.ok(at140 > at170);
  assert.ok(at170 < 0.1);
});

test('进货：扣整数分、占货架、超位/没钱都拒绝', () => {
  const catalog = buildCatalog(goodsJson.goods);
  const s = freshState();
  const cash0 = s.cashCents;
  // 初始库存：牛奶 6 + 泡面 4*2 + 可乐 6*2 = 26 格，已经超出 24 格货架
  // （初始满仓是允许的，但再进任何东西都得先腾位）
  assert.equal(usedSlots(s, catalog), 26);
  assert.equal(buyGoods(s, catalog, 'snack', 1).ok, false);
  s.stock = [];
  const r = buyGoods(s, catalog, 'snack', 2);
  assert.equal(r.ok, true);
  assert.equal(r.costCents, 350 * 2);
  assert.equal(s.cashCents, cash0 - 350 * 2);
  assert.equal(usedSlots(s, catalog), 2);
  assert.equal(buyGoods(s, catalog, 'egg', 1000).ok, false);
  assert.equal(buyGoods(freshState({ cashCents: 10 }), catalog, 'milk', 1).ok, false);
  assert.equal(buyGoods(s, catalog, 'snack', 0).ok, false);
  assert.equal(buyGoods(s, catalog, 'snack', -1).ok, false);
});

test('卖货：先进先卖（FIFO），营收全是整数分', () => {
  const catalog = buildCatalog(goodsJson.goods);
  const s = freshState({
    day: 5,
    stock: [
      { goodsId: 'milk', qty: 3, boughtOnDay: 2 },
      { goodsId: 'milk', qty: 2, boughtOnDay: 4 },
    ],
    prices: { milk: 450 },
  });
  const sim = simulateCustomers(s, catalog, 0.5);
  assert.ok(sim.unitsSold > 0, '半整天的人气牛奶应有成交');
  const totalMilk = s.stock
    .filter((b) => b.goodsId === 'milk')
    .reduce((a, b) => a + b.qty, 0);
  assert.equal(totalMilk, 5 - sim.unitsSold);
  // 先进先卖：老批次（第2天）优先于新批次（第4天）被扣减
  const newest = s.stock.find((b) => b.boughtOnDay === 4);
  if (sim.unitsSold <= 3) {
    assert.equal(newest.qty, 2);
  }
  assert.ok(Number.isInteger(s.cashCents));
  assert.equal(s.cashCents, storeJson.cashCents + sim.unitsSold * 450);
});

test('定价高到没人买 vs 成本价热卖，差异可见', () => {
  const catalog = buildCatalog(goodsJson.goods);
  function runShop(priceCents) {
    const s = freshState({
      customersPerDay: 500,
      stock: [{ goodsId: 'milk', qty: 1000, boughtOnDay: 1 }],
      prices: { milk: priceCents },
      rngState: 42,
    });
    return simulateCustomers(s, catalog, 1);
  }
  const cheap = runShop(320);
  const pricey = runShop(Math.round(320 * 1.75));
  assert.ok(
    cheap.unitsSold > pricey.unitsSold * 5,
    `低价 ${cheap.unitsSold} vs 高价 ${pricey.unitsSold}，差异不够明显`,
  );
});

test('过期：到日子开门就扔，历史里记数量', () => {
  const catalog = buildCatalog(goodsJson.goods);
  const bread = { goodsId: 'bread', qty: 2, boughtOnDay: 1 };
  assert.equal(batchFreshOn(bread, catalog, 4), true);
  assert.equal(batchFreshOn(bread, catalog, 5), false);

  const s = freshState({
    day: 1,
    customersPerDay: 0, // 不卖，专门验证过期丢弃
    stock: [{ goodsId: 'bread', qty: 4, boughtOnDay: 1 }],
    prices: {},
  });
  const t0 = 1_000_000_000_000;
  s.dayStartMs = t0;
  const r = advanceTime(s, catalog, t0 + 4 * DAY, { offline: true });
  assert.equal(s.day, 5);
  const expiry = r.entries[3].expired.find((e) => e.goodsId === 'bread');
  assert.ok(expiry, '应在第5天开门时记录过期');
  assert.equal(expiry.qty, 4);
  assert.ok(!s.stock.some((b) => b.goodsId === 'bread'));
});

test('离线补算：按整天结算，零头计入今天，锚点正确', () => {
  const catalog = buildCatalog(goodsJson.goods);
  const t0 = 2_000_000_000_000;
  const s = freshState({}, t0);
  const report = advanceTime(s, catalog, t0 + 3 * DAY + DAY / 2, { offline: true });
  assert.equal(report.daysSettled, 3);
  assert.equal(s.day, 4);
  assert.equal(report.entries.length, 3);
  assert.equal(s.dayStartMs, t0 + 3 * DAY);
  assert.ok(Number.isInteger(report.revenueCents));
});

test('离线补算：不足一天不送天数；空货架不扣钱', () => {
  const catalog = buildCatalog(goodsJson.goods);
  const t0 = 3_000_000_000_000;
  const s = freshState({ stock: [], prices: {} }, t0);
  const report = advanceTime(s, catalog, t0 + DAY - 1, { offline: true });
  assert.equal(report.daysSettled, 0);
  assert.equal(s.day, 1);
  assert.equal(s.cashCents, storeJson.cashCents);
});

test('离线封顶：只补 7 天，多出的天数不结算且有异常留痕', () => {
  const catalog = buildCatalog(goodsJson.goods);
  const t0 = 4_000_000_000_000;
  const s = freshState({}, t0);
  const report = advanceTime(s, catalog, t0 + 30 * DAY, { offline: true });
  assert.equal(report.daysSettled, 7);
  assert.equal(report.cappedDays, 23);
  assert.equal(s.day, 8);
  assert.ok(s.anomalies.some((a) => a.type === 'cap'));
  // 封顶后以“现在”作为第 8 天起点（丢掉的 23 天不进日内进度）
  assert.equal(s.dayStartMs, t0 + 30 * DAY);
});

test('离线封顶：保留最后一个日内零头，且下次 tick 不会立刻多一天', () => {
  const catalog = buildCatalog(goodsJson.goods);
  const t0 = 5_000_000_000_000;
  const s = freshState({}, t0);
  const report = advanceTime(s, catalog, t0 + 30 * DAY + DAY / 4, {
    offline: true,
  });
  assert.equal(report.daysSettled, 7);
  assert.equal(s.dayStartMs, t0 + 30 * DAY);
  const next = advanceTime(s, catalog, s.dayStartMs + DAY / 2, { offline: false });
  assert.equal(next.daysSettled, 0);
  // 再过半天 + 半天凑满一天，只结 1 天（不会把之前丢的 23 天吐回来）
  const then = advanceTime(s, catalog, s.dayStartMs + DAY, { offline: false });
  assert.equal(then.daysSettled, 1);
  assert.equal(s.day, 9);
});

test('时间回拨：不补收益、不扣钱货、清当天进度并留痕', () => {
  const catalog = buildCatalog(goodsJson.goods);
  const t0 = 6_000_000_000_000;
  const s = freshState({ stock: [], prices: {} }, t0);
  const cashBefore = s.cashCents;
  const stockBefore = s.stock.length;
  advanceTime(s, catalog, t0 + 2 * DAY, { offline: true });
  const dayAtRollback = s.day;
  assert.equal(dayAtRollback, 3);
  const report = advanceTime(s, catalog, t0 + 2 * DAY - 10 * DAY, {
    offline: true,
  });
  assert.ok(report.rollback);
  assert.equal(report.daysSettled, 0);
  assert.equal(s.day, dayAtRollback);
  assert.equal(s.cashCents, cashBefore);
  assert.ok(s.anomalies.some((a) => a.type === 'rollback'));
  assert.equal(s.dayStartMs, t0 + 2 * DAY - 10 * DAY);
  assert.equal(s.stock.length, stockBefore);
});

test('时间回拨后再往前拨：从干净锚点重新计时，刷不出额外天数', () => {
  const catalog = buildCatalog(goodsJson.goods);
  const t0 = 7_000_000_000_000;
  const s = freshState({}, t0);
  const cheat = t0 - 5 * DAY;
  advanceTime(s, catalog, cheat, { offline: true });
  const r = advanceTime(s, catalog, t0 + 10 * DAY, { offline: true });
  assert.equal(r.daysSettled, 7);
  assert.equal(r.cappedDays, 8);
});

test('小幅回拨（NTP 抖动）忽略：不记异常、不动锚点', () => {
  const catalog = buildCatalog(goodsJson.goods);
  const t0 = 8_000_000_000_000;
  const s = freshState({}, t0);
  const r = advanceTime(s, catalog, t0 - 800, { offline: true });
  assert.equal(r.rollback, null);
  assert.equal(r.daysSettled, 0);
  assert.equal(s.anomalies.length, 0);
  assert.equal(s.dayStartMs, t0);
});

test('大额整数分：几千万分级别记账后仍是安全整数', () => {
  const catalog = buildCatalog(goodsJson.goods);
  const s = freshState({
    cashCents: 90_000_000,
    customersPerDay: 2000,
    stock: [{ goodsId: 'cola', qty: 5000, boughtOnDay: 1 }],
    prices: { cola: 350 },
    rngState: 99,
  });
  const r = simulateCustomers(s, catalog, 1);
  assert.ok(Number.isSafeInteger(s.cashCents));
  assert.equal(s.cashCents, 90_000_000 + r.unitsSold * 350);
});
