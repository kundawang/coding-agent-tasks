// DOM 渲染。游戏状态只在 js/game.js 里改，这里只负责显示。

import { priceAttractiveness, usedSlots, batchFreshOn } from './game.js';
import { yuanLabel, toYuan } from './money.js';
import { MAX_CATCHUP_DAYS } from './config.js';

export function $(id) {
  return document.getElementById(id);
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2), v);
    } else if (v !== null && v !== undefined) {
      node.setAttribute(k, v);
    }
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function formatTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

function attractLevel(a) {
  if (a >= 0.66) return { cls: '', label: '好卖' };
  if (a >= 0.33) return { cls: 'mid', label: '一般' };
  return { cls: 'low', label: '没人买' };
}

function renderGoods(ctx) {
  const { state, catalog, actions } = ctx;
  const host = $('goods-list');
  host.replaceChildren();

  for (const goods of catalog.values()) {
    const price = Number.isInteger(state.prices[goods.id])
      ? state.prices[goods.id]
      : null;
    const attract = price == null ? 0 : priceAttractiveness(price, goods.costCents);
    const level = attractLevel(attract);
    const marginText =
      price == null
        ? '未上架'
        : price < goods.costCents
          ? '亏本卖'
          : `单件赚 ${yuanLabel(price - goods.costCents)}`;

    const priceInput = el('input', {
      class: 'price-input',
      type: 'text',
      inputmode: 'decimal',
      value: price == null ? '' : toYuan(price),
      title: '售价（元，精确到分）',
    });
    const qtyInput = el('input', {
      class: 'qty-input',
      type: 'number',
      min: '1',
      step: '1',
      value: '1',
    });

    const card = el(
      'div',
      { class: 'goods-card' },
      el('div', { class: 'goods-head' },
        el('span', { class: 'goods-name', text: goods.name }),
        el('span', { class: 'goods-meta', text: `占 ${goods.slotSize} 格 · 人气 ${goods.popularity}` }),
      ),
      el('div', { class: 'goods-row' },
        el('span', { text: '进价' }),
        el('strong', { text: yuanLabel(goods.costCents) }),
      ),
      el('div', { class: 'goods-row' },
        el('span', { text: '保质期' }),
        el('span', {
          text: goods.shelfLifeDays >= 9999 ? '长期' : `${goods.shelfLifeDays} 天`,
        }),
      ),
      el('div', { class: `attract-bar ${level.cls}` },
        el('div', { style: `width:${Math.round(attract * 100)}%` }),
      ),
      el('div', { class: 'goods-row' },
        el('span', { class: 'goods-meta', text: `定价吸引力：${level.label}` }),
        el('span', { class: 'goods-meta', text: marginText }),
      ),
      el('div', { class: 'goods-actions' },
        priceInput,
        el('button', {
          class: 'btn btn-ghost',
          text: '改价',
          onclick: () => actions.setPrice(goods.id, priceInput.value),
        }),
        qtyInput,
        el('button', {
          class: 'btn',
          text: '进货',
          onclick: () => actions.buy(goods.id, qtyInput.value),
        }),
      ),
    );
    host.append(card);
  }
}

function renderStock(ctx) {
  const { state, catalog } = ctx;
  const host = $('stock-list');
  host.replaceChildren();
  if (state.stock.length === 0) {
    host.append(el('div', { class: 'empty', text: '货架是空的，先进点货。' }));
    return;
  }
  for (const batch of [...state.stock].sort((a, b) => a.boughtOnDay - b.boughtOnDay)) {
    const goods = catalog.get(batch.goodsId);
    const name = goods ? goods.name : `${batch.goodsId}（目录缺失）`;
    const expired = !batchFreshOn(batch, catalog, state.day);
    const expireDay = batch.boughtOnDay + (goods ? goods.shelfLifeDays : Infinity);
    const tag =
      !goods || expireDay === Infinity
        ? '长期有效'
        : expired
          ? `第 ${expireDay} 天已过期`
          : `第 ${expireDay} 天开门过期`;
    host.append(
      el('div', { class: `stock-batch${expired ? ' expired' : ''}` },
        el('span', { text: `${name} ×${batch.qty}` }),
        el('span', { class: 'expire-tag', text: `第 ${batch.boughtOnDay} 天进货 · ${tag}` }),
      ),
    );
  }
}

function renderToday(ctx) {
  const { state } = ctx;
  const host = $('today-stats');
  host.replaceChildren();
  const rows = [
    ['今日营收', yuanLabel(state.today.revenueCents)],
    ['卖出件数', String(state.today.unitsSold)],
    ['成交顾客', String(state.today.customersServed)],
    ['流失顾客', String(state.today.customersLeft)],
  ];
  for (const [k, v] of rows) {
    host.append(
      el('div', { class: 'stat' },
        el('span', { class: 'goods-meta', text: k }),
        el('strong', { text: v }),
      ),
    );
  }
}

function goodsNameSafe(catalog, id) {
  const g = catalog.get(id);
  return g ? g.name : id;
}

function expiredText(expired, catalog) {
  if (!expired.length) return null;
  return expired.map((e) => `${goodsNameSafe(catalog, e.goodsId)}×${e.qty}`).join('、');
}

