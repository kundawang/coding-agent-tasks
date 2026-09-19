// 无依赖测试脚本：node test/run-tests.mjs
// 验证四件事：确定性、连通性、参数退化、链接编解码与防篡改。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRng } from "../js/rng.js";
import { generateDungeon, bfsDistances, TILE } from "../js/dungeon.js";
import { encodeLink, decodeLink } from "../js/codec.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const presets = JSON.parse(readFileSync(join(root, "samples/presets.json"), "utf8")).presets;
const seeds = readFileSync(join(root, "samples/seeds.txt"), "utf8")
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL  ${name}`);
  }
}

const gridStr = (d) => Array.from(d.grid).join(",");

// --- 1. 确定性：同参数同种子逐格一致，且与参数对象的键序无关 ---
for (const p of presets) {
  for (const seed of seeds) {
    const a = generateDungeon(p, seed);
    const b = generateDungeon(p, seed);
    check(`determinism ${p.id}/${seed}`, gridStr(a) === gridStr(b));
    const shuffled = {};
    for (const k of Object.keys(p).reverse()) shuffled[k] = p[k];
    const c = generateDungeon(shuffled, seed);
    check(`key-order-independent ${p.id}/${seed}`, gridStr(a) === gridStr(c));
  }
}
const rngA = createRng(" lantern ");
const rngB = createRng(" lantern ");
check(
  "rng stream identical",
  Array.from({ length: 100 }, () => rngA.next()).every((v, i) => v === [rngB.next()][0] && true)
);

// --- 2. 连通性：所有房间、所有宝箱房、所有地板格都从出生点可达 ---
function assertConnected(tag, d) {
  const dist = bfsDistances(d.grid, d.width, d.height, d.rooms[d.spawn].cx, d.rooms[d.spawn].cy);
  let allRooms = true;
  for (const r of d.rooms) {
    for (let y = r.y; y < r.y + r.h && allRooms; y++)
      for (let x = r.x; x < r.x + r.w && allRooms; x++)
        if (dist[y * d.width + x] < 0) allRooms = false;
  }
  check(`connected rooms ${tag}`, allRooms);
  check(
    `connected treasures ${tag}`,
    d.treasures.every((t) => dist[d.rooms[t].cy * d.width + d.rooms[t].cx] >= 0)
  );
  let allFloor = true;
  for (let i = 0; i < d.grid.length; i++)
    if (d.grid[i] !== TILE.WALL && dist[i] < 0) allFloor = false;
  check(`no orphan floor ${tag}`, allFloor);
  check(
    `treasure count ${tag}`,
    d.treasures.length === Math.min(d.targetRooms > 0 ? d.placedRooms - 1 : 0, d.treasures.length) &&
      d.treasures.every((t) => t !== d.spawn)
  );
}
for (const p of presets) {
  for (const seed of seeds) assertConnected(`${p.id}/${seed}`, generateDungeon(p, seed));
}

// --- 3. 优雅退化：参数互相打架时不卡死、有房间、仍连通 ---
const nasty = [
  { width: 16, height: 16, roomMin: 2, roomMax: 32, roomCount: 120, corridorWidth: 5, extraLoops: 40, treasureRooms: 20 },
  { width: 128, height: 128, roomMin: 24, roomMax: 32, roomCount: 120, corridorWidth: 1, extraLoops: 0, treasureRooms: 20 },
  { width: 16, height: 128, roomMin: 2, roomMax: 24, roomCount: 60, corridorWidth: 3, extraLoops: 10, treasureRooms: 5 },
  { width: 32, height: 32, roomMin: 10, roomMax: 20, roomCount: 1, corridorWidth: 2, extraLoops: 5, treasureRooms: 3 },
];
for (const p of nasty) {
  const t0 = Date.now();
  const d = generateDungeon(p, "nasty-seed");
  check(`degenerate fast (${Date.now() - t0}ms)`, Date.now() - t0 < 1000);
  check(`degenerate has rooms`, d.rooms.length >= 1);
  check(`degenerate placed <= target`, d.placedRooms <= p.roomCount);
  assertConnected(`degenerate ${p.width}x${p.height}rc${p.roomCount}`, d);
}

// --- 4. 链接：往返一致；各种篡改都被识别且不抛异常 ---
for (const p of presets) {
  for (const seed of seeds) {
    const code = encodeLink(p, seed);
    check(`link short ${p.id}/${seed} (${code.length}ch)`, code.length <= 120);
    const back = decodeLink(code);
    check(`link roundtrip ${p.id}/${seed}`, back.ok && back.seed === seed &&
      Object.keys(p).every((k) => typeof p[k] !== "number" || back.params[k] === p[k]));
  }
}
const unicodeSeed = "龙与地下城";
const rt = decodeLink(encodeLink(presets[0], unicodeSeed));
check("unicode seed roundtrip", rt.ok && rt.seed === unicodeSeed);

const good = encodeLink(presets[0], "lantern");
const tampered = [
  "",
  good.slice(0, -2),
  good + "!!!",
  "!!!!",
  "A".repeat(1000),
  encodeLink({ ...presets[0], width: 9999 }, "x"),
  encodeLink({ ...presets[0], roomCount: 0 }, "x"),
  btoa("64.48.5.11.18.1.2~").replace(/=+$/, ""),
  btoa("64.48.5.11.18.1.2.3").replace(/=+$/, ""),
  btoa("64.48.11.5.18.1.2.3~x").replace(/=+$/, ""),
  btoa("not a map at all").replace(/=+$/, ""),
];
for (const t of tampered) {
  let r;
  let threw = false;
  try {
    r = decodeLink(t);
  } catch {
    threw = true;
  }
  check(`tamper rejected: ${JSON.stringify(t.slice(0, 24))}`, !threw && r && r.ok === false && typeof r.error === "string");
}

// --- 5. 源码卫生：生成链路里禁止 Math.random ---
for (const f of ["js/rng.js", "js/dungeon.js", "js/codec.js", "js/main.js"]) {
  const src = readFileSync(join(root, f), "utf8");
  check(`no Math.random in ${f}`, !src.includes("Math.random"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
