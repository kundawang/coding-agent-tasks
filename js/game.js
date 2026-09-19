// 核心经营模拟。所有金额一律整数分；天数是整数游戏日。
//
// 时间模型：
//   state.dayStartMs 是“当前游戏日开始”的真实毫秒时间戳，
//   当前日进度 = now - dayStartMs，一天长度 dayLengthMs。
//   推进时间时按 floor(进度 / dayLengthMs) 结算整数个完整日。

import {
  MAX_CATCHUP_DAYS,
  ROLLBACK_IGNORE_MS,
  PRICE_ZERO_MARGIN,
  PRICE_FULL_MARGIN,
  PRICE_EXP,
  LEAVE_WEIGHT,
  HISTORY_LIMIT,
  ANOMALY_LIMIT,
} from './config.js';
import { poisson, nextState } from './rng.js';

export function buildCatalog(goodsList) {
  return new Map(goodsList.map((g) => [g.id, g]));
}

export function defaultPrice(costCents) {
  return Math.max(1, Math.round(costCents * 1.3));
}

function emptyToday() {
  return { revenueCents: 0, unitsSold: 0, customersServed: 0, customersLeft: 0 };
}

export function makeInitialState(store, nowMs) {
  const seed =
    ((nowMs >>> 0) ^
      (Math.floor(Math.random() * 0xffffffff) >>> 0) ^
      0x9e3779b9) >>>
    0;
  return {
    version: 1,
    cashCents: store.cashCents,
    shelfSlots: store.shelfSlots,
    dayLengthMs: store.dayLengthMs,
    customersPerDay: store.customersPerDay,
    day: 1,
    dayStartMs: nowMs,
    rngState: seed === 0 ? 1 : seed,
    stock: structuredClone(store.stock ?? []),
    prices: structuredClone(store.prices ?? {}),
    today: emptyToday(),
    history: [],
    anomalies: [],
    lastReport: null,
  };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// 定价吸引力 0~1。售价 = 进价时为 1；售价到进价 1.8 倍时归零。
// 免费（0 分）视为吸引力 1，但赚不到钱。
export function priceAttractiveness(priceCents, costCents) {
  if (priceCents === 0) return 1;
  if (!(priceCents > 0)) return 0;
  if (!(costCents > 0)) return 0.5; // 目录缺失进价时给个中庸值
  const ratio = priceCents / costCents;
  const linear =
    (PRICE_ZERO_MARGIN - ratio) / (PRICE_ZERO_MARGIN - PRICE_FULL_MARGIN);
  return Math.pow(clamp01(linear), PRICE_EXP);
}

export function usedSlots(state, catalog) {
  let used = 0;
  for (const batch of state.stock) {
    const g = catalog.get(batch.goodsId);
    used += batch.qty * (g ? g.slotSize : 1);
  }
  return used;
}

// 该批次在 day 这天开门时是否还在保质期内
export function batchFreshOn(batch, catalog, day) {
  const g = catalog.get(batch.goodsId);
  if (!g) return true; // 目录里没有的商品不判过期
  return batch.boughtOnDay + g.shelfLifeDays > day;
}

export function pushAnomaly(state, entry) {
  state.anomalies.push(entry);
  if (state.anomalies.length > ANOMALY_LIMIT) {
    state.anomalies.splice(0, state.anomalies.length - ANOMALY_LIMIT);
  }
}

// 进货：扣钱、占货架位；同一天进的同款并入同一批次（FIFO 好记账）
export function buyGoods(state, catalog, goodsId, qty) {
  const goods = catalog.get(goodsId);
  if (!goods) return { ok: false, reason: '商品目录里没有这个商品' };
  if (!Number.isSafeInteger(qty) || qty <= 0) {
    return { ok: false, reason: '数量必须是正整数' };
  }
  const costCents = goods.costCents * qty;
  if (state.cashCents < costCents) return { ok: false, reason: '现金不够进货' };
  const needSlots = goods.slotSize * qty;
  if (usedSlots(state, catalog) + needSlots > state.shelfSlots) {
    return { ok: false, reason: '货架位不够，先进不了这么多' };
  }
  state.cashCents -= costCents;
  const existing = state.stock.find(
    (b) => b.goodsId === goodsId && b.boughtOnDay === state.day,
  );
  if (existing) {
    existing.qty += qty;
  } else {
    state.stock.push({ goodsId, qty, boughtOnDay: state.day });
  }
  if (!Number.isInteger(state.prices[goodsId])) {
    state.prices[goodsId] = defaultPrice(goods.costCents);
  }
  return { ok: true, costCents };
}

export function setPrice(state, goodsId, priceCents) {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) {
    return { ok: false, reason: '价格必须是非负整数分' };
  }
  state.prices[goodsId] = priceCents;
  return { ok: true };
}
// 从最老批次卖出一件（先进先卖，尽量减少过期浪费）
function sellOneFIFO(state, goodsId) {
  let oldestIdx = -1;
  let oldestDay = Infinity;
  for (let i = 0; i < state.stock.length; i += 1) {
    const b = state.stock[i];
    if (b.goodsId === goodsId && b.qty > 0 && b.boughtOnDay < oldestDay) {
      oldestDay = b.boughtOnDay;
      oldestIdx = i;
    }
  }
  if (oldestIdx < 0) return false;
  const batch = state.stock[oldestIdx];
  batch.qty -= 1;
  if (batch.qty <= 0) state.stock.splice(oldestIdx, 1);
  return true;
}

