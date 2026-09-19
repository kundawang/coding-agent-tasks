// 剧本加载与静态校验。校验只看“剧本本身写得对不对”，
// 不依赖任何运行中的存档。

export class StoryError extends Error {}

export async function loadStory(url) {
  let text;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new StoryError(`读不到剧本文件 ${url}：HTTP ${res.status}`);
    }
    text = await res.text();
  } catch (err) {
    if (err instanceof StoryError) throw err;
    throw new StoryError(
      `读不到剧本文件 ${url}。\n` +
      `如果你是双击打开的 index.html（file:// 协议），浏览器会拒绝 fetch 本地文件。\n` +
      `请在本目录起一个静态服务器再访问，例如：python -m http.server 8000\n` +
      `（原始错误：${err && err.message ? err.message : err}）`
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new StoryError(`剧本不是合法 JSON：${describeJsonError(text, err)}`);
  }

  const { errors, warnings } = validateStory(data);
  return { story: data, errors, warnings };
}

function describeJsonError(text, err) {
  const m = /position (\d+)/.exec(err.message || '');
  if (!m) return err.message || String(err);
  const pos = Number(m[1]);
  let line = 1;
  let col = 1;
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text[i] === '\n') { line++; col = 1; } else { col++; }
  }
  const lineText = text.split('\n')[line - 1] || '';
  return `${err.message}（第 ${line} 行第 ${col} 列）\n  ${lineText.trim()}`;
}

const OPERATORS = ['eq', 'gte', 'lte'];

function typeName(value) {
  if (Array.isArray(value)) return 'array';
  return value === null ? 'null' : typeof value;
}

function valueTypeMatches(value, expected) {
  return typeName(value) === expected;
}

export function validateStory(story) {
  const errors = [];
  const warnings = [];
  const err = (where, message) => errors.push(`${where}：${message}`);
  const warn = (where, message) => warnings.push(`${where}：${message}`);

  if (!isPlainObject(story)) {
    err('剧本根', '必须是一个 JSON 对象，例如 { "start": ..., "vars": ..., "scenes": ... }');
    return { errors, warnings };
  }

  const id = typeof story.id === 'string' && story.id ? story.id : '(未命名剧本)';

  if (typeof story.start !== 'string' || !story.start) {
    err('根', '缺少 start，或 start 不是字符串。start 必须是起始场景的 id');
  }

  const varTypes = {};
  if (!isPlainObject(story.vars)) {
    err('根', '缺少 vars，或 vars 不是对象。vars 是初始变量表，例如 { "trust": 0 }');
  } else {
    for (const [name, value] of Object.entries(story.vars)) {
      const t = typeName(value);
      if (t !== 'boolean' && t !== 'number' && t !== 'string') {
        err(`vars["${name}"]`, `初始值类型 ${t} 不支持，只能是布尔、数字或字符串`);
        continue;
      }
      varTypes[name] = t;
    }
  }

  if (story.hud !== undefined) {
    if (!Array.isArray(story.hud) || story.hud.some((x) => typeof x !== 'string')) {
      err('hud', 'hud 必须是变量名字符串数组，例如 ["trust"]');
    } else {
      for (const name of story.hud) {
        if (!(name in varTypes)) err(`hud[${indexOf(story.hud, name)}]`, `声明了变量 "${name}"，但 vars 里没有定义`);
      }
    }
  }

  if (!isPlainObject(story.scenes)) {
    err('根', '缺少 scenes，或 scenes 不是对象。scenes 是 { 场景id: { text, choices } } 的映射');
    return { errors, warnings };
  }

  if (story.start && !(story.start in story.scenes)) {
    err(`start`, `起始场景 "${story.start}" 在 scenes 里不存在`);
  }

  const sceneIds = Object.keys(story.scenes);
  if (sceneIds.length === 0) {
    err('scenes', '一个场景都没有，没法玩');
  }

  for (const [si, sceneId] of sceneIds.entries()) {
    const whereScene = () => `第 ${si + 1} 个场景「${sceneId}」`;
    const scene = story.scenes[sceneId];

    if (!isPlainObject(scene)) {
      err(whereScene(), '场景必须是对象，形如 { "text": "...", "choices": [...] }');
      continue;
    }
    if (typeof scene.text !== 'string' || scene.text.length === 0) {
      err(whereScene(), '缺少 text，或 text 不是非空字符串（正文不能没有）');
    }
    if (!Array.isArray(scene.choices)) {
      err(whereScene(), '缺少 choices，或 choices 不是数组。结局场景请写 "choices": []');
      continue;
    }

    scene.choices.forEach((choice, ci) => {
      const where = () => `${whereScene()} 的第 ${ci + 1} 个选项`;

      if (!isPlainObject(choice)) {
        err(where(), '选项必须是对象');
        return;
      }
      if (typeof choice.text !== 'string' || choice.text.length === 0) {
        err(where(), '缺少 text，或 text 不是非空字符串（选项上得有字给玩家点）');
      }
      const isEnd = choice.end === true;

      if (choice.go === undefined || choice.go === null) {
        if (!isEnd) err(where(), '既没有 go 也没有 "end": true，选完不知道去哪');
      } else if (typeof choice.go !== 'string' || !choice.go) {
        err(where(), 'go 必须是场景 id 字符串');
      } else if (!(choice.go in story.scenes)) {
        err(where(), `go 指向场景 "${choice.go}"，但 scenes 里没有这个场景`);
      }

      if (choice.end !== undefined && typeof choice.end !== 'boolean') {
        err(where(), 'end 只能是 true / false（或者干脆不写）');
      }

      if (choice.if !== undefined) {
        checkCondition(choice.if, where, varTypes, err);
      }

      if (choice.set !== undefined) {
        if (!isPlainObject(choice.set)) {
          err(where(), 'set 必须是对象，例如 { "trust": 1 }');
        } else {
          for (const [name, value] of Object.entries(choice.set)) {
            checkAssignedVar(where, `set["${name}"]`, name, value, varTypes, err);
          }
        }
      }

      if (choice.add !== undefined) {
        if (!isPlainObject(choice.add)) {
          err(where(), 'add 必须是对象，例如 { "trust": 1 }');
        } else {
          for (const [name, value] of Object.entries(choice.add)) {
            if (!(name in varTypes)) {
              err(where(), `add["${name}"] 引用了没在 vars 里声明的变量 "${name}"（拼错了？还是忘了在 vars 里声明）`);
            } else if (varTypes[name] !== 'number' || typeof value !== 'number') {
              err(where(), `add["${name}"] 只能对数字变量加数字，"${name}" 是 ${varTypes[name]}，给的值是 ${typeName(value)}`);
            }
          }
        }
      }
    });
  }

  // 可达性：从 start 沿所有非 end 选项的 go 做 BFS（忽略条件，条件是运行时才知道的）。
  if (sceneIds.length > 0 && story.start in story.scenes && errors.length === 0) {
    const reachable = new Set();
    const queue = [story.start];
    while (queue.length) {
      const cur = queue.pop();
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      const scene = story.scenes[cur];
      if (!scene || !Array.isArray(scene.choices)) continue;
      for (const choice of scene.choices) {
        if (choice && choice.end === true) continue;
        if (choice && typeof choice.go === 'string' && choice.go in story.scenes) {
          queue.push(choice.go);
        }
      }
    }
    sceneIds.forEach((sceneId, i) => {
      if (!reachable.has(sceneId)) {
        warn(`第 ${i + 1} 个场景「${sceneId}」`, '从 start 怎么走都到不了（孤立场景）。检查是不是漏了选项指过去');
      }
    });
  }

  return { errors, warnings };
}

