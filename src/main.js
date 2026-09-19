// 页面主控制器。规则计算全部在 engine.js，这里只负责渲染、动画、输入与存档。

import {
  createCardMap,
  createDocument,
  dispatch,
  handOptions,
  checksumState,
  GameError
} from './engine.js';
import { chooseAction } from './ai.js';
import { buildRecord, validateRecord } from './replay.js';
import { saveGame, loadGame, clearSave, hasSave } from './storage.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 懒加载：els.foo 等价于 document.getElementById('foo')
const els = new Proxy({}, {
  get(target, key) {
    if (!(key in target)) target[key] = document.getElementById(key);
    return target[key];
  }
});

let cardDefs = null;
let cardsRaw = null;
let encounter = null;
let doc = null;
let busy = false;            // 动画/AI 行动期间为 true，期间所有输入一律拒绝
let pendingCardIndex = null; // 等待选目标的手牌下标
let overShown = false;

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => els.toast.classList.remove('show'), 1800);
}

function floatText(targetEl, text, kind = 'dmg') {
  const rect = targetEl.getBoundingClientRect();
  const node = document.createElement('div');
  node.className = `float-text ${kind}`;
  node.textContent = text;
  node.style.left = `${rect.left + rect.width / 2 - 10 + Math.random() * 20}px`;
  node.style.top = `${rect.top + 8}px`;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 950);
}

async function loadSamples() {
  const [cardsResp, encounterResp] = await Promise.all([
    fetch('samples/cards.json'),
    fetch('samples/encounter.json')
  ]);
  const cardsJson = await cardsResp.json();
  cardsRaw = cardsJson.cards;
  cardDefs = createCardMap(cardsRaw);
  encounter = await encounterResp.json();
}

function seedFromUrl() {
  return new URLSearchParams(location.search).get('seed');
}

function writeSeedToUrl(seed, replace = true) {
  const url = new URL(location.href);
  url.searchParams.set('seed', String(seed));
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
}

function newGame(seed) {
  const finalSeed = String(seed ?? '').length === 0 ? String(Date.now()) : String(seed);
  doc = createDocument(cardDefs, encounter, finalSeed);
  writeSeedToUrl(finalSeed);
  els.seedInput.value = finalSeed;
  pendingCardIndex = null;
  overShown = false;
  saveGame(doc);
  render();
  appendLog(`<span class="l-sys">新的一局，种子 ${finalSeed}</span>`);
}

function tryResume() {
  const saved = loadGame();
  if (!saved) return false;
  doc = {
    version: saved.version,
    seed: saved.seed,
    state: saved.state,
    actions: saved.actions,
    checksums: saved.checksums
  };
  pendingCardIndex = null;
  overShown = Boolean(doc.state.winner);
  els.seedInput.value = doc.seed;
  if (seedFromUrl() !== doc.seed) writeSeedToUrl(doc.seed);
  render();
  appendLog(`<span class="l-sys">已恢复存档：种子 ${doc.seed}，第 ${doc.state.turn} 回合</span>`);
  if (!doc.state.winner && doc.state.active === 'enemy') {
    runEnemyTurn();
  }
  return true;
}

// ---------- 渲染 ----------

const STATUS_LABELS = {
  strength: '力量',
  vulnerable: '易伤',
  weak: '虚弱',
  block: '护甲'
};

function renderSide(side) {
  const combatant = doc.state.sides[side];
  const prefix = side === 'player' ? 'player' : 'enemy';
  $(`${prefix}Name`).textContent = combatant.name;
  $(`${prefix}HpText`).textContent = `${Math.max(0, combatant.hp)} / ${combatant.maxHp}`;
  $(`${prefix}HpFill`).style.width =
    `${Math.max(0, combatant.hp) / combatant.maxHp * 100}%`;
  $(`${prefix}DrawCount`).textContent = combatant.drawPile.length;
  $(`${prefix}DiscardCount`).textContent = combatant.discard.length;
  $(`${prefix}ExhaustCount`).textContent = combatant.exhaustPile.length;

  const badgesEl = $(`${prefix}Badges`);
  badgesEl.innerHTML = '';
  for (const key of ['strength', 'vulnerable', 'weak', 'block']) {
    const value = combatant.statuses[key] || 0;
    if (value > 0) {
      const badge = document.createElement('span');
      badge.className = `badge ${key}`;
      badge.textContent = `${STATUS_LABELS[key]} ${value}`;
      badgesEl.appendChild(badge);
    }
  }
}