// 模拟一段时间内的顾客。fraction 是这段时间占一天的比例
// （整天传 1，日内补算传 partialMs / dayLengthMs）。
// 顾客数按泊松分布抽样；每个顾客按 popularity * 定价吸引力 加权挑商品。
export function simulateCustomers(state, catalog, fraction) {
  const result = {
    customers: 0,
    served: 0,
    left: 0,
    unitsSold: 0,
    revenueCents: 0,
  };
  if (fraction <= 0) return result;
  const lambda = state.customersPerDay * fraction;
  const draw = poisson(state.rngState, lambda);
  state.rngState = draw.state;
  result.customers = draw.value;

  for (let c = 0; c < result.customers; c += 1) {
    const options = [];
    let weightSum = 0;
    for (const batch of state.stock) {
      if (batch.qty <= 0 || !batchFreshOn(batch, catalog, state.day)) continue;
      if (options.some((o) => o.goodsId === batch.goodsId)) continue;
      const goods = catalog.get(batch.goodsId);
      const price = state.prices[batch.goodsId];
      if (!goods || !Number.isInteger(price)) continue; // 没定价 = 不上架卖
      const weight = goods.popularity * priceAttractiveness(price, goods.costCents);
      if (weight <= 0) continue;
      options.push({ goodsId: batch.goodsId, price, weight });
      weightSum += weight;
    }

    const roll = nextState(state.rngState);
    state.rngState = roll.state;
    const target = roll.value * (weightSum + LEAVE_WEIGHT);
    if (target >= weightSum) {
      result.left += 1;
      state.today.customersLeft += 1;
      continue;
    }
    let acc = 0;
    let chosen = null;
    for (const opt of options) {
      acc += opt.weight;
      if (target < acc) {
        chosen = opt;
        break;
      }
    }
    if (chosen && sellOneFIFO(state, chosen.goodsId)) {
      state.cashCents += chosen.price;
      state.today.revenueCents += chosen.price;
      state.today.unitsSold += 1;
      state.today.customersServed += 1;
      result.served += 1;
      result.unitsSold += 1;
      result.revenueCents += chosen.price;
    } else {
      result.left += 1;
      state.today.customersLeft += 1;
    }
  }
  return result;
}

// 一天开门时先扔过期货（boughtOnDay + shelfLifeDays <= 今天）
function expireAtStart(state, catalog, day) {
  const expired = [];
  const kept = [];
  for (const batch of state.stock) {
    if (!batchFreshOn(batch, catalog, day)) {
      const prev = expired.find((e) => e.goodsId === batch.goodsId);
      if (prev) prev.qty += batch.qty;
      else expired.push({ goodsId: batch.goodsId, qty: batch.qty });
    } else {
      kept.push(batch);
    }
  }
  state.stock = kept;
  return expired;
}

// 结算一个完整日：做生意 -> 翻篇 -> 扔新一天的过期货。
function settleFullDay(state, catalog) {
  const dayNumber = state.day;
  simulateCustomers(state, catalog, 1);
  state.day += 1;
  const expired = expireAtStart(state, catalog, state.day);
  const entry = {
    day: dayNumber,
    revenueCents: state.today.revenueCents,
    unitsSold: state.today.unitsSold,
    customersServed: state.today.customersServed,
    customersLeft: state.today.customersLeft,
    expired,
  };
  state.history.push(entry);
  if (state.history.length > HISTORY_LIMIT) {
    state.history.splice(0, state.history.length - HISTORY_LIMIT);
  }
  state.today = emptyToday();
  return entry;
}

