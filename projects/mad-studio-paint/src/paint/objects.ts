/**
 * The objects of vector and text layers – lines, text boxes and balloons – as one content type, so
 * the Object tool, Move layer, transforms and flips treat them alike (also frame panels, a gradient
 * layer's gradient and the focus / speed lines of a lines layer). Pure, unit tested.
 */
import { distanceToEdge, polygonBounds, transformPanel, type FramePanel } from './frames';
import type { GradientFill } from './gradient';
import { hitEffectLines, referenceBounds, transformEffectLines, type EffectLines } from './effectLines';
import type { Affine, Pt } from './rulers';
import {
  balloonBody,
  balloonBounds,
  boundsOf,
  frameMatrix,
  hitBalloon,
  hitTextBox,
  insidePolygon,
  textBounds,
  transformBalloon,
  transformText,
  type Balloon,
  type Box,
  type TextBox,
} from './text';
import { hitStroke, keepWhere, strokeBounds, transformStrokes, type VectorStroke } from './vector';

export interface Content {
  strokes: VectorStroke[];
  texts: TextBox[];
  balloons: Balloon[];
  /** Comic frame panels (frame border folders). */
  panels: FramePanel[];
  /** The gradient of a gradient layer (object id GRADIENT_ID). */
  gradient?: GradientFill;
  /** The focus / speed lines of a lines layer. */
  lines?: EffectLines[];
}

/** Object id of a gradient layer's gradient. */
export const GRADIENT_ID = 'gradient';

export const EMPTY_CONTENT: Content = { strokes: [], texts: [], balloons: [], panels: [] };

export const contentOf = (l: { kind: string; strokes?: VectorStroke[]; texts?: TextBox[]; balloons?: Balloon[]; frame?: { panels: FramePanel[] }; gradient?: GradientFill; items?: EffectLines[] }): Content => ({
  strokes: l.strokes ?? [],
  texts: l.texts ?? [],
  balloons: l.balloons ?? [],
  panels: l.frame?.panels ?? [],
  ...(l.gradient ? { gradient: l.gradient } : {}),
  ...(l.items ? { lines: l.items } : {}),
});

export const objectIds = (c: Content): string[] => [...[...c.strokes, ...c.balloons, ...c.texts, ...c.panels, ...(c.lines ?? [])].map((o) => o.id), ...(c.gradient ? [GRADIENT_ID] : [])];

const applyTo = (m: Affine, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

export const textCenter = (t: TextBox): Pt => {
  const m = frameMatrix(t);
  return { x: m[0] * (t.w / 2) + m[2] * (t.h / 2) + m[4], y: m[1] * (t.w / 2) + m[3] * (t.h / 2) + m[5] };
};

/** Text boxes whose centre lies in one of the balloons. */
function textsIn(c: Content, balloons: Balloon[]): Set<string> {
  const bodies = balloons.map(balloonBody);
  return new Set(c.texts.filter((t) => bodies.some((b) => insidePolygon(b, textCenter(t)))).map((t) => t.id));
}

export interface TransformOptions {
  /** Line widths scale with the transform (default true). */
  scaleWidth?: boolean;
  /** Letter sizes scale too (default: only for text that does not wrap at its frame). */
  scaleText?: boolean;
  /** Balloon outlines scale too (default false). */
  scaleLine?: boolean;
}

/**
 * Applies `m` to the objects in `which` (all when null). Text inside a balloon that moves goes
 * along with it.
 */
export function transformContent(c: Content, which: Set<string> | null, m: Affine, opts: TransformOptions = {}): Content {
  const picked = (id: string) => !which || which.has(id);
  const carried = textsIn(
    c,
    c.balloons.filter((b) => picked(b.id)),
  );
  return {
    strokes: c.strokes.map((s) => (picked(s.id) ? transformStrokes([s], m, opts.scaleWidth ?? true)[0] : s)),
    balloons: c.balloons.map((b) => (picked(b.id) ? transformBalloon(b, m, opts.scaleLine) : b)),
    texts: c.texts.map((t) => (picked(t.id) || carried.has(t.id) ? transformText(t, m, opts.scaleText ?? !t.wrap) : t)),
    panels: c.panels.map((p) => (picked(p.id) ? transformPanel(p, m) : p)),
    ...(c.gradient ? { gradient: picked(GRADIENT_ID) ? { ...c.gradient, a: applyTo(m, c.gradient.a), b: applyTo(m, c.gradient.b) } : c.gradient } : {}),
    ...(c.lines ? { lines: c.lines.map((e) => (picked(e.id) ? transformEffectLines(e, m) : e)) } : {}),
  };
}

/** The affine map that best matches `map` near `p` (from finite differences). */
export function localAffine(map: (p: Pt) => Pt, p: Pt, step = 1): Affine {
  const c = map(p);
  const ex = map({ x: p.x + step, y: p.y });
  const ey = map({ x: p.x, y: p.y + step });
  const a = (ex.x - c.x) / step;
  const b = (ex.y - c.y) / step;
  const cc = (ey.x - c.x) / step;
  const d = (ey.y - c.y) / step;
  return [a, b, cc, d, c.x - a * p.x - cc * p.y, c.y - b * p.x - d * p.y];
}

/**
 * Applies a non-affine map (perspective, mesh) to the objects in `which`: line and frame points
 * follow it exactly; line widths, text and balloons follow its local affine approximation.
 */
export function warpContent(c: Content, which: Set<string> | null, map: (p: Pt) => Pt, opts: TransformOptions = {}): Content {
  const picked = (id: string) => !which || which.has(id);
  const carried = textsIn(
    c,
    c.balloons.filter((b) => picked(b.id)),
  );
  const centre = (pts: Pt[]): Pt => ({ x: pts.reduce((s, p) => s + p.x, 0) / Math.max(1, pts.length), y: pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length) });
  return {
    strokes: c.strokes.map((s) => {
      if (!picked(s.id)) return s;
      const [shaped] = transformStrokes([s], localAffine(map, centre(s.points)), opts.scaleWidth ?? true);
      return { ...shaped, points: s.points.map((p, i) => ({ ...shaped.points[i], ...map(p) })) };
    }),
    balloons: c.balloons.map((b) => (picked(b.id) ? transformBalloon(b, localAffine(map, { x: b.x + b.w / 2, y: b.y + b.h / 2 }), opts.scaleLine) : b)),
    texts: c.texts.map((t) => (picked(t.id) || carried.has(t.id) ? transformText(t, localAffine(map, textCenter(t)), opts.scaleText ?? !t.wrap) : t)),
    panels: c.panels.map((p) => (picked(p.id) ? { ...p, points: p.points.map(map) } : p)),
    ...(c.gradient ? { gradient: picked(GRADIENT_ID) ? { ...c.gradient, a: map(c.gradient.a), b: map(c.gradient.b) } : c.gradient } : {}),
    ...(c.lines ? { lines: c.lines.map((e) => (picked(e.id) ? transformEffectLines(e, localAffine(map, { x: e.cx, y: e.cy })) : e)) } : {}),
  };
}

