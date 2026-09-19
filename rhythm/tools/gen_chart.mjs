// 占位谱面生成器：拿到真实谱面后，直接用真实文件覆盖 samples/chart.json 即可。
// 用法: node rhythm/tools/gen_chart.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', '..', 'samples', 'chart.json');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bpm = 150;
const beatMs = 60000 / bpm; // 400ms
const eighthMs = beatMs / 2;
const rand = mulberry32(20260918);

const TARGET_NOTES = 804;
const INTRO_BEATS = 8;    // 2 小节空拍进场
const OUTRO_MS = 3000;

const notes = [];
let lastLane = -1;
function pushNote(timeMs, lane) {
  notes.push({ time: Math.round(timeMs), lane });
  lastLane = lane;
}
function pickLane() {
  let lane = Math.floor(rand() * 4);
  if (lane === lastLane && rand() < 0.6) lane = (lane + 1 + Math.floor(rand() * 3)) % 4;
  return lane;
}

let beat = INTRO_BEATS;
while (notes.length < TARGET_NOTES) {
  const bar = Math.floor(beat / 4);
  const section = Math.floor(bar / 8) % 4; // 8 小节一个段落循环
  const beatInBar = beat % 4;
  const t = beat * beatMs;

  // 段落密度: 0=铺垫 1=主歌 2=副歌(密) 3=间奏(稀)
  const density = [0.95, 1.0, 1.0, 0.7][section];
  const isRestBar = section === 3 && bar % 2 === 1;

  if (!isRestBar) {
    for (let e = 0; e < 2; e++) {
      const et = t + e * eighthMs;
      if (rand() < density) pushNote(et, pickLane());
      // 副歌弱拍概率塞 16 分
      if (section === 2 && rand() < 0.3) pushNote(et + eighthMs / 2, pickLane());
    }
    // 每小节强拍保底一个音，避免长空白
    if (beatInBar === 0 && !notes.some(n => Math.abs(n.time - t) < 1)) {
      pushNote(t, pickLane());
    }
  }
  beat++;
}

notes.length = TARGET_NOTES; // 截到 804
notes.sort((a, b) => a.time - b.time);

const chart = {
  title: 'Placeholder Tune (generated)',
  bpm,
  offsetMs: 0,
  notes,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(chart));
const last = notes[notes.length - 1].time;
console.log(`notes=${notes.length} lastNote=${last}ms (~${(last / 1000).toFixed(1)}s) duration~${((last + OUTRO_MS) / 1000).toFixed(1)}s`);
