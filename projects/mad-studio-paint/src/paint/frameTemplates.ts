/**
 * Frame border templates: page layouts that make a set of frames at once. The app's own templates
 * are cuts across the page frame (in units of it, 0..1), applied with the chosen gutters like the
 * Divide frame border tool; registered templates keep their frames' shapes (in units of the
 * canvas). Pure, unit tested.
 */
import { insidePanel, rectPoints, splitPanel } from './frames';
import type { Pt } from './rulers';

/** A cut through the frame its middle lies in, from `a` to `b` (units of the page frame). */
export interface TemplateCut {
  a: [number, number];
  b: [number, number];
}

export interface FrameTemplate {
  id: string;
  name: string;
  /** The app's templates: cuts in order. */
  cuts?: TemplateCut[];
  /** Registered templates: the frames themselves, in units of the canvas. */
  panels?: [number, number][][];
}

/** A cut across a row at height v (from u0 to u1), or down a column at u (from v0 to v1). */
const row = (v: number, u0 = -0.1, u1 = 1.1): TemplateCut => ({ a: [u0, v], b: [u1, v] });
const col = (u: number, v0 = -0.1, v1 = 1.1): TemplateCut => ({ a: [u, v0], b: [u, v1] });

/** Own layouts (not the reference's materials). */
export const FRAME_TEMPLATES: FrameTemplate[] = [
  { id: 'single', name: '1 frame', cuts: [] },
  { id: 'rows2', name: '2 rows', cuts: [row(0.5)] },
  { id: 'rows3', name: '3 rows', cuts: [row(1 / 3), row(2 / 3)] },
  { id: 'yonkoma', name: '4 rows (yonkoma)', cuts: [row(0.25), row(0.5), row(0.75)] },
  { id: 'grid4', name: '2 × 2', cuts: [row(0.5), col(0.5, -0.1, 0.5), col(0.5, 0.5, 1.1)] },
  { id: 'grid6', name: '2 × 3', cuts: [row(1 / 3), row(2 / 3), col(0.5, -0.1, 1 / 3), col(0.5, 1 / 3, 2 / 3), col(0.5, 2 / 3, 1.1)] },
  { id: 'wide-two', name: 'Wide + 2', cuts: [row(0.42), col(0.5, 0.42, 1.1)] },
  { id: 'two-wide', name: '2 + wide', cuts: [row(0.58), col(0.5, -0.1, 0.58)] },
  { id: 'staggered', name: 'Staggered', cuts: [row(1 / 3), row(2 / 3), col(0.62, -0.1, 1 / 3), col(0.38, 1 / 3, 2 / 3), col(0.55, 2 / 3, 1.1)] },
  { id: 'slanted', name: 'Slanted', cuts: [{ a: [-0.1, 0.395], b: [1.1, 0.29] }, { a: [0.63, 0.33], b: [0.44, 1.1] }] },
  { id: 'splash', name: 'Splash + strip', cuts: [row(0.72), col(1 / 3, 0.72, 1.1), col(2 / 3, 0.72, 1.1)] },
  { id: 'tall', name: 'Tall + 3', cuts: [col(0.45), row(1 / 3, 0.45, 1.1), row(2 / 3, 0.45, 1.1)] },
];

/**
 * The frames of a template on a page frame (x, y, w, h) with gutters (px): `gapY` between frames
 * above each other, `gapX` between frames side by side. For a registered template `canvas` gives
 * the size its frames scale to. Frames are in reading order (top to bottom, then left to right).
 */
export function templatePanels(t: FrameTemplate, frame: { x: number; y: number; w: number; h: number }, gapX: number, gapY: number, canvas = { w: frame.w, h: frame.h }): Pt[][] {
  let panels: Pt[][];
  if (t.panels) panels = t.panels.map((poly) => poly.map(([u, v]) => ({ x: u * canvas.w, y: v * canvas.h })));
  else {
    const at = ([u, v]: [number, number]): Pt => ({ x: frame.x + u * frame.w, y: frame.y + v * frame.h });
    panels = [rectPoints(frame.x, frame.y, frame.w, frame.h)];
    for (const cut of t.cuts ?? []) {
      const a = at(cut.a);
      const b = at(cut.b);
      const i = panels.findIndex((p) => insidePanel(p, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
      if (i < 0) continue;
      const across = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      const parts = splitPanel(panels[i], a, b, across ? gapY : gapX);
      if (parts) panels.splice(i, 1, ...parts);
    }
  }
  const centre = (p: Pt[]) => p.reduce((c, q) => ({ x: c.x + q.x / p.length, y: c.y + q.y / p.length }), { x: 0, y: 0 });
  // Rows first (frames whose middles are within a fifth of the page height count as one row).
  const band = (frame.h || 1) / 5;
  return panels
    .map((p) => ({ p, c: centre(p) }))
    .sort((m, n) => (Math.abs(m.c.y - n.c.y) > band ? m.c.y - n.c.y : m.c.x - n.c.x))
    .map((x) => x.p);
}

/** Frames as a registered template: their corners in units of the canvas. */
export function templateFromPanels(name: string, panels: Pt[][], canvas: { w: number; h: number }): FrameTemplate {
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return {
    id: `own-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.slice(0, 60) || 'Template',
    panels: panels.map((poly) => poly.map((p) => [round(p.x / canvas.w), round(p.y / canvas.h)] as [number, number])),
  };
}

/** A registered template from storage, or null. */
export function sanitizeTemplate(raw: unknown): FrameTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.panels)) return null;
  const panels = r.panels
    .slice(0, 100)
    .map((poly) =>
      Array.isArray(poly)
        ? poly.slice(0, 64).flatMap((pt): [number, number][] => (Array.isArray(pt) && pt.length === 2 && pt.every((v) => typeof v === 'number' && Number.isFinite(v) && v > -2 && v < 3) ? [[pt[0], pt[1]]] : []))
        : [],
    )
    .filter((poly) => poly.length >= 3);
  if (panels.length === 0) return null;
  return { id: typeof r.id === 'string' ? r.id.slice(0, 40) : `own-${panels.length}`, name: typeof r.name === 'string' ? r.name.slice(0, 60) : 'Template', panels };
}
