// 存档升级。
//
// 策略：
// 1. 每个版本一个迁移函数，登记在 MIGRATIONS 里：key 是“源版本”，
//    读档时按顺序一路升级到最新。以后加字段就加一个函数，例如
//    MIGRATIONS[1] = (s) => { s.xxx = ...; return s; }，再把
//    SCHEMA_VERSION 提到 2。
// 2. 无论升到哪个版本，最后都会再跑一遍 v1 基础兜底（fillV1），
//    所以哪怕存档被手改过、缺了字段，也只会补缺，不会清档报错。

import { SCHEMA_VERSION } from './config.js';

function intOr(v, fallback, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : Number.NaN;
  if (Number.isNaN(n) || n < min || n > max) return { value: fallback, repaired: true };
  return { value: n, repaired: false };
}

function clone(value, fallback) {
  if (value === undefined || value === null) return structuredClone(fallback);
  try {
    return structuredClone(value);
  } catch {
    return structuredClone(fallback);
  }
}

// 字段级兜底：缺什么补什么，类型不对修什么
export function fillV1(data, base, warnings) {
  const s = clone(data, {});

  let r = intOr(s.cashCents, base.cashCents, { min: 0, max: Number.MAX_SAFE_INTEGER });
  s.cashCents = r.value;
  if (r.repaired) warnings.push('cashCents 非法，已用初始资金兜底');

  r = intOr(s.shelfSlots, base.shelfSlots, { min: 0, max: 100000 });
  s.shelfSlots = r.value;
  if (r.repaired) warnings.push('shelfSlots 非法，已兜底');

  r = intOr(s.dayLengthMs, base.dayLengthMs, { min: 1000, max: 24 * 3600 * 1000 });
  s.dayLengthMs = r.value;
  if (r.repaired) warnings.push('dayLengthMs 非法，已兜底');

  r = intOr(s.customersPerDay, base.customersPerDay, { min: 0, max: 1000000 });
  s.customersPerDay = r.value;
  if (r.repaired) warnings.push('customersPerDay 非法，已兜底');

  r = intOr(s.day, 1, { min: 1, max: 1e9 });
  s.day = r.value;
  if (r.repaired) warnings.push('day 非法，已兜底');

  if (typeof s.dayStartMs !== 'number' || !Number.isFinite(s.dayStartMs) || s.dayStartMs < 0) {
    s.dayStartMs = null; // 交给启动流程锚定
    warnings.push('dayStartMs 缺失，已重新锚定当前时间');
  }

  r = intOr(s.rngState, (0x12345678 ^ (s.day * 2654435761)) >>> 0, { min: 1, max: 0xffffffff });
  s.rngState = r.value >>> 0;
  if (r.repaired) warnings.push('rngState 缺失，已重建随机种子');

  if (!s.prices || typeof s.prices !== 'object' || Array.isArray(s.prices)) {
    s.prices = {};
    warnings.push('prices 缺失，已补为空表');
  } else {
    for (const [id, p] of Object.entries(s.prices)) {
      const fixed = intOr(p, null, { min: 0, max: Number.MAX_SAFE_INTEGER });
      if (fixed.repaired || fixed.value === null) {
        warnings.push(`prices.${id} 非法，已移除`);
        delete s.prices[id];
      } else {
        s.prices[id] = fixed.value;
      }
    }
  }

  const stock = [];
  if (!Array.isArray(s.stock)) {
    warnings.push('stock 缺失，已补为空货架');
  } else {
    for (const item of s.stock) {
      if (!item || typeof item !== 'object') {
        warnings.push('stock 中有非法条目，已丢弃');
        continue;
      }
      const qty = intOr(item.qty, null, { min: 1, max: 1e9 });
      const bought = intOr(item.boughtOnDay, s.day, { min: 1, max: 1e9 });
      if (typeof item.goodsId !== 'string' || !item.goodsId || qty.value === null) {
        warnings.push('stock 中有商品信息缺失的条目，已丢弃');
        continue;
      }
      stock.push({ goodsId: item.goodsId, qty: qty.value, boughtOnDay: bought.value });
    }
  }
  s.stock = stock;

  if (!Array.isArray(s.history)) s.history = [];
  if (!Array.isArray(s.anomalies)) s.anomalies = [];
  if (s.lastReport !== null && typeof s.lastReport !== 'object') s.lastReport = null;
  if (!s.today || typeof s.today !== 'object') {
    s.today = { revenueCents: 0, unitsSold: 0, customersServed: 0, customersLeft: 0 };
  } else {
    for (const k of ['revenueCents', 'unitsSold', 'customersServed', 'customersLeft']) {
      const fixed = intOr(s.today[k], 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
      s.today[k] = fixed.value;
    }
  }

  s.version = SCHEMA_VERSION;
  return s;
}

// 迁移步骤：key = 源版本。新增字段时在这里加。
// 例：
// MIGRATIONS[1] = (s) => {
//   if (!('membershipCents' in s)) s.membershipCents = 0;
//   return s;
// };
export const MIGRATIONS = {};

// 把任意老存档迁到最新版本。返回 { state, fromVersion, warnings }。
export function migrateSave(raw, base) {
  const warnings = [];
  let state;
  let fromVersion = 0;

  if (raw && typeof raw === 'object') {
    state = clone(raw, {});
    const v = intOr(state.version, 0, { min: 0, max: SCHEMA_VERSION });
    fromVersion = v.value;
    if (state.version === undefined || state.version === null) {
      warnings.push('存档没有版本号，按最老版本处理');
    } else if (v.repaired) {
      warnings.push('存档版本号非法，按最老版本处理');
    }
  } else {
    state = {};
    warnings.push('存档为空，按初始版本处理');
  }

  while (fromVersion < SCHEMA_VERSION) {
    const step = MIGRATIONS[fromVersion];
    if (step) state = step(state) ?? state;
    fromVersion += 1;
  }

  state = fillV1(state, base, warnings);
  return { state, fromVersion, warnings };
}