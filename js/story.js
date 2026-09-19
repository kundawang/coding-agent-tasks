// 剧本加载、解析与静态校验。纯函数，不碰 DOM。

export async function loadStory(url = 'samples/story.json') {
  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (e) {
    return {
      errors: [`剧本文件拉取失败（${url}）：${e.message}。请用本地静态服务器打开，不要直接双击 html。`],
      warnings: [],
    };
  }
  if (!res.ok) return { errors: [`剧本文件拉取失败：HTTP ${res.status}（${url}）`], warnings: [] };
  return parseStory(await res.text());
}

export function parseStory(raw) {
  const errors = [];
  const warnings = [];
  let root;
  try {
    root = JSON.parse(raw);
  } catch (e) {
    return { errors: [`剧本不是合法 JSON：${e.message}${describeJsonPosition(raw, e)}`], warnings: [] };
  }
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    return { errors: ['剧本根节点必须是 JSON 对象。'], warnings };
  }

  if (typeof root.id !== 'string' || !root.id.trim()) errors.push('剧本缺少字符串字段 id。');
  const id = root.id || 'story';

  if (!Number.isInteger(root.version) || root.version < 1) {
    warnings.push('剧本缺少正整数字段 version，按 1 处理（读档时靠它判断剧本有没有更新）。');
  }

  if (typeof root.start !== 'string' || !root.start) errors.push('剧本缺少 start 字段（起始场景 id）。');

  const initialVars = {};
  if (root.vars === undefined) {
    warnings.push('剧本没有 vars，初始变量表为空。');
  } else if (typeof root.vars !== 'object' || root.vars === null || Array.isArray(root.vars)) {
    errors.push('vars 必须是对象，例如 { "trust": 0 }。');
  } else {
    for (const [name, value] of Object.entries(root.vars)) {
      if (!isPrimitive(value)) errors.push(`初始变量「${name}」只能是数字、字符串或布尔值。`);
      else initialVars[name] = value;
    }
  }

  const hud = normalizeHud(root.hud, Object.keys(initialVars), errors, warnings);

  if (typeof root.scenes !== 'object' || root.scenes === null || Array.isArray(root.scenes)) {
    errors.push('剧本缺少 scenes 对象（场景表）。');
    return { errors, warnings, story: null };
  }

  for (const key of Object.keys(root)) {
    if (!['id', 'version', 'start', 'vars', 'hud', 'scenes'].includes(key)) {
      warnings.push(`剧本根上有未知字段「${key}」，已忽略，是不是拼错了？`);
    }
  }

  const scenes = {};
  let ordinal = 0;
  for (const [sceneId, rawScene] of Object.entries(root.scenes)) {
    ordinal += 1;
    const where = `第 ${ordinal} 个场景「${sceneId}」`;
    if (typeof rawScene !== 'object' || rawScene === null || Array.isArray(rawScene)) {
      errors.push(`${where}：场景必须是对象。`);
      continue;
    }
    const text = normalizeText(rawScene.text, where, errors, warnings);
    const choices = [];
    if (rawScene.choices === undefined) {
      warnings.push(`${where}：没有 choices，按空选项处理（走到这里即结局）。`);
    } else if (!Array.isArray(rawScene.choices)) {
      errors.push(`${where}：choices 必须是数组。`);
    } else {
      rawScene.choices.forEach((rawChoice, i) => {
        const choice = validateChoice(rawChoice, `${where}的第 ${i + 1} 个选项`, initialVars, errors, warnings);
        if (choice) choices.push(choice);
      });
    }
    for (const key of Object.keys(rawScene)) {
      if (!['text', 'choices'].includes(key)) warnings.push(`${where}：未知字段「${key}」，已忽略。`);
    }
    scenes[sceneId] = { id: sceneId, ordinal, text, choices };
  }

  if (Object.keys(scenes).length === 0) errors.push('scenes 里一个场景都没有。');
  if (root.start && !scenes[root.start]) errors.push(`start 指向的场景「${root.start}」不存在。`);

  for (const scene of Object.values(scenes)) {
    scene.choices.forEach((choice, i) => {
      if (choice.go !== null && !scenes[choice.go]) {
        errors.push(`第 ${scene.ordinal} 个场景「${scene.id}」的第 ${i + 1} 个选项「${choice.text}」跳到不存在的场景「${choice.go}」。`);
      }
    });
  }

  // 可达性：从 start 沿所有 go 边（忽略显示条件）走不到的场景就是孤岛。
  if (root.start && scenes[root.start]) {
    const reachable = new Set();
    const stack = [root.start];
    while (stack.length) {
      const cur = stack.pop();
      if (reachable.has(cur) || !scenes[cur]) continue;
      reachable.add(cur);
      for (const choice of scenes[cur].choices) {
        if (choice.go && scenes[choice.go] && !reachable.has(choice.go)) stack.push(choice.go);
      }
    }
    for (const scene of Object.values(scenes)) {
      if (!reachable.has(scene.id)) {
        warnings.push(`第 ${scene.ordinal} 个场景「${scene.id}」怎么走都到不了：没有任何选项指向它。`);
      }
    }
  }

  if (errors.length) return { errors, warnings, story: null };

  return {
    errors,
    warnings,
    story: {
      id,
      version: Number.isInteger(root.version) ? root.version : 1,
      start: root.start,
      initialVars,
      hud,
      scenes,
    },
  };
}