function renderHand() {
  const handEl = els.hand;
  handEl.innerHTML = '';
  const isPlayerTurn = doc.state.active === 'player' && !doc.state.winner;
  const options = handOptions(doc.state, 'player', cardDefs);

  for (const opt of options) {
    const node = document.createElement('div');
    node.className = 'card';
    if (!isPlayerTurn || !opt.playable) node.classList.add('unplayable');
    if (pendingCardIndex === opt.index) node.classList.add('pending');
    node.dataset.index = String(opt.index);

    const cost = document.createElement('div');
    cost.className = 'cost';
    cost.textContent = opt.def.cost;
    node.appendChild(cost);

    const name = document.createElement('div');
    name.className = 'cname';
    name.textContent = opt.def.name;
    node.appendChild(name);

    const text = document.createElement('div');
    text.className = 'ctext';
    text.textContent = opt.def.text;
    node.appendChild(text);

    if (opt.def.exhaust) {
      const tag = document.createElement('div');
      tag.className = 'exhaust-tag';
      tag.textContent = '消耗';
      node.appendChild(tag);
    }

    node.title = opt.reason ?? (opt.def.target === 'enemy' ? '点击后选择敌人作为目标' : '点击打出');
    node.addEventListener('click', () => onCardClick(opt.index));
    handEl.appendChild(node);
  }
}

function render() {
  renderSide('player');
  renderSide('enemy');
  renderHand();

  const player = doc.state.sides.player;
  els.energyText.textContent = player.energy;
  els.energyMax.textContent = player.energyPerTurn;

  const activeName = doc.state.sides[doc.state.active].name;
  if (doc.state.winner) {
    els.turnInfo.textContent =
      doc.state.winner === 'player' ? '你赢了 🎉' : `${doc.state.sides.enemy.name}赢了`;
  } else {
    els.turnInfo.textContent = `第 ${doc.state.turn} 回合 · ${activeName}`;
  }

  els.endTurnBtn.disabled = busy || !!doc.state.winner || doc.state.active !== 'player';

  const targetable = pendingCardIndex !== null && doc.state.active === 'player' && !doc.state.winner;
  els.enemySide.classList.toggle('targetable', targetable);

  els.seedInput.value = doc.seed;
}

function appendLog(html) {
  const line = document.createElement('div');
  line.innerHTML = html;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}

// ---------- 玩家输入 ----------

function onCardClick(index) {
  if (busy) return; // 动画/AI 行动中连点：直接忽略，状态不会被碰
  if (doc.state.winner) return;
  if (doc.state.active !== 'player') {
    toast('还没轮到你的回合');
    return;
  }

  const options = handOptions(doc.state, 'player', cardDefs);
  const opt = options[index];
  if (!opt) return;
  if (!opt.playable) {
    toast(opt.reason ?? '这张牌现在打不出去');
    return;
  }

  if (opt.def.target === 'enemy') {
    // 只有一个敌人，但仍显式要求选目标：点牌 → 点敌人
    pendingCardIndex = pendingCardIndex === index ? null : index;
    render();
  } else {
    pendingCardIndex = null;
    void playerDispatch({ type: 'playCard', side: 'player', handIndex: index });
  }
}

function onEnemyClick() {
  if (busy || pendingCardIndex === null) return;
  const index = pendingCardIndex;
  pendingCardIndex = null;
  void playerDispatch({ type: 'playCard', side: 'player', handIndex: index, target: 'enemy' });
}

function onEndTurnClick() {
  if (busy) return;
  if (doc.state.active !== 'player' || doc.state.winner) return;
  pendingCardIndex = null;
  void playerDispatch({ type: 'endTurn', side: 'player' });
}

// 任何结算都只允许走这里：engine 先做原子校验，抛错=状态原样不动
async function playerDispatch(action) {
  if (busy) return;
  let events;
  try {
    events = dispatch(doc, action, cardDefs);
  } catch (err) {
    toast(err instanceof GameError ? err.message : '操作失败');
    render();
    return;
  }
  busy = true; // 同步上锁：同一个事件循环里的第二次点击会被挡在入口
  saveGame(doc);
  await animateEvents(events);
  if (!doc.state.winner && doc.state.active === 'enemy') {
    await runEnemyTurn();
  }
  busy = false;
  render();
  maybeShowGameOver();
}

// ---------- 战报导入/导出 ----------

