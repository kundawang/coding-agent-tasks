// localStorage 存档：带版本号的迁移链。
// 读到老存档 -> 逐级 migrate 到 SAVE_VERSION，缺字段一律补默认值，不清档。

import { SAVE_VERSION, suggestedPrice } from "./core.js";

const STORAGE_KEY = "cornerstore.save.v1";
const BACKUP_SUFFIX = ".corrupt-backup";

const MAX_EVENTS = 50;

// ---- 迁移函数：每个函数把存档从版本 N 升到 N+1 ----

// v1 -> v2：v1 就是 samples/store.json 的形状，补齐运营字段。
function migrate1to2(save) {
  save.version = 2;
  save.shopName = "街角小店";
  save.day = 1;
  save.dayStartMs = null;
  save.lastSeenMs = null;
  save.reports = [];
  save.events = [];
  return save;
}

const MIGRATIONS = {
  1: migrate1to2,
};

function migrate(raw) {
  let save = raw && typeof raw === "object" ? raw : {};
  let fromVersion = Number.isInteger(save.version) ? save.version : 1;
  if (fromVersion < 1) fromVersion = 1;

  // 未来版本（在别处玩了新版又回老版）：不删档，原样交给规范化层兜底。
  if (fromVersion > SAVE_VERSION) {
    return { save, fromVersion, migrated: false, future: true };
  }

  let version = fromVersion;
  let migrated = false;
  while (version < SAVE_VERSION) {
    const fn = MIGRATIONS[version];
    if (!fn) break;
    save = fn(save);
    version += 1;
    migrated = true;
  }
  save.version = SAVE_VERSION;
  return { save, fromVersion, migrated, future: false };
}

// 规范化：任何来源（老存档 / 未来版本 / 手滑改坏）缺的字段都补上，
// 类型不对的丢掉，保证下游拿到的形状始终合法。
export function normalizeState(raw, defaults, catalog) {
  const { save, fromVersion, migrated, future } = migrate(raw);
  const goodsById = new Map(catalog.map((g) => [g.id, g]));

  const state = {
    version: SAVE_VERSION,
    shopName:
      typeof save.shopName === "string" && save.shopName ? save.shopName : "街角小店",
    cashCents: intOr(save.cashCents, defaults.cashCents),
    shelfSlots: intOr(save.shelfSlots, defaults.shelfSlots),
    dayLengthMs: intOr(save.dayLengthMs, defaults.dayLengthMs),
    customersPerDay: intOr(save.customersPerDay, defaults.customersPerDay),
    day: intOr(save.day, 1),
    dayStartMs: typeof save.dayStartMs === "number" ? save.dayStartMs : null,
    lastSeenMs: typeof save.lastSeenMs === "number" ? save.lastSeenMs : null,
  };

  state.stock = Array.isArray(save.stock)
    ? save.stock
        .filter((b) => b && goodsById.has(b.goodsId))
        .map((b) => ({
          goodsId: b.goodsId,
          qty: Math.max(0, intOr(b.qty, 0)),
          boughtOnDay: Math.max(1, intOr(b.boughtOnDay, state.day)),
        }))
        .filter((b) => b.qty > 0)
    : [];

  state.prices = {};
  for (const g of catalog) {
    const p = save.prices && save.prices[g.id];
    state.prices[g.id] =
      Number.isInteger(p) && p >= 0 ? p : suggestedPrice(g.costCents);
  }

  state.reports = Array.isArray(save.reports)
    ? save.reports
        .filter((r) => r && Number.isInteger(r.day))
        .slice(0, 60)
        .map((r) => ({
          day: r.day,
          revenue: intOr(r.revenue, 0),
          cogs: intOr(r.cogs, 0),
          expiredCost: intOr(r.expiredCost, 0),
          profit: intOr(r.profit, 0),
          sold: Array.isArray(r.sold) ? r.sold : [],
          expired: Array.isArray(r.expired) ? r.expired : [],
        }))
    : [];

  state.events = Array.isArray(save.events)
    ? save.events
        .filter((e) => e && typeof e.type === "string")
        .slice(-MAX_EVENTS)
        .map((e) => ({
          type: String(e.type),
          atMs: intOr(e.atMs, Date.now()),
          detail: e.detail && typeof e.detail === "object" ? e.detail : {},
        }))
    : [];

  return { state, meta: { fromVersion, migrated, future } };
}

function intOr(v, fallback) {
  return Number.isFinite(v) && Number.isInteger(v) ? v : fallback;
}

// 从 localStorage 读档；没有存档返回 raw:null。
// JSON 损坏时备份原文后按"无存档"处理（不清档报错/白屏）。
export function loadRaw() {
  let text = null;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { raw: null, corrupt: false, blocked: true };
  }
  if (text === null) return { raw: null, corrupt: false, blocked: false };
  try {
    return { raw: JSON.parse(text), corrupt: false, blocked: false };
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY + BACKUP_SUFFIX, text);
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 配额满或被禁用也不影响新开档 */
    }
    return { raw: null, corrupt: true, blocked: false };
  }
}

export function persist(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function wipeSave() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function pushEvent(state, type, detail = {}) {
  state.events.push({ type, atMs: Date.now(), detail });
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }
}
