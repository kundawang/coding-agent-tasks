// 谱面加载与归一化。刻意写得宽容：真的 chart.json 只要大致长这样就能吃：
// { "bpm": 128, "offsetMs": 1875,
//   "notes": [ { "timeMs": 2343.75, "lane": 0 }, ... ] }

function pick(obj, keys, fallback) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return fallback;
}

export function normalizeChart(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('谱面不是 JSON 对象');
  const bpm = Number(pick(raw, ['bpm', 'BPM'], NaN));
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('谱面缺少合法 bpm');

  const offsetMs = Number(pick(raw, ['offsetMs', 'offset_ms', 'offset'], 0));
  if (!Number.isFinite(offsetMs)) throw new Error('谱面 offsetMs 不合法');

  const rawNotes = pick(raw, ['notes', 'note', 'chart'], []);
  if (!Array.isArray(rawNotes)) throw new Error('谱面 notes 不是数组');

  const notes = [];
  for (const item of rawNotes) {
    let timeMs;
    let lane;
    if (Array.isArray(item)) {
      [timeMs, lane] = item;
    } else if (item && typeof item === 'object') {
      timeMs = pick(item, ['timeMs', 'time_ms', 'time', 't', 'ms']);
      lane = pick(item, ['lane', 'column', 'key', 'track']);
    }
    timeMs = Number(timeMs);
    lane = Number(lane);
    if (!Number.isFinite(timeMs) || !Number.isFinite(lane)) continue;
    lane = Math.floor(lane);
    if (lane < 0 || lane > 3) continue;
    notes.push({ timeMs, lane });
  }

  notes.sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);

  // 去掉完全重复的音符
  const dedup = [];
  for (const n of notes) {
    const last = dedup[dedup.length - 1];
    if (!last || last.timeMs !== n.timeMs || last.lane !== n.lane) dedup.push(n);
  }

  if (dedup.length === 0) throw new Error('谱面里没有合法音符');

  const meta = raw.meta && typeof raw.meta === 'object' ? raw.meta : {};
  return {
    title: String(pick(meta, ['title', 'name'], pick(raw, ['title', 'name'], '未命名曲目'))),
    artist: String(
      pick(meta, ['artist', 'author'], pick(raw, ['artist', 'author'], 'WebAudio 合成')),
    ),
    bpm,
    offsetMs,
    beatMs: 60000 / bpm,
    notes: dedup,
    durationMs: dedup[dedup.length - 1].timeMs,
  };
}

export async function loadChart(url = 'samples/chart.json') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`谱面加载失败：HTTP ${res.status}`);
  return normalizeChart(await res.json());
}