function validateChoice(rawChoice, where, initialVars, errors, warnings) {
  if (typeof rawChoice !== 'object' || rawChoice === null || Array.isArray(rawChoice)) {
    errors.push(`${where}：选项必须是对象。`);
    return null;
  }
  if (typeof rawChoice.text !== 'string' || !rawChoice.text.trim()) {
    errors.push(`${where}：缺少选项文字 text。`);
  }
  const text = typeof rawChoice.text === 'string' ? rawChoice.text : '(缺少文字)';

  let cond = null;
  if (rawChoice.if !== undefined) {
    const iw = `${where}的显示条件`;
    if (typeof rawChoice.if !== 'object' || rawChoice.if === null || Array.isArray(rawChoice.if)) {
      errors.push(`${iw}：if 必须是对象，例如 { "var": "trust", "gte": 2 }。`);
    } else {
      const varName = rawChoice.if.var;
      if (typeof varName !== 'string' || !varName) {
        errors.push(`${iw}：缺少要判断的变量名 var。`);
      } else if (!(varName in initialVars)) {
        errors.push(`${iw}：引用了没定义的变量「${varName}」（vars 里没有）。`);
      }
      const ops = ['eq', 'gte', 'lte'].filter((op) => op in rawChoice.if);
      if (ops.length === 0) {
        errors.push(`${iw}：至少要有一个比较运算符 eq / gte / lte。`);
      } else if (ops.length > 1) {
        errors.push(`${iw}：只能写一个比较运算符，现在写了 ${ops.join('、')}。`);
      } else {
        const op = ops[0];
        const value = rawChoice.if[op];
        if (!isPrimitive(value)) {
          errors.push(`${iw}：比较值只能是数字、字符串或布尔值。`);
        } else if (varName in initialVars && typeof initialVars[varName] !== typeof value) {
          warnings.push(`${iw}：变量「${varName}」是 ${typeName(initialVars[varName])}，比较值却是 ${typeName(value)}，选项可能永远（或总是）出现。`);
        }
        cond = { var: varName, op, value };
      }
      for (const key of Object.keys(rawChoice.if)) {
        if (!['var', 'eq', 'gte', 'lte'].includes(key)) warnings.push(`${iw}：未知字段「${key}」，已忽略。`);
      }
    }
  }

  const set = {};
  if (rawChoice.set !== undefined) {
    if (typeof rawChoice.set !== 'object' || rawChoice.set === null || Array.isArray(rawChoice.set)) {
      errors.push(`${where}：set 必须是对象，例如 { "trust": 1 }。`);
    } else {
      for (const [name, value] of Object.entries(rawChoice.set)) {
        if (!(name in initialVars)) {
          errors.push(`${where}：set 修改了没定义的变量「${name}」（先在 vars 里声明）。`);
        } else if (!isPrimitive(value)) {
          errors.push(`${where}：set 给变量「${name}」的值只能是数字、字符串或布尔值。`);
        } else if (typeof initialVars[name] !== typeof value) {
          errors.push(`${where}：变量「${name}」在 vars 里是 ${typeName(initialVars[name])}，set 却给了 ${typeName(value)}，类型不一致。`);
        } else {
          set[name] = value;
        }
      }
    }
  }

  const add = {};
  if (rawChoice.add !== undefined) {
    if (typeof rawChoice.add !== 'object' || rawChoice.add === null || Array.isArray(rawChoice.add)) {
      errors.push(`${where}：add 必须是对象，例如 { "trust": 1 }。`);
    } else if (rawChoice.set !== undefined) {
      errors.push(`${where}：同一个选项不能同时写 set 和 add（set 是赋值，add 是增量，二选一）。`);
    } else {
      for (const [name, delta] of Object.entries(rawChoice.add)) {
        if (!(name in initialVars)) {
          errors.push(`${where}：add 修改了没定义的变量「${name}」（先在 vars 里声明）。`);
        } else if (typeof initialVars[name] !== 'number' || typeof delta !== 'number') {
          errors.push(`${where}：add 只能对数字变量加数字，变量「${name}」或增量不是数字。`);
        } else {
          add[name] = delta;
        }
      }
    }
  }

  let go = null;
  if (rawChoice.go !== undefined) {
    if (typeof rawChoice.go !== 'string' || !rawChoice.go) {
      errors.push(`${where}：go 必须是场景 id 字符串。`);
    } else {
      go = rawChoice.go;
    }
  }

  const end = rawChoice.end === true;
  if (rawChoice.end !== undefined && typeof rawChoice.end !== 'boolean') {
    warnings.push(`${where}：end 应为布尔值 true/false，当前值已按真假处理。`);
  }
  if (go === null && !end) {
    errors.push(`${where}：既没有 go 也没有 end: true，点了什么都不会发生。`);
  }
  if (end && go === null) {
    warnings.push(`${where}：end: true 但没写 go，游戏会在当前场景直接结束（有意为之可忽略）。`);
  }

  for (const key of Object.keys(rawChoice)) {
    if (!['text', 'if', 'set', 'add', 'go', 'end'].includes(key)) {
      warnings.push(`${where}：未知字段「${key}」，已忽略。`);
    }
  }

  return { text, cond, set, add, go, end };
}

