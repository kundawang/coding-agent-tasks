// 纯游戏逻辑：不碰 localStorage / DOM，方便用 Node 直接跑自测。
// 时间全部用真实毫秒时间戳（Date.now()），游戏天数 = 真实时间 / dayLengthMs。

export const SAVE_VERSION = 2;

// 离线（或关页）回来最多补算的整天数。
export const MAX_CATCHUP_DAYS = 7;

// 时间戳往回走小于这个值当作 NTP 校时误差，忽略。
export const CLOCK_SKEW_MS = 30 * 1000;

const clampInt = (v, lo, hi, fallback) => {
  const n = Number.isFinite(v) ? Math.trunc(v) : fallback;
  if (Number.isNaN(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

// 建议零售价：进价 1.5 倍，取整到分。
export function suggestedPrice(costCents) {
  return Math.round((Number(costCents) * 3) / 2);
}

// 一个顾客看到该商品、决定买的概率（万分比的整数，0~10000）。
// ratio = 售价 / 进价（浮点仅用于比值，钱本身仍是整数分）。
// 1.5 倍进价约 50% 购买率；低价能到接近 90%；贵到 10 倍以上基本没人买。
export function buyChancePermyriad(priceCents, costCents) {
  if (priceCents <= 0) return 0;
  const ratio = priceCents / costCents;
  if (ratio <= 1) return 9000;
  if (ratio <= 1.5) {
    return Math.round(9000 - ((ratio - 1) / 0.5) * 4000);
  }
  if (ratio <= 3) {
    return Math.round(5000 - ((ratio - 1.5) / 1.5) * 4200);
  }
  const p = Math.round(800 - ((ratio - 3) / 7) * 800);
  return clampInt(p, 0, 10000, 0);
}

function rollPermyriad() {
  return Math.floor(Math.random() * 10000);
}

// 已占用货架位（slotSize 以商品目录为准，不进存档）
export function usedSlots(state, catalog) {
  const sizeOf = new Map(catalog.map((g) => [g.id, g.slotSize]));
  return state.stock.reduce(
    (sum, b) => sum + b.qty * (sizeOf.get(b.goodsId) ?? 1),
    0
  );
}

// 结算一天：
//  1) 按 popularity 分流 customersPerDay 个顾客，按定价决定买不买；
//  2) 卖掉的按批次先进先出扣库存；
//  3) 当天结束时保质期到期（boughtOnDay + shelfLifeDays <= day+1）的批次扔掉；
//  4) day += 1。
// 返回当天报表（直接修改 state 并返回报表）。
export function simulateDay(state, catalog, day) {
  const goodsById = new Map(catalog.map((g) => [g.id, g]));
  const stock = state.stock.map((b) => ({ ...b }));
  const customers = clampInt(state.customersPerDay ?? 120, 0, 1_000_000, 120);

  const sold = [];
  const byId = new Map();

  for (let i = 0; i < customers; i++) {
    const choices = stock.filter((b) => b.qty > 0);
    if (choices.length === 0) break;

    // 商品权重 = 受欢迎程度（同商品多个批次共享权重）
    let totalWeight = 0;
    for (const b of choices) {
      const g = goodsById.get(b.goodsId);
      totalWeight += g ? Math.max(1, Math.round(g.popularity * 100)) : 1;
    }
    let pick = Math.random() * totalWeight;
    let target = null;
    for (const b of choices) {
      const g = goodsById.get(b.goodsId);
      pick -= g ? Math.max(1, Math.round(g.popularity * 100)) : 1;
      if (pick < 0) {
        target = b;
        break;
      }
    }
    if (!target) target = choices[0];

    const g = goodsById.get(target.goodsId);
    const price = state.prices[target.goodsId] ?? suggestedPrice(g.costCents);
    if (rollPermyriad() >= buyChancePermyriad(price, g.costCents)) continue;

    // 成交：先进先出扣批次
    const batch = stock
      .filter((b) => b.goodsId === target.goodsId && b.qty > 0)
      .sort((a, b) => a.boughtOnDay - b.boughtOnDay)[0];
    if (!batch) continue;
    batch.qty -= 1;

    let row = byId.get(target.goodsId);
    if (!row) {
      row = { goodsId: target.goodsId, qty: 0, revenue: 0, cost: 0 };
      byId.set(target.goodsId, row);
      sold.push(row);
    }
    row.qty += 1;
    row.revenue += price;
    row.cost += g.costCents;
  }

  // 丢掉空批次，再处理过期：第 day 天结束、即将进入第 day+1 天，
  // boughtOnDay + shelfLifeDays <= day+1 的已经撑不到开卖。
  const expired = [];
  const remaining = [];
  for (const b of stock) {
    if (b.qty <= 0) continue;
    const g = goodsById.get(b.goodsId);
    if (g && b.boughtOnDay + g.shelfLifeDays <= day + 1) {
      expired.push({ goodsId: b.goodsId, qty: b.qty, cost: b.qty * g.costCents });
    } else {
      remaining.push({ goodsId: b.goodsId, qty: b.qty, boughtOnDay: b.boughtOnDay });
    }
  }

  const revenue = sold.reduce((s, r) => s + r.revenue, 0);
  const cogs = sold.reduce((s, r) => s + r.cost, 0);
  const expiredCost = expired.reduce((s, r) => s + r.cost, 0);

  state.stock = remaining;
  state.cashCents += revenue;
  state.day = day + 1;

  const report = {
    day,
    revenue,
    cogs,
    expiredCost,
    profit: revenue - cogs - expiredCost,
    sold,
    expired,
  };
  state.reports.unshift(report);
  if (state.reports.length > 60) state.reports.length = 60;
  return report;
}

// 进货：校验现金和货架位，扣钱、并入同天批次。
export function buyStock(state, catalog, goods, qty) {
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: "数量不对" };
  const cost = goods.costCents * qty;
  if (state.cashCents < cost) return { ok: false, reason: "现金不够" };
  const slotsNeed = goods.slotSize * qty;
  if (usedSlots(state, catalog) + slotsNeed > state.shelfSlots) {
    return { ok: false, reason: "货架位不够" };
  }
  state.cashCents -= cost;
  const existing = state.stock.find(
    (b) => b.goodsId === goods.id && b.boughtOnDay === state.day
  );
  if (existing) {
    existing.qty += qty;
  } else {
    state.stock.push({ goodsId: goods.id, qty, boughtOnDay: state.day });
  }
  if (state.prices[goods.id] === undefined) {
    state.prices[goods.id] = suggestedPrice(goods.costCents);
  }
  return { ok: true };
}

// 把时间从 lastSeenMs 推进到 nowMs（在线 tick / 关页回来同一套逻辑）。
// 不写 events，调用方根据返回值决定怎么提示。
// partialMs：保留下来的"当前天已过毫秒数"，供 UI 对齐进度条。
export function advanceTime(state, catalog, nowMs, lastSeenMs) {
  if (typeof lastSeenMs !== "number") {
    return { kind: "fresh", days: 0, capped: false, reports: [], partialMs: 0 };
  }

  const delta = nowMs - lastSeenMs;
  if (delta < 0 && Math.abs(delta) > CLOCK_SKEW_MS) {
    // 时间明显回拨：回拨区间一律不补收益、不推进天数、商品也不因此过期。
    return {
      kind: "rollback",
      days: 0,
      capped: false,
      reports: [],
      skewMs: delta,
      partialMs: 0,
    };
  }
  if (delta <= 0) {
    // 小的回拨抖动（<=30s）或同一毫秒：忽略。
    return { kind: "idle", days: 0, capped: false, reports: [], partialMs: 0 };
  }

  const fullDays = Math.floor(delta / state.dayLengthMs);
  if (fullDays <= 0) {
    return { kind: "idle", days: 0, capped: false, reports: [], partialMs: delta };
  }

  const days = Math.min(fullDays, MAX_CATCHUP_DAYS);
  const reports = [];
  for (let i = 0; i < days; i++) {
    reports.push(simulateDay(state, catalog, state.day));
  }
  const partialMs =
    fullDays > MAX_CATCHUP_DAYS ? 0 : delta - fullDays * state.dayLengthMs;
  return {
    kind: days >= 2 ? "catchup" : "interval",
    days,
    capped: fullDays > MAX_CATCHUP_DAYS,
    skippedDays: Math.max(0, fullDays - days),
    reports,
    partialMs,
  };
}
