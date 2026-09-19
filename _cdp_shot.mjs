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

await send('Page.enable');
await new Promise((r) => setTimeout(r, 800));

// Start a real live match, then synthesize held keys via dispatching events
// (P1 holds W then D; P2 holds Up then Left) for ~4.5s, then screenshot.
await evalJs(`document.getElementById('btnStart').click()`);

function key(code, type) {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
}
await evalJs(`
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true }));
`);
await new Promise((r) => setTimeout(r, 1700));
await evalJs(`
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', bubbles: true }));
`);
await new Promise((r) => setTimeout(r, 1300));

const state = await evalJs(`({
  status: document.getElementById('status').textContent,
  timer: document.getElementById('timer').textContent,
  s0: document.getElementById('score0').textContent,
  s1: document.getElementById('score1').textContent,
})`);
console.log(JSON.stringify(state));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('_shot_live.png', Buffer.from(shot.result.data, 'base64'));
console.log('screenshot saved');
ws.close();
process.exit(0);
