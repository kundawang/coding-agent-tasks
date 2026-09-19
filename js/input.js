// 键盘采样：只记录当前按下状态。玩家一 WASD，玩家二方向键。
// 方向键和空格阻止浏览器默认滚动。

import { INPUT } from './sim.js';

const P1_KEYS = {
  KeyW: INPUT.UP,
  KeyS: INPUT.DOWN,
  KeyA: INPUT.LEFT,
  KeyD: INPUT.RIGHT,
};
const P2_KEYS = {
  ArrowUp: INPUT.UP,
  ArrowDown: INPUT.DOWN,
  ArrowLeft: INPUT.LEFT,
  ArrowRight: INPUT.RIGHT,
};

export class Keyboard {
  constructor(target = window) {
    this.mask = [0, 0];
    this._down = (e) => this._onChange(e, true);
    this._up = (e) => this._onChange(e, false);
    this._blur = () => {
      this.mask[0] = 0;
      this.mask[1] = 0;
    };
    target.addEventListener('keydown', this._down);
    target.addEventListener('keyup', this._up);
    target.addEventListener('blur', this._blur);
  }

  _onChange(e, isDown) {
    const bit1 = P1_KEYS[e.code];
    const bit2 = P2_KEYS[e.code];
    if (bit1 !== undefined) {
      e.preventDefault();
      this.mask[0] = isDown ? this.mask[0] | bit1 : this.mask[0] & ~bit1;
    } else if (bit2 !== undefined) {
      e.preventDefault();
      this.mask[1] = isDown ? this.mask[1] | bit2 : this.mask[1] & ~bit2;
    }
  }

  snapshot() {
    return [this.mask[0], this.mask[1]];
  }

  clear() {
    this.mask[0] = 0;
    this.mask[1] = 0;
  }
}
