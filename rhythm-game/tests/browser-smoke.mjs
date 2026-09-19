// 零依赖真实浏览器冒烟：起静态服务 -> 无头 Edge/Chrome --dump-dom。
// main.js 成功加载所有 ES module 并 fetch 到谱面后，会把
// #song-title 改成谱面标题、排行榜渲染空行。模块解析/运行时错误会让它们保持初始值。
// node tests/browser-smoke.mjs
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8137;
const URL = `http://localhost:${PORT}/`;

const candidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const browserPath = candidates.find(existsSync);
if (!browserPath) {
  console.log('跳过：没找到系统浏览器');
  process.exit(0);
}

const server = spawn('python', ['-m', 'http.server', String(PORT)], {
  cwd: root,
  stdio: 'ignore',
  shell: process.platform === 'win32',
});

try {
  await sleep(1500);
  const out = execFileSync(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--virtual-time-budget=4000',
      '--dump-dom',
      URL,
    ],
    { encoding: 'utf8', timeout: 30000 },
  );

  const checks = [
    ['谱面标题已渲染', out.includes('午休幻想曲')],
    ['BPM/音符数已渲染', out.includes('128 BPM') && out.includes('804 音符')],
    ['排行榜空行已渲染', out.includes('还没有成绩')],
    ['未停留在加载中', !out.includes('加载谱面中')],
    ['未出现谱面加载失败', !out.includes('谱面加载失败')],
  ];
  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) ok = false;
  }
  process.exit(ok ? 0 : 1);
} finally {
  server.kill();
}
