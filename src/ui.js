// 纯 DOM 渲染：输入“当前应该显示的状态”，输出画面；不持有对局状态。

import { STATUS_LABEL } from './log.js';

export const $ = (id) => document.getElementById(id);

export function renderBoard(game, cardMap, opts = {}) {
  const inViewer = !!opts.inViewer;
  for (const side of ['player', 'enemy']) {
    const s = game.sides[side];
    $(`${side}Name`).textContent = s.name;
    $(`${side}HpText`).textContent = `${s.hp} / ${s.maxHp}`;
    $(`${side}HpFill`).style.width = `${Math.max(0, (s.hp / s.maxHp) * 100)}%`;
    const chips = [];
    if (s.block > 0) chips.push(`<span class="chip block-chip">护甲 ${s.block}</span>`);
    for (const status of ['strength', 'vulnerable', 'weak']) {
      if (s.statuses[status] > 0) {
        chips.push(`<span class="chip ${status}">${STATUS_LABEL[status]} ${s.statuses[status]}</span>`);
      }
    }
    $(`${side}Chips`).innerHTML = chips.join('');
    $(`${side}DrawCount`).textContent = s.drawPile.length;
    $(`${side}DiscardCount`).textContent = s.discard.length;
    $(`${side}ExhaustCount`).textContent = s.exhaust.length;
  }
  $('energyCur').textContent = game.sides.player.energy;
  $('energyMax').textContent = `/${game.sides.player.maxEnergy}`;

  $('enemyHand').innerHTML = game.sides.enemy.hand.map(() => '<div class="card-back"></div>').join('');

  const handEl = $('playerHand');
  handEl.innerHTML = '';
  const interactive = !inViewer && !opts.busy && game.active === 'player' && !game.over;
  for (const uid of game.sides.player.hand) {
    const card = cardMap[game.cards[uid]];
    const unaffordable = interactive && game.sides.player.energy < card.cost;
    const el = document.createElement('div');
    el.className = [
      'card',
      card.exhaust ? 'exhausted-card' : '',
      unaffordable ? 'disabled' : '',
      opts.armedUid === uid ? 'armed' : '',
    ].join(' ').trim();
    el.dataset.uid = uid;
    el.innerHTML = `
      <div class="cost">${card.cost}</div>
      <div class="cname">${card.name}</div>
      <div class="ctext">${card.text}</div>
      <div class="ctag">${card.exhaust ? '消耗' : targetTag(card.target)}</div>`;
    if (interactive && !unaffordable) {
      el.addEventListener('click', () => opts.onCardClick(uid));
    }
    handEl.appendChild(el);
  }

  const turnLabel = game.over
    ? (game.winner === 'player' ? '你赢了' : game.winner === 'enemy' ? '你输了' : '同归于尽')
    : `第 ${game.turn} 回合 · ${game.active === 'player' ? '你的回合' : 'AI 回合'}${opts.busy ? '（结算中…）' : ''}`;
  $('turnInfo').textContent = turnLabel;

  $('endTurnBtn').disabled = inViewer || opts.busy || game.over || game.active !== 'player';

  // 目标选择条
  const bar = $('targetBar');
  if (!inViewer && opts.armedUid !== null) {
    const card = cardMap[game.cards[opts.armedUid]];
    bar.hidden = false;
    $('targetPrompt').textContent = `为「${card.name}」选择目标：`;
    $('targetEnemyBtn').hidden = card.target !== 'enemy';
    $('targetSelfBtn').hidden = card.target !== 'self';
  } else {
    bar.hidden = true;
  }

  document.body.classList.toggle('viewing', inViewer);
}

function targetTag(target) {
  if (target === 'enemy') return '敌方';
  if (target === 'self') return '自己';
  return '';
}

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function floatAt(side, text, cls) {
  const anchor = $(side === 'player' ? 'playerCombatant' : 'enemyCombatant');
  const rect = anchor.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = `float-text ${cls}`;
  el.textContent = text;
  el.style.left = `${rect.left + rect.width / 2 - 20 + (Math.random() * 24 - 12)}px`;
  el.style.top = `${rect.top + 10}px`;
  $('floatLayer').appendChild(el);
  setTimeout(() => el.remove(), 950);
}

export function flashCombatant(side) {
  const el = $(side === 'player' ? 'playerCombatant' : 'enemyCombatant');
  el.classList.remove('hit-flash');
  void el.offsetWidth;
  el.classList.add('hit-flash');
}

export function shakeCard(uid) {
  const el = document.querySelector(`.card[data-uid="${uid}"]`);
  if (el) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }
}

export function toast(message, ok = false, anchorTimer = null) {
  const el = $('toast');
  el.textContent = message;
  el.className = ok ? 'toast ok' : 'toast';
  el.hidden = false;
  if (anchorTimer) clearTimeout(anchorTimer);
  return setTimeout(() => { el.hidden = true; }, 2200);
}

export function appendLog(html, cls = 'log-info') {
  const box = $('logBox');
  const line = document.createElement('div');
  line.className = cls;
  line.innerHTML = html;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

export function renderPileModal(title, uids, game, cardMap) {
  $('pileTitle').textContent = title;
  const list = $('pileList');
  list.innerHTML = '';
  if (uids.length === 0) {
    list.innerHTML = '<p class="hint">空的</p>';
    return;
  }
  for (const uid of uids) {
    const card = cardMap[game.cards[uid]];
    const el = document.createElement('div');
    el.className = `card ${card.exhaust ? 'exhausted-card' : ''}`;
    el.innerHTML = `
      <div class="cost">${card.cost}</div>
      <div class="cname">${card.name}</div>
      <div class="ctext">${card.text}</div>
      <div class="ctag">${card.exhaust ? '消耗' : ''}</div>`;
    list.appendChild(el);
  }
}