function renderHistory(ctx) {
  const { state, catalog } = ctx;
  const host = $('history-list');
  host.replaceChildren();
  if (state.history.length === 0) {
    host.append(el('div', { class: 'empty', text: '还没有结算过完整的一天。' }));
    return;
  }
  for (const h of [...state.history].reverse()) {
    const expired = expiredText(h.expired, catalog);
    host.append(
      el('div', { class: 'record' },
        el('div', { class: 'record-line' },
          el('strong', { text: `第 ${h.day} 天` }),
          el('span', { text: `营收 ${yuanLabel(h.revenueCents)}` }),
        ),
        el('div', { class: 'record-sub',
          text: `成交 ${h.customersServed} 人 / 流失 ${h.customersLeft} 人 / 卖出 ${h.unitsSold} 件`,
        }),
        expired
          ? el('div', { class: 'record-sub', style: 'color:var(--danger)', text: `过期丢弃：${expired}` })
          : null,
      ),
    );
  }
}

function renderAnomalies(ctx) {
  const { state } = ctx;
  const host = $('anomaly-list');
  const badge = $('anomaly-count');
  host.replaceChildren();
  const count = state.anomalies.length;
  badge.textContent = String(count);
  badge.classList.toggle('show', count > 0);
  if (count === 0) {
    host.append(el('div', { class: 'empty', text: '暂无异常。' }));
    return;
  }
  for (const a of [...state.anomalies].reverse()) {
    host.append(
      el('div', { class: `record ${a.type}` },
        el('div', { class: 'record-line' },
          el('strong', {
            text:
              a.type === 'rollback'
                ? '时间回拨'
                : a.type === 'cap'
                  ? '离线封顶'
                  : a.type === 'migrate'
                    ? '存档升级'
                    : '异常',
          }),
          el('span', { class: 'record-sub', text: formatTime(a.atMs || Date.now()) }),
        ),
        el('div', { class: 'record-sub', text: a.detail }),
      ),
    );
  }
}

function renderHud(ctx) {
  const { state, catalog, nowMs } = ctx;
  $('hud-cash').textContent = yuanLabel(state.cashCents);
  $('hud-day').textContent = String(state.day);
  const slotsNode = $('hud-slots');
  const used = usedSlots(state, catalog);
  slotsNode.textContent = `${used}/${state.shelfSlots}`;
  slotsNode.style.color = used > state.shelfSlots ? 'var(--danger)' : '';
  const progress = state.dayStartMs
    ? Math.min(1, Math.max(0, (nowMs - state.dayStartMs) / state.dayLengthMs))
    : 0;
  $('hud-clock-fill').style.width = `${(progress * 100).toFixed(1)}%`;
  $('hud-clock-text').textContent = `${Math.floor(progress * 100)}%（${(
    state.dayLengthMs /
    60000
  ).toFixed(0)} 分钟/天）`;
}

export function renderAll(ctx) {
  renderHud(ctx);
  renderGoods(ctx);
  renderStock(ctx);
  renderToday(ctx);
  renderHistory(ctx);
  renderAnomalies(ctx);
}

// 轻量渲染：只刷数字和进度条，输入框不重建，避免打字/焦点被打断
export function renderHudOnly(ctx) {
  renderHud(ctx);
  renderToday(ctx);
}

let toastTimer = null;
export function toast(message, isError = false) {
  const node = $('toast');
  node.textContent = message;
  node.className = isError ? 'toast error' : 'toast';
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 2600);
}

export function showModal(title, bodyNode) {
  $('modal-title').textContent = title;
  const body = $('modal-body');
  body.replaceChildren(bodyNode);
  $('modal').hidden = false;
}

export function hideModal() {
  $('modal').hidden = true;
}

function reportRow(label, value, strong = false) {
  return el('div', { class: 'report-row' },
    el('span', { text: label }),
    el(strong ? 'strong' : 'span', { text: value }),
  );
}

// 离线/回拨结算弹窗：补了几天、赚了多少、丢了什么，一项项写清楚
export function showReport(report, catalog) {
  const body = el('div');
  const isRollback = !!report.rollback;

  if (isRollback) {
    body.append(
      el('p', {
        text: `检测到本机系统时间往回拨了约 ${Math.round(-report.rollback.deltaMs / 1000)} 秒。`,
      }),
      el('p', { class: 'report-danger',
        text: '按规矩这次不结算任何收益（不送天数，也不罚没现金库存），游戏时钟已重置到今天开头，事件已记入“异常记录”。',
      }),
    );
    if (report.daysSettled > 0 || report.revenueCents > 0) {
      body.append(reportRow('之后正常推进结算', `${report.daysSettled} 天`));
    }
  } else {
    body.append(
      reportRow('离线补算', `${report.daysSettled} 个完整游戏日`, true),
      reportRow('补算营收', yuanLabel(report.revenueCents), true),
      reportRow('卖出件数', String(report.unitsSold)),
      reportRow('成交 / 流失顾客', `${report.customersServed} / ${report.customersLeft}`),
    );
    if (report.expired.length) {
      body.append(reportRow('过期丢弃', expiredText(report.expired, catalog)));
    }
    const fullDayUnits = report.entries.reduce((a, e) => a + e.unitsSold, 0);
    if (fullDayUnits < report.unitsSold) {
      body.append(
        el('p', { class: 'report-sub', text: '营收含今天已经过去的零头时段。' }),
      );
    }
    if (report.cappedDays > 0) {
      body.append(
        el('p', { class: 'report-warn',
          text: `离线时间超过 ${MAX_CATCHUP_DAYS} 天上限，多出的 ${report.cappedDays} 天没有结算（既不送钱也不扣货）。`,
        }),
      );
    }
    if (report.daysSettled === 0 && report.revenueCents === 0) {
      body.append(el('p', { class: 'report-sub', text: '时间不足一个游戏日，没有需要补算的生意。' }));
    }
  }
  showModal(isRollback ? '检测到时间回拨' : '欢迎回来，小店营业报告', body);
}
