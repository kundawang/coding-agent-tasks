// Canvas 渲染。纯视觉：所有音符位置都按“当前音频时钟对应的歌曲时间”反推，
// 所以窗口缩放 / 切全屏 / 掉帧都不会影响判定，只是画得大一点或少几帧。
import { LANES, KEY_LABELS, APPROACH_MS, LANE_COLORS } from './config.js';

const JUDGE_TEXT = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.layout = null;
    this.laneFlash = [0, 0, 0, 0];
    this.popups = [];
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const fieldW = Math.min(this.w * 0.56, 560);
    const laneW = fieldW / LANES;
    const fieldX = (this.w - fieldW) / 2;
    const lineY = this.h * 0.82;
    this.layout = { fieldW, laneW, fieldX, lineY, noteH: Math.max(14, laneW * 0.32) };
  }

  noteY(noteTimeMs, songTimeMs) {
    const { lineY } = this.layout;
    const travel = lineY + this.layout.noteH;
    return lineY - ((noteTimeMs - songTimeMs) / APPROACH_MS) * travel;
  }

  flashLane(lane) {
    this.laneFlash[lane] = 1;
  }

  addPopup(lane, judgement) {
    this.popups.push({ lane, judgement, t: performance.now() });
  }

  laneX(lane) {
    return this.layout.fieldX + lane * this.layout.laneW;
  }

  draw(state) {
    const { ctx } = this;
    const { fieldX, fieldW, laneW, lineY, noteH } = this.layout;
    ctx.clearRect(0, 0, this.w, this.h);

    ctx.fillStyle = '#0c0f1a';
    ctx.fillRect(0, 0, this.w, this.h);

    for (let lane = 0; lane < LANES; lane += 1) {
      const x = fieldX + lane * laneW;
      ctx.fillStyle = lane % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)';
      ctx.fillRect(x, 0, laneW, lineY);
    }

    const { notes, states, songTimeMs } = state;
    const topLimit = songTimeMs - 200;
    const bottomLimit = songTimeMs + APPROACH_MS;
    ctx.save();
    ctx.beginPath();
    ctx.rect(fieldX, 0, fieldW, lineY);
    ctx.clip();
    for (let i = 0; i < notes.length; i += 1) {
      const note = notes[i];
      if (states[i] === 1) continue;
      if (note.timeMs < topLimit || note.timeMs > bottomLimit) continue;
      const y = this.noteY(note.timeMs, songTimeMs);
      if (y > lineY + noteH) continue;
      const x = fieldX + note.lane * laneW;
      const pad = laneW * 0.08;
      const grad = ctx.createLinearGradient(0, y - noteH, 0, y);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.25, LANE_COLORS[note.lane]);
      grad.addColorStop(1, LANE_COLORS[note.lane]);
      ctx.fillStyle = states[i] === 2 ? 'rgba(120,120,140,0.35)' : grad;
      this.roundRect(x + pad, y - noteH, laneW - pad * 2, noteH, 6);
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(fieldX - 6, lineY - 2, fieldW + 12, 4);

    for (let lane = 0; lane < LANES; lane += 1) {
      const x = fieldX + lane * laneW;
      const held = state.held?.[lane] ? 1 : 0;
      const flash = Math.max(held, this.laneFlash[lane]);
      this.laneFlash[lane] *= 0.82;
      ctx.fillStyle = `rgba(255,255,255,${0.05 + flash * 0.12})`;
      ctx.fillRect(x, lineY, laneW, this.h - lineY);
      ctx.strokeStyle = LANE_COLORS[lane];
      ctx.lineWidth = 2 + flash * 4;
      ctx.globalAlpha = 0.5 + flash * 0.5;
      ctx.beginPath();
      ctx.moveTo(x, lineY);
      ctx.lineTo(x, this.h);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = held ? 'rgba(255,255,255,0.95)' : 'rgba(160,170,190,0.85)';
      ctx.font = `bold ${Math.min(laneW * 0.5, 42)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(KEY_LABELS[lane], x + laneW / 2, lineY + (this.h - lineY) / 2);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(fieldX, lineY, fieldW, this.h - lineY);

    const now = performance.now();
    this.popups = this.popups.filter((p) => now - p.t < 380);
    for (const p of this.popups) {
      const age = (now - p.t) / 380;
      const x = fieldX + p.lane * laneW + laneW / 2;
      const y = lineY - 70 - age * 36;
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle =
        p.judgement === 'perfect'
          ? '#ffd54f'
          : p.judgement === 'great'
            ? '#81d4fa'
            : p.judgement === 'good'
              ? '#a5d6a7'
              : '#ef9a9a';
      ctx.font = `bold ${p.judgement === 'miss' ? 22 : 26}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(JUDGE_TEXT[p.judgement], x, y);
      ctx.globalAlpha = 1;
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px monospace';
    ctx.fillText(String(state.score ?? 0).padStart(7, '0'), 24, 46);
    ctx.font = '14px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`SCORE  偏移 ${state.offsetMs >= 0 ? '+' : ''}${state.offsetMs}ms`, 24, 68);

    if (state.combo >= 2) {
      ctx.textAlign = 'right';
      ctx.font = 'bold 46px monospace';
      ctx.fillStyle = '#ffd54f';
      ctx.fillText(`${state.combo}`, this.w - 28, 58);
      ctx.font = '14px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('COMBO', this.w - 28, 80);
    }

    if (state.phase === 'countdown' || songTimeMs < 0) {
      const remainBeat = Math.ceil(-songTimeMs / state.beatMs);
      if (remainBeat >= 1 && remainBeat <= 4) {
        ctx.textAlign = 'center';
        ctx.font = 'bold 84px monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(String(remainBeat), this.w / 2, this.h * 0.42);
      }
    }

    const progress = Math.max(0, Math.min(1, songTimeMs / state.endMs));
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(fieldX, 14, fieldW, 4);
    ctx.fillStyle = LANE_COLORS[0];
    ctx.fillRect(fieldX, 14, fieldW * progress, 4);
  }

  // 校准页专用：收缩圈 + 每拍敲击偏差
  drawCalibration(beatPerfTimes, nowPerf, taps, beatMs) {
    const { ctx } = this;
    const { fieldX, fieldW, lineY } = this.layout;
    ctx.fillStyle = '#0c0f1a';
    ctx.fillRect(0, 0, this.w, this.h);
    const cx = this.w / 2;
    const cy = this.h * 0.4;

    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 56, 0, Math.PI * 2);
    ctx.stroke();

    let next = beatPerfTimes.findIndex((t) => t >= nowPerf - 90);
    if (next >= 0) {
      const beatT = beatPerfTimes[next];
      const remain = (beatT - nowPerf) / beatMs;
      if (remain >= -0.3 && remain <= 1) {
        const r = 56 + Math.max(0, remain) * 120;
        ctx.strokeStyle = '#ffd54f';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (Math.abs(beatT - nowPerf) < 90) {
        ctx.fillStyle = 'rgba(255,213,79,0.25)';
        ctx.beginPath();
        ctx.arc(cx, cy, 56, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.textAlign = 'center';
    taps.forEach((dev, i) => {
      const x = fieldX + (fieldW * (i + 0.5)) / 4;
      const ok = Math.abs(dev) <= 30;
      ctx.font = 'bold 30px monospace';
      ctx.fillStyle = ok ? '#81c784' : Math.abs(dev) <= 100 ? '#ffd54f' : '#e57373';
      ctx.fillText(`${dev >= 0 ? '+' : ''}${dev}`, x, lineY - 40);
      ctx.font = '14px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(`第 ${i + 1} 拍`, x, lineY - 16);
    });

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '16px monospace';
    ctx.fillText(
      taps.length >= 4 ? '计算完成…' : '听拍点，收缩圈进目标圈时按任意游戏键（D F J K），共四下',
      cx,
      this.h - 90,
    );
  }

  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
