import { loadConfig } from "./config.js";
import { formatYuan, parseYuanToCents } from "./money.js";
import {
  advanceTime,
  buyChancePermyriad,
  buyStock,
  suggestedPrice,
  usedSlots,
  MAX_CATCHUP_DAYS,
} from "./core.js";
import { loadRaw, normalizeState, persist, pushEvent, wipeSave } from "./save.js";

let catalog;
let goodsById;
let defaults;
let state;

const el = (id) => document.getElementById(id);

async function boot() {
  let loaded;
  try {
    loaded = await loadConfig();
  } catch (err) {
    el("fatal").hidden = false;
    el("fatal").textContent =
      (location.protocol === "file:"
        ? "直接双击打开 HTML 时浏览器会禁止读取 samples 数据。请用任意静态服务器打开本目录，"
        : "素材读取失败：") + (err && err.message ? err.message : String(err));
    return;
  }
  catalog = loaded.catalog;
  defaults = loaded.defaults;
  goodsById = new Map(catalog.map((g) => [g.id, g]));

  const { raw, corrupt, blocked } = loadRaw();
  const normalized = normalizeState(raw, defaults, catalog);
  state = normalized.state;

  const now = Date.now();
  const notices = [];

  if (corrupt) {
    notices.push({
      type: "corrupt",
      text: "旧存档损坏无法解析，已把原文另存备份并新开一档，没有直接删掉。",
    });
    pushEvent(state, "corrupt-reset", {});
  }
  if (blocked) {
    notices.push({ type: "blocked", text: "浏览器禁用了 localStorage，进度不会被保存。" });
  }
  if (normalized.meta.migrated && raw !== null && typeof raw === "object") {
    notices.push({
      type: "migrated",
      text: `存档已从 v${normalized.meta.fromVersion} 自动升级到 v${state.version}，老数据完整保留。`,
    });
    pushEvent(state, "save-migrated", {
      from: normalized.meta.fromVersion,
      to: state.version,
    });
  }
  if (normalized.meta.future) {
    notices.push({
      type: "future",
      text: `存档来自更新版本（v${normalized.meta.fromVersion}），当前版本可能不认识新字段。`,
    });
  }

  if (raw === null && !corrupt) {
    state.stock = defaults.stock
      .filter((b) => goodsById.has(b.goodsId))
      .map((b) => ({
        goodsId: b.goodsId,
        qty: b.qty,
        boughtOnDay: b.boughtOnDay ?? 1,
      }));
    state.dayStartMs = now;
    state.lastSeenMs = now;
  } else if (state.lastSeenMs === null || state.dayStartMs === null) {
    state.lastSeenMs = now;
    state.dayStartMs = now;
  } else {
    notices.push(...applyTimeAdvance(now));
  }

  el("reset-btn").addEventListener("click", () => {
    if (window.confirm("确定清档重开？当前现金、库存和记录都会消失。")) {
      wipeSave();
      location.reload();
    }
  });

  renderNotices(notices);
  renderAll();
  persist(state);

  setInterval(tick, 5000);
  setInterval(renderProgress, 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
  });
  window.addEventListener("online", tick);
  window.addEventListener("beforeunload", () => persist(state));
  setInterval(() => persist(state), 15000);
}

// 推进时间并返回需要给玩家看的横幅；事件记账在这里完成。
function applyTimeAdvance(now) {
  const notices = [];
  const result = advanceTime(state, catalog, now, state.lastSeenMs);
  state.lastSeenMs = now;

  if (result.kind === "rollback") {
    const mins = Math.max(1, Math.round(Math.abs(result.skewMs) / 60000));
    notices.push({
      type: "rollback",
      text:
        `检测到系统时间往回拨了约 ${mins} 分钟：这段时间不计任何收益、不推进日期，` +
        "商品也不因此过期。把时间调回去后继续等即可正常过天。",
    });
    pushEvent(state, "clock-rollback", { skewMs: result.skewMs });
    return notices;
  }

  if (result.days > 0) {
    const revenue = result.reports.reduce((s, r) => s + r.revenue, 0);
    const profit = result.reports.reduce((s, r) => s + r.profit, 0);
    const expiredCost = result.reports.reduce((s, r) => s + r.expiredCost, 0);
    if (result.kind === "catchup") {
      let text =
        `你离开了一阵子，按营业时间补算了 ${result.days} 天` +
        `（最多补 ${MAX_CATCHUP_DAYS} 天）：` +
        `营业收入 ${formatYuan(revenue)} 元，净利润 ${formatYuan(profit)} 元` +
        (expiredCost > 0 ? `，过期报损 ${formatYuan(expiredCost)} 元` : "") +
        "。明细见下方每日报表。";
      if (result.capped) {
        text += ` 另有 ${result.skippedDays} 天超出上限，没有补算。`;
      }
      notices.push({ type: "catchup", text });
    }
    pushEvent(state, "offline-settled", {
      days: result.days,
      revenue,
      profit,
      expiredCost,
      capped: result.capped,
      skippedDays: result.skippedDays ?? 0,
    });
  }
  // 回拨分支已提前 return。走到这里时间一直向前：
  // 用实际保留的时长（受七天上限约束）对齐今天起点，
  // 被丢弃的天数不参与进度计算。
  state.dayStartMs = now - (result.partialMs ?? 0);
  return notices;
}

