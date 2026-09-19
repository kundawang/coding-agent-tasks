// 键盘输入：键位 D F J K -> 轨道 0 1 2 3。
// keydown 处理函数里直接读 AudioContext 时钟（由调用方注入 getAudioTimeMs），
// 不经过 rAF，避免高刷新率 / 掉帧让击打时间漂移。

export const KEY_TO_LANE = Object.freeze({
  KeyD: 0,
  KeyF: 1,
  KeyJ: 2,
  KeyK: 3,
});

export const LANE_KEYS = Object.freeze(['D', 'F', 'J', 'K']);

export class Input {
  constructor({ onLaneDown, onLaneUp, onSystemKey, getAudioTimeMs }) {
    this.onLaneDown = onLaneDown;
    this.onLaneUp = onLaneUp;
    this.onSystemKey = onSystemKey;
    this.getAudioTimeMs = getAudioTimeMs;
    this.enabled = false;
    this._down = new Set();
    this._handler = (event) => this._onKey(event);
    this._upHandler = (event) => this._onKeyUp(event);
  }

  attach() {
    window.addEventListener('keydown', this._handler);
    window.addEventListener('keyup', this._upHandler);
  }

  detach() {
    window.removeEventListener('keydown', this._handler);
    window.removeEventListener('keyup', this._upHandler);
  }

  setEnabled(on) {
    this.enabled = on;
    this._down.clear();
  }

  isDown(lane) {
    return this._down.has(lane);
  }

  _onKey(event) {
    // Esc 始终交给系统（暂停/取消），避免被浏览器全屏切换吞掉时还产生轨道事件。
    if (event.code === 'Escape') {
      event.preventDefault();
      this.onSystemKey?.('escape');
      return;
    }
    if (event.code === 'KeyM') {
      this.onSystemKey?.('mute');
      return;
    }
    const lane = KEY_TO_LANE[event.code];
    if (lane === undefined) return;
    if (!this.enabled) return;
    event.preventDefault();
    if (event.repeat) return;
    this._down.add(lane);
    const audioTimeMs = this.getAudioTimeMs ? this.getAudioTimeMs() : null;
    this.onLaneDown?.(lane, audioTimeMs);
  }

  _onKeyUp(event) {
    const lane = KEY_TO_LANE[event.code];
    if (lane === undefined) return;
    this._down.delete(lane);
    if (!this.enabled) return;
    event.preventDefault();
    this.onLaneUp?.(lane);
  }
}
