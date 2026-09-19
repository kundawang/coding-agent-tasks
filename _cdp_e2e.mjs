import { writeFileSync } from 'node:fs';

const base = 'http://127.0.0.1:9333';
const target = await (await fetch(`${base}/json/new?${encodeURIComponent('http://127.0.0.1:8147/index.html')}`, { method: 'PUT' })).json();
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

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1050, deviceScaleFactor: 1, mobile: false });
await new Promise((r) => setTimeout(r, 800));

// Start a live match then fast-forward the live match object to one tick
// before the end; the real RAF loop runs the final step + finishLive().
await evalJs(`window.__tw.startLive()`);
await evalJs(`window.__tw.match.tick = window.__tw.match.totalTicks - 5`);
await new Promise((r) => setTimeout(r, 400));

const finishState = await evalJs(`(() => ({
  mode: window.__tw.mode,
  title: document.getElementById('ovTitle').textContent,
  body: document.getElementById('ovBody').textContent,
  overlayShown: !document.getElementById('overlay').classList.contains('hidden'),
  exportEnabled: !document.getElementById('btnExport').disabled,
  specEnabled: !document.getElementById('btnSpec').disabled,
  hasReplay: !!window.__tw.exported,
  score0: document.getElementById('score0').textContent,
  score1: document.getElementById('score1').textContent,
}))()`);
console.log('finish:', JSON.stringify(finishState, null, 2));

const shot1 = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('_shot_finish.png', Buffer.from(shot1.result.data, 'base64'));

// Enter spectator from the finish screen
await evalJs(`document.getElementById('btnSpecOverlay').click()`);
await new Promise((r) => setTimeout(r, 300));
const specState = await evalJs(`(() => ({
  mode: window.__tw.mode,
  specbar: document.getElementById('specbar').classList.contains('on'),
  verify: document.getElementById('verify').textContent,
  endTick: document.getElementById('ticklabel').textContent,
}))()`);
console.log('spec:', JSON.stringify(specState, null, 2));

// Exit spectator -> should return to finish overlay
await evalJs(`document.getElementById('btnExitSpec').click()`);
await new Promise((r) => setTimeout(r, 150));
const backState = await evalJs(`(() => ({
  mode: window.__tw.mode,
  overlayShown: !document.getElementById('overlay').classList.contains('hidden'),
  specbar: document.getElementById('specbar').classList.contains('on'),
}))()`);
console.log('back to finish:', JSON.stringify(backState, null, 2));

const ok =
  finishState.mode === 'finished' &&
  finishState.overlayShown &&
  finishState.exportEnabled &&
  finishState.specEnabled &&
  finishState.hasReplay &&
  specState.mode === 'spectator' &&
  specState.specbar &&
  /校验通过/.test(specState.verify) &&
  backState.mode === 'finished' &&
  backState.overlayShown &&
  !backState.specbar;
console.log(ok ? 'E2E PASS' : 'E2E FAIL');
ws.close();
process.exit(ok ? 0 : 1);
