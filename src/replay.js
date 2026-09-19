// 对战记录的导出与重放。
//
// 记录里只写“每一步在哪个场景选了第几个选项”，不写正文、不写变量值。
// 别人重放时用他自己手上的剧本逐步推导：
//   - 场景/选项没了、条件不满足了、跳转对不上了 → 立即停下并说明是第几步；
//   - 选项文案变了 → 给警告但照常重放（朋友比的是路线，文案改动可以接受）。

import { applyChoice, evalCondition, isTerminal } from './state.js';
import { isPlainObject, cloneJson } from './util.js';

export const REPLAY_FORMAT = 'branchscript-replay/1';

export function buildRecord(story, state) {
  return {
    format: REPLAY_FORMAT,
    storyId: story.id,
    version: story.version ?? 1,
    exportedAt: new Date().toISOString(),
    start: story.start,
    steps: state.path.slice(1).map((step) => {
      const out = { scene: step.scene, choice: step.choice };
      const choice = story.scenes[step.scene]?.choices?.[step.choice];
      if (choice) out.label = choice.text;
      if (step.end) out.end = true;
      out.to = step.to;
      return out;
    }),
  };
}

export function parseRecord(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`记录不是合法 JSON：${err.message}`);
  }
  if (!isPlainObject(data) || data.format !== REPLAY_FORMAT) {
    throw new Error(`不是 branchscript 的对战记录（需要 format 字段为 "${REPLAY_FORMAT}"）`);
  }
  return data;
}

// 按当前剧本把整份记录逐步跑一遍，产出每个时间点的快照供 UI 前后翻看。
export function analyzeReplay(story, record) {
  if (!isPlainObject(record)) throw new Error('记录内容为空');
  if (record.storyId !== story.id) {
    throw new Error(`这份记录属于剧本「${record.storyId}」，当前载入的剧本是「${story.id}」，对不上，没法重放。`);
  }
  if (!Array.isArray(record.steps)) throw new Error('记录里没有 steps 数组');

  if (record.start !== undefined && record.start !== story.start) {
    throw new Error(`记录的起始场景是「${record.start}」，当前剧本的起始场景改成了「${story.start}」，路线无法对齐。`);
  }

  const warnings = [];
  const vars = cloneJson(story.vars);
  let current = story.start;
  let ended = false;

  // snapshots[i]：走完前 i 步之后的样子。
  const snapshots = [{
    scene: current,
    vars: cloneJson(vars),
    choiceIndex: null,
    end: false,
  }];

  record.steps.forEach((step, i) => {
    const stepNo = i + 1;
    const prefix = `第 ${stepNo} 步`;

    if (ended) {
      throw new Error(`${prefix}：上一步已经是结局了，记录后面却还有步骤（记录是不是被多粘了一段？）`);
    }
    if (!isPlainObject(step)) throw new Error(`${prefix}：这一步不是对象`);
    if (step.scene !== current) {
      throw new Error(`${prefix}：记录显示当时在场景「${step.scene}」，但按当前剧本推导应该在「${current}」，路线对不上。`);
    }
    const scene = story.scenes[current];
    if (!scene) throw new Error(`${prefix}：场景「${current}」在当前剧本里不存在。`);

    if (typeof step.choice !== 'number') {
      // 没有 choice 的收尾项：只能出现在末尾，表示“落在这个场景”。
      if (i !== record.steps.length - 1) {
        throw new Error(`${prefix}：缺少 choice，且它不是最后一步。`);
      }
      if (typeof step.scene !== 'string') throw new Error(`${prefix}：缺少场景 id。`);
      return;
    }

    if (!Array.isArray(scene.choices)) {
      throw new Error(`${prefix}：场景「${current}」在当前剧本里没有选项，记录却选了第 ${step.choice + 1} 个。`);
    }
    const choice = scene.choices[step.choice];
    if (!choice) {
      throw new Error(`${prefix}：选了第 ${step.choice + 1} 个选项，但场景「${current}」现在只有 ${scene.choices.length} 个选项。`);
    }
    if (!evalCondition(choice.if, vars)) {
      throw new Error(`${prefix}：选项「${choice.text}」的显示条件在当前剧本下不满足，这条路线走不通了。`);
    }
    if (typeof step.label === 'string' && step.label !== choice.text) {
      warnings.push(`${prefix}的选项文案变了：记录里是「${step.label}」，当前剧本是「${choice.text}」，仍按位置重放。`);
    }
    if (step.to !== undefined && typeof step.to === 'string' && !(step.to in story.scenes)) {
      throw new Error(`${prefix}：这一步去往的场景「${step.to}」在当前剧本里被删掉了。`);
    }

    const synthetic = { scene: current, vars, ended: false, path: [] };
    applyChoice(story, synthetic, step.choice);
    current = synthetic.scene;
    ended = synthetic.ended;

    if (step.to !== undefined && step.to !== current) {
      throw new Error(`${prefix}：记录里这一步到「${step.to}」，按当前剧本却到了「${current}」，剧本改过路线。`);
    }
    if (step.end === true && !synthetic.ended) {
      throw new Error(`${prefix}：记录里这一步是结局，但在当前剧本里已经不是结局了。`);
    }

    snapshots.push({
      scene: current,
      vars: cloneJson(vars),
      choiceIndex: step.choice,
      end: synthetic.ended,
    });
  });

  const finalScene = story.scenes[current];
  const terminal = ended || isTerminal(story, current);
  if (!terminal) {
    warnings.push('记录走完时所在的场景在当前剧本里不是结局，这是一份没打完的记录，或剧本改过结局。');
  }

  return { snapshots, warnings, ended: terminal, endScene: terminal ? current : null, finalScene };
}