/** Bounds of the objects in `which` (all when null). */
export function contentBounds(c: Content, which: Set<string> | null = null): Box | null {
  const picked = (id: string) => !which || which.has(id);
  const boxes = [
    ...c.strokes.filter((s) => picked(s.id)).map(strokeBounds),
    ...c.balloons.filter((b) => picked(b.id)).map(balloonBounds),
    ...c.texts.filter((t) => picked(t.id)).map(textBounds),
    ...c.panels.filter((p) => picked(p.id)).map((p) => polygonBounds(p.points)),
    ...(c.gradient && picked(GRADIENT_ID) ? [boundsOf([c.gradient.a, c.gradient.b], 4)] : []),
    ...(c.lines ?? []).filter((e) => picked(e.id)).map(referenceBounds),
  ].filter((b): b is Box => b !== null);
  return boundsOf(boxes.flatMap((b) => [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
  ]));
}

/** The top-most object under p: text above balloons, then lines, then frame borders (on their line); focus / speed lines on their reference or lines (`area`: the canvas). */
export function pickObject(c: Content, p: Pt, tolerance: number, frameLine = 0, area = { x: 0, y: 0, w: 0, h: 0 }): string | null {
  const lines = c.lines ?? [];
  for (let i = lines.length - 1; i >= 0; i--) if (hitEffectLines(lines[i], p, tolerance, area)) return lines[i].id;
  for (let i = c.texts.length - 1; i >= 0; i--) if (hitTextBox(c.texts[i], p, tolerance)) return c.texts[i].id;
  for (let i = c.balloons.length - 1; i >= 0; i--) if (hitBalloon(c.balloons[i], p)) return c.balloons[i].id;
  const k = hitStroke(c.strokes, p, tolerance);
  if (k >= 0) return c.strokes[k].id;
  for (const panel of c.panels) if (distanceToEdge(panel.points, p) <= tolerance + frameLine / 2) return panel.id;
  // A gradient is picked on the line between its start and end.
  if (c.gradient && distanceToEdge([c.gradient.a, c.gradient.b], p) <= tolerance * 2) return GRADIENT_ID;
  return null;
}

/**
 * Objects an area (the selection) takes along: lines with a part inside it, text boxes and
 * balloons whose centre is inside it.
 */
export function idsTouching(c: Content, inside: (p: Pt) => boolean): Set<string> {
  const ids = new Set<string>();
  for (const s of c.strokes) if (keepWhere([s], inside).length > 0) ids.add(s.id);
  for (const t of c.texts) if (inside(textCenter(t))) ids.add(t.id);
  for (const panel of c.panels) {
    const b = polygonBounds(panel.points);
    if (inside({ x: b.x + b.w / 2, y: b.y + b.h / 2 })) ids.add(panel.id);
  }
  for (const b of c.balloons) {
    const r = { x: b.w / 2, y: b.h / 2 };
    const m = frameMatrix(b);
    if (inside({ x: m[0] * r.x + m[2] * r.y + m[4], y: m[1] * r.x + m[3] * r.y + m[5] })) ids.add(b.id);
  }
  if (c.gradient && (inside(c.gradient.a) || inside(c.gradient.b))) ids.add(GRADIENT_ID);
  for (const e of c.lines ?? []) if (inside({ x: e.cx, y: e.cy })) ids.add(e.id);
  return ids;
}

/** The content without the objects in `ids` (a gradient layer keeps its gradient). */
export const removeObjects = (c: Content, ids: Set<string>): Content => ({
  ...c,
  strokes: c.strokes.filter((s) => !ids.has(s.id)),
  texts: c.texts.filter((t) => !ids.has(t.id)),
  balloons: c.balloons.filter((b) => !ids.has(b.id)),
  panels: c.panels.filter((p) => !ids.has(p.id)),
  ...(c.lines ? { lines: c.lines.filter((e) => !ids.has(e.id)) } : {}),
});

/** Only the objects in `ids`. */
export const pickContent = (c: Content, ids: Set<string>): Content => ({
  strokes: c.strokes.filter((s) => ids.has(s.id)),
  texts: c.texts.filter((t) => ids.has(t.id)),
  balloons: c.balloons.filter((b) => ids.has(b.id)),
  panels: c.panels.filter((p) => ids.has(p.id)),
  ...(c.lines ? { lines: c.lines.filter((e) => ids.has(e.id)) } : {}),
});
