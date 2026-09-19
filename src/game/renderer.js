// Canvas 渲染器：只负责把“快照”画出来，不碰判定、不碰音频时钟。
// 窗口缩放 / 全屏只改变几何（relayout），songTime 来自音频，分辨率怎么切都不漂。

import { LANE_KEYS } from './input.js';

export const FALL_TIME_MS = 1600; // 音符从屏幕上方到判定线的走时

const LANE_COLORS = [
  { base: '#38e1ff', glow: 'rgba(56,225,255,0.85)' },
  { base: '#5cff9d', glow: 'rgba(92,255,157,0.85)' },
  { base: '#ffd166', glow: 'rgba(255,209,102,0.85)' },
  { base: '#ff5c8a', glow: 'rgba(255,92,138,0.85)' },
];

const JUDGMENT_COLORS = {
  perfect: '#ffe66d',
  great: '#7CFC9B',
  good: '#5cc8ff',
  miss: '#ff5555',
};

const JUDGMENT_LABELS = {
  perfect: 'PERFECT',
  great: 'GREAT',
  good: 'GOOD',
  miss: 'MISS',
};

// 老版本浏览器没有 roundRect，补一个最小实现。
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    this.moveTo(x + radius, y);
    this.arcTo(x + w, y, x + w, y + h, radius);
    this.arcTo(x + w, y + h, x, y + h, radius);
    this.arcTo(x, y + h, x, y, radius);
    this.arcTo(x, y, x + w, y, radius);
    this.closePath();
  };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.layout = null;
    this.relayout();
    window.addEventListener('resize', () => this.relayout());
  }

  relayout() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.cssWidth = Math.max(320, rect.width);
    this.cssHeight = Math.max(240, rect.height);
    this.canvas.width = Math.round(this.cssWidth * this.dpr);
    this.canvas.height = Math.round(this.cssHeight * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const laneAreaW = Math.min(640, this.cssWidth * 0.92);
    const laneW = laneAreaW / 4;
    const originX = (this.cssWidth - laneAreaW) / 2;
    const judgeY = this.cssHeight - Math.max(96, this.cssHeight * 0.14);
    this.layout = { laneAreaW, laneW, originX, judgeY };
  }

  clear() {
    const { ctx } = this;
    ctx.fillStyle = '#0a0d1a';
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
  }

  _laneX(lane) {
    return this.layout.originX + lane * this.layout.laneW;
  }

  drawBackground(songMs = 0) {
    const { ctx, cssWidth, cssHeight } = this;
    const grad = ctx.createLinearGradient(0, 0, 0, cssHeight);
    grad.addColorStop(0, '#0a0d1a');
    grad.addColorStop(1, '#141029');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    // 极淡的网格背景，随音乐时间滚动（暂停时因为 songMs 冻结而停住）。
    const gap = 48;
    const shift = ((songMs * 0.06) % gap);
    ctx.strokeStyle = 'rgba(120,140,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = -gap + shift; y < cssHeight; y += gap) {
      ctx.moveTo(0, y);
      ctx.lineTo(cssWidth, y);
    }
    ctx.stroke();
  }

  drawLanes(activeLanes) {
    const { ctx } = this;
    const { originX, laneW, laneAreaW, judgeY } = this.layout;

    ctx.fillStyle = 'rgba(18,22,44,0.72)';
    ctx.fillRect(originX, 0, laneAreaW, judgeY + 26);

    for (let lane = 0; lane < 4; lane += 1) {
      const x = this._laneX(lane);
      const color = LANE_COLORS[lane];
      if (activeLanes?.has(lane)) {
        ctx.fillStyle = color.glow.replace(/0\.85\)$/, '0.16)');
        ctx.fillRect(x + 1, 0, laneW - 2, judgeY + 26);
      }
      // 分隔线
      ctx.strokeStyle = 'rgba(160,180,255,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, judgeY + 26);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(originX + laneAreaW, 0);
    ctx.lineTo(originX + laneAreaW, judgeY + 26);
    ctx.stroke();

    // 判定线
    ctx.save();
    ctx.shadowColor = 'rgba(120,180,255,0.9)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(200,225,255,0.95)';
    ctx.fillRect(originX - 4, judgeY - 3, laneAreaW + 8, 5);
    ctx.restore();

    // 键位提示
    for (let lane = 0; lane < 4; lane += 1) {
      const x = this._laneX(lane);
      const color = LANE_COLORS[lane];
      const pressed = activeLanes?.has(lane);
      ctx.save();
      ctx.translate(x + laneW / 2, judgeY + laneW * 0.42);
      const r = Math.min(laneW * 0.26, 30);
      if (pressed) {
        ctx.shadowColor = color.glow;
        ctx.shadowBlur = 18;
        ctx.fillStyle = color.base;
      } else {
        ctx.fillStyle = 'rgba(20,26,52,0.95)';
      }
      ctx.beginPath();
      ctx.roundRect(-r, -r, r * 2, r * 2, 8);
      ctx.fill();
      ctx.strokeStyle = color.base;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = pressed ? '#0a0d1a' : color.base;
      ctx.font = `700 ${Math.round(r * 1.05)}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(LANE_KEYS[lane], 0, 1);
      ctx.restore();
    }
  }

  drawNotes(notes, songMs, hitNotes) {
    const { ctx } = this;
    const { laneW, judgeY } = this.layout;
    const noteH = Math.max(10, Math.min(22, laneW * 0.13));
    for (const note of notes) {
      const delta = note.t - songMs;
      if (delta > FALL_TIME_MS || delta < -120) continue;
      const y = judgeY - (delta / FALL_TIME_MS) * judgeY;
      const x = this._laneX(note.lane);
      const color = LANE_COLORS[note.lane];
      ctx.save();
      ctx.shadowColor = color.glow;
      ctx.shadowBlur = 10;
      ctx.fillStyle = color.base;
      const pad = 6;
      ctx.beginPath();
      ctx.roundRect(x + pad, y - noteH / 2, laneW - pad * 2, noteH, 5);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x + pad + 3, y - noteH / 2 + 2, laneW - pad * 2 - 6, 2);
      ctx.restore();
    }
  }

  drawEffects(effects, nowMs) {
    const { ctx } = this;
    const { laneW, judgeY } = this.layout;
    for (const fx of effects) {
      const age = nowMs - fx.bornAt;
      if (age > 260) continue;
      const progress = age / 260;
      const x = this._laneX(fx.lane) + laneW / 2;
      if (fx.kind === 'hit') {
        ctx.save();
        ctx.globalAlpha = 1 - progress;
        ctx.strokeStyle = LANE_COLORS[fx.lane].base;
        ctx.lineWidth = 3;
        const r = 14 + progress * 34;
        ctx.beginPath();
        ctx.arc(x, judgeY, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = 0.5 * (1 - progress);
        ctx.strokeStyle = '#ff5555';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x - 14, judgeY - 14);
        ctx.lineTo(x + 14, judgeY + 14);
        ctx.moveTo(x + 14, judgeY - 14);
        ctx.lineTo(x - 14, judgeY + 14);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawJudgment(judgment, bornAt, nowMs) {
    if (!judgment) return;
    const age = nowMs - bornAt;
    if (age > 420) return;
    const { ctx, cssWidth } = this;
    const progress = Math.min(1, age / 420);
    const y = this.layout.judgeY - 88 - progress * 10;
    ctx.save();
    ctx.globalAlpha = 1 - progress * 0.7;
    ctx.font = '800 30px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = JUDGMENT_COLORS[judgment];
    ctx.shadowBlur = 14;
    ctx.fillStyle = JUDGMENT_COLORS[judgment];
    ctx.fillText(JUDGMENT_LABELS[judgment], cssWidth / 2, y);
    ctx.restore();
  }

  drawCombo(combo) {
    if (combo < 2) return;
    const { ctx, cssWidth } = this;
    const y = this.layout.judgeY - 148;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 46px "Segoe UI", system-ui, sans-serif';
    ctx.shadowColor = 'rgba(140,170,255,0.9)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#eaf0ff';
    ctx.fillText(String(combo), cssWidth / 2, y);
    ctx.shadowBlur = 0;
    ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(200,210,245,0.85)';
    ctx.fillText('COMBO', cssWidth / 2, y + 34);
    ctx.restore();
  }

  drawHud({ score, counts, songMs, durationMs, offsetMs, calibrated, muted }) {
    const { ctx, cssWidth } = this;
    ctx.save();
    ctx.textBaseline = 'top';

    ctx.font = '800 22px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#eaf0ff';
    ctx.textAlign = 'left';
    ctx.fillText(String(score).padStart(7, '0'), 18, 14);

    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(190,202,240,0.85)';
    ctx.fillText(
      `P ${counts.perfect}  G ${counts.great}  g ${counts.good}  M ${counts.miss}`,
      18,
      44,
    );

    // 进度条
    const barW = Math.min(260, cssWidth * 0.28);
    const progress = Math.max(0, Math.min(1, songMs / durationMs));
    const bx = cssWidth - barW - 18;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(bx, 20, barW, 6);
    ctx.fillStyle = '#6ea8ff';
    ctx.fillRect(bx, 20, barW * progress, 6);

    // 校准状态徽标：校准过和没校准要一眼能看出区别。
    const badge = calibrated
      ? `校准 ${offsetMs >= 0 ? '+' : ''}${offsetMs}ms`
      : '未校准！';
    ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = calibrated ? '#7CFC9B' : '#ffb347';
    ctx.fillText(badge, cssWidth - 18, 36);
    ctx.fillStyle = 'rgba(190,202,240,0.7)';
    ctx.fillText(muted ? '🔇 M 取消静音' : 'M 静音', cssWidth - 18, 54);

    ctx.restore();
  }

  drawCountIn(songMs, offsetMs, bpm) {
    if (songMs > offsetMs) return;
    const beatMs = 60000 / bpm;
    const beatsUntil = Math.ceil((offsetMs - songMs) / beatMs);
    if (beatsUntil < 1 || beatsUntil > 4) return;
    const nextBeatSongMs = offsetMs - (beatsUntil - 1) * beatMs;
    const progress = Math.max(0, Math.min(1, 1 - (nextBeatSongMs - songMs) / beatMs));
    const { ctx, cssWidth, cssHeight } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const scale = 1 + (1 - progress) * 0.5;
    ctx.translate(cssWidth / 2, cssHeight * 0.32);
    ctx.scale(scale, scale);
    ctx.globalAlpha = 1 - progress * 0.5;
    ctx.font = '900 64px "Segoe UI", system-ui, sans-serif';
    ctx.shadowColor = 'rgba(120,180,255,0.9)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#eaf0ff';
    ctx.fillText(beatsUntil === 1 ? 'GO' : String(beatsUntil), 0, 0);
    ctx.restore();
  }

  // 校准界面：四个拍点用收缩圆环表示，听到一声就点任意轨道键。
  drawCalibration(beatSongMs, tapMarks, songMs) {
    const { ctx, cssWidth, cssHeight } = this;
    this.drawBackground(songMs);
    const cx = cssWidth / 2;
    const cy = cssHeight * 0.46;
    for (let i = 0; i < beatSongMs.length; i += 1) {
      const t = beatSongMs[i];
      if (t < songMs - 300) continue;
      const beatMs = beatSongMs[1] - beatSongMs[0];
      const remain = (t - songMs) / beatMs; // 1 -> 0
      const r = 30 + Math.max(0, remain) * 90;
      const hit = tapMarks[i];
      ctx.save();
      ctx.strokeStyle = hit ? '#7CFC9B' : '#6ea8ff';
      ctx.lineWidth = 4;
      ctx.globalAlpha = remain < -0.1 ? 0 : remain < 0 ? 1 + remain / 3 : 1;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(6, r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = '#eaf0ff';
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0a0d1a';
    ctx.font = '900 20px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(tapMarks.filter(Boolean).length), cx, cy + 1);
    ctx.restore();
  }

  drawIdle(songMs) {
    this.drawBackground(songMs);
  }
}