function normalizeText(value, where, errors, warnings) {
  if (value === undefined) {
    warnings.push(`${where}：没有 text，正文为空。`);
    return [''];
  }
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((part) => typeof part === 'string')) {
    if (value.length === 0) warnings.push(`${where}：text 是空数组，正文为空。`);
    return value;
  }
  errors.push(`${where}：text 必须是字符串，或者字符串数组（数组会逐段显示）。`);
  return [''];
}

function normalizeHud(value, varNames, errors, warnings) {
  const declared = new Set(varNames);
  if (value === undefined) return varNames.map((name) => ({ name, label: name }));
  if (!Array.isArray(value)) {
    errors.push('hud 必须是数组，例如 [ "trust", { "var": "hasKey", "label": "钥匙" } ]。');
    return varNames.map((name) => ({ name, label: name }));
  }
  const seen = new Set();
  const hud = [];
  value.forEach((item, i) => {
    const where = `hud 第 ${i + 1} 项`;
    let entry;
    if (typeof item === 'string') {
      entry = { name: item, label: item };
    } else if (item && typeof item === 'object' && !Array.isArray(item)) {
      if (typeof item.var !== 'string' || !item.var) {
        errors.push(`${where}：缺少 var。`);
        return;
      }
      const label = item.label === undefined ? item.var : item.label;
      if (typeof label !== 'string') {
        errors.push(`${where}：label 必须是字符串。`);
        return;
      }
      entry = { name: item.var, label };
      for (const key of Object.keys(item)) {
        if (key !== 'var' && key !== 'label') warnings.push(`${where}：未知字段「${key}」，已忽略。`);
      }
    } else {
      errors.push(`${where}：必须是变量名字符串，或 { "var": "...", "label": "..." } 对象。`);
      return;
    }
    if (!declared.has(entry.name)) {
      errors.push(`${where}：变量「${entry.name}」没在 vars 里声明。`);
      return;
    }
    if (seen.has(entry.name)) {
      warnings.push(`${where}：变量「${entry.name}」重复显示，已去掉重复项。`);
      return;
    }
    seen.add(entry.name);
    hud.push(entry);
  });
  return hud;
}

function isPrimitive(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function typeName(value) {
  if (Array.isArray(value)) return '数组';
  if (value === null) return 'null';
  if (typeof value === 'boolean') return '布尔值';
  if (typeof value === 'number') return '数字';
  if (typeof value === 'string') return '字符串';
  return typeof value;
}

// V8 的 JSON 错误 message 通常带 position，尽量换算成行列号。
function describeJsonPosition(raw, error) {
  const match = /position (\d+)/.exec(error.message);
  if (!match) return '';
  const pos = Number(match[1]);
  let line = 1;
  let col = 1;
  for (let i = 0; i < pos && i < raw.length; i += 1) {
    if (raw[i] === '\n') {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return `（大约第 ${line} 行第 ${col} 列）`;
}