function currentRecordJson() {
  return JSON.stringify(buildRecord(doc, cardsRaw, encounter), null, 2);
}

function openRecordModal(title, hint, text, editable) {
  els.recordModalTitle.textContent = title;
  els.recordModalHint.textContent = hint;
  els.recordText.value = text;
  els.recordText.readOnly = !editable;
  els.recordLoadBtn.style.display = editable ? '' : 'none';
  els.recordModal.classList.remove('hidden');
}

function onExport() {
  if (!doc) return;
  openRecordModal(
    '导出战报',
    '整段复制发给群友；对方在复盘页粘贴即可逐步重放。',
    currentRecordJson(),
    false
  );
}

function onImport() {
  openRecordModal('导入战报', '把战报 JSON 粘贴到这里，然后点“去复盘页打开”。', '', true);
}

async function onRecordCopy() {
  els.recordText.select();
  try {
    await navigator.clipboard.writeText(els.recordText.value);
    toast('已复制到剪贴板');
  } catch (err) {
    document.execCommand('copy');
    toast('已复制');
  }
}

function onRecordLoad() {
  const raw = els.recordText.value.trim();
  try {
    const record = JSON.parse(raw);
    validateRecord(record);
    sessionStorage.setItem('emberdeck-pending-record', raw);
    location.href = 'replay.html';
  } catch (err) {
    toast(err instanceof GameError ? err.message : '战报 JSON 解析失败');
  }
}

function maybeShowGameOver() {
  if (doc.state.winner && !overShown) {
    overShown = true;
    els.overTitle.textContent = doc.state.winner === 'player' ? '你赢了 🎉' : '你输了';
    els.overSeed.textContent = doc.seed;
    els.overModal.classList.remove('hidden');
  }
}

// ---------- 事件绑定 / 启动 ----------

function bind() {
  els.toast = $('toast');
  els.hand = $('hand');
  els.log = $('log');
  els.enemySide = $('enemySide');
  els.enemyPortrait = $('enemyPortrait');
  els.playerPortrait = $('playerPortrait');
  els.energyText = $('energyText');
  els.energyMax = $('energyMax');
  els.turnInfo = $('turnInfo');
  els.endTurnBtn = $('endTurnBtn');
  els.seedInput = $('seedInput');
  els.enemySide.addEventListener('click', onEnemyClick);
  els.enemySide.addEventListener('mouseenter', () => els.enemySide.classList.add('enemy-hover'));
  els.enemySide.addEventListener('mouseleave', () => els.enemySide.classList.remove('enemy-hover'));
  els.endTurnBtn.addEventListener('click', onEndTurnClick);

  $('newGameBtn').addEventListener('click', () => {
    const seed = els.seedInput.value.trim();
    if (hasSave() && !window.confirm('开新局会覆盖当前存档，确定？')) return;
    newGame(seed);
  });
  $('randomSeedBtn').addEventListener('click', () => {
    els.seedInput.value = String(Math.floor(Math.random() * 1_000_000_000));
  });
  $('replayLink').addEventListener('click', () => { location.href = 'replay.html'; });

  $('exportBtn').addEventListener('click', onExport);
  $('importBtn').addEventListener('click', onImport);
  $('recordCopyBtn').addEventListener('click', onRecordCopy);
  $('recordLoadBtn').addEventListener('click', onRecordLoad);
  $('recordCloseBtn').addEventListener('click', () => els.recordModal.classList.add('hidden'));

  $('overExportBtn').addEventListener('click', () => {
    els.overModal.classList.add('hidden');
    onExport();
  });
  $('overCloseBtn').addEventListener('click', () => els.overModal.classList.add('hidden'));

  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
      pendingCardIndex = null;
      els.recordModal.classList.add('hidden');
      render();
    }
  });

}

async function main() {
  await loadSamples();
  bind();

  const urlSeed = seedFromUrl();
  const resumed = tryResume();
  if (!resumed) {
    if (urlSeed) newGame(urlSeed);
    else newGame('1');
  }
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend',
    `<pre style="color:#ff9d8a;padding:16px">启动失败：${err.message}\n请确认用静态服务器打开（python -m http.server），而不是双击 html。</pre>`);
});

// ---------- 结算动画 / 日志 ----------

function cardName(uid) {
  const id = doc.state.cards[uid]?.id;
  return cardDefs[id]?.name ?? '?';
}

function sideName(side) {
  return doc.state.sides[side]?.name ?? side;
}

