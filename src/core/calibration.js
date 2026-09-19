// 纯校准计算：四拍引导 + 四下点击，推出本机音频偏移。
//
// 符号约定（与判定一致）：
//   errorMs = 击打歌曲时刻 - 音符时刻 - offsetMs
// 校准时 errorMs ≈ 0，故 offsetMs ≈ 击打时刻 - 拍点时刻。
// 该值包含“声卡输出 + 按键输入”的往返延迟（听到拍点需要输出延迟，
// 按下被浏览器收到又有输入延迟），在判定里整段补回。
//
// 输入是两套时间（毫秒）：
//   beatTimesMs: 4 个拍点的 AudioContext 时间
//   tapTimesMs : 4 次点击对应的 AudioContext 时间（由 keydown 时刻换算，
//                不是 rAF 时间，避免高刷屏 / 掉帧引入偏差）
// 点击数不足、或与任一拍点偏差超过 rejectWindowMs，都视为无效。

export const CALIBRATION_TAPS = 4;
export const REJECT_WINDOW_MS = 250;

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// 每次点击和最近拍点配对。返回 { ok, offsetMs, deltas, error }。
export function computeOffset(beatTimesMs, tapTimesMs, rejectWindowMs = REJECT_WINDOW_MS) {
  if (!Array.isArray(beatTimesMs) || !Array.isArray(tapTimesMs)) {
    return { ok: false, error: 'bad-input' };
  }
  if (tapTimesMs.length !== CALIBRATION_TAPS || beatTimesMs.length !== CALIBRATION_TAPS) {
    return { ok: false, error: 'need-four-taps' };
  }
  const deltas = tapTimesMs.map((tap) => {
    let nearest = beatTimesMs[0];
    let best = Math.abs(tap - nearest);
    for (const beat of beatTimesMs) {
      const dist = Math.abs(tap - beat);
      if (dist < best) {
        best = dist;
        nearest = beat;
      }
    }
    return { deltaMs: tap - nearest, distanceMs: best };
  });
  if (deltas.some((d) => d.distanceMs > rejectWindowMs)) {
    return { ok: false, error: 'off-beat', deltas };
  }
  const raw = deltas.map((d) => d.deltaMs);
  return { ok: true, offsetMs: Math.round(median(raw)), deltas };
}

// 给出第 i 个引导拍（0 起）的歌曲时间。
// 拍点对齐谱面网格：第一拍在 downbeatMs，往后每隔 beatMs 一个，
// 但引导拍全部落在下拍之前（负数歌曲时间），因此第 4 拍正好是下拍。
export function calibrationBeatTimes(downbeatMs, beatMs, taps = CALIBRATION_TAPS) {
  const times = [];
  for (let i = 0; i < taps; i += 1) {
    times.push(downbeatMs - (taps - 1 - i) * beatMs);
  }
  return times;
}
