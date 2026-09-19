// 复盘页：粘贴战报 → 从种子重放整局 → 逐步看状态，每步带校验和比对。

import { replay, validateRecord } from './replay.js';
import { checksumState } from './engine.js';

const $ = (id) => document.getElementById(id);

let result = null;
let viewIndex = 0;
let autoTimer = null;

function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => node.classList.remove('show'), 1800);
}

function loadRecord(raw) {
  const record = JSON.parse(raw);
  validateRecord(record);
  result = replay(record);
  $('recordSeed').textContent = `种子 ${record.seed} · 共 ${record.actions.length} 个动作`;
  viewIndex = 0;
  renderSteps();
  renderView();
  renderVerify();
}

function renderVerify() {
  const node = $('verifyResult');
  if (result.ok) {
    node.className = 'verify-ok';
    node.textContent = `校验通过：${result.steps.length - 1} 步全部一致`;
  } else {
    node.className = 'verify-bad';
    node.textContent = `校验失败：第 ${result.mismatchAt} 步开始对不上`;
  }
}

function describeAction(action) {
  if (!action) return '开局';
  if (action.type === 'endTurn') {
    return `${action.side === 'player' ? '你' : 'AI'} 结束回合`;
  }
  return `${action.side === 'player' ? '你' : 'AI'} 出手牌 #${action.handIndex}` +
    (action.target ? ` → ${action.target}` : '');
}

function renderSteps() {
  const list = $('stepList');
  list.innerHTML = '';
  result.steps.forEach((step, index) => {
    const row = document.createElement('div');
    row.className = 'step-row';
    if (index === viewIndex) row.classList.add('current');
    if (!step.match) row.classList.add('bad');
    row.innerHTML =
      `<span class="idx">#${index}</span>` +
      `<span>${describeAction(step.action)}</span>` +
      `<span>${step.match ? '✓' : `✗ 期望 ${step.checksum}`}${step.error ? ' ' + step.error : ''}</span>` +
      `<span class="sum">${step.actual}</span>`;
    row.addEventListener('click', () => { viewIndex = index; renderSteps(); renderView(); });
    list.appendChild(row);
  });
}

// 复盘查看某一步时，用同一个重放函数重新跑到该步（数据量小，简单且不会跑偏）
function stateAt(index) {
  const record = JSON.parse($('recordInput').value);
  const partial = replay(record, { stopAt: index });
  return partial.doc.state;
}

function sideHtml(side, state, recordCards) {
  const combatant = state.sides[side];
  const cardName = (uid) => {
    const id = state.cards[uid]?.id;
    return recordCards[id]?.name ?? id;
  };
  const hand = combatant.hand.map((uid) => cardName(uid)).join('、') || '（空）';
  const drawIds = combatant.drawPile.map(cardName);
  const discard = combatant.discard.map(cardName).join('、') || '（空）';
  const exhaust = combatant.exhaustPile.map(cardName).join('、') || '（空）';
  const s = combatant.statuses;
  return `
    <h3>${combatant.name}${state.active === side ? '（行动中）' : ''}</h3>
    <div class="kv">
      生命 <b>${Math.max(0, combatant.hp)}/${combatant.maxHp}</b> ·
      能量 <b>${combatant.energy}/${combatant.energyPerTurn}</b><br/>
      力量 <b>${s.strength}</b> · 易伤 <b>${s.vulnerable}</b> ·
      虚弱 <b>${s.weak}</b> · 护甲 <b>${s.block}</b><br/>
      手牌（${combatant.hand.length}）：${hand}<br/>
      抽牌堆（${drawIds.length}，顺序从堆底到堆顶）：${drawIds.join('、') || '（空）'}<br/>
      弃牌堆：${discard}<br/>
      消耗堆：${exhaust}
    </div>`;
}

function renderView() {
  if (!result) return;
  const state = stateAt(viewIndex);
  const record = JSON.parse($('recordInput').value);
  const cardMap = {};
  for (const card of record.cards) cardMap[card.id] = card;
  $('playerState').innerHTML = sideHtml('player', state, cardMap);
  $('enemyState').innerHTML = sideHtml('enemy', state, cardMap);
  $('prevBtn').disabled = viewIndex === 0;
  $('firstBtn').disabled = viewIndex === 0;
  $('nextBtn').disabled = viewIndex === result.steps.length - 1;
  $('lastBtn').disabled = viewIndex === result.steps.length - 1;

  const rows = $('stepList').querySelectorAll('.step-row');
  rows[viewIndex]?.scrollIntoView({ block: 'nearest' });
}

function gotoStep(index) {
  if (!result) return;
  viewIndex = Math.max(0, Math.min(result.steps.length - 1, index));
  renderSteps();
  renderView();
}

function setAutoPlay(on) {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
  if (!on) return;
  autoTimer = setInterval(() => {
    if (viewIndex >= result.steps.length - 1) {
      $('autoPlayChk').checked = false;
      setAutoPlay(false);
      return;
    }
    gotoStep(viewIndex + 1);
  }, 900);
}

function bind() {
  $('backBtn').addEventListener('click', () => { location.href = 'index.html'; });
  $('loadRecordBtn').addEventListener('click', () => {
    try {
      loadRecord($('recordInput').value);
      toast('战报载入成功');
    } catch (err) {
      toast(err.message);
    }
  });
  $('firstBtn').addEventListener('click', () => gotoStep(0));
  $('prevBtn').addEventListener('click', () => gotoStep(viewIndex - 1));
  $('nextBtn').addEventListener('click', () => gotoStep(viewIndex + 1));
  $('lastBtn').addEventListener('click', () => gotoStep(Infinity));
  $('autoPlayChk').addEventListener('change', (evt) => setAutoPlay(evt.target.checked));

  const pending = sessionStorage.getItem('emberdeck-pending-record');
  if (pending) {
    $('recordInput').value = pending;
    sessionStorage.removeItem('emberdeck-pending-record');
    loadRecord(pending);
  }
}

bind();
