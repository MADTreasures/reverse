/**
 * Text boxes and speech balloons: layout, outline geometry, hit tests and transforms. Pure (the
 * caller passes a text measuring function), unit tested.
 *
 * Text boxes and balloons are placed by an anchor (the top-left corner of their frame, in document
 * pixels) and an angle (radians) about that anchor.
 */
import type { Affine, Pt } from './rulers';

export interface TextStyle {
  /** CSS font family. */
  font: string;
  /** Size in document pixels. */
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  align: 'left' | 'center' | 'right';
  vertical: boolean;
  color: string;
  /** Distance between lines as a multiple of the size. */
  lineSpacing: number;
  /** Extra space between characters (px). */
  letterSpacing: number;
  /** Border around the letters (px, 0 = none). */
  edge: number;
  edgeColor: string;
}

export interface TextBox extends TextStyle {
  id: string;
  x: number;
  y: number;
  angle: number;
  /** Frame size. Without wrapping it follows the text. */
  w: number;
  h: number;
  /** "Wrap text at frame": lines break at the frame; text outside it is hidden. */
  wrap: boolean;
  text: string;
}

export type BalloonShape = 'ellipse' | 'rounded' | 'rect' | 'cloud';

export interface BalloonTail {
  id: string;
  /** Where the tail points to. */
  tip: Pt;
  /** Width at the balloon (px). */
  width: number;
  /** −1 … 1: how far the tail curves to the side. */
  bend: number;
  /** 'thought': a row of small bubbles instead of a pointed tail. */
  kind: 'pointed' | 'thought';
}

export interface Balloon {
  id: string;
  shape: BalloonShape;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  lineWidth: number;
  lineColor: string;
  /** null: not filled (transparent inside). */
  fillColor: string | null;
  tails: BalloonTail[];
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: 'sans-serif',
  size: 24,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  align: 'left',
  vertical: false,
  color: '#000000',
  lineSpacing: 1.2,
  letterSpacing: 0,
  edge: 0,
  edgeColor: '#ffffff',
};

