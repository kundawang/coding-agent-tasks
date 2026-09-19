// 一局游戏的纯逻辑：初始状态、条件判定、执行选项。
// 不碰 DOM、不碰 localStorage，方便存档模块和回放模块共用。

import { isPlainObject } from './util.js';

export function initialState(story) {
  return {
    scene: story.start,
    ended: false,
    vars: JSON.parse(JSON.stringify(story.vars)),
    // path: 玩家走过的每一步。进入起始场景时先记录一个起点。
    path: [{ scene: story.start }],
    startedAt: new Date().toISOString(),
  };
}

export function isTerminal(story, sceneId) {
  const scene = story.scenes[sceneId];
  return !scene || !Array.isArray(scene.choices) || scene.choices.length === 0;
}

export function evalCondition(cond, vars) {
  if (cond === undefined || cond === null) return true;
  const actual = vars[cond.var];
  if (cond.eq !== undefined) return actual === cond.eq;
  if (cond.gte !== undefined) return Number(actual) >= Number(cond.gte);
  if (cond.lte !== undefined) return Number(actual) <= Number(cond.lte);
  return false;
}

export function visibleChoices(story, state) {
  const scene = story.scenes[state.scene];
  if (!scene || !Array.isArray(scene.choices)) return [];
  const list = [];
  scene.choices.forEach((choice, index) => {
    if (choice && evalCondition(choice.if, state.vars)) {
      list.push({ index, choice });
    }
  });
  return list;
}

// 执行第 choiceIndex 个选项，返回新状态（原地修改后返回同一个对象）。
export function applyChoice(story, state, choiceIndex) {
  const scene = story.scenes[state.scene];
  const choice = scene && scene.choices ? scene.choices[choiceIndex] : undefined;
  if (!choice) {
    throw new Error(`场景「${state.scene}」没有第 ${choiceIndex} 个选项`);
  }

  if (isPlainObject(choice.set)) {
    for (const [name, value] of Object.entries(choice.set)) {
      state.vars[name] = value;
    }
  }
  if (isPlainObject(choice.add)) {
    for (const [name, delta] of Object.entries(choice.add)) {
      state.vars[name] = Number(state.vars[name]) + Number(delta);
    }
  }

  const step = { scene: state.scene, choice: choiceIndex };
  if (choice.end === true) {
    step.end = true;
    // end 选项可以自带 go（正文是结局文）；没 go 就停在当前场景。
    if (typeof choice.go === 'string') state.scene = choice.go;
    state.ended = true;
  } else if (typeof choice.go === 'string') {
    state.scene = choice.go;
  }

  step.to = state.scene;
  state.path.push(step);

  // 走到空选项场景也算结局。
  if (isTerminal(story, state.scene)) state.ended = true;
  return state;
}
