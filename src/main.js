import { loadStory } from './story.js';
import { initialState, visibleChoices, applyChoice, isTerminal } from './state.js';
import { writeSave, loadSave, clearSave, hasSave } from './storage.js';
import { buildRecord, parseRecord, analyzeReplay } from './replay.js';
import { formatTime } from './util.js';

const screens = {
  title: document.getElementById('screen-title'),
  game: document.getElementById('screen-game'),
  end: document.getElementById('screen-end'),
  replay: document.getElementById('screen-replay'),
  problem: document.getElementById('screen-problem'),
};

function show(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle('hidden', key !== name);
  }
  window.scrollTo(0, 0);
}

const $ = (id) => document.getElementById(id);

let story = null;
let state = null;
let currentNotices = [];
let replayData = null;
let replayIndex = 0;

function storyUrl() {
  const params = new URLSearchParams(location.search);
  return params.get('story') ?? 'samples/story.json';
}

async function boot() {
  let loaded;
  try {
    loaded = await loadStory(storyUrl());
  } catch (err) {
    showFatal(err.message || String(err));
    return;
  }
  story = loaded.story;

  if (loaded.errors.length > 0) {
    showProblems(loaded.errors, loaded.warnings);
    return;
  }
  if (loaded.warnings.length > 0) {
    // 警告（如孤立场景）不致命：标题页继续，但也给一个查看入口。
    currentNotices = loaded.warnings.map((w) => `剧本检查提醒：${w}`);
  }
  renderTitle();
}

function showFatal(message) {
  showProblems([message], []);
}

