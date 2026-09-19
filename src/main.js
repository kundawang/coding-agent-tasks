import * as Engine from './engine.js';
import { hashSeed } from './rng.js';
import { runEnemyTurn, verifyReplay, newReplay, recordStep } from './replay.js';
import { describeEffects, describeStep, STATUS_LABEL, SIDE_LABEL } from './log.js';
import { $, renderBoard, delay, floatAt, flashCombatant, shakeCard, toast, appendLog, renderPileModal } from './ui.js';

const SAVE_KEY = 'emberdeck.save.v1';

class App {
  constructor(cardDefs, encounter) {
    this.cardDefs = cardDefs;
    this.cardMap = Object.fromEntries(cardDefs.map((c) => [c.id, c]));
    this.encounter = encounter;
    this.game = null;
    this.replay = null;
    this.seed = null;
    this.busy = false;
    this.armedUid = null;
    this.viewer = null;
    this.toastTimer = null;
    this.bindUi();
    this.bootstrap();
  }

  bindUi() {
    $('newGameBtn').addEventListener('click', () => {
      const raw = $('seedInput').value.trim();
      this.startNew(raw === '' ? String((Math.random() * 0xffffffff) >>> 0) : raw, true);
    });
    $('endTurnBtn').addEventListener('click', () => this.playerEndTurn());
    $('exportBtn').addEventListener('click', () => this.openExport());
    $('importBtn').addEventListener('click', () => this.openImport());
    $('targetEnemyBtn').addEventListener('click', () => this.resolveArm('enemy'));
    $('targetSelfBtn').addEventListener('click', () => this.resolveArm('player'));
    $('cancelTargetBtn').addEventListener('click', () => this.disarm());
    $('gameOverExportBtn').addEventListener('click', () => { $('gameOverModal').hidden = true; this.openExport(); });
    $('gameOverNewBtn').addEventListener('click', () => {
      $('gameOverModal').hidden = true;
      this.startNew($('seedInput').value.trim(), true);
    });
    $('recordCopyBtn').addEventListener('click', () => this.copyRecord());
    $('recordLoadBtn').addEventListener('click', () => this.loadRecordFromText());
    $('recordCloseBtn').addEventListener('click', () => { $('recordModal').hidden = true; });
    $('pileCloseBtn').addEventListener('click', () => { $('pileModal').hidden = true; });
    $('vwPrev').addEventListener('click', () => this.viewerStep(-1));
    $('vwNext').addEventListener('click', () => this.viewerStep(1));
    $('vwScrub').addEventListener('input', (e) => this.viewerGoTo(Number(e.target.value)));
    $('vwPlay').addEventListener('click', () => this.viewerAutoplay());
    $('vwExit').addEventListener('click', () => this.exitViewer());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.disarm();
      if (e.key === ' ' && !this.viewer && !this.busy && this.game && this.game.active === 'player') {
        e.preventDefault();
        this.playerEndTurn();
      }
    });
    document.querySelectorAll('.pile').forEach((btn) => {
      btn.addEventListener('click', () => this.showPile(btn.dataset.side, btn.dataset.pile));
    });
  }

  bootstrap() {
    $('encounterName').textContent = `· ${this.encounter.name}`;
    const urlSeed = new URLSearchParams(location.search).get('seed');
    let restored = null;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) restored = JSON.parse(raw);
    } catch {
      restored = null;
    }

    if (restored && (urlSeed === null || hashSeed(urlSeed) === (restored.seed >>> 0))) {
      try {
        this.game = Engine.deserializeGame(restored.gameText);
        this.replay = restored.replay;
        this.seed = restored.seed;
        $('seedInput').value = String(this.seed);
        this.render();
        this.rebuildLog();
        this.toastMsg('已从上次中断处继续', true);
        if (!this.game.over && this.game.active === 'enemy') this.driveEnemyTurn(false);
        return;
      } catch {
        // 存档损坏：当作没有，按地址栏种子开新局
      }
    }
    this.startNew(urlSeed ?? String((Math.random() * 0xffffffff) >>> 0), false);
  }

  startNew(seedRaw, confirmOverwrite) {
    if (confirmOverwrite && this.game && !this.game.over && !this.viewer) {
      if (!window.confirm('当前对局还没结束，确定要重开吗？进度会被覆盖。')) return;
    }
    this.exitViewer(false);
    const seed = hashSeed(seedRaw);
    this.seed = seed;
    this.game = Engine.createGame(this.encounter, this.cardMap, seed);
    this.replay = newReplay(seed, this.encounter, this.cardDefs, this.game);
    $('seedInput').value = String(seedRaw);
    this.armedUid = null;
    this.busy = false;
    $('logBox').innerHTML = '';
    this.save();
    this.render();
    this.log(`种子 ${seed}，开局`, 'log-turn');
  }

  save() {
    if (this.viewer) return;
    if (this.game.over) {
      localStorage.removeItem(SAVE_KEY);
      return;
    }
    const payload = { seed: this.seed, gameText: Engine.serializeGame(this.game), replay: this.replay };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    } catch {
      // 存储不可用不影响对局
    }
  }

  // ---------- 玩家操作 ----------

  onCardClick(uid) {
    if (this.viewer) return;
    if (this.busy) return this.toastMsg('动画结算中，操作已忽略');
    if (this.game.over) return this.toastMsg('本局已经结束');
    if (this.game.active !== 'player') return this.toastMsg('现在是 AI 的回合');
    if (!this.game.sides.player.hand.includes(uid)) return;
    const card = this.cardMap[this.game.cards[uid]];
    if (this.game.sides.player.energy < card.cost) {
      shakeCard(uid);
      return this.toastMsg(`能量不足：「${card.name}」需要 ${card.cost} 点`);
    }
    if (card.target === 'none') {
      this.doPlay(uid, null);
    } else {
      this.armedUid = uid;
      this.render();
    }
  }

  resolveArm(targetSide) {
    const uid = this.armedUid;
    if (uid === null) return;
    const card = this.cardMap[this.game.cards[uid]];
    const want = card.target === 'enemy' ? 'enemy' : 'player';
    if (want !== targetSide) return this.toastMsg('目标不合法');
    this.armedUid = null;
    this.doPlay(uid, targetSide);
  }

  disarm() {
    if (this.armedUid !== null) {
      this.armedUid = null;
      this.render();
    }
  }

  // 先同步占坑（busy）再调引擎；引擎校验失败抛错，状态一个数字都不会改。
  async doPlay(uid, targetSide) {
    if (this.busy) return;
    this.busy = true;
    let result;
    try {
      result = Engine.playCard(this.game, 'player', uid, targetSide, this.cardMap);
    } catch (err) {
      this.busy = false;
      this.render();
      return this.toastMsg(err.message);
    }
    const cardName = this.cardMap[result.cardId].name;
    const text = `你打出「${cardName}」：${describeEffects(result)}`;
    recordStep(this.replay, 'playCard', this.game, {
      side: 'player', cardUid: uid, target: targetSide, text,
    });
    this.save();
    this.render();
    this.log(text);
    await this.animateResult('player', result);
    this.busy = false;
    if (this.game.over) return this.showGameOver();
    this.render();
  }

  async playerEndTurn() {
    if (this.viewer || this.busy) return;
    if (this.game.over || this.game.active !== 'player') return this.toastMsg('还没轮到你结束回合');
    this.armedUid = null;
    Engine.finishTurn(this.game, 'player');
    recordStep(this.replay, 'endTurn', this.game, { side: 'player', text: '你结束回合' });
    this.render();
    this.log('你结束回合', 'log-turn');
    await this.driveEnemyTurn(true);
  }

  // 直播与“刷新后停在 AI 回合”恢复共用同一个驱动器，结算顺序天然一致。
  async driveEnemyTurn(begin) {
    this.busy = true;
    this.render();
    for (const item of runEnemyTurn(this.game, this.cardMap, { begin })) {
      const { step, result } = item;
      const text =
        step.kind === 'playCard'
          ? `AI 打出「${this.cardMap[this.game.cards[step.cardUid]].name}」：${describeEffects(result)}`
          : describeStep(step, this.cardMap);
      recordStep(this.replay, step.kind, this.game, { ...step, text });
      this.save();
      this.render();
      this.log(text, step.kind === 'playCard' ? 'log-dmg' : 'log-turn');
      if (step.kind === 'playCard') await this.animateResult('enemy', result);
      else await delay(420);
      if (this.game.over) break;
    }
    this.busy = false;
    this.render();
    if (this.game.over) this.showGameOver();
  }

  async animateResult(casterSide, result) {
    for (const eff of result.effects) {
      if (eff.kind === 'damage') {
        for (const hit of eff.hits) {
          floatAt(eff.target, `-${hit.amount}`, 'dmg');
          flashCombatant(eff.target);
          await delay(230);
        }
      } else if (eff.kind === 'block') {
        floatAt(casterSide, `+${eff.amount} 护甲`, 'block');
      } else if (eff.kind === 'heal') {
        floatAt(casterSide, `+${eff.amount}`, 'heal');
      } else if (eff.kind === 'loseHp') {
        floatAt(casterSide, `-${eff.amount} 血`, 'dmg');
        flashCombatant(casterSide);
      } else if (eff.kind === 'apply') {
        floatAt(eff.target, `+${eff.amount} ${STATUS_LABEL[eff.status]}`, 'status');
      } else if (eff.kind === 'draw') {
        floatAt(casterSide, `抽 ${eff.drawn.length}`, 'block');
      }
      await delay(120);
    }
    await delay(160);
  }

  // ---------- 渲染 / 日志 ----------

  render() {
    if (this.viewer) {
      const replay = this.viewer.replay;
      const snap = replay.steps[this.viewer.index].snapshot;
      const cardMap = Object.fromEntries(replay.cards.map((c) => [c.id, c]));
      renderBoard(snap, cardMap, { inViewer: true });
      $('viewerBar').hidden = false;
      $('vwScrub').max = replay.steps.length - 1;
      $('vwScrub').value = this.viewer.index;
      $('vwPos').textContent = `${this.viewer.index} / ${replay.steps.length - 1}`;
      $('vwStepDesc').textContent = describeStep(replay.steps[this.viewer.index], cardMap);
      return;
    }
    $('viewerBar').hidden = true;
    renderBoard(this.game, this.cardMap, {
      busy: this.busy,
      armedUid: this.armedUid,
      onCardClick: (uid) => this.onCardClick(uid),
    });
  }

  log(text, cls = 'log-info') {
    appendLog(text, cls);
  }

  rebuildLog() {
    $('logBox').innerHTML = '';
    for (const step of this.replay.steps.slice(1)) {
      this.log(step.text || describeStep(step, this.cardMap), step.kind === 'playCard' && step.side === 'enemy' ? 'log-dmg' : 'log-turn');
    }
  }

  toastMsg(message, ok = false) {
    this.toastTimer = toast(message, ok, this.toastTimer);
  }

  showGameOver() {
    this.save();
    const win = this.game.winner === 'player';
    $('gameOverTitle').textContent = win ? '胜利' : this.game.winner === 'enemy' ? '失败' : '同归于尽';
    $('gameOverText').textContent =
      `种子 ${this.seed} · 你 ${this.game.sides.player.hp} 血，AI ${this.game.sides.enemy.hp} 血。` +
      '可以导出记录发到群里复盘。';
    $('gameOverModal').hidden = false;
  }

  // ---------- 导入 / 导出 ----------

  openExport() {
    if (this.viewer) {
      this.fillRecordModal('别人发来的对战记录', JSON.stringify(this.viewer.replay), this.viewer.replay, false);
      return;
    }
    this.fillRecordModal('本局对战记录（每一步后都附完整状态快照）', JSON.stringify(this.replay), this.replay, false);
  }

  openImport() {
    this.fillRecordModal('把对战记录粘贴到下面，点“粘贴并重放”', '', null, true);
  }

  fillRecordModal(title, text, replay, allowLoad) {
    $('recordTitle').textContent = title;
    $('recordText').value = text;
    $('recordLoadBtn').hidden = !allowLoad;
    $('recordVerify').textContent = '';
    $('recordVerify').className = 'verify';
    $('recordModal').hidden = false;
    if (replay && !allowLoad) {
      const result = verifyReplay(replay);
      const box = $('recordVerify');
      box.className = result.ok ? 'verify ok' : 'verify bad';
      box.textContent = result.ok
        ? `自检通过：${replay.steps.length - 1} 步，胜方=${replay.winner === 'player' ? '玩家' : replay.winner === 'enemy' ? 'AI' : '无'}，种子=${replay.seed}`
        : `自检发现 ${result.errors.length} 处不一致`;
    }
  }

  async copyRecord() {
    const ta = $('recordText');
    ta.select();
    try {
      await navigator.clipboard.writeText(ta.value);
      this.toastMsg('已复制到剪贴板', true);
    } catch {
      document.execCommand('copy');
      this.toastMsg('已复制', true);
    }
  }

  loadRecordFromText() {
    let replay;
    try {
      replay = JSON.parse($('recordText').value);
    } catch {
      return this.toastMsg('不是合法的 JSON');
    }
    const result = verifyReplay(replay);
    const box = $('recordVerify');
    box.className = result.ok ? 'verify ok' : 'verify bad';
    if (!result.ok) {
      box.textContent = `记录无法重放：\n${result.errors.map((e) => `[步骤 ${e.index}] ${e.message}`).join('\n')}`;
      return;
    }
    box.textContent = `校验通过：${replay.steps.length - 1} 步。进入逐步回放。`;
    this.enterViewer(replay);
  }

  // ---------- 回放查看器 ----------

  enterViewer(replay) {
    this.disarm();
    this.viewer = { replay, index: 0, autoplay: null };
    this.render();
  }

  viewerStep(delta) {
    if (!this.viewer) return;
    this.stopAutoplay();
    this.viewerGoTo(this.viewer.index + delta);
  }

  viewerGoTo(index) {
    if (!this.viewer) return;
    const max = this.viewer.replay.steps.length - 1;
    this.viewer.index = Math.max(0, Math.min(max, index));
    this.render();
  }

  viewerAutoplay() {
    if (!this.viewer) return;
    if (this.viewer.autoplay) {
      this.stopAutoplay();
      return;
    }
    $('vwPlay').textContent = '暂停';
    this.viewer.autoplay = setInterval(() => {
      if (this.viewer.index >= this.viewer.replay.steps.length - 1) {
        this.stopAutoplay();
        return;
      }
      this.viewerGoTo(this.viewer.index + 1);
    }, 600);
  }

  stopAutoplay() {
    if (this.viewer && this.viewer.autoplay) clearInterval(this.viewer.autoplay);
    this.viewer && (this.viewer.autoplay = null);
    $('vwPlay').textContent = '自动播放';
  }

  exitViewer(rerender = true) {
    if (!this.viewer) return;
    this.stopAutoplay();
    this.viewer = null;
    $('recordModal').hidden = true;
    if (rerender) this.render();
  }

  // ---------- 牌堆查看 ----------

  showPile(side, pileKey) {
    // 对手的牌堆只允许在回放里看（直播看牌堆属于偷看）。
    if (!this.viewer && side === 'enemy') return this.toastMsg('不能偷看 AI 的牌堆');
    const { game, cardMap } = this.viewer
      ? {
          game: this.viewer.replay.steps[this.viewer.index].snapshot,
          cardMap: Object.fromEntries(this.viewer.replay.cards.map((c) => [c.id, c])),
        }
      : { game: this.game, cardMap: this.cardMap };
    const labels = { drawPile: '抽牌堆（顶在最后）', discard: '弃牌堆', exhaust: '消耗堆', hand: '手牌' };
    const s = game.sides[side];
    const uids = pileKey === 'drawPile' ? [...s[pileKey]].reverse() : s[pileKey];
    renderPileModal(`${SIDE_LABEL[side]} · ${labels[pileKey]}（${uids.length}）`, uids, game, cardMap);
    $('pileModal').hidden = false;
  }
}

// ---------- 数据加载（相对路径，python -m http.server 根目录直接可用） ----------

async function main() {
  try {
    const [cardsResp, encResp] = await Promise.all([
      fetch('./samples/cards.json'),
      fetch('./samples/encounter.json'),
    ]);
    const cardsJson = await cardsResp.json();
    const encounter = await encResp.json();
    Engine.validateCardDefs(cardsJson.cards);
    new App(cardsJson.cards, encounter);
  } catch (err) {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<pre style="color:#ff8a8a;padding:20px">加载失败：${err.message}\n请用静态服务器打开（python -m http.server），不要直接双击 index.html。</pre>`
    );
  }
}

main();