export const newObjectId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 10)}`;

export const fontString = (s: Pick<TextStyle, 'font' | 'size' | 'bold' | 'italic'>) =>
  `${s.italic ? 'italic ' : ''}${s.bold ? 'bold ' : ''}${Math.max(0.5, s.size)}px ${s.font}`;

// ------------------------------------------------------------------ layout

/** Width of `text` in the given CSS font, with extra letter spacing (px). */
export type Measure = (text: string, font: string, letterSpacing: number) => number;

/** A piece of text placed in the frame: a whole line (horizontal) or one character (vertical). */
export interface PlacedRun {
  text: string;
  /** Left edge (horizontal) or column centre (vertical), relative to the frame. */
  x: number;
  /** Middle of the line or character cell. */
  y: number;
  w: number;
  /** Vertical text: Latin letters and digits lie on their side. */
  sideways?: boolean;
}

export interface TextLayout {
  runs: PlacedRun[];
  /** Size of the text (or of the frame when it wraps). */
  w: number;
  h: number;
}


/** Splits a paragraph into lines that fit `max` px (greedy; long words break between letters). */
function wrapParagraph(text: string, max: number, width: (s: string) => number): string[] {
  if (text === '' || max <= 0) return [text];
  // Tokens: words with the spaces after them, single CJK characters, runs of spaces.
  const tokens = text.match(/[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]|[^\s\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]+\s*|\s+/g) ?? [text];
  const lines: string[] = [];
  let line = '';
  const trimEnd = (s: string) => s.replace(/\s+$/, '');
  const fits = (s: string) => width(trimEnd(s)) <= max;
  const breakLine = () => {
    lines.push(trimEnd(line));
    line = '';
  };
  for (let token of tokens) {
    if (fits(line + token)) {
      line += token;
      continue;
    }
    if (line.trim() !== '') {
      breakLine();
      token = token.trimStart();
      if (fits(token)) {
        line = token;
        continue;
      }
    }
    // Longer than the frame on its own: break between letters.
    for (const ch of token) {
      if (line !== '' && !fits(line + ch)) {
        breakLine();
        if (ch.trim() === '') continue;
      }
      line += ch;
    }
  }
  lines.push(trimEnd(line));
  return lines;
}

/** Characters set sideways in vertical text (Latin letters, digits and their punctuation). */
const SIDEWAYS = /[\u0021-\u024f]/;

/** Lines (or columns) of a text box and where they go in its frame. */
export function layoutText(t: Pick<TextBox, keyof TextStyle | 'text' | 'wrap' | 'w' | 'h'>, measure: Measure): TextLayout {
  const font = fontString(t);
  const lh = t.size * t.lineSpacing;
  const width = (s: string) => measure(s, font, t.letterSpacing);
  const paragraphs = t.text.split('\n');
  if (!t.vertical) {
    const lines = t.wrap ? paragraphs.flatMap((p) => wrapParagraph(p, t.w, width)) : paragraphs;
    const widths = lines.map(width);
    const w = t.wrap ? t.w : Math.max(t.size * 0.5, ...widths);
    const h = t.wrap ? t.h : Math.max(lh, lines.length * lh);
    const runs = lines.map((text, i) => ({
      text,
      x: t.align === 'center' ? (w - widths[i]) / 2 : t.align === 'right' ? w - widths[i] : 0,
      y: i * lh + lh / 2,
      w: widths[i],
    }));
    return { runs, w, h };
  }
  // Vertical: columns from right to left, characters from top to bottom.
  const cell = t.size + t.letterSpacing;
  const perColumn = t.wrap ? Math.max(1, Math.floor(t.h / cell)) : Infinity;
  const columns: string[][] = [];
  for (const p of paragraphs) {
    const chars = [...p];
    if (chars.length === 0) columns.push([]);
    const step = Number.isFinite(perColumn) ? perColumn : Math.max(1, chars.length);
    for (let i = 0; i < chars.length; i += step) columns.push(chars.slice(i, i + step));
  }
  const longest = Math.max(1, ...columns.map((c) => c.length));
  const w = t.wrap ? t.w : Math.max(lh, columns.length * lh);
  const h = t.wrap ? t.h : longest * cell;
  const runs: PlacedRun[] = [];
  columns.forEach((col, ci) => {
    const x = w - ci * lh - lh / 2;
    const used = col.length * cell;
    const top = t.align === 'center' ? (h - used) / 2 : t.align === 'right' ? h - used : 0;
    col.forEach((ch, k) => runs.push({ text: ch, x, y: top + k * cell + cell / 2, w: width(ch), ...(SIDEWAYS.test(ch) ? { sideways: true } : {}) }));
  });
  return { runs, w, h };
}

// ------------------------------------------------------------------ frames

/** Local (frame) → document matrix of a text box or balloon. */
export function frameMatrix(o: { x: number; y: number; angle: number }): Affine {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  return [c, s, -s, c, o.x, o.y];
}

const apply = (m: Affine, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

/** Document point → frame coordinates. */
export function toFrame(o: { x: number; y: number; angle: number }, p: Pt): Pt {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/** Corners of a frame in document space. */
export function frameCorners(o: { x: number; y: number; w: number; h: number; angle: number }): Pt[] {
  const m = frameMatrix(o);
  return [
    { x: 0, y: 0 },
    { x: o.w, y: 0 },
    { x: o.w, y: o.h },
    { x: 0, y: o.h },
  ].map((p) => apply(m, p));
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Axis-aligned bounds of points, grown by `pad`. */
export function boundsOf(points: Pt[], pad = 0): Box | null {
  if (points.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: Math.floor(x0 - pad), y: Math.floor(y0 - pad), w: Math.ceil(x1 + pad) - Math.floor(x0 - pad), h: Math.ceil(y1 + pad) - Math.floor(y0 - pad) };
}

/** Bounds of a text box on the canvas (its border included). */
export const textBounds = (t: TextBox) => boundsOf(frameCorners(t), t.edge + 2)!;

/** True when p lies in the text box's frame (grown by `tolerance`). */
export function hitTextBox(t: TextBox, p: Pt, tolerance = 0): boolean {
  const q = toFrame(t, p);
  return q.x >= -tolerance && q.y >= -tolerance && q.x <= t.w + tolerance && q.y <= t.h + tolerance;
}

// ------------------------------------------------------------------ balloons

/** Outline of the balloon body in frame coordinates. */
function bodyLocal(b: Balloon): Pt[] {
  const { w, h } = b;
  const pts: Pt[] = [];
  switch (b.shape) {
    case 'rect':
      return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
    case 'rounded': {
      const r = Math.min(w, h) * 0.3;
      const corner = (cx: number, cy: number, a0: number) => {
        for (let i = 0; i <= 8; i++) {
          const a = a0 + (i / 8) * (Math.PI / 2);
          pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
        }
      };
      corner(w - r, r, -Math.PI / 2);
      corner(w - r, h - r, 0);
      corner(r, h - r, Math.PI / 2);
      corner(r, r, Math.PI);
      return pts;
    }
    case 'cloud': {
      // Bumps along an ellipse, about one per 40 px of circumference.
      const rx = w / 2;
      const ry = h / 2;
      const n = Math.max(6, Math.min(24, Math.round((Math.PI * (rx + ry)) / 40)));
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        const p0 = { x: rx + Math.cos(a0) * rx * 0.86, y: ry + Math.sin(a0) * ry * 0.86 };
        const p1 = { x: rx + Math.cos(a1) * rx * 0.86, y: ry + Math.sin(a1) * ry * 0.86 };
        // A half circle over each chord, bulging outwards.
        const mx = (p0.x + p1.x) / 2;
        const my = (p0.y + p1.y) / 2;
        const r = Math.hypot(p1.x - p0.x, p1.y - p0.y) / 2;
        const start = Math.atan2(p0.y - my, p0.x - mx);
        // Sweep through the side facing away from the centre.
        const out = Math.atan2(my - ry, mx - rx);
        const dir = Math.sin(out - start) >= 0 ? 1 : -1;
        for (let k = 0; k <= 8; k++) {
          const a = start + dir * (k / 8) * Math.PI;
          pts.push({ x: mx + Math.cos(a) * r, y: my + Math.sin(a) * r });
        }
      }
      return pts;
    }
    default: {
      const n = 72;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({ x: w / 2 + Math.cos(a) * (w / 2), y: h / 2 + Math.sin(a) * (h / 2) });
      }
      return pts;
    }
  }
}

/** Outline of the balloon body in document coordinates. */
export function balloonBody(b: Balloon): Pt[] {
  const m = frameMatrix(b);
  return bodyLocal(b).map((p) => apply(m, p));
}

export const balloonCenter = (b: Balloon): Pt => apply(frameMatrix(b), { x: b.w / 2, y: b.h / 2 });

/**
 * Outlines of a tail in document coordinates: one polygon for a pointed tail (from the middle of
 * the balloon to the tip, curving to the side by `bend`), or a few shrinking bubbles for a
 * thought tail.
 */
export function tailShapes(b: Balloon, t: BalloonTail): Pt[][] {
  const c = balloonCenter(b);
  const dx = t.tip.x - c.x;
  const dy = t.tip.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [];
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  if (t.kind === 'thought') {
    // Start where the body ends along the way to the tip (sampled), then three bubbles.
    const body = balloonBody(b);
    let edge = 0;
    for (let s = 0; s <= len; s += 2) {
      if (!insidePolygon(body, { x: c.x + ux * s, y: c.y + uy * s })) break;
      edge = s;
    }
    const free = Math.max(1, len - edge);
    const out: Pt[][] = [];
    const sizes = [0.5, 0.33, 0.2];
    sizes.forEach((f, i) => {
      const r = Math.max(1.5, (t.width / 2) * f * 2);
      const d = edge + free * ((i + 1) / sizes.length) - r;
      const cx = c.x + ux * d;
      const cy = c.y + uy * d;
      const ring: Pt[] = [];
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        ring.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.8 });
      }
      out.push(ring);
    });
    return out;
  }
  const half = t.width / 2;
  const bend = Math.max(-1, Math.min(1, t.bend)) * len * 0.35;
  // Quadratic curves from both sides of the base to the tip through a shared side offset.
  const ctrl = { x: c.x + dx / 2 + nx * bend, y: c.y + dy / 2 + ny * bend };
  const a = { x: c.x + nx * half, y: c.y + ny * half };
  const z = { x: c.x - nx * half, y: c.y - ny * half };
  const curve = (from: Pt, to: Pt, steps = 16): Pt[] => {
    const pts: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const k = 1 - s;
      // The control point moves with the side so the tail narrows evenly.
      const cx = ctrl.x + (from.x - c.x) * k * 0.5;
      const cy = ctrl.y + (from.y - c.y) * k * 0.5;
      pts.push({ x: k * k * from.x + 2 * k * s * cx + s * s * to.x, y: k * k * from.y + 2 * k * s * cy + s * s * to.y });
    }
    return pts;
  };
  return [[...curve(a, t.tip), ...curve(z, t.tip).reverse()]];
}

/** Ray casting point-in-polygon test. */
export function insidePolygon(poly: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** True when p is inside the balloon or one of its tails. */
export function hitBalloon(b: Balloon, p: Pt): boolean {
  if (insidePolygon(balloonBody(b), p)) return true;
  return b.tails.some((t) => tailShapes(b, t).some((poly) => insidePolygon(poly, p)));
}

/** Bounds of a balloon with its tails and outline. */
export function balloonBounds(b: Balloon): Box {
  const pts = [...balloonBody(b), ...b.tails.flatMap((t) => tailShapes(b, t).flat())];
  return boundsOf(pts, b.lineWidth + 2)!;
}

// ------------------------------------------------------------------ transforms

/** Angle and scale of an affine transform; mirrored transforms keep text readable. */
function placement(o: { x: number; y: number; w: number; h: number; angle: number }, m: Affine, w: number, h: number) {
  const det = m[0] * m[3] - m[1] * m[2];
  const turn = Math.atan2(m[1], m[0]);
  const angle = det < 0 ? turn - o.angle + Math.PI : o.angle + turn;
  const centre = apply(m, apply(frameMatrix(o), { x: o.w / 2, y: o.h / 2 }));
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Anchor = centre − R(angle)·(w/2, h/2).
  return { x: centre.x - (c * w) / 2 + (s * h) / 2, y: centre.y - (s * w) / 2 - (c * h) / 2, angle: normalize(angle) };
}

const normalize = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A text box moved, scaled and rotated by `m`. Scaling changes the letter size (`scaleText`, as
 * when the whole image is scaled or the box does not wrap) or only the frame.
 */
export function transformText(t: TextBox, m: Affine, scaleText: boolean): TextBox {
  const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  const w = t.w * k;
  const h = t.h * k;
  return {
    ...t,
    ...placement(t, m, w, h),
    w,
    h,
    ...(scaleText ? { size: t.size * k, letterSpacing: t.letterSpacing * k, edge: t.edge * k } : {}),
  };
}

/** A balloon moved, scaled and rotated by `m` (tails follow; the outline width stays unless `scaleLine`). */
export function transformBalloon(b: Balloon, m: Affine, scaleLine = false): Balloon {
  const det = m[0] * m[3] - m[1] * m[2];
  const k = Math.sqrt(Math.abs(det)) || 1;
  const w = b.w * k;
  const h = b.h * k;
  return {
    ...b,
    ...placement(b, m, w, h),
    w,
    h,
    lineWidth: scaleLine ? b.lineWidth * k : b.lineWidth,
    tails: b.tails.map((t) => ({ ...t, tip: apply(m, t.tip), width: t.width * k, bend: det < 0 ? -t.bend : t.bend })),
  };
}

// ------------------------------------------------------------------ files

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const color = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
const id = (v: unknown, prefix: string) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : newObjectId(prefix));
/** Font family names as CSS accepts them (no braces or semicolons). */
const family = (v: unknown) => (typeof v === 'string' && v.length <= 200 && !/[;{}<>\\]/.test(v) && v.trim() ? v.trim() : DEFAULT_TEXT_STYLE.font);

/** Text style from a file or the tool settings, completed and validated. */
export function sanitizeTextStyle(raw: unknown): TextStyle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_TEXT_STYLE;
  return {
    font: family(r.font),
    size: num(r.size, d.size, 0.5, 5000),
    bold: r.bold === true,
    italic: r.italic === true,
    underline: r.underline === true,
    strike: r.strike === true,
    align: r.align === 'center' || r.align === 'right' ? r.align : 'left',
    vertical: r.vertical === true,
    color: color(r.color, d.color),
    lineSpacing: num(r.lineSpacing, d.lineSpacing, 0.5, 5),
    letterSpacing: num(r.letterSpacing, 0, -100, 1000),
    edge: num(r.edge, 0, 0, 500),
    edgeColor: color(r.edgeColor, d.edgeColor),
  };
}

export function sanitizeTextBox(raw: unknown): TextBox | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== 'string') return null;
  return {
    ...sanitizeTextStyle(r),
    id: id(r.id, 't'),
    x: num(r.x, 0, -1e6, 1e6),
    y: num(r.y, 0, -1e6, 1e6),
    angle: num(r.angle, 0, -100, 100),
    w: num(r.w, 10, 1, 1e6),
    h: num(r.h, 10, 1, 1e6),
    wrap: r.wrap === true,
    text: r.text.slice(0, 100000),
  };
}

export function sanitizeBalloon(raw: unknown): Balloon | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const tails = Array.isArray(r.tails)
    ? r.tails.slice(0, 32).flatMap((x): BalloonTail[] => {
        if (!x || typeof x !== 'object') return [];
        const t = x as Record<string, unknown>;
        const tip = (t.tip && typeof t.tip === 'object' ? t.tip : {}) as Record<string, unknown>;
        return [
          {
            id: id(t.id, 'q'),
            tip: { x: num(tip.x, 0, -1e6, 1e6), y: num(tip.y, 0, -1e6, 1e6) },
            width: num(t.width, 20, 1, 1e5),
            bend: num(t.bend, 0, -1, 1),
            kind: t.kind === 'thought' ? 'thought' : 'pointed',
          },
        ];
      })
    : [];
  return {
    id: id(r.id, 'b'),
    shape: r.shape === 'rounded' || r.shape === 'rect' || r.shape === 'cloud' ? r.shape : 'ellipse',
    x: num(r.x, 0, -1e6, 1e6),
    y: num(r.y, 0, -1e6, 1e6),
    w: num(r.w, 10, 1, 1e6),
    h: num(r.h, 10, 1, 1e6),
    angle: num(r.angle, 0, -100, 100),
    lineWidth: num(r.lineWidth, 3, 0, 500),
    lineColor: color(r.lineColor, '#000000'),
    fillColor: r.fillColor === null ? null : color(r.fillColor, '#ffffff'),
    tails,
  };
}
