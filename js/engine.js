// 运行时：条件判断、选项过滤、应用选项、结局判定。纯函数。

export function newGame(story) {
  return {
    storyId: story.id,
    storyVersion: story.version,
    current: story.start,
    vars: { ...story.initialVars },
    history: [],
    ended: false,
  };
}

export function evalCond(cond, vars) {
  if (!cond) return true;
  const actual = vars[cond.var];
  const wanted = cond.value;
  switch (cond.op) {
    case 'eq':
      return actual === wanted;
    case 'gte':
      return typeof actual === 'number' && typeof wanted === 'number' && actual >= wanted;
    case 'lte':
      return typeof actual === 'number' && typeof wanted === 'number' && actual <= wanted;
    default:
      return false;
  }
}

// 剧本通过校验后，运行时理论上不会再遇到结构问题；
// 但存档可能来自旧剧本，所以所有越界/缺场景都返回明确的错误对象而不抛异常。
export function visibleChoices(story, state) {
  const scene = story.scenes[state.current];
  if (!scene) return { error: `当前场景「${state.current}」在剧本里不存在（可能已被删除）。` };
  return { choices: scene.choices.map((choice, index) => ({ choice, index })).filter(({ choice }) => evalCond(choice.cond, state.vars)) };
}

export function isEnding(story, state) {
  if (state.ended) return true;
  const scene = story.scenes[state.current];
  if (!scene) return false;
  if (scene.choices.length === 0) return true;
  return visibleChoices(story, state).choices.length === 0;
}

export function choose(story, state, choiceIndex) {
  const scene = story.scenes[state.current];
  if (!scene) return { error: `当前场景「${state.current}」在剧本里不存在。` };
  const choice = scene.choices[choiceIndex];
  if (!choice) return { error: `第 ${choiceIndex + 1} 个选项在当前剧本里不存在（剧本可能改过）。` };
  if (!evalCond(choice.cond, state.vars)) {
    return { error: `选项「${choice.text}」的显示条件此刻不满足，选不了。` };
  }

  const nextVars = { ...state.vars };
  for (const [name, value] of Object.entries(choice.set)) nextVars[name] = value;
  for (const [name, delta] of Object.entries(choice.add)) nextVars[name] = nextVars[name] + delta;

  const entry = {
    scene: state.current,
    choice: choiceIndex,
    text: choice.text,
  };
  const nextHistory = [...state.history, entry];

  // end:true 且没有 go：在当前场景结束；end:true 且有 go：落到目标场景后结束。
  if (choice.end && !choice.go) {
    return {
      state: { ...state, vars: nextVars, history: nextHistory, ended: true },
    };
  }
  if (!choice.go) return { error: `选项「${choice.text}」既没有 go 也没有 end。` };
  if (!story.scenes[choice.go]) {
    return { error: `选项「${choice.text}」跳向的场景「${choice.go}」在剧本里不存在。` };
  }
  return {
    state: {
      ...state,
      vars: nextVars,
      history: nextHistory,
      current: choice.go,
      ended: choice.end,
    },
  };
}
