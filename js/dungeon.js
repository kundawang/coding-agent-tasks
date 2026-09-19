// 地牢生成器。同一组参数 + 同一个种子，输出逐格一致：
// 所有随机性来自 createRng，且 RNG 调用顺序只依赖确定性的循环顺序，
// 不依赖对象键序、Map/Set 迭代顺序或时间。

import { createRng } from "./rng.js";

export const TILE = { WALL: 0, ROOM: 1, CORRIDOR: 2 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function generateDungeon(params, seedString) {
  const rng = createRng(seedString);
  const { width, height } = params;
  const grid = new Uint8Array(width * height);
  const rooms = [];

  // 房间边长先夹到地图能容纳的范围（优雅退化，不报错）
  const wLo = clamp(params.roomMin, 2, width - 4);
  const wHi = clamp(params.roomMax, wLo, width - 4);
  const hLo = clamp(params.roomMin, 2, height - 4);
  const hHi = clamp(params.roomMax, hLo, height - 4);

  const overlaps = (x, y, w, h) =>
    rooms.some(
      (r) =>
        x - 1 < r.x + r.w + 1 &&
        x + w + 1 > r.x - 1 &&
        y - 1 < r.y + r.h + 1 &&
        y + h + 1 > r.y - 1
    );

  const carveRoom = (x, y, w, h) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) grid[yy * width + xx] = TILE.ROOM;
    rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
  };

  // 随机放置，放满 roomCount 或尝试次数用尽为止（放不下就少放，绝不死循环）
  const maxAttempts = params.roomCount * 80;
  for (let attempt = 0; attempt < maxAttempts && rooms.length < params.roomCount; attempt++) {
    const w = rng.int(wLo, wHi);
    const h = rng.int(hLo, hHi);
    const x = rng.int(1, width - w - 1);
    const y = rng.int(1, height - h - 1);
    if (!overlaps(x, y, w, h)) carveRoom(x, y, w, h);
  }

  // 兜底：一个房间都放不下时，在正中央硬塞一个，保证地图不为空
  if (rooms.length === 0) {
    const w = clamp(wLo, 2, width - 2);
    const h = clamp(hLo, 2, height - 2);
    carveRoom((width - w) >> 1, (height - h) >> 1, w, h);
  }

  // --- 走廊：完全图 + Prim 最小生成树保证全连通，再按 extraLoops 加环路 ---
  const n = rooms.length;
  const weight = [];
  for (let i = 0; i < n; i++) weight.push(new Array(n).fill(0));
  // 固定 i<j 的循环顺序调用 RNG，与对象/数组遍历方式无关
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d =
        Math.abs(rooms[i].cx - rooms[j].cx) + Math.abs(rooms[i].cy - rooms[j].cy);
      const w = d + rng.next() * 8;
      weight[i][j] = w;
      weight[j][i] = w;
    }
  }

  const inTree = new Array(n).fill(false);
  inTree[0] = true;
  const mstEdges = [];
  for (let added = 1; added < n; added++) {
    let best = null;
    for (let i = 0; i < n; i++) {
      if (!inTree[i]) continue;
      for (let j = 0; j < n; j++) {
        if (inTree[j]) continue;
        if (!best || weight[i][j] < best.w) best = { i, j, w: weight[i][j] };
      }
    }
    mstEdges.push([best.i, best.j]);
    inTree[best.j] = true;
  }

  // 剩余边按 RNG 给的键排序，取前 extraLoops 条作为环路
  const inMst = new Set(mstEdges.map(([a, b]) => a * n + b));
  const spares = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (!inMst.has(i * n + j)) spares.push({ i, j, key: rng.next() });
  spares.sort((a, b) => a.key - b.key || a.i - b.i || a.j - b.j);
  const loopEdges = spares.slice(0, params.extraLoops).map(({ i, j }) => [i, j]);

  // 只把墙挖成地板，绝不把地板填回墙，所以不会挖穿房间或画出重叠的墙
  const carve = (x, y) => {
    if (x >= 1 && x < width - 1 && y >= 1 && y < height - 1) {
      const idx = y * width + x;
      if (grid[idx] === TILE.WALL) grid[idx] = TILE.CORRIDOR;
    }
  };
  const cw = params.corridorWidth;
  const carveCorridor = (a, b) => {
    const { cx: x1, cy: y1 } = rooms[a];
    const { cx: x2, cy: y2 } = rooms[b];
    const hSeg = (xa, xb, y) => {
      const y0 = clamp(y, 1, height - 1 - cw);
      for (let x = Math.min(xa, xb); x <= Math.max(xa, xb); x++)
        for (let dy = 0; dy < cw; dy++) carve(x, y0 + dy);
    };
    const vSeg = (ya, yb, x) => {
      const x0 = clamp(x, 1, width - 1 - cw);
      for (let y = Math.min(ya, yb); y <= Math.max(ya, yb); y++)
        for (let dx = 0; dx < cw; dx++) carve(x0 + dx, y);
    };
    if (rng.chance(0.5)) {
      hSeg(x1, x2, y1);
      vSeg(y1, y2, x2);
    } else {
      vSeg(y1, y2, x1);
      hSeg(x1, x2, y2);
    }
  };
  for (const [a, b] of mstEdges) carveCorridor(a, b);
  for (const [a, b] of loopEdges) carveCorridor(a, b);

  // --- 宝箱房：从出生房 BFS，取步行距离最远的若干间 ---
  const dist = bfsDistances(grid, width, height, rooms[0].cx, rooms[0].cy);
  const treasureCount = Math.min(params.treasureRooms, n - 1);
  const byDistance = [];
  for (let i = 1; i < n; i++) byDistance.push(i);
  byDistance.sort(
    (a, b) =>
      dist[rooms[b].cy * width + rooms[b].cx] -
        dist[rooms[a].cy * width + rooms[a].cx] || a - b
  );
  const treasures = byDistance.slice(0, treasureCount).sort((a, b) => a - b);

  return {
    width,
    height,
    grid,
    rooms,
    spawn: 0,
    treasures,
    placedRooms: n,
    targetRooms: params.roomCount,
  };
}

export function bfsDistances(grid, width, height, sx, sy) {
  const dist = new Int32Array(width * height).fill(-1);
  const queue = [sy * width + sx];
  dist[queue[0]] = 0;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const x = cur % width;
    const y = (cur / width) | 0;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      if (dist[ni] === -1 && grid[ni] !== TILE.WALL) {
        dist[ni] = dist[cur] + 1;
        queue.push(ni);
      }
    }
  }
  return dist;
}
