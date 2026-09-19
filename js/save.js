// 存档：自动保存到 localStorage，读档时按新剧本做兼容迁移。

const KEY_PREFIX = 'branchscript:save:';
export const SAVE_VERSION = 1;

export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

export function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // 隐私模式等情况下 localStorage 可能抛错，退回内存档（关掉页面就没了）。
  }
  return memoryStorage();
}

function keyFor(storyId) {
  return KEY_PREFIX + storyId;
}

export function saveGame(story, state, storage = defaultStorage()) {
  const record = {
    saveVersion: SAVE_VERSION,
    storyId: story.id,
    storyVersion: story.version,
    savedAt: new Date().toISOString(),
    current: state.current,
    vars: state.vars,
    history: state.history,
    ended: state.ended,
  };
  storage.setItem(keyFor(story.id), JSON.stringify(record));
}

export function clearSave(storyId, storage = defaultStorage()) {
  storage.removeItem(keyFor(storyId));
}

export function hasSave(storyId, storage = defaultStorage()) {
  return storage.getItem(keyFor(storyId)) !== null;
}

// 读档 + 迁移。返回 { status, state, notices }：
// status: 'ok' 正常读档；'migrated' 做过修复，notices 里说明；'missing'/'bad' 没档可续。
export function loadGame(story, storage = defaultStorage()) {
  const notices = [];
  const raw = storage.getItem(keyFor(story.id));
  if (raw === null) return { status: 'missing', state: null, notices };

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return { status: 'bad', state: null, notices: ['找到一个存档，但内容已损坏（不是合法 JSON），无法续玩，已忽略。'] };
  }
  if (typeof record !== 'object' || record === null) {
    return { status: 'bad', state: null, notices: ['存档结构不对，已忽略。'] };
  }
  if (record.storyId !== undefined && record.storyId !== story.id) {
    return { status: 'missing', state: null, notices: [] };
  }

  if (Number.isInteger(record.storyVersion) && record.storyVersion !== story.version) {
    notices.push(`这是剧本 v${record.storyVersion} 的存档，当前剧本是 v${story.version}，已按新剧本自动处理。`);
  }

  // 变量：删除新剧本里不存在的，补上新增变量的默认值；坏类型重置为默认值。
  const vars = {};
  const oldVars = typeof record.vars === 'object' && record.vars !== null && !Array.isArray(record.vars) ? record.vars : null;
  if (!oldVars) {
    notices.push('存档里的变量表读不出来，已全部重置为剧本默认值。');
  }
  for (const [name, defaultValue] of Object.entries(story.initialVars)) {
    if (!oldVars || !(name in oldVars)) {
      vars[name] = defaultValue;
      if (oldVars) notices.push(`新剧本新增了变量「${name}」，已补上默认值 ${JSON.stringify(defaultValue)}。`);
    } else if (typeof oldVars[name] !== typeof defaultValue) {
      vars[name] = defaultValue;
      notices.push(`变量「${name}」的类型和新剧本不一致，已重置为默认值 ${JSON.stringify(defaultValue)}。`);
    } else {
      vars[name] = oldVars[name];
    }
  }
  if (oldVars) {
    for (const name of Object.keys(oldVars)) {
      if (!(name in story.initialVars)) notices.push(`变量「${name}」在新剧本里已删除，已丢弃。`);
    }
  }

  // 历史：逐条验证（场景还在、选项还在、条件在该步变量下仍成立），留下最长可用前缀。
  const rawHistory = Array.isArray(record.history) ? record.history : [];
  if (!Array.isArray(record.history)) notices.push('存档里的走过路径格式不对，已清空路径。');
  const history = [];
  let cursor = story.start;
  const replayVars = { ...story.initialVars };
  let aborted = false;
  for (let i = 0; i < rawHistory.length; i += 1) {
    const item = rawHistory[i];
    const stepDesc = `第 ${i + 1} 步`;
    if (typeof item !== 'object' || item === null || typeof item.scene !== 'string' || !Number.isInteger(item.choice)) {
      notices.push(`${stepDesc}的记录格式不对，路径从这里截断。`);
      aborted = true;
      break;
    }
    if (item.scene !== cursor || !story.scenes[item.scene]) {
      notices.push(`你原来到过的场景「${item.scene}」在新剧本里找不到了，已退回到上一个还能玩的场景。`);
      aborted = true;
      break;
    }
    const scene = story.scenes[item.scene];
    const choice = scene.choices[item.choice];
    if (!choice) {
      notices.push(`${stepDesc}选的选项在新剧本里已经不在「${item.scene}」中了，已退回到这个选项之前。`);
      aborted = true;
      break;
    }
    let conditionOk = true;
    if (choice.cond) {
      conditionOk = evalSimpleCond(choice.cond, replayVars);
    }
    if (!conditionOk) {
      notices.push(`${stepDesc}的选项「${choice.text}」在新剧本里条件对不上了，已退回到这个选项之前。`);
      aborted = true;
      break;
    }
    for (const [name, value] of Object.entries(choice.set)) {
      if (name in replayVars) replayVars[name] = value;
    }
    for (const [name, delta] of Object.entries(choice.add)) {
      if (typeof replayVars[name] === 'number') replayVars[name] += delta;
    }
    history.push({ scene: item.scene, choice: item.choice, text: choice.text });
    if (choice.end && !choice.go) {
      cursor = null;
      break;
    }
    cursor = choice.go;
    if (!story.scenes[cursor]) {
      notices.push(`第 ${i + 1} 步跳去的场景「${choice.go}」在新剧本里被删了，已停在它之前的场景。`);
      aborted = true;
      break;
    }
  }
  if (rawHistory.length > history.length && !aborted) {
    notices.push('部分路径记录在新剧本里失效，已截断。');
  }

  // 决定落点：优先存档的 current；没了就退到历史最后一个可用场景（即下一次要点选项的地方）。
  let current = typeof record.current === 'string' ? record.current : null;
  let ended = record.ended === true;

  if (current !== null && story.scenes[current]) {
    // current 有效。历史以其为准（历史可能比 current 短，无妨）。
  } else {
    if (current !== null) {
      notices.push(`你存档时所在的场景「${current}」在新剧本里被删掉了。`);
    } else {
      notices.push('存档里没有当前场景信息。');
    }
    if (cursor !== null && story.scenes[cursor]) {
      current = cursor;
      notices.push(`已把你退回到最近一个还在的场景「${current}」，可以从这里继续。`);
      ended = false;
    } else {
      current = story.start;
      history.length = 0;
      ended = false;
      notices.push('整条路径都失效了，已退回剧本开头重新开始（变量保留为剧本默认值）。');
    }
  }

  // 兜底：落到一个没有任何可见选项、也没标记结束的场景，按结局处理，免得玩家卡死。
  const scene = story.scenes[current];
  if (!ended) {
    const anyVisible = scene.choices.some((choice) => !choice.cond || evalSimpleCond(choice.cond, vars));
    if (scene.choices.length === 0 || !anyVisible) {
      ended = true;
      notices.push('当前场景在新剧本里已经没有可走的选项，按结局处理。可点「重新开始」开新局。');
    }
  }

  return {
    status: notices.length ? 'migrated' : 'ok',
    state: {
      storyId: story.id,
      storyVersion: story.version,
      current,
      vars,
      history,
      ended,
    },
    notices,
  };
}

function evalSimpleCond(cond, vars) {
  const actual = vars[cond.var];
  const wanted = cond.value;
  if (cond.op === 'eq') return actual === wanted;
  if (cond.op === 'gte') return actual >= wanted;
  if (cond.op === 'lte') return actual <= wanted;
  return false;
}
