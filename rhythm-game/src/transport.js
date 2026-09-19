// 时间轴：唯一真相源是 AudioContext.currentTime。
// - start(t0, perfAnchor)：歌曲 0 毫秒映射到音频时钟 t0
// - pause/resume：只累加“挂起时长”，暂停区间不计入歌曲时间
// - songTimeAtPerf(p)：把 performance.now 域的输入/rAF 时间戳换算到歌曲时间，
//   渲染掉帧只会少画几帧，绝不改变判定
export class Transport {
  constructor() {
    this.t0 = 0;
    this.anchorCtx = 0;
    this.anchorPerf = 0;
    this.pausedSec = 0;
    this.pauseCtx = null;
  }

  start(startCtxTime, perfNow) {
    this.t0 = startCtxTime;
    this.anchorCtx = startCtxTime;
    this.anchorPerf = perfNow;
    this.pausedSec = 0;
    this.pauseCtx = null;
  }

  pause(ctxTime) {
    if (this.pauseCtx !== null) return;
    this.pauseCtx = ctxTime;
  }

  resume(ctxTime, perfNow) {
    if (this.pauseCtx === null) return;
    this.pausedSec += ctxTime - this.pauseCtx;
    this.pauseCtx = null;
    this.anchorCtx = ctxTime;
    this.anchorPerf = perfNow;
  }

  get paused() {
    return this.pauseCtx !== null;
  }

  // performance.now 域 -> AudioContext 域（两者速率一致，只差零点）
  ctxTimeAtPerf(perfMs) {
    if (this.pauseCtx !== null) return this.pauseCtx;
    return this.anchorCtx + (perfMs - this.anchorPerf) / 1000;
  }

  songTimeAtCtx(ctxTime) {
    const ref = this.pauseCtx !== null ? this.pauseCtx : ctxTime;
    return (ref - this.t0 - this.pausedSec) * 1000;
  }

  songTimeAtPerf(perfMs) {
    return this.songTimeAtCtx(this.ctxTimeAtPerf(perfMs));
  }

  // 歌曲时间 -> AudioContext 时间，调度器用它排未来的音
  ctxTimeForSongMs(songMs) {
    return this.t0 + this.pausedSec + songMs / 1000;
  }
}