// 推进游戏时钟。
// offline=true 时按 MAX_CATCHUP_DAYS 封顶；时钟回拨永远不补收益。
// 返回本次推进的明细，供界面出“离线结算/异常”报告。
export function advanceTime(state, catalog, nowMs, { offline = false } = {}) {
  const report = {
    elapsedMs: 0,
    grantedMs: 0,
    daysSettled: 0,
    cappedDays: 0,
    rollback: null,
    revenueCents: 0,
    unitsSold: 0,
    customersServed: 0,
    customersLeft: 0,
    expired: [],
    entries: [],
  };

  const last = state.dayStartMs ?? nowMs;
  const elapsed = nowMs - last;
  report.elapsedMs = elapsed;

  let grantedMs = 0;
  let clockRolledBack = false;
  if (elapsed < -ROLLBACK_IGNORE_MS) {
    // 本地时间明显往回走：不照着补收益，游戏时钟重新锚到“现在”。
    // 策略是“往保守靠”：不罚没已赚到的现金/库存，也不送任何一天，
    // 当天未走完的时间进度清零重计，并在异常列表里留痕。
    clockRolledBack = true;
    report.rollback = { deltaMs: elapsed, atMs: nowMs };
    pushAnomaly(state, {
      type: 'rollback',
      atMs: nowMs,
      deltaMs: elapsed,
      detail: `检测到系统时间回拨约 ${Math.round(-elapsed / 1000)} 秒，本次不结算任何收益，游戏时钟已重置到当天开头`,
    });
  } else if (elapsed >= 0) {
    grantedMs = elapsed;
  }
  // 负得很少（NTP 校时抖动之类）：忽略，锚点和进度都不动

  let fullDays = Math.floor(grantedMs / state.dayLengthMs);
  if (offline && fullDays > MAX_CATCHUP_DAYS) {
    report.cappedDays = fullDays - MAX_CATCHUP_DAYS;
    fullDays = MAX_CATCHUP_DAYS;
    // 只认前 fullDays 整天 + 最后一个日内零头；更早的时间整个丢弃
    grantedMs = fullDays * state.dayLengthMs + (grantedMs % state.dayLengthMs);
    pushAnomaly(state, {
      type: 'cap',
      atMs: nowMs,
      skippedDays: report.cappedDays,
      detail: `离线时间超过 ${MAX_CATCHUP_DAYS} 天上限，多出的 ${report.cappedDays} 天未结算`,
    });
  }
  report.grantedMs = grantedMs;
  report.daysSettled = fullDays;

  for (let i = 0; i < fullDays; i += 1) {
    const entry = settleFullDay(state, catalog);
    report.entries.push(entry);
    report.revenueCents += entry.revenueCents;
    report.unitsSold += entry.unitsSold;
    report.customersServed += entry.customersServed;
    report.customersLeft += entry.customersLeft;
    for (const e of entry.expired) {
      const prev = report.expired.find((x) => x.goodsId === e.goodsId);
      if (prev) prev.qty += e.qty;
      else report.expired.push({ ...e });
    }
  }

  // 对齐“当前日开始”锚点：封顶时丢掉的天数不能残留在日内进度里
  if (clockRolledBack || elapsed >= 0) {
    state.dayStartMs = nowMs - (grantedMs - fullDays * state.dayLengthMs);
  }

  // 最后一天的日内零头：按比例抽顾客，收入计入“今天”
  const partialMs = grantedMs - fullDays * state.dayLengthMs;
  if (partialMs > 0) {
    const partial = simulateCustomers(state, catalog, partialMs / state.dayLengthMs);
    report.revenueCents += partial.revenueCents;
    report.unitsSold += partial.unitsSold;
    report.customersServed += partial.served;
    report.customersLeft += partial.left;
  }

  if (
    clockRolledBack ||
    report.daysSettled > 0 ||
    report.cappedDays > 0 ||
    report.revenueCents > 0 ||
    report.unitsSold > 0
  ) {
    state.lastReport = {
      atMs: nowMs,
      offline,
      daysSettled: report.daysSettled,
      cappedDays: report.cappedDays,
      rollback: report.rollback,
      revenueCents: report.revenueCents,
      unitsSold: report.unitsSold,
      customersServed: report.customersServed,
      customersLeft: report.customersLeft,
      expired: report.expired,
    };
  }

  return report;
}