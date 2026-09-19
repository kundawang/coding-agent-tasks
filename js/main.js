// 入口：加载 samples -> 读/迁移存档 -> 离线补算 -> 接界面和游戏循环。

import { SCHEMA_VERSION } from './config.js';
import {
  buildCatalog,
  makeInitialState,
  advanceTime,
  buyGoods,
  setPrice,
  pushAnomaly,
  defaultPrice,
} from './game.js';
import { migrateSave } from './migrate.js';
import { loadRawSave, writeSave, clearSave } from './storage.js';
import { parseYuan, yuanLabel } from './money.js';
import {
  $,
  renderAll,
  renderHudOnly,
  toast,
  showReport,
  hideModal,
} from './ui.js';

async function loadJson(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} 加载失败：HTTP ${res.status}`);
  return res.json();
}

function nowMs() {
  return Date.now();
}

// 读档时第一次锚定：没有合法锚点就锚在“现在”，不送任何游戏时间
function anchorStart(state, now) {
  if (
    typeof state.dayStartMs !== 'number' ||
    !Number.isFinite(state.dayStartMs) ||
    state.dayStartMs <= 0
  ) {
    state.dayStartMs = now;
  }
}

function bootstrap() {
  Promise.all([
    loadJson('samples/goods.json'),
    loadJson('samples/store.json'),
  ])
    .then(([goodsJson, storeJson]) => start(goodsJson.goods, storeJson))
    .catch((err) => {
      document.body.innerHTML =
        `<pre style="padding:24px;color:#d9705f">游戏数据加载失败：${String(
          err.message || err,
        )}\n\n请用静态服务器打开本目录（例如 python -m http.server），\n不要直接双击 index.html 用 file:// 打开，否则浏览器会拦截 JSON 读取。</pre>`;
    });
}

function start(goodsList, storeConfig) {
  const catalog = buildCatalog(goodsList);
  const now = nowMs();

  const { raw, error: loadError } = loadRawSave();
  let state;
  let migratedFrom = null;
  let migrateWarnings = [];

  if (raw === undefined && !loadError) {
    state = makeInitialState(storeConfig, now);
  } else {
    const result = migrateSave(raw, makeInitialState(storeConfig, now));
    state = result.state;
    migratedFrom = result.fromVersion;
    migrateWarnings = result.warnings;
  }

  // 新商品（samples 以后加东西）：老存档没价格就补默认价，能直接卖
  for (const goods of catalog.values()) {
    if (!Number.isInteger(state.prices[goods.id])) {
      state.prices[goods.id] = defaultPrice(goods.costCents);
    }
  }

  anchorStart(state, now);

  if (loadError) {
    pushAnomaly(state, {
      type: 'migrate',
      atMs: now,
      detail: loadError,
    });
  }
  if (migratedFrom !== null && (migratedFrom !== SCHEMA_VERSION || migrateWarnings.length)) {
    pushAnomaly(state, {
      type: 'migrate',
      atMs: now,
      detail:
        `存档从 v${migratedFrom} 升级到 v${SCHEMA_VERSION}` +
        (migrateWarnings.length ? `；补缺字段：${migrateWarnings.join('；')}` : ''),
    });
  }

  // 启动即离线补算（封顶 7 天；回拨不补）
  const report = advanceTime(state, catalog, now, { offline: true });
  writeSave(state);

  const ctx = {
    get state() {
      return state;
    },
    get catalog() {
      return catalog;
    },
    get nowMs() {
      return nowMs();
    },
    actions: {
      buy(goodsId, qtyText) {
        const qty = Number.parseInt(String(qtyText), 10);
        const r = buyGoods(state, catalog, goodsId, qty);
        if (r.ok) {
          toast(`进货成功，花费 ${yuanLabel(r.costCents)}`);
          persistAndRender(true);
        } else {
          toast(r.reason, true);
        }
      },
      setPrice(goodsId, priceText) {
        const cents = parseYuan(priceText);
        if (cents === null || cents < 0) {
          toast('价格格式不对，填类似 5.50 的元数', true);
          return;
        }
        const r = setPrice(state, goodsId, cents);
        if (r.ok) {
          toast(cents === 0 ? '已设为免费赠送' : '定价已更新');
          persistAndRender(true);
        } else {
          toast(r.reason, true);
        }
      },
      reset() {
        const again =
          window.confirm('确定清空当前存档、按 samples 重新开店吗？这个操作不可撤销。');
        if (!again) return;
        clearSave();
        window.location.reload();
      },
    },
  };

  function persistAndRender(full) {
    writeSave(state);
    if (full) renderAll({ ...ctx, nowMs: nowMs() });
    else renderHudOnly({ ...ctx, nowMs: nowMs() });
  }

  renderAll({ ...ctx, nowMs: now });

  // 离线报告/回拨提示必须明明白白弹给玩家
  if (report.rollback || report.daysSettled > 0 || report.cappedDays > 0) {
    showReport(report, catalog);
  } else if (migrateWarnings.length > 0 || loadError) {
    toast('读到老存档，缺的字段已经补上，详情见“异常记录”');
  }
  $('modal-ok').addEventListener('click', hideModal);
  $('btn-reset').addEventListener('click', ctx.actions.reset);

  // 游戏循环：每 500ms 推进真实时间。
  // 页面切后台/合盖时浏览器会节流定时器，回来一跳可能很久；
  // 距上次 tick 超过 30 秒就按“离线”处理（封顶 7 天 + 弹报告）。
  let lastTickNow = now;
  setInterval(() => {
    const n = nowMs();
    const gap = n - lastTickNow;
    lastTickNow = n;
    const wasOffline = gap > 30000;
    const r = advanceTime(state, catalog, n, { offline: wasOffline });
    if (
      r.daysSettled > 0 ||
      r.rollback ||
      r.cappedDays > 0 ||
      r.revenueCents > 0 ||
      r.unitsSold > 0
    ) {
      persistAndRender(true);
      if (wasOffline && (r.daysSettled > 0 || r.cappedDays > 0 || r.rollback)) {
        showReport(r, catalog);
      } else if (r.rollback) {
        toast('检测到系统时间回拨，已按保守策略处理并记入异常', true);
      }
    } else {
      renderHudOnly({ ...ctx, nowMs: n });
    }
  }, 500);

  window.addEventListener('beforeunload', () => writeSave(state));
  document.addEventListener('visibilitychange', () => {
    // 回到页面时不主动推进：500ms 定时器会立刻接手并结算，避免重复推进
    if (document.visibilityState === 'hidden') writeSave(state);
  });

  // 另一个标签页改了存档：别互相覆盖，提示并以存档为准
  window.addEventListener('storage', (e) => {
    if (e.key && e.key.startsWith('cornerstore')) {
      toast('检测到另一个标签页也在开店，已停止本页自动存档；刷新后以存档为准');
      window.location.reload();
    }
  });
}

bootstrap();
