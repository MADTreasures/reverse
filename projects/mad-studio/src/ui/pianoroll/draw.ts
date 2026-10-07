import { TICKS_PER_STEP, isBlackKey, noteName, ticksPerBar, PPQ } from '../../model/timing';
import type { Note } from '../../model/types';

export const KEYS_W = 62;
export const RULER_H = 22;
export const VEL_H = 74;

export interface RollView {
  width: number;
  height: number;
  pxPerTick: number;
  rowHeight: number;
  scrollTick: number;
  scrollY: number;
}

export function gridBottom(v: RollView): number {
  return v.height - VEL_H;
}

export function xOfTick(v: RollView, tick: number): number {
  return KEYS_W + (tick - v.scrollTick) * v.pxPerTick;
}

export function tickAtX(v: RollView, x: number): number {
  return v.scrollTick + (x - KEYS_W) / v.pxPerTick;
}

export function yOfKey(v: RollView, key: number): number {
  return RULER_H + (127 - key) * v.rowHeight - v.scrollY;
}

export function keyAtY(v: RollView, y: number): number {
  return Math.max(0, Math.min(127, 127 - Math.floor((y - RULER_H + v.scrollY) / v.rowHeight)));
}

export function maxScrollY(v: RollView): number {
  return Math.max(0, 128 * v.rowHeight - (gridBottom(v) - RULER_H));
}

