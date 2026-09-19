// 零依赖真实浏览器玩法冒烟（CDP + 极简内置 WebSocket）：
// 启动一局 -> 页面内定时器机器人在音符时刻调真实按键处理 ->
// 验证 Perfect/连击/分数增长 -> Esc 暂停并验证歌曲时间冻结 -> 恢复继续。
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8139;
const CDP_PORT = 8140;
const TARGET = `http://localhost:${PORT}/`;

const candidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = candidates.find(existsSync);
if (!browserPath) {
  console.log('跳过：没找到系统浏览器');
  process.exit(0);
}

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(Number(u.port), u.hostname, () => {
      sock.write(
        `GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\n` +
          `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    let handshake = Buffer.alloc(0);
    sock.on('data', function onData(chunk) {
      handshake = Buffer.concat([handshake, chunk]);
      if (handshake.includes('\r\n\r\n')) {
        sock.removeListener('data', onData);
        resolve(wrap(sock));
      }
    });
    sock.on('error', reject);
  });

  function wrap(sock) {
    let buf = Buffer.alloc(0);
    const queue = [];
    const waiters = [];
    sock.on('data', (c) => {
      buf = Buffer.concat([buf, c]);
      while (true) {
        if (buf.length < 2) break;
        const b1 = buf[1] & 0x7f;
        let len = b1;
        let off = 2;
        if (b1 === 126) { len = buf.readUInt16BE(2); off = 4; }
        else if (b1 === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) break;
        queue.push(buf.slice(off, off + len).toString('utf8'));
        buf = buf.slice(off + len);
        while (waiters.length && queue.length) waiters.shift()(queue.shift());
      }
    });
    return {
      send(obj) {
        const data = Buffer.from(JSON.stringify(obj), 'utf8');
        const mask = crypto.randomBytes(4);
        const head = [0x81];
        if (data.length < 126) head.push(0x80 | data.length);
        else {
          head.push(0xfe);
          const n = data.length;
          head.push((n >> 8) & 255, n & 255);
        }
        const masked = Buffer.from(data.map((b, i) => b ^ mask[i % 4]));
        sock.write(Buffer.concat([Buffer.from(head), mask, masked]));
      },
      recv: () =>
        new Promise((res) => {
          if (queue.length) res(queue.shift());
          else waiters.push(res);
        }),
      close: () => sock.end(),
    };
  }
}

const getJson = (u) =>
  new Promise((resolve, reject) => {
    http.get(u, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });

const server = spawn('python', ['-m', 'http.server', String(PORT)], {
  cwd: root,
  stdio: 'ignore',
  shell: process.platform === 'win32',
});
const profileDir = mkdtempSync(join(tmpdir(), 'rhythm-smoke-'));
const browser = spawn(
  browserPath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--autoplay-policy=no-user-gesture-required',
    TARGET,
  ],
  { stdio: 'ignore' },
);

let pass = true;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) pass = false;
};

try {
  await sleep(2500);
  const list = await getJson(`http://localhost:${CDP_PORT}/json`);
  const page = list.find((t) => t.url.includes(TARGET));
  const ws = await wsConnect(page.webSocketDebuggerUrl);
  let mid = 0;
  const pending = new Map();
  (async () => {
    while (true) {
      const msg = JSON.parse(await ws.recv());
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  })();
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++mid;
      pending.set(id, resolve);
      ws.send({ id, method, params });
    });
  await send('Runtime.enable');
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.result?.exceptionDetails) {
      throw new Error(
        JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails),
      );
    }
    return r.result.result.value;
  };

  check(
    '菜单已加载',
    (await evalJs(`document.getElementById('song-title').textContent`)).includes('幻想曲'),
  );

  // 注入定时器机器人：命中真实按键路径 Game.press
  await evalJs(`
    window.__robot = setInterval(() => {
      const g = window.__game;
      if (!g || g.phase === 'paused' || g.phase === 'finish' || g.phase === 'countdown') return;
      const songNow = g.transport.songTimeAtPerf(performance.now()) - g.offsetMs;
      for (let i = 0; i < g.chart.notes.length; i++) {
        if (g.states[i] !== 0) continue;
        const n = g.chart.notes[i];
        if (songNow >= n.timeMs && songNow - n.timeMs < 16) g.press(n.lane, performance.now());
      }
    }, 4);
  `);

  await evalJs(`document.getElementById('btn-start').click()`);
  await sleep(7000);

  const stats = await evalJs(`
    (() => {
      const b = window.__game.board;
      return { ...b.counts, maxCombo: b.maxCombo, score: b.score, phase: window.__game.phase };
    })()
  `);
  check('游戏进入播放阶段', stats.phase === 'play');
  check('已经判定出音符', stats.perfect + stats.great + stats.good + stats.miss > 10);
  check('Perfect 出现', stats.perfect > 0);
  check('零 Miss（机器人在窗口内）', stats.miss === 0);
  check('连击在累积', stats.maxCombo > 5);
  check('分数在增长', stats.score > 1000);

  const freezeA = await evalJs(`
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    window.__game.transport.songTimeAtPerf(performance.now());
  `);
  await sleep(700);
  const freezeB = await evalJs(`window.__game.transport.songTimeAtPerf(performance.now())`);
  check('Esc 进入暂停', (await evalJs(`window.__game.phase`)) === 'paused');
  check('暂停期间歌曲时间冻结（700ms 内零漂移）', Math.abs(freezeB - freezeA) < 1);

  await evalJs(`document.getElementById('btn-resume').click()`);
  await sleep(500);
  check('恢复到播放阶段', (await evalJs(`window.__game.phase`)) === 'play');
  const comboAfter = await evalJs(`window.__game.board.maxCombo`);
  await sleep(1500);
  const comboLater = await evalJs(`window.__game.board.maxCombo`);
  check('恢复后连击继续增长', comboLater > comboAfter);
  const missAfter = await evalJs(`window.__game.board.counts.miss`);
  check('暂停恢复后仍零 Miss（不错位）', missAfter === 0);

  await evalJs(`clearInterval(window.__robot); window.__game.destroy();`);
  ws.close();
} catch (err) {
  console.error('冒烟出错：', err.message);
  pass = false;
} finally {
  browser.kill();
  server.kill();
  setTimeout(() => rmSync(profileDir, { recursive: true, force: true }), 500);
}
process.exit(pass ? 0 : 1);
