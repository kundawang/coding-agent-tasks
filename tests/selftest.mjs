// 纯 Node 自测：node tests/selftest.mjs
// 不依赖任何库；core.js / money.js / save.js 都是纯逻辑，可直接 import。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { formatYuan, parseYuanToCents } from "../js/money.js";
import {
  advanceTime,
  buyChancePermyriad,
  buyStock,
  simulateDay,
  suggestedPrice,
  usedSlots,
  MAX_CATCHUP_DAYS,
  CLOCK_SKEW_MS,
} from "../js/core.js";
import { normalizeState } from "../js/save.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const catalog = JSON.parse(readFileSync(join(root, "samples/goods.json"), "utf8")).goods;
const defaults = JSON.parse(readFileSync(join(root, "samples/store.json"), "utf8"));

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const goods = (id) => catalog.find((g) => g.id === id);

function freshState(over = {}) {
  return {
    cashCents: 500000,
    shelfSlots: 24,
    dayLengthMs: 240000,
    customersPerDay: 120,
    day: 1,
    dayStartMs: 1_000_000,
    lastSeenMs: 1_000_000,
    stock: [],
    prices: Object.fromEntries(
      catalog.map((g) => [g.id, suggestedPrice(g.costCents)])
    ),
    reports: [],
    events: [],
    ...over,
  };
}

// ---------- 金额：整数分，不产生 0.1+0.2 ----------

test("parseYuanToCents 走字符串，没有浮点误差", () => {
  assert.equal(parseYuanToCents("0.1"), 10n);
  assert.equal(parseYuanToCents("0.2"), 20n);
  assert.equal(parseYuanToCents("0.1") + parseYuanToCents("0.2"), 30n);
  assert.equal(parseYuanToCents("12"), 1200n);
  assert.equal(parseYuanToCents("12.3"), 1230n);
  assert.equal(parseYuanToCents("12.34"), 1234n);
  assert.equal(parseYuanToCents("12.345"), null);
  assert.equal(parseYuanToCents("abc"), null);
});

test("formatYuan 大数（几千万分以上）不失真、带千分位", () => {
  assert.equal(formatYuan(0), "0.00");
  assert.equal(formatYuan(5), "0.05");
  assert.equal(formatYuan(123456789012345), "1,234,567,890,123.45");
  assert.equal(formatYuan(-500), "-5.00");
});

// ---------- 定价曲线：高价没人买、低价不赚钱 ----------

test("购买率随价格单调下降，且差距足够明显", () => {
  const cost = 320;
  const cheap = buyChancePermyriad(cost, cost);
  const fair = buyChancePermyriad(suggestedPrice(cost), cost);
  const pricey = buyChancePermyriad(cost * 3, cost);
  const insane = buyChancePermyriad(cost * 10, cost);
  assert.equal(cheap, 9000);
  assert.equal(fair, 5000);
  assert.equal(pricey, 800);
  assert.equal(insane, 0);
  assert.ok(cheap > fair && fair > pricey && pricey >= insane);
  assert.equal(buyChancePermyriad(0, cost), 0);
});

// ---------- 日结算 ----------

test("simulateDay：定价 1 分几乎卖光，收入正确，天数 +1", () => {
  const state = freshState({
    stock: [{ goodsId: "milk", qty: 200, boughtOnDay: 1 }],
  });
  state.prices.milk = 1;
  const r = simulateDay(state, catalog, 1);
  assert.equal(state.day, 2);
  const qty = r.sold[0].qty;
  // 1 分定价成交率 90%，120 人期望 108，放宽松断言但和天价档拉开数量级
  assert.ok(qty >= 95, `定价 1 分应几乎卖光，实际只卖 ${qty}`);
  assert.equal(r.revenue, qty);
  assert.equal(r.cogs, qty * 320);
  assert.equal(state.stock[0].qty, 200 - qty);
  assert.equal(state.cashCents, 500000 + qty);
});

test("simulateDay：天价没人买，收入为 0", () => {
  const state = freshState({
    stock: [{ goodsId: "milk", qty: 50, boughtOnDay: 1 }],
  });
  state.prices.milk = 100000;
  const r = simulateDay(state, catalog, 1);
  assert.equal(r.revenue, 0);
  assert.equal(state.stock[0].qty, 50);
});

