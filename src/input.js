// 键盘 -> 每个玩家 5 个 bit 的输入状态。
// 记录的是 tick 时刻的“按住状态”，不是按键事件，
// 所以掉帧/重放都不会丢输入，长按时序也能精确复现。

import { INPUT } from './config.js';

const P1_KEYS = {
  KeyW: INPUT.UP,
  KeyS: INPUT.DOWN,
  KeyA: INPUT.LEFT,
  KeyD: INPUT.RIGHT,
  Space: INPUT.ATTACK,
};

const P2_KEYS = {
  ArrowUp: INPUT.UP,
  ArrowDown: INPUT.DOWN,
  ArrowLeft: INPUT.LEFT,
  ArrowRight: INPUT.RIGHT,
  Enter: INPUT.ATTACK,
  NumpadEnter: INPUT.ATTACK,
};

export class Keyboard {
  constructor() {
    this.held = new Set();
    this.onTogglePause = null;

    window.addEventListener('keydown', (e) => {
      if (P1_KEYS[e.code] || P2_KEYS[e.code] ||
          e.code === 'KeyQ' || e.code === 'KeyP') {
        e.preventDefault();
      }
      if (e.repeat) return;
      if (e.code === 'KeyQ' || e.code === 'KeyP') {
        this.onTogglePause?.();
        return;
      }
      this.held.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      if (P1_KEYS[e.code] || P2_KEYS[e.code]) e.preventDefault();
      this.held.delete(e.code);
    });

    // 切窗口时清键，避免“卡键”
    window.addEventListener('blur', () => this.held.clear());
  }

  sample() {
    let p1 = 0;
    let p2 = 0;
    for (const code of this.held) {
      if (P1_KEYS[code]) p1 |= P1_KEYS[code];
      if (P2_KEYS[code]) p2 |= P2_KEYS[code];
    }
    return [p1, p2];
  }
}