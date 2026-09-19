import { writeFileSync } from 'node:fs';

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
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception));
  return r.result.result.value;
}
function seekTo(t) {
  return evalJs(`(() => {
    const s = document.getElementById('seek');
    s.value = ${t};
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return document.getElementById('ticklabel').textContent;
  })()`);
}

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1000,
  height: 1050,
  deviceScaleFactor: 1,
  mobile: false,
});
await new Promise((r) => setTimeout(r, 800));

const replayJson = await evalJs(`(async () => {
  const { arena, rules } = await (await import('/js/config.js')).loadConfig();
  const sim = await import('/js/sim.js');
  const rep = await import('/js/replay.js');
  const m = sim.createMatch(arena, rules, 555);
  const rec = new rep.Recorder(555, m.totalTicks, arena, rules);
  while (m.status === 'running') {
    const t = m.tick + 1;
    const inp = [t <= 103 ? 1 : t <= 128 ? 8 : 0, t <= 103 ? 1 : t <= 128 ? 4 : 0];
    rec.noteInputs(t, inp);
    sim.step(m, inp);
  }
  return JSON.stringify(rec.finish(m));
})()`);

await evalJs(`window.__testReplay = ${JSON.stringify(replayJson)}`);
await evalJs(`(() => {
  document.getElementById('btnImport').click();
  document.getElementById('replayText').value = window.__testReplay;
  document.getElementById('btnLoadReplay').click();
})()`);
await new Promise((r) => setTimeout(r, 300));

console.log('entered:', JSON.stringify(await evalJs(`(() => ({
  specbar: document.getElementById('specbar').classList.contains('on'),
  verify: document.getElementById('verify').textContent,
  tick: document.getElementById('ticklabel').textContent,
}))()`)));

await seekTo(3000);
await new Promise((r) => setTimeout(r, 150));
console.log('seek 3000:', JSON.stringify(await evalJs(`(() => ({
  tick: document.getElementById('ticklabel').textContent,
  timer: document.getElementById('timer').textContent,
  s0: document.getElementById('score0').textContent,
}))()`)));

await seekTo(10800);
await new Promise((r) => setTimeout(r, 150));
console.log('seek end:', JSON.stringify(await evalJs(`(() => ({
  tick: document.getElementById('ticklabel').textContent,
  s0: document.getElementById('score0').textContent,
  s1: document.getElementById('score1').textContent,
  status: document.getElementById('status').textContent,
}))()`)));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('_shot_spec.png', Buffer.from(shot.result.data, 'base64'));

// Slow motion 0.25x for 600ms wall => expect ~9 ticks advanced from 0
await seekTo(0);
await evalJs(`(() => {
  const sp = document.getElementById('speed');
  sp.value = '0.25';
  sp.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('btnPlay').click();
})()`);
await new Promise((r) => setTimeout(r, 600));
console.log('slowmo 600ms:', JSON.stringify(await evalJs(`(() => ({
  tick: document.getElementById('ticklabel').textContent,
  status: document.getElementById('status').textContent,
}))()`)));

// Tampered replay should show red verification warning
await evalJs(`(() => {
  const bad = JSON.parse(window.__testReplay);
  bad.seed = 1;
  document.getElementById('replayText').value = JSON.stringify(bad);
  document.getElementById('btnLoadReplay').click();
})()`);
await new Promise((r) => setTimeout(r, 200));
console.log('tampered:', JSON.stringify(await evalJs(`(() => ({
  cls: document.getElementById('verify').className,
  text: document.getElementById('verify').textContent,
}))()`)));

ws.close();
process.exit(0);
