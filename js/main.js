import { generateDungeon, TILE } from "./dungeon.js";
import { encodeLink, decodeLink, PARAM_RANGES } from "./codec.js";

const FALLBACK_PRESETS = [
  { id: "cramped", name: "窄道", width: 64, height: 48, roomMin: 5, roomMax: 11, roomCount: 18, corridorWidth: 1, extraLoops: 2, treasureRooms: 3 },
  { id: "open", name: "大厅", width: 80, height: 60, roomMin: 9, roomMax: 18, roomCount: 12, corridorWidth: 3, extraLoops: 5, treasureRooms: 2 },
  { id: "maze", name: "迷宫", width: 72, height: 72, roomMin: 3, roomMax: 6, roomCount: 40, corridorWidth: 1, extraLoops: 0, treasureRooms: 5 },
  { id: "cave", name: "洞穴", width: 96, height: 64, roomMin: 6, roomMax: 14, roomCount: 24, corridorWidth: 2, extraLoops: 8, treasureRooms: 4 },
];
const PARAM_FIELDS = [
  "width", "height", "roomMin", "roomMax",
  "roomCount", "corridorWidth", "extraLoops", "treasureRooms",
];
const DEFAULT_SEED = "lantern";

const $ = (id) => document.getElementById(id);
const canvas = $("map");
const ctx = canvas.getContext("2d");
let current = null;

function showStatus(msg, isError) {
  const el = $("status");
  el.textContent = msg || "";
  el.className = isError ? "error" : "info";
  el.style.display = msg ? "block" : "none";
}

function readInputs() {
  const params = {};
  for (const f of PARAM_FIELDS) params[f] = Number($(f).value);
  return params;
}

function writeInputs(params, seed) {
  for (const f of PARAM_FIELDS) $(f).value = params[f];
  if (seed !== undefined) $("seed").value = seed;
}

function validateInputs(params) {
  for (const f of PARAM_FIELDS) {
    const [lo, hi] = PARAM_RANGES[f];
    if (!Number.isInteger(params[f]) || params[f] < lo || params[f] > hi)
      return `${f} 需要在 [${lo}, ${hi}] 之间`;
  }
  if (params.roomMax < params.roomMin) return "roomMax 不能小于 roomMin";
  if (params.treasureRooms > params.roomCount) return "宝箱房数量不能超过房间总数";
  return null;
}

function generate() {
  const params = readInputs();
  const seed = $("seed").value;
  const err = validateInputs(params);
  if (err) {
    showStatus(err, true);
    return;
  }
  if (!seed) {
    showStatus("种子不能为空", true);
    return;
  }
  current = { params, seed, dungeon: generateDungeon(params, seed) };
  render();
  const code = encodeLink(params, seed);
  history.replaceState(null, "", `#m=${code}`);
  const d = current.dungeon;
  showStatus(
    d.placedRooms < d.targetRooms
      ? `地图放不下 ${d.targetRooms} 个房间，已自动退化为 ${d.placedRooms} 个`
      : `已生成 ${d.placedRooms} 个房间，宝箱房 ${d.treasures.length} 个`,
    false
  );
}

function drawTo(context, d, cell) {
  context.fillStyle = "#14161f";
  context.fillRect(0, 0, d.width * cell, d.height * cell);
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      const t = d.grid[y * d.width + x];
      if (t === TILE.WALL) continue;
      context.fillStyle = t === TILE.ROOM ? "#c9b896" : "#7d7466";
      context.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const mark = (roomIdx, color) => {
    const r = d.rooms[roomIdx];
    context.fillStyle = color;
    context.fillRect(r.cx * cell + cell * 0.2, r.cy * cell + cell * 0.2, cell * 0.6, cell * 0.6);
  };
  for (const t of d.treasures) mark(t, "#e8b830");
  mark(d.spawn, "#4fc06a");
}

function render() {
  const d = current.dungeon;
  const maxW = $("map-wrap").clientWidth - 4;
  const maxH = Math.max(360, window.innerHeight - 140);
  const cell = Math.max(3, Math.floor(Math.min(maxW / d.width, maxH / d.height)));
  canvas.width = d.width * cell;
  canvas.height = d.height * cell;
  drawTo(ctx, d, cell);
}

function copyText(text, okMsg) {
  navigator.clipboard.writeText(text).then(
    () => showStatus(okMsg, false),
    () => showStatus("复制失败，浏览器拒绝了剪贴板访问", true)
  );
}

async function init() {
  let presets = FALLBACK_PRESETS;
  try {
    const res = await fetch("samples/presets.json");
    presets = (await res.json()).presets;
  } catch {
    // file:// 或离线时用内置副本
  }
  const sel = $("preset");
  for (const p of presets) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.onchange = () => {
    const p = presets.find((x) => x.id === sel.value);
    if (p) writeInputs(p);
  };

  // 从链接恢复；链接坏了就提示并退回默认参数，绝不白屏
  const m = location.hash.match(/^#m=(.+)$/);
  if (m) {
    const decoded = decodeLink(m[1]);
    if (decoded.ok) {
      writeInputs(decoded.params, decoded.seed);
    } else {
      writeInputs(presets[0], DEFAULT_SEED);
      showStatus(`链接无效：${decoded.error}。已加载默认地图。`, true);
    }
  } else {
    writeInputs(presets[0], DEFAULT_SEED);
  }

  $("generate").onclick = generate;
  $("share").onclick = () => {
    if (!current) return;
    const url = `${location.href.split("#")[0]}#m=${encodeLink(current.params, current.seed)}`;
    copyText(url, `链接已复制（${url.length} 字符）`);
  };
  $("export").onclick = () => {
    if (!current) return;
    const d = current.dungeon;
    const off = document.createElement("canvas");
    off.width = d.width * 8;
    off.height = d.height * 8;
    drawTo(off.getContext("2d"), d, 8);
    off.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `dungeon-${current.seed}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };
  $("coords").onclick = () => {
    if (!current) return;
    const d = current.dungeon;
    const data = {
      seed: current.seed,
      params: current.params,
      spawn: { room: d.spawn, x: d.rooms[d.spawn].cx, y: d.rooms[d.spawn].cy },
      rooms: d.rooms.map((r, i) => ({
        id: i, x: r.x, y: r.y, w: r.w, h: r.h,
        treasure: d.treasures.includes(i),
      })),
    };
    copyText(JSON.stringify(data, null, 2), "坐标已复制到剪贴板");
  };
  window.addEventListener("resize", () => current && render());

  generate();
}

init();
