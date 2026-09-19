// 生成占位谱面 samples/chart.json（3 分钟、804 音符）。
// 真谱面拿到后直接覆盖这个文件即可，游戏无需改动。
// 运行：node scripts/generate-chart.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const BPM = 128;
const OFFSET_MS = (60000 / BPM) * 4; // 4 拍 lead-in 后落到第 0 拍
const BEAT = 60000 / BPM;
const BARS = 94;
const TARGET_NOTES = 804;

// 可复现的伪随机
let seed = 0x5eed1234;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
}

// 段落：bar 0-7 intro(0)，8-23 verse(1)，24-39 build(2)，
// 40-55 chorus(3)，56-71 verse2(1)，72-87 build2(2)，88-93 finale(3)
function sectionOf(bar) {
  if (bar < 8) return 0;
  if (bar < 24) return 1;
  if (bar < 40) return 2;
  if (bar < 56) return 3;
  if (bar < 72) return 1;
  if (bar < 88) return 2;
  return 3;
}

// 每个 16 分格子出现音符的基础概率（按段落）
const DENSITY = [0.26, 0.46, 0.62, 0.72];

const slots = [];
for (let bar = 0; bar < BARS; bar += 1) {
  const section = sectionOf(bar);
  for (let step = 0; step < 16; step += 1) {
    // intro 不打 16 分；所有段落都弱化反拍 16 分
    if (section === 0 && step % 2 === 1) continue;
    if (step % 2 === 1 && rand() > 0.45) continue;
    let p = DENSITY[section];
    if (step % 4 === 0) p = Math.min(1, p + 0.22); // 正拍更密
    if (rand() > p) continue;
    slots.push({ bar, step, u: rand() });
  }
}

// 用格子自带的随机值排序做增删，尽量不破坏密度形状
if (slots.length > TARGET_NOTES) {
  slots.sort((a, b) => b.u - a.u);
  slots.length = TARGET_NOTES;
} else if (slots.length < TARGET_NOTES) {
  const have = new Set(slots.map((s) => `${s.bar}:${s.step}`));
  const missing = [];
  for (let bar = 0; bar < BARS; bar += 1) {
    for (let step = 0; step < 16; step += 1) {
      if (!have.has(`${bar}:${step}`)) missing.push({ bar, step, u: rand() });
    }
  }
  missing.sort((a, b) => b.u - a.u);
  slots.push(...missing.slice(0, TARGET_NOTES - slots.length));
}

slots.sort((a, b) => (a.bar - b.bar) * 16 + a.step - b.step);

// 分配轨道：跟随最近轨道 + 随机游走，同轨连续太多就换
const notes = [];
let lastLane = rand() > 0.5 ? 1 : 2;
let sameLaneStreak = 0;
let lastStepKey = -1;

for (const slot of slots) {
  const stepKey = slot.bar * 16 + slot.step;
  let lane;
  if (stepKey - lastStepKey <= 1 && sameLaneStreak < 2) {
    lane = lastLane;
    sameLaneStreak += 1;
  } else {
    const drift = Math.round((rand() - 0.5) * 2); // -1..1
    lane = Math.min(3, Math.max(0, lastLane + drift));
    if (lane === lastLane) sameLaneStreak += 1;
    else sameLaneStreak = 0;
  }
  lastLane = lane;
  lastStepKey = stepKey;

  const timeMs = +(OFFSET_MS + stepKey * (BEAT / 4)).toFixed(3);
  notes.push({ timeMs, lane });

  // 高潮段落偶发双押（约 6%），增加表演感
  if (sectionOf(slot.bar) === 3 && rand() < 0.06) {
    const other = lane + (lane < 2 ? 1 : -1);
    if (other >= 0 && other < 4) notes.push({ timeMs, lane: other });
  }
}

// 双押可能把数量推过目标，按出现顺序裁掉多余的双押副音
if (notes.length > TARGET_NOTES) {
  const extra = notes.length - TARGET_NOTES;
  const marked = new Set();
  for (let i = notes.length - 1; i >= 0 && marked.size < extra; i -= 1) {
    const twin = notes.find(
      (n, j) => j !== i && n.timeMs === notes[i].timeMs && n.lane === notes[i].lane,
    );
    if (!twin) marked.add(i);
  }
  for (let i = notes.length - 1; i >= 0 && marked.size < extra; i -= 1) marked.add(i);
  for (const i of [...marked].sort((a, b) => b - a)) notes.splice(i, 1);
}

notes.sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);

const chart = {
  meta: {
    title: '午休幻想曲 (占位谱面)',
    artist: 'WebAudio 8-bit 合成',
    generatedBy: 'scripts/generate-chart.mjs',
  },
  bpm: BPM,
  offsetMs: +OFFSET_MS.toFixed(3),
  notes,
};

mkdirSync(join(root, 'samples'), { recursive: true });
writeFileSync(join(root, 'samples', 'chart.json'), JSON.stringify(chart, null, 1));
console.log(
  `生成完成：${notes.length} 音符，时长 ${(notes[notes.length - 1].timeMs / 60000).toFixed(1)} 分钟`,
);