function tick() {
  const before = state.reports.length;
  const now = Date.now();
  const notices = applyTimeAdvance(now);
  renderNotices(notices);
  if (notices.length > 0 || state.reports.length !== before) persist(state);
  renderAll();
}

function renderNotices(notices) {
  const box = el("notices");
  for (const n of notices) {
    const div = document.createElement("div");
    div.className = `notice notice-${n.type}`;
    div.textContent = n.text;
    const close = document.createElement("button");
    close.className = "notice-close";
    close.textContent = "×";
    close.addEventListener("click", () => div.remove());
    div.appendChild(close);
    box.appendChild(div);
  }
}

function renderAll() {
  el("shop-name").textContent = state.shopName;
  el("stat-day").textContent = `第 ${state.day} 天`;
  el("stat-cash").textContent = `${formatYuan(state.cashCents)} 元`;
  el("stat-slots").textContent = `${usedSlots(state, catalog)} / ${state.shelfSlots}`;
  renderProgress();
  renderGoods();
  renderStock();
  renderReports();
  renderEvents();
}

function renderProgress() {
  const now = Date.now();
  const elapsed = Math.max(0, now - state.dayStartMs);
  const pct = Math.min(100, (elapsed / state.dayLengthMs) * 100);
  el("day-progress-bar").style.width = `${pct}%`;
  const remainMs = Math.max(0, state.dayLengthMs - (elapsed % state.dayLengthMs));
  const secs = Math.ceil(remainMs / 1000);
  el("day-progress-text").textContent =
    `距本日结算还有 ${Math.floor(secs / 60)} 分 ${secs % 60} 秒`;
}

function renderGoods() {
  const tbody = el("goods-body");
  tbody.innerHTML = "";
  for (const g of catalog) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = g.name;
    tr.appendChild(nameTd);

    const costTd = document.createElement("td");
    costTd.textContent = `${formatYuan(g.costCents)} 元`;
    tr.appendChild(costTd);

    const priceTd = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.className = "price-input";
    input.value = yuanInputValue(state.prices[g.id]);
    const hint = document.createElement("span");
    hint.className = "chance-hint";
    const refreshHint = () => {
      const cents = parseYuanToCents(input.value);
      if (cents === null || cents < 0n) {
        hint.textContent = "价格非法（最多两位小数）";
        hint.dataset.tone = "bad";
        return;
      }
      const chance = buyChancePermyriad(Number(cents), g.costCents);
      hint.textContent =
        cents === 0n
          ? "白送：成交率 0%，也不挣钱"
          : `顾客成交率约 ${(chance / 100).toFixed(1)}%（建议价 ${formatYuan(
              suggestedPrice(g.costCents)
            )} 元）`;
      hint.dataset.tone = chance >= 5000 ? "good" : chance >= 1000 ? "mid" : "bad";
    };
    input.addEventListener("input", refreshHint);
    input.addEventListener("change", () => {
      const cents = parseYuanToCents(input.value);
      if (cents === null || cents < 0n) {
        input.value = yuanInputValue(state.prices[g.id]);
        refreshHint();
        return;
      }
      state.prices[g.id] = Number(cents);
      input.value = yuanInputValue(state.prices[g.id]);
      refreshHint();
      persist(state);
    });
    priceTd.appendChild(input);
    priceTd.appendChild(hint);
    tr.appendChild(priceTd);
    refreshHint();

    const buyTd = document.createElement("td");
    const qty = document.createElement("input");
    qty.type = "number";
    qty.min = "1";
    qty.value = "1";
    qty.className = "qty-input";
    const btn = document.createElement("button");
    btn.textContent = "进货";
    btn.addEventListener("click", () => {
      const n = Math.trunc(Number(qty.value));
      const res = buyStock(state, catalog, g, n);
      if (!res.ok) {
        flashButton(btn, res.reason);
        return;
      }
      persist(state);
      renderAll();
    });
    buyTd.append(qty, btn);
    const slotHint = document.createElement("span");
    slotHint.className = "muted";
    slotHint.textContent = ` 占 ${g.slotSize} 位 · 保质期 ${g.shelfLifeDays} 天`;
    buyTd.appendChild(slotHint);
    tr.appendChild(buyTd);

    tbody.appendChild(tr);
  }
}