function showProblems(errors, warnings) {
  const list = $('problem-list');
  list.innerHTML = '';
  for (const w of warnings) {
    const li = document.createElement('li');
    li.className = 'warning';
    li.innerHTML = `<span class="lvl">警告</span>${escapeHtml(w)}`;
    list.appendChild(li);
  }
  for (const e of errors) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="lvl">错误</span>${escapeHtml(e)}`;
    list.appendChild(li);
  }
  $('btn-problem-continue').classList.toggle('hidden', errors.length > 0);
  show('problem');
}

$('btn-problem-continue').addEventListener('click', () => {
  renderTitle();
});

// ---------------- 标题 ----------------

function renderTitle() {
  $('title-name').textContent = story.id;
  $('title-meta').textContent = `剧本版本 ${story.version ?? 1} · ${Object.keys(story.scenes).length} 个场景`;

  const panel = $('save-panel');
  panel.innerHTML = '';

  const heading = document.createElement('h2');
  heading.textContent = '存档';
  panel.appendChild(heading);

  if (hasSave(story)) {
    const { state: loaded, notices, savedAt } = loadSave(story);
    const row = document.createElement('div');
    row.className = 'row';

    const cont = document.createElement('button');
    cont.textContent = `继续游戏${savedAt ? `（${formatTime(savedAt)} 存档）` : ''}`;
    cont.addEventListener('click', () => {
      state = loaded;
      currentNotices = notices.slice();
      // 迁移后的存档立刻写回，把兜底结果固化。
      writeSave(story, state);
      if (state.ended || isTerminal(story, state.scene)) renderEnd();
      else renderGame();
    });

    const fresh = document.createElement('button');
    fresh.className = 'ghost';
    fresh.textContent = '重新开始（覆盖存档）';
    fresh.addEventListener('click', () => startNew());

    row.append(cont, fresh);
    panel.appendChild(row);
    if (notices.length > 0) {
      const note = document.createElement('div');
      note.className = 'notice';
      note.textContent = notices.join('\n');
      panel.appendChild(note);
    }
  } else {
    const row = document.createElement('div');
    row.className = 'row';
    const start = document.createElement('button');
    start.textContent = '开始新游戏';
    start.addEventListener('click', () => startNew());
    row.appendChild(start);
    panel.appendChild(row);
    const tip = document.createElement('p');
    tip.className = 'muted';
    tip.textContent = '（中途关掉页面也没关系，下次来可以接着玩。）';
    panel.appendChild(tip);
  }

  $('replay-error').textContent = '';
  $('record-input').value = '';
  show('title');
}

function startNew() {
  clearSave(story);
  state = initialState(story);
  writeSave(story, state);
  currentNotices = [];
  if (state.ended || isTerminal(story, state.scene)) renderEnd();
  else renderGame();
}

// ---------------- 游戏中 ----------------

function hudVars(s) {
  const names = Array.isArray(story.hud) ? story.hud : [];
  return names.map((name) => ({ name, value: s.vars[name] }));
}

function renderHud(container, s) {
  const stats = hudVars(s);
  container.innerHTML = '';
  if (stats.length === 0) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  for (const { name, value } of stats) {
    const span = document.createElement('span');
    span.className = 'stat';
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = name;
    span.append(k, document.createTextNode(formatValue(value)));
    container.appendChild(span);
  }
}

function formatValue(value) {
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

function renderNotice(container, notices) {
  container.innerHTML = '';
  if (!notices || notices.length === 0) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  container.textContent = notices.join('\n');
}

function renderGame() {
  $('game-title').textContent = `${story.id} · 第 ${state.path.length - 1} 步`;
  $('save-status').textContent = '已自动存档';
  renderHud($('hud'), state);
  renderNotice($('notice'), currentNotices);
  renderSceneCard($('scene-text'), $('choices'), state.scene, state.vars, null, true);
  show('game');
}

function renderSceneCard(textEl, choicesEl, sceneId, vars, highlightIndex, interactive) {
  const scene = story.scenes[sceneId];
  textEl.textContent = scene ? scene.text : `（场景「${sceneId}」在当前剧本里找不到。）`;
  choicesEl.innerHTML = '';

  if (!scene || !Array.isArray(scene.choices)) return;

  const available = visibleChoices(story, { scene: sceneId, vars });
  if (interactive && available.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = '（这里暂时没有能选的选项——可能是剧本把条件写死了。）';
    choicesEl.appendChild(p);
  }

  available.forEach(({ index, choice }) => {
    const btn = document.createElement('button');
    if (highlightIndex === index) btn.className = 'replayed';
    if (!interactive) btn.disabled = true;
    if (highlightIndex === index) {
      const tag = document.createElement('span');
      tag.className = 'choice-tag';
      tag.textContent = '↳ 记录中这一步选了它';
      btn.appendChild(tag);
    }
    btn.append(document.createTextNode(choice.text));
    if (interactive) btn.addEventListener('click', () => choose(index));
    choicesEl.appendChild(btn);
  });
}

function choose(choiceIndex) {
  if (state.ended) return;
  currentNotices = [];
  applyChoice(story, state, choiceIndex);
  writeSave(story, state);
  if (state.ended || isTerminal(story, state.scene)) {
    renderEnd();
  } else {
    renderGame();
  }
}

$('btn-abandon').addEventListener('click', () => {
  if (confirm('放弃本局？自动存档会保留在“继续游戏”里，标题页可随时回来。')) {
    renderTitle();
  }
});

// ---------------- 结局 ----------------

function renderEnd() {
  renderHud($('end-hud'), state);
  const scene = story.scenes[state.scene];
  $('end-text').textContent = scene ? scene.text : '';
  $('record-output').value = JSON.stringify(buildRecord(story, state), null, 2);
  $('copy-status').textContent = '';
  show('end');
}

$('btn-again').addEventListener('click', () => startNew());
$('btn-end-title').addEventListener('click', () => renderTitle());

$('btn-copy-record').addEventListener('click', async () => {
  const text = $('record-output').value;
  const ok = await copyText(text);
  $('copy-status').textContent = ok ? '已复制，去发给朋友吧。' : '复制失败，请手动全选复制。';
});

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面的兜底
  }
  const ta = $('record-output');
  ta.focus();
  ta.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

// ---------------- 回放 ----------------

$('btn-replay').addEventListener('click', () => {
  const raw = $('record-input').value.trim();
  if (!raw) {
    $('replay-error').textContent = '先把记录 JSON 贴进来。';
    return;
  }
  try {
    const record = parseRecord(raw);
    replayData = analyzeReplay(story, record);
    replayIndex = 0;
    $('replay-title').textContent = `回放 · ${record.storyId}${typeof record.version === 'number' ? `（记录版本 ${record.version}）` : ''}`;
    renderReplay();
  } catch (err) {
    $('replay-error').textContent = err.message || String(err);
  }
});

function renderReplay() {
  const { snapshots, warnings } = replayData;
  const snap = snapshots[replayIndex];
  renderHud($('replay-hud'), snap);
  renderNotice($('replay-notice'), warnings);

  // 高亮“下一步要选”的那个选项；最后一步的快照高亮已选的选项。
  const next = snapshots[replayIndex + 1];
  const highlight = next ? next.choiceIndex : snap.choiceIndex;
  renderSceneCard($('replay-text'), $('replay-choices'), snap.scene, snap.vars, highlight);

  const total = snapshots.length - 1;
  $('replay-progress').textContent =
    `第 ${replayIndex} / ${total} 步` +
    (snap.end || replayData.ended && replayIndex === snapshots.length - 1 ? ' · 已到结局' : '');

  $('btn-replay-prev').disabled = replayIndex === 0;
  $('btn-replay-next').disabled = replayIndex >= snapshots.length - 1;
  show('replay');
}

$('btn-replay-prev').addEventListener('click', () => {
  if (replayIndex > 0) { replayIndex--; renderReplay(); }
});
$('btn-replay-next').addEventListener('click', () => {
  if (replayIndex < replayData.snapshots.length - 1) { replayIndex++; renderReplay(); }
});
$('btn-replay-close').addEventListener('click', () => renderTitle());

// ---------------- 工具 ----------------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

boot();
