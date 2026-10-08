/**
 * The objects of vector and text layers – lines, text boxes and balloons – as one content type, so
 * the Object tool, Move layer, transforms and flips treat them alike. Pure, unit tested.
 */
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
}

export const EMPTY_CONTENT: Content = { strokes: [], texts: [], balloons: [] };

export const contentOf = (l: { kind: string; strokes?: VectorStroke[]; texts?: TextBox[]; balloons?: Balloon[] }): Content => ({
  strokes: l.strokes ?? [],
  texts: l.texts ?? [],
  balloons: l.balloons ?? [],
});

export const objectIds = (c: Content): string[] => [...c.strokes, ...c.balloons, ...c.texts].map((o) => o.id);

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
  };
}

/** Bounds of the objects in `which` (all when null). */
export function contentBounds(c: Content, which: Set<string> | null = null): Box | null {
  const picked = (id: string) => !which || which.has(id);
  const boxes = [
    ...c.strokes.filter((s) => picked(s.id)).map(strokeBounds),
    ...c.balloons.filter((b) => picked(b.id)).map(balloonBounds),
    ...c.texts.filter((t) => picked(t.id)).map(textBounds),
  ].filter((b): b is Box => b !== null);
  return boundsOf(boxes.flatMap((b) => [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
  ]));
}

/** The top-most object under p: text above balloons, then lines. */
export function pickObject(c: Content, p: Pt, tolerance: number): string | null {
  for (let i = c.texts.length - 1; i >= 0; i--) if (hitTextBox(c.texts[i], p, tolerance)) return c.texts[i].id;
  for (let i = c.balloons.length - 1; i >= 0; i--) if (hitBalloon(c.balloons[i], p)) return c.balloons[i].id;
  const k = hitStroke(c.strokes, p, tolerance);
  return k >= 0 ? c.strokes[k].id : null;
}

/**
 * Objects an area (the selection) takes along: lines with a part inside it, text boxes and
 * balloons whose centre is inside it.
 */
export function idsTouching(c: Content, inside: (p: Pt) => boolean): Set<string> {
  const ids = new Set<string>();
  for (const s of c.strokes) if (keepWhere([s], inside).length > 0) ids.add(s.id);
  for (const t of c.texts) if (inside(textCenter(t))) ids.add(t.id);
  for (const b of c.balloons) {
    const r = { x: b.w / 2, y: b.h / 2 };
    const m = frameMatrix(b);
    if (inside({ x: m[0] * r.x + m[2] * r.y + m[4], y: m[1] * r.x + m[3] * r.y + m[5] })) ids.add(b.id);
  }
  return ids;
}

/** The content without the objects in `ids` (and the text inside removed balloons stays). */
export const removeObjects = (c: Content, ids: Set<string>): Content => ({
  strokes: c.strokes.filter((s) => !ids.has(s.id)),
  texts: c.texts.filter((t) => !ids.has(t.id)),
  balloons: c.balloons.filter((b) => !ids.has(b.id)),
});

/** Only the objects in `ids`. */
export const pickContent = (c: Content, ids: Set<string>): Content => ({
  strokes: c.strokes.filter((s) => ids.has(s.id)),
  texts: c.texts.filter((t) => ids.has(t.id)),
  balloons: c.balloons.filter((b) => ids.has(b.id)),
});