export interface RollScene {
  notes: Note[];
  ghosts: { notes: Note[]; color: string }[];
  selected: Set<string>;
  color: string;
  beatsPerBar: number;
  patternLength: number;
  playhead: number | null;
  rubber: { t0: number; t1: number; k0: number; k1: number } | null;
  pressedKey: number | null;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function drawRoll(ctx: CanvasRenderingContext2D, v: RollView, s: RollScene): void {
  const { width, height, pxPerTick, rowHeight } = v;
  const bottom = gridBottom(v);
  ctx.clearRect(0, 0, width, height);

  // --- grid background (rows)
  ctx.save();
  ctx.beginPath();
  ctx.rect(KEYS_W, RULER_H, width - KEYS_W, bottom - RULER_H);
  ctx.clip();
  const topKey = keyAtY(v, RULER_H);
  const bottomKey = keyAtY(v, bottom - 1);
  for (let key = bottomKey; key <= topKey; key++) {
    const y = yOfKey(v, key);
    ctx.fillStyle = isBlackKey(key) ? '#1c2227' : '#232a30';
    ctx.fillRect(KEYS_W, y, width - KEYS_W, rowHeight);
    if (key % 12 === 0) {
      ctx.fillStyle = '#ffffff10';
      ctx.fillRect(KEYS_W, y + rowHeight - 1, width - KEYS_W, 1);
    }
  }

  // --- vertical grid lines
  const startTick = Math.max(0, Math.floor(v.scrollTick / TICKS_PER_STEP) * TICKS_PER_STEP);
  const endTick = tickAtX(v, width);
  const bar = ticksPerBar(s.beatsPerBar);
  const stepVisible = TICKS_PER_STEP * pxPerTick >= 6;
  for (let t = startTick; t <= endTick; t += TICKS_PER_STEP) {
    const x = Math.round(xOfTick(v, t)) + 0.5;
    if (t % bar === 0) ctx.strokeStyle = '#ffffff33';
    else if (t % PPQ === 0) ctx.strokeStyle = '#ffffff17';
    else if (stepVisible) ctx.strokeStyle = '#ffffff08';
    else continue;
    ctx.beginPath();
    ctx.moveTo(x, RULER_H);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }

  // --- outside the pattern
  const endX = xOfTick(v, s.patternLength);
  if (endX < width) {
    ctx.fillStyle = '#0006';
    ctx.fillRect(Math.max(KEYS_W, endX), RULER_H, width - endX, bottom - RULER_H);
  }

  // --- ghost notes of other channels
  for (const g of s.ghosts) {
    ctx.strokeStyle = `${g.color}66`;
    for (const n of g.notes) {
      const x = xOfTick(v, n.start);
      const w = Math.max(2, n.length * pxPerTick);
      if (x > width || x + w < KEYS_W) continue;
      ctx.strokeRect(x + 0.5, yOfKey(v, n.key) + 1.5, w - 1, rowHeight - 3);
    }
  }

  // --- notes
  for (const n of s.notes) {
    const x = xOfTick(v, n.start);
    const w = Math.max(3, n.length * pxPerTick - 1);
    const y = yOfKey(v, n.key);
    if (x > width || x + w < KEYS_W || y > bottom || y + rowHeight < RULER_H) continue;
    const selected = s.selected.has(n.id);
    roundRect(ctx, x + 0.5, y + 0.5, w, rowHeight - 1, 2.5);
    ctx.globalAlpha = 0.55 + n.velocity * 0.45;
    ctx.fillStyle = selected ? '#ffe2c2' : s.color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = selected ? '#ffffff' : '#0b0e10';
    ctx.lineWidth = selected ? 1.5 : 1;
    ctx.stroke();
    ctx.lineWidth = 1;
    if (w > 26 && rowHeight >= 10) {
      ctx.fillStyle = '#10151add';
      ctx.font = `${Math.min(10, rowHeight - 3)}px -apple-system, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(noteName(n.key), x + 4, y + rowHeight / 2 + 0.5);
    }
  }

  // --- rubber band
  if (s.rubber) {
    const x0 = xOfTick(v, Math.min(s.rubber.t0, s.rubber.t1));
    const x1 = xOfTick(v, Math.max(s.rubber.t0, s.rubber.t1));
    const y0 = yOfKey(v, Math.max(s.rubber.k0, s.rubber.k1));
    const y1 = yOfKey(v, Math.min(s.rubber.k0, s.rubber.k1)) + rowHeight;
    ctx.fillStyle = '#5cb4ff22';
    ctx.strokeStyle = '#5cb4ff';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
  }
  ctx.restore();

  // --- ruler
  ctx.fillStyle = '#1a2025';
  ctx.fillRect(KEYS_W, 0, width - KEYS_W, RULER_H);
  ctx.fillStyle = '#0b0e10';
  ctx.fillRect(KEYS_W, RULER_H - 1, width - KEYS_W, 1);
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  const barPx = bar * pxPerTick;
  const barEvery = barPx < 28 ? Math.ceil(28 / barPx) : 1;
  for (let t = Math.floor(v.scrollTick / bar) * bar; t <= endTick; t += bar) {
    const x = Math.round(xOfTick(v, t)) + 0.5;
    if (x < KEYS_W) continue;
    const barIndex = t / bar;
    if (barIndex % barEvery === 0) {
      ctx.fillStyle = '#c3ccd4';
      ctx.fillText(String(barIndex + 1), x + 4, RULER_H / 2);
      ctx.fillStyle = '#ffffff40';
      ctx.fillRect(x, RULER_H - 9, 1, 8);
    }
    if (barPx > 60) {
      for (let b = 1; b < s.beatsPerBar; b++) {
        ctx.fillStyle = '#ffffff22';
        ctx.fillRect(Math.round(xOfTick(v, t + b * PPQ)), RULER_H - 5, 1, 4);
      }
    }
  }

  // --- keyboard
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, RULER_H, KEYS_W, bottom - RULER_H);
  ctx.clip();
  for (let key = bottomKey; key <= topKey; key++) {
    const y = yOfKey(v, key);
    const black = isBlackKey(key);
    ctx.fillStyle = key === s.pressedKey ? '#ff9b3d' : black ? '#262c32' : '#d9dfe4';
    ctx.fillRect(0, y, black ? KEYS_W * 0.62 : KEYS_W - 1, rowHeight - (black ? 0 : 1));
    if (!black && key !== s.pressedKey) {
      ctx.fillStyle = '#b9c1c8';
      ctx.fillRect(0, y + rowHeight - 1, KEYS_W - 1, 1);
    }
    if (key % 12 === 0 && rowHeight >= 8) {
      ctx.fillStyle = '#39424b';
      ctx.font = `${Math.min(10, rowHeight - 2)}px -apple-system, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(noteName(key), KEYS_W - 26, y + rowHeight / 2);
    }
  }
  ctx.restore();
  ctx.fillStyle = '#0b0e10';
  ctx.fillRect(KEYS_W - 1, RULER_H, 1, bottom - RULER_H);
  ctx.fillStyle = '#1a2025';
  ctx.fillRect(0, 0, KEYS_W, RULER_H);

  // --- velocity lane
  ctx.fillStyle = '#161b1f';
  ctx.fillRect(0, bottom, width, VEL_H);
  ctx.fillStyle = '#0b0e10';
  ctx.fillRect(0, bottom, width, 1);
  ctx.fillStyle = '#5f6b76';
  ctx.font = '9px -apple-system, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('VELOCITY', 8, bottom + 6);
  ctx.save();
  ctx.beginPath();
  ctx.rect(KEYS_W, bottom + 1, width - KEYS_W, VEL_H - 1);
  ctx.clip();
  const laneTop = bottom + 8;
  const laneH = VEL_H - 14;
  for (const n of s.notes) {
    const x = Math.round(xOfTick(v, n.start)) + 0.5;
    if (x < KEYS_W - 4 || x > width) continue;
    const h = n.velocity * laneH;
    const selected = s.selected.has(n.id);
    ctx.strokeStyle = selected ? '#ffe2c2' : s.color;
    ctx.beginPath();
    ctx.moveTo(x, laneTop + laneH);
    ctx.lineTo(x, laneTop + laneH - h);
    ctx.stroke();
    ctx.fillStyle = selected ? '#ffffff' : s.color;
    ctx.fillRect(x - 2, laneTop + laneH - h - 2, 5, 4);
  }
  ctx.restore();

  // --- playhead
  if (s.playhead !== null) {
    const x = Math.round(xOfTick(v, s.playhead)) + 0.5;
    if (x >= KEYS_W && x <= width) {
      ctx.strokeStyle = '#ff9b3d';
      ctx.beginPath();
      ctx.moveTo(x, RULER_H);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.fillStyle = '#ff9b3d';
      ctx.beginPath();
      ctx.moveTo(x - 5, 2);
      ctx.lineTo(x + 5, 2);
      ctx.lineTo(x, 10);
      ctx.fill();
    }
  }
}