function indexOf(arr, value) {
  const i = arr.indexOf(value);
  return i === -1 ? '?' : i;
}

function checkCondition(cond, where, varTypes, err) {
  if (!isPlainObject(cond)) {
    err(where(), 'if 必须是对象，例如 { "var": "trust", "gte": 3 }');
    return;
  }
  if (typeof cond.var !== 'string' || !cond.var) {
    err(where(), 'if 缺少 "var"，或它不是变量名字符串');
    return;
  }
  if (!(cond.var in varTypes)) {
    err(where(), `if 引用了没在 vars 里声明的变量 "${cond.var}"（拼错了？还是忘了在 vars 里声明）`);
  }
  const ops = OPERATORS.filter((op) => cond[op] !== undefined);
  if (ops.length === 0) {
    err(where(), `if 没有比较条件，需要给 eq / gte / lte 中的一个（变量 "${cond.var}"）`);
    return;
  }
  if (ops.length > 1) {
    err(where(), `if 同时给了 ${ops.join(' / ')}，只能有一个（变量 "${cond.var}"）`);
  }
  const op = ops[0];
  const expected = varTypes[cond.var];
  if (expected !== undefined && !valueTypeMatches(cond[op], expected)) {
    err(where(), `if 的 ${op} 值类型不对：变量 "${cond.var}" 是 ${expected}，给的值是 ${typeName(cond[op])}`);
  }
  if ((op === 'gte' || op === 'lte') && expected === 'boolean') {
    err(where(), `布尔变量 "${cond.var}" 不能用 ${op}，布尔只能用 eq`);
  }
}

function checkAssignedVar(where, fieldDesc, name, value, varTypes, err) {
  if (!(name in varTypes)) {
    err(where(), `${fieldDesc} 引用了没在 vars 里声明的变量 "${name}"（拼错了？还是忘了在 vars 里声明）`);
    return;
  }
  const actual = typeName(value);
  if (actual !== varTypes[name]) {
    err(where(), `${fieldDesc} 类型不对：变量 "${name}" 声明的是 ${varTypes[name]}，给的值是 ${actual}`);
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
