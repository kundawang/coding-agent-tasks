// 校准纯计算：屏幕给出 N 个拍点（音频时钟），玩家跟着敲 N 下，
// 偏差 = 敲击时刻 - 拍点时刻（performance.now 时钟域，单位 ms）。
// 取中位数作为本机偏移：正数表示整体按晚（输入/输出延迟），
// 判定时 delta = (按键时刻 - 音符时刻) - offset，相当于把判定窗口往前挪。

export function median(values) {
  const xs = [...values].sort((a, b) => a - b);
  if (xs.length === 0) return 0;
  const mid = Math.floor(xs.length / 2);
  if (xs.length % 2) return xs[mid];
  return (xs[mid - 1] + xs[mid]) / 2;
}

export function deviationsFor(tapsMs, beatTimesMs) {
  return tapsMs.map((t, i) => Math.round(t - beatTimesMs[i]));
}

// 返回 { offsetMs, deviations, meanAbsMs }
// offsetMs 四舍五入到整数毫秒；偏差过大（>250ms）的点不参与中位数，
// 但仍在 deviations 里原样返回展示。
export function computeCalibration(tapsMs, beatTimesMs) {
  const deviations = deviationsFor(tapsMs, beatTimesMs);
  const sane = deviations.filter((d) => Math.abs(d) <= 250);
  const pool = sane.length >= 2 ? sane : deviations;
  const offsetMs = Math.round(median(pool));
  const meanAbsMs =
    Math.round((pool.reduce((s, d) => s + Math.abs(d), 0) / pool.length) * 10) / 10;
  return { offsetMs, deviations, meanAbsMs };
}
