// Temporary browser smoke test via CDP (Node built-in WebSocket, no deps).
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const profileDir = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\emberdeck-cdp';
fs.rmSync(profileDir, { recursive: true, force: true });

const port = 8131;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = path.join(process.cwd(), decodeURIComponent(req.url.split('?')[0]));
  if (req.url.endsWith('/')) p = path.join(p, 'index.html');
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'text/plain' });
    res.end(d);
  });
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
  '--allow-file-access-from-files',
  '--remote-debugging-port=8132', '--user-data-dir=' + profileDir,
  'about:blank',
]);

const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d))); }).on('error', reject);
});
let version;
for (let i = 0; i < 40; i++) {
  try { version = await getJson('http://127.0.0.1:8132/json'); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
}
const page = version.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown' || msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Log.entryAdded') {
    console.log('BROWSER:', msg.method, JSON.stringify(msg.params).slice(0, 500));
  }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const mid = ++id;
  pending.set(mid, resolve);
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
  return r.result.result.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');
const fileUrl = 'file:///' + path.join(process.cwd(), 'index.html').replace(/\\/g, '/') + '?seed=12345';
await send('Page.navigate', { url: fileUrl });
await new Promise((r) => setTimeout(r, 1300));
console.log('ready state:', await evalJs(`document.readyState`), 'cards:', await evalJs(`document.querySelectorAll('#playerHand .card').length`));
console.log('url:', await evalJs(`location.href`));
console.log('html len:', await evalJs(`document.documentElement.innerHTML.length`));
console.log('seed input exists:', await evalJs(`!!document.getElementById('seedInput')`));
console.log('body tail:', await evalJs(`document.body.innerText.slice(0, 300)`));

const results = [];
const check = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);
const enemyCardJs = `[...document.querySelectorAll('#playerHand .card')]
  .find((c) => !c.classList.contains('disabled') && c.querySelector('.ctag').textContent === '敌方')`;

check('enemy hp 70', await evalJs(`document.getElementById('enemyHpText').textContent`) === '70 / 70');
check('player hp 80', await evalJs(`document.getElementById('playerHpText').textContent`) === '80 / 80');
check('energy 3', await evalJs(`document.getElementById('energyCur').textContent`) === '3');
check('hand 5', await evalJs(`document.querySelectorAll('#playerHand .card').length`) === 5);
check('seed filled', await evalJs(`document.getElementById('seedInput').value`) === '12345');

// play an enemy-target card: click card -> target bar -> click enemy
await evalJs(`(${enemyCardJs}).click()`);
await new Promise((r) => setTimeout(r, 80));
check('armed + target bar', await evalJs(`!!document.querySelector('.card.armed') && !document.getElementById('targetBar').hidden`));
await evalJs(`document.getElementById('targetEnemyBtn').click()`);
await new Promise((r) => setTimeout(r, 1300));
check('energy spent', Number(await evalJs(`document.getElementById('energyCur').textContent`)) === 1);
check('enemy damaged', await evalJs(`document.getElementById('enemyHpText').textContent`) === '62 / 70');
check('log line', await evalJs(`document.getElementById('logBox').innerText.includes('你打出')`));

// double-click target button resolves only once
await evalJs(`
  (async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    (${enemyCardJs}).click();
    await sleep(30);
    document.getElementById('targetEnemyBtn').click();
    document.getElementById('targetEnemyBtn').click();
  })()`);
await new Promise((r) => setTimeout(r, 100));
check('double-click target -> only one play (hand stays 3)', await evalJs(`document.querySelectorAll('#playerHand .card').length`) === 3);
await new Promise((r) => setTimeout(r, 900));

// spam clicks while resolution animation in flight: state must freeze
const spam = await evalJs(`
  (async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const before = { energy: document.getElementById('energyCur').textContent, hand: document.querySelectorAll('#playerHand .card').length };
    const target = ${enemyCardJs};
    if (!target) return { error: 'no enemy card', before, tags: [...document.querySelectorAll('#playerHand .card')].map(c=>c.className+'|'+c.querySelector('.ctag').textContent) };
    target.click();
    await sleep(20);
    document.getElementById('targetEnemyBtn').click();
    const snaps = [];
    for (let i = 0; i < 10; i++) {
      document.querySelectorAll('#playerHand .card')[0]?.click();
      document.getElementById('endTurnBtn').click();
      await sleep(40);
      snaps.push(document.querySelectorAll('#playerHand .card').length + '@' + document.getElementById('energyCur').textContent);
    }
    await sleep(800);
    return { before, snaps, after: { energy: document.getElementById('energyCur').textContent, hand: document.querySelectorAll('#playerHand .card').length } };
  })()`);
const frozen = spam.snaps.slice(0, 6).every((x) => x === `${spam.before.hand - 1}@${spam.before.energy}`);
if (spam.error) console.log('SPAM ERROR:', JSON.stringify(spam));
check('state frozen during animation spam', !spam.error && frozen, JSON.stringify({ error: spam.error, before: spam.before, snaps: spam.snaps && spam.snaps.slice(0, 4), after: spam.after }));

check('localStorage saved', await evalJs(`!!localStorage.getItem('emberdeck.save.v1')`));

// illegal: end turn while it is player turn twice quickly (second click must be ignored)
await evalJs(`
  document.getElementById('endTurnBtn').click();
  document.getElementById('endTurnBtn').click();
  document.getElementById('endTurnBtn').click();`);
await new Promise((r) => setTimeout(r, 3500));
check('AI acted', await evalJs(`document.getElementById('logBox').innerText.includes('AI 打出')`));
check('back to player turn', await evalJs(`document.getElementById('turnInfo').textContent.includes('你的回合')`));

// export record -> in-page self check -> import -> viewer
await evalJs(`document.getElementById('exportBtn').click()`);
await new Promise((r) => setTimeout(r, 200));
const verifyText = await evalJs(`document.getElementById('recordVerify').textContent`);
check('record self-check ok', verifyText.includes('自检通过'), verifyText);
const recordJson = await evalJs(`document.getElementById('recordText').value`);
fs.writeFileSync('tmp_browser_record.json', recordJson, 'utf8');

// open import modal and paste
await evalJs(`document.getElementById('recordModal').hidden = true; document.getElementById('importBtn').click()`);
await evalJs(`document.getElementById('recordText').value = ${JSON.stringify(recordJson)}; document.getElementById('recordLoadBtn').click()`);
await new Promise((r) => setTimeout(r, 300));
check('viewer entered', await evalJs(`!document.getElementById('viewerBar').hidden`));
check('viewer step0 enemy 70', await evalJs(`document.getElementById('enemyHpText').textContent`) === '70 / 70');
const parsed = JSON.parse(recordJson);
await evalJs(`document.getElementById('vwScrub').value = ${parsed.steps.length - 1}; document.getElementById('vwScrub').dispatchEvent(new Event('input'))`);
check('viewer last step label', (await evalJs(`document.getElementById('vwPos').textContent`)) === `${parsed.steps.length - 1} / ${parsed.steps.length - 1}`);

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
ws.close();
server.close();
chrome.kill();
process.exit(failed ? 1 : 0);
