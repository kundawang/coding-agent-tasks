// 通过 CDP 在真实浏览器里跑页面级集成测试（只用 Node 内置 WebSocket/fetch）。

const base = 'http://127.0.0.1:9333';
const pageUrl = 'http://127.0.0.1:8147/index.html';

const target = await (await fetch(`${base}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((r) => pending.set(mid, r));
}
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result.exceptionDetails) {
    throw new Error('JS error: ' + JSON.stringify(r.result.exceptionDetails.exception));
  }
  return r.result.result.value;
}

await send('Page.enable');
await new Promise((r) => setTimeout(r, 1200));

// 页面内脚本：直接驱动真实 app 的状态。app.js 没导出，所以通过 DOM + 模拟操作。
// 但为验证核心，直接在页面上下文里重新 import 模块跑一局（和 app 用的是同一份代码）。
const result = await evalJs(`(async () => {
  const out = {};
  const cfg = await import('/js/config.js');
  const { arena, rules } = await cfg.loadConfig();
  const sim = await import('/js/sim.js');
  const rep = await import('/js/replay.js');

  // 1) 固定步长确定性：同种子两次
  const script = (t) => [t <= 103 ? 1 : t <= 128 ? 8 : 0, t <= 103 ? 1 : t <= 128 ? 4 : 0];
  function play(seed) {
    const m = sim.createMatch(arena, rules, seed);
    const rec = new rep.Recorder(seed, m.totalTicks, arena, rules);
    while (m.status === 'running') {
      const t = m.tick + 1;
      const inp = script(t);
      rec.noteInputs(t, inp);
      sim.step(m, inp);
    }
    return { m, data: rec.finish(m) };
  }
  const a = play(123);
  const b = play(123);
  out.deterministic = JSON.stringify(a.data) === JSON.stringify(b.data);
  out.score = a.m.score.map(Math.floor);
  out.captures = a.m.events.filter(e => e.type === 'capture');
  out.verify = rep.reconstruct(a.data).consistent;
  out.ticks = a.m.totalTicks;

  // 2) 固定步长语义检查：tickRate=60 => stepMs
  out.stepMs = 1000 / rules.tickRate;

  // 3) 验证 UI 已加载（DOM 冒烟）
  out.uiTimer = document.getElementById('timer').textContent;
  out.hasCanvas = !!document.getElementById('game').getContext;
  return out;
})()`);

console.log(JSON.stringify(result, null, 2));

// 4) 点击“开始对战”，跑真实 RAF 主循环 1 秒，确认 HUD 从 3:00.0 变成 2:59.x
await evalJs(`document.getElementById('btnStart').click()`);
await new Promise((r) => setTimeout(r, 1200));
const hud = await evalJs(`({
  timer: document.getElementById('timer').textContent,
  status: document.getElementById('status').textContent,
  score0: document.getElementById('score0').textContent,
  overlayHidden: document.getElementById('overlay').classList.contains('hidden'),
})`);
console.log('after start:', JSON.stringify(hud));

// 5) 暂停
await evalJs(`document.getElementById('btnPause').click()`);
const paused1 = await evalJs(`document.getElementById('status').textContent`);
await new Promise((r) => setTimeout(r, 600));
const paused2 = await evalJs(`document.getElementById('status').textContent`);
console.log('pause:', paused1, '/', paused2, paused1 === paused2 ? 'OK 暂停不推进' : 'FAIL');

ws.close();
process.exit(0);
