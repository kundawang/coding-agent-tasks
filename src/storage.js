// localStorage 自动存档，以及剧本改了之后老存档的兼容迁移。
//
// 迁移策略（全部只做“说得过去”的兜底，绝不让老存档白屏）：
// 1. 剧本 id 对不上：不认，视为无存档。
// 2. 当前场景在新剧本里被删：沿走过的路退到最近一个还存在的场景；
//    退到的那一步之后的历史截断（那些路在新剧本里已经不存在了）。
// 3. 变量缺失：补上新剧本的默认值；类型变了：用新剧本默认值覆盖；多出来的变量保留。
// 4. ended 的场景在新剧本里不再是结局：取消 ended，继续玩。

import { initialState, isTerminal } from './state.js';
import { isPlainObject, cloneJson } from './util.js';

export const SAVE_PREFIX = 'branchscript:save/';

export function saveKey(storyId) {
  return `${SAVE_PREFIX}${storyId}`;
}

export function writeSave(story, state) {
  const record = {
    format: 'branchscript-save/1',
    storyId: story.id,
    version: story.version ?? 1,
    savedAt: new Date().toISOString(),
    state,
  };
  try {
    localStorage.setItem(saveKey(story.id), JSON.stringify(record));
  } catch (err) {
    // 隐私模式 / 存储满了都不该影响游戏本身。
    console.warn('存档写入失败', err);
  }
}

export function readRawSave(storyId) {
  let raw;
  try {
    raw = localStorage.getItem(saveKey(storyId));
  } catch (err) {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSave(story) {
  try {
    localStorage.removeItem(saveKey(story.id));
  } catch {
    // 忽略
  }
}

export function hasSave(story) {
  const save = readRawSave(story.id);
  return !!(save && save.storyId === story.id && isPlainObject(save.state));
}

// 返回 { state, notices }。state 为 null 表示没有可继续的存档。
export function loadSave(story) {
  const save = readRawSave(story.id);
  if (!save || save.storyId !== story.id || !isPlainObject(save.state)) {
    return { state: null, notices: [] };
  }

  const notices = [];
  const oldVersion = save.version;
  const newVersion = story.version ?? 1;
  if (typeof oldVersion === 'number' && oldVersion !== newVersion) {
    notices.push(`这份存档基于剧本版本 ${oldVersion}，当前剧本是版本 ${newVersion}，已按新剧本兼容读取。`);
  }

  const rawState = save.state;
  const state = initialState(story);

  // ---- 变量迁移 ----
  if (isPlainObject(rawState.vars)) {
    for (const [name, defaultValue] of Object.entries(story.vars)) {
      if (!(name in rawState.vars)) {
        notices.push(`新剧本新增了变量「${name}」，已按初始值补上。`);
        continue;
      }
      const oldValue = rawState.vars[name];
      if (typeOf(oldValue) !== typeOf(defaultValue)) {
        notices.push(`变量「${name}」的类型在新剧本里变了（原来 ${typeOf(oldValue)}，现在 ${typeOf(defaultValue)}），已重置为初始值。`);
        continue;
      }
      state.vars[name] = cloneJson(oldValue);
    }
    for (const [name, value] of Object.entries(rawState.vars)) {
      if (!(name in state.vars)) {
        // 剧本删掉的变量保留在存档里无妨，但引擎不再使用它。
        state.vars[name] = cloneJson(value);
      }
    }
  }

  // ---- 场景 / 路径迁移：沿走过的路退到最近还活着的场景 ----
  const rawPath = Array.isArray(rawState.path) ? rawState.path.filter(isPlainObject) : [];

  const sceneExists = (sceneId) =>
    typeof sceneId === 'string' && Object.prototype.hasOwnProperty.call(story.scenes, sceneId);

  const currentExists = typeof rawState.scene === 'string' && sceneExists(rawState.scene);
  let targetScene = currentExists ? rawState.scene : null;

  if (!targetScene) {
    // 优先用路径找最近的存在场景。
    for (let i = rawPath.length - 1; i >= 0; i--) {
      const candidate = rawPath[i].scene;
      if (sceneExists(candidate)) {
        targetScene = candidate;
        break;
      }
    }
    if (targetScene) {
      notices.push(`你存档所在的场景在新剧本里已经删掉了，已退回到最近还在的场景「${targetScene}」，之后走过的路也一并截断。`);
    } else {
      notices.push('存档里的所有场景在新剧本里都找不到了，只能从故事开头重新开始。');
      targetScene = story.start;
    }
  }

  state.scene = targetScene;

  // 重建一条在新剧本里合法的路径：从起点逐步校验，第一条对不上的步骤之后全部截断。
  const cleanPath = [{ scene: story.start }];
  let trustedHistory = true;
  if (rawPath.length > 0 && rawPath[0] && rawPath[0].scene !== story.start) {
    // start 被改过：整段历史不可信，但当前落点保留。
    trustedHistory = false;
    notices.push('剧本的起始场景变了，旧的行走记录已清空，直接从你保存的场景继续。');
  } else {
    for (let i = 1; i < rawPath.length; i++) {
      const step = rawPath[i];
      if (!sceneExists(step.scene)) break;
      const from = cleanPath[cleanPath.length - 1].scene;
      const fromScene = story.scenes[from];
      if (!fromScene || !Array.isArray(fromScene.choices)) break;
      const choiceIndex = step.choice;
      if (typeof choiceIndex !== 'number' || choiceIndex < 0 || choiceIndex >= fromScene.choices.length) break;
      const choice = fromScene.choices[choiceIndex];
      if (!choice) break;
      // end 选项没有 go 时停在原地；否则目标必须对得上。
      const expectedTo = choice.end === true
        ? (typeof choice.go === 'string' ? choice.go : from)
        : choice.go;
      if (expectedTo !== step.scene) break;
      cleanPath.push({ scene: step.scene, choice: choiceIndex, to: step.scene, ...(step.end ? { end: true } : {}) });
    }
  }

  // 当前落点若不在可信路径的末端，作为终点补在路径上，至少覆盖玩家看到的位置。
  const pathTip = cleanPath[cleanPath.length - 1].scene;
  if (!trustedHistory || pathTip !== targetScene) {
    cleanPath.push({ scene: targetScene });
  }
  state.path = cleanPath;

  // ---- 结局状态迁移 ----
  state.ended = rawState.ended === true;
  if (state.ended && !isTerminal(story, targetScene)) {
    state.ended = false;
    notices.push(`你之前已走到结局，但场景「${targetScene}」在新剧本里还有后续，已为你打开新的剧情。`);
  }

  if (typeof rawState.startedAt === 'string') state.startedAt = rawState.startedAt;

  return { state, notices, savedAt: save.savedAt };
}

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  return value === null ? 'null' : typeof value;
}
