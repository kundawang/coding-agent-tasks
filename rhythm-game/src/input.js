// 键盘输入。keydown 时间戳与 rAF 时间戳同为 performance.now 时钟域，
// 游戏里统一换算到 AudioContext 时间——没有任何 setTimeout 参与时序。
import { KEYS } from './config.js';

export class Input {
  constructor(target = window) {
    this.target = target;
    this.held = [false, false, false, false];
    this.onPress = null; // (lane, eventTimeMs)
    this.onEsc = null; // (eventTimeMs)

    this._down = (e) => {
      if (e.repeat) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        this.onEsc?.(e.timeStamp);
        return;
      }
      const lane = KEYS.indexOf(e.code);
      if (lane < 0) return;
      e.preventDefault();
      this.held[lane] = true;
      this.onPress?.(lane, e.timeStamp);
    };
    this._up = (e) => {
      const lane = KEYS.indexOf(e.code);
      if (lane < 0) return;
      this.held[lane] = false;
    };
    this._blur = () => {
      this.held = [false, false, false, false];
    };
  }

  attach() {
    this.target.addEventListener('keydown', this._down);
    this.target.addEventListener('keyup', this._up);
    this.target.addEventListener('blur', this._blur);
  }

  detach() {
    this.target.removeEventListener('keydown', this._down);
    this.target.removeEventListener('keyup', this._up);
    this.target.removeEventListener('blur', this._blur);
  }
}

// 把屏幕点击/触摸映射到轨道，方便没有键盘时（或演示时）操作
export function laneFromPointer(clientX, renderer) {
  const { fieldX, fieldW, laneW } = renderer.layout;
  if (clientX < fieldX || clientX > fieldX + fieldW) return -1;
  return Math.min(3, Math.max(0, Math.floor((clientX - fieldX) / laneW)));
}
