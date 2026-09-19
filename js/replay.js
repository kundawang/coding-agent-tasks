// 对局记录：导出 / 导入 / 逐步重放。记录格式见 README。

import { evalCond, newGame, choose } from './engine.js';

export function buildRecord(story, state) {
  return {
    format: 'branchscript-replay',
    formatVersion: 1,
    storyId: story.id,
    storyVersion: story.version,
    exportedAt: new Date().toISOString(),
    start: story.start,
    steps: state.history.map((item) => ({ scene: item.scene, choice: item.choice })),
  };
}

export function exportRecordText(story, state) {
  return JSON.stringify(buildRecord(story, state), null, 2);
}

export function parseRecordText(text) {
  let record;
  try {
    record = JSON.parse(text);
  } catch (e) {
    return { error: `记录不是合法 JSON：${e.message}` };
  }
  if (typeof record !== 'object' || record === null) return { error: '记录内容不对：根节点不是对象。' };
  if (record.format !== 'branchscript-replay') {
    return { error: '这不是 branchscript 的对局记录（缺少 "format": "branchscript-replay"）。' };
  }
  if (!Number.isInteger(record.formatVersion) || record.formatVersion < 1) {
    return { error: '记录缺少 formatVersion，无法识别。' };
  }
  if (!Array.isArray(record.steps)) return { error: '记录里没有 steps 数组。' };
  for (let i = 0; i < record.steps.length; i += 1) {
    const step = record.steps[i];
    if (typeof step !== 'object' || step === null || typeof step.scene !== 'string' || !Number.isInteger(step.choice)) {
      return { error: `记录第 ${i + 1} 步格式不对：需要 { "scene": "场景id", "choice": 选项序号 }。` };
    }
    if (step.choice < 0) return { error: `记录第 ${i + 1} 步的选项序号不能是负数。` };
  }
  return { record };
}

// 从剧本默认变量出发逐步模拟，返回每一步的快照，便于 UI 一步步回放。
// 任何一步对不上（场景删了、选项没了、条件不满足）就在该步停下并说明。
export function simulateReplay(story, record) {
  const notices = [];
  if (record.storyId !== story.id) {
    return { error: `这条记录属于剧本「${record.storyId}」，当前剧本是「${story.id}」，对不上。` };
  }
  if (Number.isInteger(record.storyVersion) && record.storyVersion !== story.version) {
    notices.push(`记录是用剧本 v${record.storyVersion} 打的，当前剧本是 v${story.version}，可能对不上。`);
  }
  if (record.start !== undefined && record.start !== story.start) {
    notices.push('记录里的起始场景和当前剧本不同，以当前剧本的 start 为准。');
  }

  const frames = [];
  let state = newGame(story);
  let fatal = null;

  for (let i = 0; i < record.steps.length; i += 1) {
    const step = record.steps[i];
    const stepNo = i + 1;
    const scene = story.scenes[step.scene];
    if (!scene) {
      fatal = `第 ${stepNo} 步的场景「${step.scene}」在当前剧本里不存在（可能被删或改名了），回放停在这里。`;
      break;
    }
    if (step.scene !== state.current) {
      fatal = `第 ${stepNo} 步对不上：记录当时在场景「${step.scene}」，按当前剧本重放到这里应该在「${state.current}」。剧本改过，无法继续。`;
      break;
    }
    if (state.ended) {
      fatal = `第 ${stepNo} 步多余：上一步之后游戏已经结束了。`;
      break;
    }
    const choice = scene.choices[step.choice];
    if (!choice) {
      fatal = `第 ${stepNo} 步选的第 ${step.choice + 1} 个选项，在当前剧本的场景「${step.scene}」里不存在，回放停在这里。`;
      break;
    }
    if (!evalCond(choice.cond, state.vars)) {
      fatal = `第 ${stepNo} 步的选项「${choice.text}」按当前剧本重放时条件不满足（变量对不上），回放停在这里。`;
      break;
    }
    const result = choose(story, state, step.choice);
    if (result.error) {
      fatal = `第 ${stepNo} 步执行失败：${result.error}`;
      break;
    }
    state = result.state;
    frames.push({
      stepNo,
      fromScene: step.scene,
      choiceIndex: step.choice,
      choiceText: choice.text,
      state: cloneState(state),
    });
  }

  return {
    notices,
    initialState: newGame(story),
    frames,
    completed: !fatal && record.steps.length > 0 && state.ended,
    finishedWithoutEnd: !fatal && !state.ended,
    error: fatal || null,
  };
}

export function cloneState(state) {
  return {
    ...state,
    vars: { ...state.vars },
    history: state.history.map((item) => ({ ...item })),
  };
}