function flashButton(btn, msg) {
  const old = btn.textContent;
  btn.textContent = msg;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = old;
    btn.disabled = false;
  }, 1200);
}

// 分 -> 输入框元字符串。输入框只用于录入，金额运算不走它。
function yuanInputValue(cents) {
  return (Number(cents) / 100).toString();
}

function renderStock() {
  const tbody = el("stock-body");
  tbody.innerHTML = "";
  if (state.stock.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "muted";
    td.textContent = "货架空空，赶紧进货。";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  // 按商品合并批次展示，标出最早一批的剩余保质期。
  const merged = new Map();
  for (const b of state.stock) {
    const g = goodsById.get(b.goodsId);
    if (!g) continue;
    let row = merged.get(b.goodsId);
    if (!row) {
      row = { goodsId: b.goodsId, qty: 0, earliest: b.boughtOnDay };
      merged.set(b.goodsId, row);
    }
    row.qty += b.qty;
    row.earliest = Math.min(row.earliest, b.boughtOnDay);
  }
  for (const row of merged.values()) {
    const g = goodsById.get(row.goodsId);
    const tr = document.createElement("tr");

    const td = document.createElement("td");
    td.textContent = g.name;
    tr.appendChild(td);

    const qtyTd = document.createElement("td");
    qtyTd.textContent = `${row.qty} 件`;
    tr.appendChild(qtyTd);

    const slotTd = document.createElement("td");
    slotTd.textContent = `${row.qty * g.slotSize} 位`;
    tr.appendChild(slotTd);

    const lifeTd = document.createElement("td");
    const left = row.earliest + g.shelfLifeDays - state.day;
    lifeTd.textContent = left <= 1 ? "今天结算时丢弃" : `还剩 ${left} 天`;
    lifeTd.className = left <= 1 ? "warn" : "";
    tr.appendChild(lifeTd);

    const priceTd = document.createElement("td");
    priceTd.textContent = `${formatYuan(state.prices[g.id])} 元`;
    tr.appendChild(priceTd);

    tbody.appendChild(tr);
  }
}

function renderReports() {
  const tbody = el("reports-body");
  tbody.innerHTML = "";
  if (state.reports.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "muted";
    td.textContent = "还没有结算过。";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  for (const r of state.reports.slice(0, 14)) {
    const tr = document.createElement("tr");

    const dayTd = document.createElement("td");
    dayTd.textContent = `第 ${r.day} 天`;
    tr.appendChild(dayTd);

    const revTd = document.createElement("td");
    revTd.textContent = `${formatYuan(r.revenue)} 元`;
    tr.appendChild(revTd);

    const profitTd = document.createElement("td");
    profitTd.textContent = `${formatYuan(r.profit)} 元`;
    profitTd.className = r.profit >= 0 ? "pos" : "neg";
    tr.appendChild(profitTd);

    const soldTd = document.createElement("td");
    soldTd.textContent = `${r.sold.reduce((s, x) => s + x.qty, 0)} 件`;
    tr.appendChild(soldTd);

    const expTd = document.createElement("td");
    expTd.textContent = r.expiredCost > 0 ? `${formatYuan(r.expiredCost)} 元` : "—";
    expTd.className = r.expiredCost > 0 ? "warn" : "";
    tr.appendChild(expTd);

    tbody.appendChild(tr);
  }
}

const EVENT_TEXT = {
  "offline-settled": (d) =>
    `离线补算 ${d.days} 天：收入 ${formatYuan(d.revenue)} 元，净利 ${formatYuan(d.profit)} 元` +
    (d.capped ? `（超出 ${d.skippedDays} 天未补）` : ""),
  "clock-rollback": (d) =>
    `检测到系统时间回拨 ${Math.max(1, Math.round(Math.abs(d.skewMs) / 60000))} 分钟，已冻结该时段结算`,
  "save-migrated": (d) => `存档从 v${d.from} 升级到 v${d.to}`,
  "corrupt-reset": () => "存档损坏，已备份原文并重开",
};

function renderEvents() {
  const ul = el("event-list");
  ul.innerHTML = "";
  const events = state.events.slice(-12).reverse();
  if (events.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "暂无特殊事件。";
    ul.appendChild(li);
    return;
  }
  for (const e of events) {
    const li = document.createElement("li");
    const fn = EVENT_TEXT[e.type];
    li.textContent = fn ? fn(e.detail) : e.type;
    li.dataset.kind = e.type;
    ul.appendChild(li);
  }
}

boot();