async function animateEvents(events) {
  render();

  for (const evt of events) {
    switch (evt.type) {
      case 'turnStart':
        appendLog(`<span class="l-sys">— ${sideName(evt.side)}的回合开始（回合 ${evt.turn}）—</span>`);
        render();
        await sleep(260);
        break;
      case 'turnEnd':
        break;
      case 'cardPlayed': {
        appendLog(`<b>${sideName(evt.side)}</b> 打出 <b>${cardName(evt.uid)}</b>`);
        if (evt.side === 'player') {
          const node = els.hand.querySelector(`.card`);
          node?.classList.add('flash');
        }
        render();
        await sleep(300);
        break;
      }
      case 'hit': {
        const targetEl = evt.to === 'enemy' ? els.enemyPortrait : els.playerPortrait;
        const tag = evt.times > 1 ? `（${evt.index}/${evt.times}）` : '';
        floatText(targetEl, `-${evt.hpLost}${evt.blocked ? ` 护甲${evt.blocked}` : ''}`, 'dmg');
        const parts = [`基础${evt.base}`];
        if (evt.strength) parts.push(`力量+${evt.strength}`);
        if (evt.vulnerable) parts.push('易伤×1.5');
        if (evt.weak) parts.push('虚弱×0.75');
        parts.push(`=${evt.amount}`);
        appendLog(`<span class="l-hit">${sideName(evt.from)} 命中 ${sideName(evt.to)}${tag}：${parts.join(' ')}` +
          (evt.blocked ? `，护甲抵消 ${evt.blocked}` : '') +
          `，掉血 ${evt.hpLost}</span>`);
        render();
        await sleep(320);
        break;
      }
      case 'block':
        floatText(evt.side === 'enemy' ? els.enemyPortrait : els.playerPortrait, `+${evt.amount} 护甲`, 'blk');
        appendLog(`<span class="l-block">${sideName(evt.side)} 获得 ${evt.amount} 护甲</span>`);
        render();
        await sleep(220);
        break;
      case 'energy':
        appendLog(`<span class="l-sys">${sideName(evt.side)} 获得 ${evt.amount} 能量</span>`);
        render();
        break;
      case 'draw':
        appendLog(`${sideName(evt.side)} 抽 ${evt.drawn.length} 张` +
          (evt.reshuffles ? `（弃牌堆洗回 ${evt.reshuffles} 次）` : '') +
          (evt.overflow.length ? `，${evt.overflow.length} 张因手牌满进弃牌堆` : ''));
        render();
        break;
      case 'apply':
        appendLog(`<span class="l-sys">${sideName(evt.side)} 获得 ${evt.amount} 层${STATUS_LABELS[evt.status] ?? evt.status}</span>`);
        render();
        await sleep(180);
        break;
      case 'heal':
        floatText(evt.side === 'enemy' ? els.enemyPortrait : els.playerPortrait, `+${evt.amount}`, 'heal');
        appendLog(`<span class="l-sys">${sideName(evt.side)} 回复 ${evt.amount} 点生命</span>`);
        render();
        await sleep(220);
        break;
      case 'loseHp':
        floatText(evt.side === 'enemy' ? els.enemyPortrait : els.playerPortrait, `-${evt.amount}`, 'dmg');
        appendLog(`<span class="l-hit">${sideName(evt.side)} 失去 ${evt.amount} 点生命（无视护甲）</span>`);
        render();
        await sleep(220);
        break;
      case 'handDiscarded':
        if (evt.cards.length) appendLog(`${sideName(evt.side)} 剩余 ${evt.cards.length} 张手牌进弃牌堆`);
        render();
        break;
      case 'gameOver':
        render();
        break;
      default:
        render();
    }
  }

  render();
}

// ---------- AI 回合 ----------

async function runEnemyTurn() {
  busy = true;
  let guard = 0;
  while (!doc.state.winner && doc.state.active === 'enemy' && guard++ < 200) {
    const action = chooseAction(doc.state, 'enemy', cardDefs);
    let events;
    try {
      events = action
        ? dispatch(doc, action, cardDefs)
        : dispatch(doc, { type: 'endTurn', side: 'enemy' }, cardDefs);
    } catch (err) {
      // 策略只产生合法动作；真到这里说明程序有 bug，停下来而不是乱动状态
      console.error('AI 动作被引擎拒绝', err);
      break;
    }
    saveGame(doc);
    await animateEvents(events);
    await sleep(240);
  }
  busy = false;
  render();
}