test("simulateDay：10 倍进价在 1000 顾客下严格零成交", () => {
  const state = freshState({
    customersPerDay: 1000,
    stock: [{ goodsId: "milk", qty: 1000, boughtOnDay: 1 }],
  });
  state.prices.milk = goods("milk").costCents * 10;
  const r = simulateDay(state, catalog, 1);
  assert.equal(r.revenue, 0);
  assert.equal(r.sold.length, 0);
});

test("simulateDay：过期按保质期丢弃并计报损", () => {
  const state = freshState({
    day: 4,
    stock: [{ goodsId: "bread", qty: 3, boughtOnDay: 1 }],
    customersPerDay: 0,
  });
  const r = simulateDay(state, catalog, 4);
  assert.equal(state.stock.length, 0);
  assert.equal(r.expired[0].qty, 3);
  assert.equal(r.expiredCost, 3 * 480);
  assert.equal(r.profit, -3 * 480);
});

test("simulateDay：先进先出，老批次优先卖掉", () => {
  const state = freshState({
    customersPerDay: 50,
    stock: [
      // 两批次量都很大，50 个顾客不可能卖光任何一批；
      // 若 FIFO 正确，只有 boughtOnDay=1 的批次被扣减。
      { goodsId: "milk", qty: 100, boughtOnDay: 1 },
      { goodsId: "milk", qty: 100, boughtOnDay: 3 },
    ],
  });
  state.prices.milk = 1;
  simulateDay(state, catalog, 3);
  assert.equal(state.stock.length, 2);
  const oldBatch = state.stock.find((b) => b.boughtOnDay === 1);
  const newBatch = state.stock.find((b) => b.boughtOnDay === 3);
  assert.ok(oldBatch.qty < 100, "老批次应被扣减");
  assert.equal(newBatch.qty, 100, "新批次不应被动");
  assert.ok(oldBatch.qty >= 30, "50 顾客 90% 成交率下老批次应还剩不少");
});

test("simulateDay：没库存时顾客流失，不崩", () => {
  const state = freshState();
  const r = simulateDay(state, catalog, 1);
  assert.equal(r.revenue, 0);
  assert.equal(state.day, 2);
});

// ---------- 进货 / 货架 ----------

test("buyStock：扣现金、并入同天批次、自动给默认价", () => {
  const state = freshState({ prices: {} });
  const res = buyStock(state, catalog, goods("milk"), 5);
  assert.ok(res.ok);
  assert.equal(state.cashCents, 500000 - 5 * 320);
  assert.equal(state.stock[0].qty, 5);
  assert.equal(state.prices.milk, suggestedPrice(320));
  const res2 = buyStock(state, catalog, goods("milk"), 2);
  assert.ok(res2.ok);
  assert.equal(state.stock.length, 1);
  assert.equal(state.stock[0].qty, 7);
});

test("buyStock：货架位不够拒绝，现金不变", () => {
  const state = freshState({
    stock: [{ goodsId: "milk", qty: 20, boughtOnDay: 1 }],
  });
  const before = state.cashCents;
  const res = buyStock(state, catalog, goods("milk"), 5);
  assert.ok(!res.ok);
  assert.equal(res.reason, "货架位不够");
  assert.equal(state.cashCents, before);
});

test("buyStock：现金不够拒绝", () => {
  const state = freshState({ cashCents: 100 });
  const res = buyStock(state, catalog, goods("milk"), 1);
  assert.ok(!res.ok);
  assert.equal(res.reason, "现金不够");
});

test("usedSlots 按商品目录的 slotSize 算", () => {
  const state = freshState({
    stock: [
      { goodsId: "egg", qty: 2, boughtOnDay: 1 },
      { goodsId: "milk", qty: 3, boughtOnDay: 1 },
    ],
  });
  assert.equal(usedSlots(state, catalog), 7);
});

// ---------- 离线补算 ----------

test("advanceTime：不足一天不结算、一关一开不白送", () => {
  const state = freshState();
  const r = advanceTime(state, catalog, state.lastSeenMs + 1000, state.lastSeenMs);
  assert.equal(r.days, 0);
  assert.equal(state.day, 1);
});

