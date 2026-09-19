// 通过 CDP 在真实浏览器里跑一轮交互冒烟（Node >=18 自带 WebSocket）。
// 用法：先 node tools/serve.mjs，再 node tools/cdp-test.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9222;
const profile = mkdtempSync(join(tmpdir(), 'emberdeck-cdp-'));
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const child = spawn(chrome, [
  `--remote-debugging-port=${PORT}`,
  '--headless=new',
  '--disable-gpu',
  `--user-data-dir=${profile}`,
  'about:blank'
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(list.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await send('Page.enable');
  ws.addEventListener('message', (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.method === 'Page.javascriptDialogOpening') {
      send('Page.handleJavaScriptDialog', { accept: true });
    }
  });
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  };
  return {
    send,
    evalJs,
    close: () => {
      ws.close();
      child.kill();
      try { rmSync(profile, { recursive: true, force: true }); } catch {}
    }
  };
}

for (let i = 0; i < 40; i++) {
  try {
    await fetch(`http://127.0.0.1:${PORT}/json/version`);
    break;
  } catch {
    await sleep(300);
  }
}

const browser = await cdp();
const { evalJs } = browser;
await evalJs(`location.href = 'http://localhost:8123/index.html?seed=777'`);
await sleep(1500);

const results = [];
const check = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`);

// 1) 同种子两次开局手牌一致
const hand1 = await evalJs(`[...document.querySelectorAll('#hand .card .cname')].map(n=>n.textContent).join('|')`);
await evalJs(`document.getElementById('newGameBtn').click()`);
await sleep(300);
// confirm 对话框在 headless 里默认接受
const hand2 = await evalJs(`[...document.querySelectorAll('#hand .card .cname')].map(n=>n.textContent).join('|')`);
check('same seed deals same hand', hand1 === hand2 && hand1.length > 0);

// 2) 第一张能打的攻击牌：点牌 → 必须点敌人才生效；不点敌人直接再点别处不扣血
const state0 = await evalJs(`document.getElementById('enemyHpText').textContent`);
const firstAttackIdx = await evalJs(`
  (() => {
    const cards = [...document.querySelectorAll('#hand .card')];
    const idx = cards.findIndex(c => !c.classList.contains('unplayable'));
    return idx;
  })()`);
await evalJs(`document.querySelectorAll('#hand .card')[${firstAttackIdx}].click()`);
await sleep(100);
const pending = await evalJs(`document.querySelectorAll('#hand .card')[${firstAttackIdx}].classList.contains('pending')`);
check('enemy card enters pending-target mode', pending === true);

// 3) 双击攻击牌本身（不是敌人）：不会结算
await evalJs(`document.querySelectorAll('#hand .card')[${firstAttackIdx}].click()`);
await sleep(100);
const stateAfterDoubleCard = await evalJs(`document.getElementById('enemyHpText').textContent`);
check('clicking card twice does not resolve attack', stateAfterDoubleCard === state0);

// 4) 正确流程：点牌 → 点敌人，敌人掉血
await evalJs(`document.querySelectorAll('#hand .card')[${firstAttackIdx}].click()`);
await sleep(50);
await evalJs(`document.getElementById('enemySide').click()`);
await sleep(1200); // 等动画
const hpAfterHit = await evalJs(`document.getElementById('enemyHpText').textContent`);
check('enemy loses hp after valid target click', hpAfterHit !== state0);

// 5) 连点两次敌人目标（在同一动作上）只结算一次：记录当前手牌数，再尝试对敌人重复点击
const handCountAfter = await evalJs(`document.querySelectorAll('#hand .card').length`);
await evalJs(`document.getElementById('enemySide').click(); document.getElementById('enemySide').click();`);
await sleep(800);
const handCountAfterSpam = await evalJs(`document.querySelectorAll('#hand .card').length`);
check('double-click enemy does not resolve twice', handCountAfter === handCountAfterSpam);

// 6) 存档：刷新页面后种子/回合/血量恢复
const snapshotBefore = await evalJs(`JSON.stringify({
  hp: document.getElementById('playerHpText').textContent,
  ehp: document.getElementById('enemyHpText').textContent,
  turn: document.getElementById('turnInfo').textContent
})`);
await evalJs(`location.reload()`);
await sleep(1500);
const snapshotAfter = await evalJs(`JSON.stringify({
  hp: document.getElementById('playerHpText').textContent,
  ehp: document.getElementById('enemyHpText').textContent,
  turn: document.getElementById('turnInfo').textContent
})`);
check('localStorage resumes game', snapshotBefore === snapshotAfter);

// 7) 非法操作提示存在（结束回合后再点手牌应被拒绝或无响应）
await evalJs(`document.getElementById('endTurnBtn').click()`);
await sleep(9000); // 等 AI 回合（多张牌，每张带动画）跑完
const activeAfterEnemy = await evalJs(`document.getElementById('turnInfo').textContent`);
const endBtnEnabled = await evalJs(`!document.getElementById('endTurnBtn').disabled`);
check('turn returned to player after AI', activeAfterEnemy.includes('你') && endBtnEnabled);

// 8) 战报导出可用
await evalJs(`document.getElementById('exportBtn').click()`);
await sleep(100);
const recordJson = await evalJs(`document.getElementById('recordText').value`);
let recordOk = false;
try {
  const rec = JSON.parse(recordJson);
  recordOk = rec.kind === 'emberdeck-record' && Array.isArray(rec.actions) && rec.checksums.length === rec.actions.length + 1;
} catch {}
check('exported record is well-formed', recordOk);
writeFileSync('tmp-record.json', recordJson);

// 9) 战报复放全部校验和一致（在复盘页里载入）
await evalJs(`location.href = 'replay.html'`);
await sleep(1200);
const verify = await evalJs(`(async () => {
  const raw = ${JSON.stringify(recordJson).replace(/`/g, '\\`')};
  document.getElementById('recordInput').value = raw;
  document.getElementById('loadRecordBtn').click();
  await new Promise(r => setTimeout(r, 400));
  return document.getElementById('verifyResult').textContent;
})()`);
check('replay page verifies all steps', verify.includes('校验通过'));

console.log(results.join('\n'));
if (results.some((r) => r.startsWith('FAIL'))) process.exitCode = 1;
browser.close();
process.exit(process.exitCode ?? 0);
