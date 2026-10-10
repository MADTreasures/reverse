import { noteColor, notePropSpec, noteValue, type NotePropKey } from '../../model/notes';
import { inScale, type ScaleSpec } from '../../model/scales';
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
  /** Spacing of the finest grid lines (ticks), see gridLineTicks(). */
  lineTicks: number;
  /** Where pattern playback starts (marker in the ruler). */
  patternStart: number;
  /** Note property shown in the event lane. */
  lane: NotePropKey;
  /** Scale highlighting: rows outside the scale are darker, the root rows lighter. */
  scale: ScaleSpec | null;
}

/** Event lane geometry: values from `laneTop` (max) to `laneTop + laneH` (min). */
export function laneGeometry(v: RollView): { laneTop: number; laneH: number } {
  return { laneTop: gridBottom(v) + 8, laneH: VEL_H - 14 };
}

/** Value of the lane property at height `y`. */
export function laneValueAtY(v: RollView, key: NotePropKey, y: number): number {
  const spec = notePropSpec(key);
  const { laneTop, laneH } = laneGeometry(v);
  const frac = Math.min(1, Math.max(0, (laneTop + laneH - y) / laneH));
  return spec.min + frac * (spec.max - spec.min);
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
    if (s.scale) ctx.fillStyle = !inScale(key, s.scale) ? '#1f2a31' : (key - s.scale.root) % 12 === 0 ? '#33475a' : '#2b3a44';
    else ctx.fillStyle = isBlackKey(key) ? '#25333c' : '#2b3a44';
    ctx.fillRect(KEYS_W, y, width - KEYS_W, rowHeight);
    if (key % 12 === 0) {
      ctx.fillStyle = '#ffffff10';
      ctx.fillRect(KEYS_W, y + rowHeight - 1, width - KEYS_W, 1);
    }
  }

  // --- vertical grid lines (finer as you zoom in, like FL Studio's "Line" snap)
  const line = s.lineTicks;
  const startTick = Math.max(0, Math.floor(v.scrollTick / line) * line);
  const endTick = tickAtX(v, width);
  const bar = ticksPerBar(s.beatsPerBar);
  for (let t = startTick; t <= endTick; t += line) {
    const x = Math.round(xOfTick(v, t)) + 0.5;
    if (t % bar === 0) ctx.strokeStyle = '#ffffff33';
    else if (t % PPQ === 0) ctx.strokeStyle = '#ffffff17';
    else if (t % TICKS_PER_STEP === 0) ctx.strokeStyle = '#ffffff0b';
    else ctx.strokeStyle = '#ffffff06';
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

  // --- notes (colour group tint; muted notes hollow; slide notes with a ramp, portamento notes with a hook)
  for (const n of s.notes) {
    const x = xOfTick(v, n.start);
    const w = Math.max(3, n.length * pxPerTick - 1);
    const y = yOfKey(v, n.key);
    if (x > width || x + w < KEYS_W || y > bottom || y + rowHeight < RULER_H) continue;
    const selected = s.selected.has(n.id);
    const fill = selected ? '#ffe2c2' : noteColor(n.color, s.color);
    roundRect(ctx, x + 0.5, y + 0.5, w, rowHeight - 1, 2.5);
    if (n.muted) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.setLineDash([3, 2]);
      ctx.strokeStyle = selected ? '#ffffff' : fill;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.globalAlpha = 0.55 + n.velocity * 0.45;
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = selected ? '#ffffff' : '#0b0e10';
      ctx.lineWidth = selected ? 1.5 : 1;
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    let textX = x + 4;
    if ((n.slide || n.porta) && rowHeight >= 7) {
      ctx.fillStyle = '#10151acc';
      ctx.beginPath();
      if (n.slide) {
        // A ramp: the glide the slide note causes.
        ctx.moveTo(x + 2, y + rowHeight - 2);
        ctx.lineTo(x + Math.min(12, w - 1), y + 2);
        ctx.lineTo(x + Math.min(12, w - 1), y + rowHeight - 2);
      } else {
        ctx.moveTo(x + 2, y + rowHeight / 2 - 3);
        ctx.lineTo(x + Math.min(8, w - 1), y + rowHeight / 2);
        ctx.lineTo(x + 2, y + rowHeight / 2 + 3);
      }
      ctx.closePath();
      ctx.fill();
      textX += 10;
    }
    if (w > 26 + textX - x - 4 && rowHeight >= 10) {
      ctx.fillStyle = n.muted ? '#e6ebeecc' : '#10151add';
      ctx.font = `${Math.min(10, rowHeight - 3)}px -apple-system, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(noteName(n.key), textX, y + rowHeight / 2 + 0.5);
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
  ctx.fillStyle = '#3b464d';
  ctx.fillRect(KEYS_W, 0, width - KEYS_W, RULER_H);
  ctx.fillStyle = '#1d272d';
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
      ctx.fillStyle = '#e6ebee';
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

  // --- pattern start marker (set by clicking the ruler)
  const sx = xOfTick(v, s.patternStart);
  if (s.patternStart > 0 && sx >= KEYS_W && sx <= width) {
    ctx.fillStyle = '#7cc35b';
    ctx.beginPath();
    ctx.moveTo(sx, RULER_H - 1);
    ctx.lineTo(sx - 5, RULER_H - 9);
    ctx.lineTo(sx + 5, RULER_H - 9);
    ctx.fill();
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
  ctx.fillStyle = '#1d272d';
  ctx.fillRect(KEYS_W - 1, RULER_H, 1, bottom - RULER_H);
  ctx.fillStyle = '#3b464d';
  ctx.fillRect(0, 0, KEYS_W, RULER_H);

  // --- event lane (FL Studio: the event editor under the notes, with a choice of note property)
  const spec = notePropSpec(s.lane);
  ctx.fillStyle = '#26323a';
  ctx.fillRect(0, bottom, width, VEL_H);
  ctx.fillStyle = '#1d272d';
  ctx.fillRect(0, bottom, width, 1);
  ctx.fillStyle = '#aab6be';
  ctx.font = '9px -apple-system, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(spec.label.toUpperCase(), 8, bottom + 6);
  ctx.fillStyle = '#7d8a93';
  ctx.fillText('▾ lane', 8, bottom + 18);
  ctx.save();
  ctx.beginPath();
  ctx.rect(KEYS_W, bottom + 1, width - KEYS_W, VEL_H - 1);
  ctx.clip();
  const { laneTop, laneH } = laneGeometry(v);
  const yOf = (value: number) => laneTop + laneH - ((value - spec.min) / (spec.max - spec.min)) * laneH;
  const base = spec.bipolar ? yOf(spec.def) : laneTop + laneH;
  if (spec.bipolar) {
    ctx.fillStyle = '#ffffff1a';
    ctx.fillRect(KEYS_W, Math.round(base), width - KEYS_W, 1);
  }
  for (const n of s.notes) {
    const x = Math.round(xOfTick(v, n.start)) + 0.5;
    if (x < KEYS_W - 4 || x > width) continue;
    const top = yOf(noteValue(n, s.lane));
    const selected = s.selected.has(n.id);
    const color = selected ? '#ffe2c2' : noteColor(n.color, s.color);
    ctx.globalAlpha = n.muted ? 0.35 : 1;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x, top);
    ctx.stroke();
    ctx.fillStyle = selected ? '#ffffff' : color;
    ctx.fillRect(x - 2, top - 2, 5, 4);
    ctx.globalAlpha = 1;
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