test("advanceTime：正常补 3 天，逐天结算、partialMs 正确", () => {
  const state = freshState({
    stock: [{ goodsId: "milk", qty: 1000, boughtOnDay: 1 }],
  });
  state.prices.milk = 1;
  const t0 = 1_000_000;
  state.lastSeenMs = t0;
  const r = advanceTime(state, catalog, t0 + 3 * 240000 + 5000, t0);
  assert.equal(r.days, 3);
  assert.equal(r.capped, false);
  assert.equal(r.partialMs, 5000);
  assert.equal(state.day, 4);
  assert.equal(r.reports.length, 3);
});

test("advanceTime：超过 7 天只补 7 天，标记 capped/skippedDays", () => {
  const state = freshState();
  const t0 = 2_000_000;
  const r = advanceTime(state, catalog, t0 + 30 * 240000, t0);
  assert.equal(r.days, MAX_CATCHUP_DAYS);
  assert.equal(r.capped, true);
  assert.equal(r.skippedDays, 30 - MAX_CATCHUP_DAYS);
  assert.equal(state.day, 1 + MAX_CATCHUP_DAYS);
  assert.equal(r.partialMs, 0);
});

// ---------- 时间回拨 ----------

test("advanceTime：大幅回拨 -> rollback，不补钱不推进不过期", () => {
  const state = freshState({
    day: 9,
    stock: [{ goodsId: "bread", qty: 2, boughtOnDay: 9 }],
  });
  const cashBefore = state.cashCents;
  const r = advanceTime(
    state,
    catalog,
    state.lastSeenMs - 10 * 240000,
    state.lastSeenMs
  );
  assert.equal(r.kind, "rollback");
  assert.ok(Math.abs(r.skewMs) > CLOCK_SKEW_MS);
  assert.equal(state.day, 9);
  assert.equal(state.cashCents, cashBefore);
  assert.equal(state.stock[0].qty, 2);
});

test("advanceTime：30 秒以内的回拨当作抖动忽略", () => {
  const state = freshState();
  const r = advanceTime(state, catalog, state.lastSeenMs - 5000, state.lastSeenMs);
  assert.equal(r.kind, "idle");
  assert.equal(state.day, 1);
});

test("advanceTime：没有时间锚点时什么也不补", () => {
  const state = freshState();
  const r = advanceTime(state, catalog, Date.now(), null);
  assert.equal(r.kind, "fresh");
  assert.equal(r.days, 0);
});

// ---------- 存档迁移 ----------

test("v1 存档（samples 形状）能迁移并补齐所有新字段", () => {
  const v1 = {
    cashCents: 12345,
    shelfSlots: 24,
    dayLengthMs: 240000,
    customersPerDay: 120,
    stock: [{ goodsId: "milk", qty: 6, boughtOnDay: 1 }],
    prices: { milk: 450 },
  };
  const { state, meta } = normalizeState(v1, defaults, catalog);
  assert.equal(meta.migrated, true);
  assert.equal(meta.fromVersion, 1);
  assert.equal(state.version, 2);
  assert.equal(state.cashCents, 12345);
  assert.equal(state.day, 1);
  assert.equal(state.shopName, "街角小店");
  assert.equal(state.lastSeenMs, null);
  assert.ok(Array.isArray(state.reports));
  assert.ok(Array.isArray(state.events));
  assert.equal(state.stock[0].goodsId, "milk");
  assert.equal(state.prices.cola, suggestedPrice(210));
});

test("缺字段/乱字段的存档被规范化兜底，不抛错", () => {
  const ugly = {
    version: 2,
    cashCents: "oops",
    stock: [
      { goodsId: "milk", qty: -3, boughtOnDay: 1 },
      { goodsId: "ghost_goods", qty: 9, boughtOnDay: 1 },
      "garbage",
    ],
    prices: { milk: "free" },
    events: [{ type: 123 }, "x"],
  };
  const { state } = normalizeState(ugly, defaults, catalog);
  assert.equal(state.cashCents, defaults.cashCents);
  assert.equal(state.stock.length, 0);
  assert.equal(state.prices.milk, suggestedPrice(320));
  assert.equal(state.events.length, 0);
});

test("未来版本存档保留数据并给出 future 标记", () => {
  const future = {
    version: 99,
    cashCents: 500,
    stock: [],
    prices: {},
    day: 3,
  };
  const { state, meta } = normalizeState(future, defaults, catalog);
  assert.equal(meta.future, true);
  assert.equal(meta.migrated, false);
  assert.equal(state.cashCents, 500);
  assert.equal(state.day, 3);
});

console.log(`\n全部通过：${passed} 个测试`);
