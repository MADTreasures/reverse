/**
 * Ruler tool (create rulers), Object tool (select, move and edit them) and the ruler overlay.
 * Rulers are drawn purple while their kind of snapping is on, green while it is off.
 */
import { findLayer } from '../model/layers';
import type { Id } from '../model/types';
import { offsetPath, simplifyPolyline, smoothPolyline, translatePoints, type CurveSpec } from '../paint/curves';
import {
  curveMiddle,
  curveSamples,
  distanceToRuler,
  eyeLevel,
  isSpecial,
  moveHandle,
  rulerHandles,
  rulerPath,
  translateRuler,
  type Pt,
  type Ruler,
  type RulerInput,
} from '../paint/rulers';
import { isSpecialCurve, type SubTool } from '../paint/tools';
import { apply as applyMatrix } from '../paint/viewMath';
import * as actions from '../store/actions';
import { getState, setState } from '../store/store';
import { CurveInput } from './curveInput';
import type { Modifiers, OverlayView, PointerInfo, ToolSession } from './types';

const HANDLE_PX = 9;
const PICK_PX = 8;
const DRAG_THRESHOLD = 3;

interface Hit {
  layerId: Id;
  ruler: Ruler;
  key: string;
}

/** A handle of an applicable ruler under the pointer (the selected ruler first). */
export function hitHandle(p: PointerInfo, view: OverlayView): Hit | null {
  const s = getState();
  const list = actions.activeRulers(s);
  const sel = s.selectedRuler;
  list.sort((a, b) => Number(b.ruler.id === sel?.rulerId) - Number(a.ruler.id === sel?.rulerId));
  for (const { layerId, ruler } of list) {
    for (const h of rulerHandles(ruler, { w: s.doc.width, h: s.doc.height })) {
      const q = applyMatrix(view.matrix, h.at.x, h.at.y);
      if (Math.hypot(q.x - p.sx, q.y - p.sy) <= HANDLE_PX) return { layerId, ruler, key: h.key };
    }
  }
  return null;
}

/** The applicable ruler whose line is under the pointer. */
function pickRuler(p: PointerInfo): { layerId: Id; ruler: Ruler } | null {
  const s = getState();
  const reach = PICK_PX / Math.max(0.01, s.view.zoom);
  let best: { layerId: Id; ruler: Ruler } | null = null;
  let bestD = reach;
  for (const item of actions.activeRulers(s)) {
    const d = distanceToRuler(item.ruler, p);
    if (d <= bestD) {
      bestD = d;
      best = item;
    }
  }
  return best;
}

/** Drags one handle of a ruler; the edit is one undo step. */
class HandleSession implements ToolSession {
  readonly cursor = 'grabbing';
  private key: string;

  constructor(private hit: Hit) {
    this.key = `ruler:${hit.ruler.id}:${Date.now()}`;
    setState({ selectedRuler: { layerId: hit.layerId, rulerId: hit.ruler.id } });
  }

  move(p: PointerInfo): void {
    actions.updateRuler(this.hit.layerId, moveHandle(this.hit.ruler, this.hit.key, p, p.shift), 'Edit ruler', this.key);
  }

  up(p: PointerInfo): void {
    this.move(p);
  }

  cancel(): void {}
}

/** Drags a whole ruler. */
class MoveRulerSession implements ToolSession {
  readonly cursor = 'move';
  private key: string;

  constructor(
    private item: { layerId: Id; ruler: Ruler },
    private start: PointerInfo,
  ) {
    this.key = `ruler-move:${item.ruler.id}:${Date.now()}`;
  }

  move(p: PointerInfo): void {
    if (Math.hypot(p.sx - this.start.sx, p.sy - this.start.sy) < DRAG_THRESHOLD) return;
    actions.updateRuler(this.item.layerId, translateRuler(this.item.ruler, p.x - this.start.x, p.y - this.start.y), 'Move ruler', this.key);
  }

  up(p: PointerInfo): void {
    this.move(p);
  }

  cancel(): void {}
}

/** Object tool on rulers: select a ruler, drag its handles or the ruler itself. */
export function rulerObjectSession(p: PointerInfo, view: OverlayView): ToolSession | null {
  const hit = hitHandle(p, view);
  if (hit) return new HandleSession(hit);
  const item = pickRuler(p);
  if (item) {
    setState({ selectedRuler: { layerId: item.layerId, rulerId: item.ruler.id } });
    return new MoveRulerSession(item, p);
  }
  setState({ selectedRuler: null });
  return null;
}

/**
 * Ruler tool: drag to create the sub tool's ruler (curves: click their points; the ruler pen: draw
 * it); dragging a handle edits an existing one.
 */
export function rulerSession(sub: SubTool, p: PointerInfo, view: OverlayView): ToolSession | null {
  const curve = sub.rulerKind === 'curve' || (sub.rulerKind === 'special' && isSpecialCurve(sub.specialRuler));
  // While a curve is being placed, clicks add its points.
  if (!(curve && CurveInput.active)) {
    const hit = hitHandle(p, view);
    if (hit) return new HandleSession(hit);
  }
  if (actions.editBlocker() === 'No layer selected') return null;
  if (sub.rulerKind === 'perspective') {
    addVanishingPoint(p);
    return null;
  }
  if (curve) return curvePress(sub, p);
  if (sub.rulerKind === 'pen') return new PenRulerSession(p, view.zoom);
  return new CreateRulerSession(sub, p);
}

/** Curve ruler, parallel / multiple / radial curve: one more point (or the end) of the curve. */
function curvePress(sub: SubTool, p: PointerInfo): ToolSession | null {
  const kind = sub.rulerKind === 'curve' ? 'curve' : (sub.specialRuler ?? 'parallelCurve');
  return CurveInput.press(p, `${sub.id}:${kind}`, sub.curveType ?? 'spline', (spec) => {
    const layerId = getState().activeLayerId;
    if (kind === 'radialCurve') actions.addRuler({ kind: 'radialCurve', ...spec, center: spec.points[0] }, layerId);
    else if (kind === 'multiCurve') actions.addRuler({ kind: 'multiCurve', ...spec, angle: multiCurveAngle(spec) }, layerId);
    else if (kind === 'parallelCurve') actions.addRuler({ kind: 'parallelCurve', ...spec }, layerId);
    else actions.addRuler({ kind: 'curve', ...spec }, layerId);
  });
}

/** A new multiple curve's lines are moved across the curve (square to the line from its start to its end). */
function multiCurveAngle(spec: CurveSpec): number {
  const a = spec.points[0];
  const b = spec.points[spec.points.length - 1];
  return Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
}

/** Bends sharper than this (radians) stay corners of a ruler pen ruler. */
const PEN_CORNER = 1;

/** Ruler pen: a ruler along a line drawn by hand (smoothed, then a spline through few points). */
class PenRulerSession implements ToolSession {
  readonly cursor = 'crosshair';
  private points: Pt[];

  constructor(
    p: PointerInfo,
    private zoom: number,
  ) {
    this.points = [{ x: p.x, y: p.y }];
  }

  move(p: PointerInfo, coalesced: PointerInfo[]): void {
    for (const q of coalesced.length ? coalesced : [p]) this.points.push({ x: q.x, y: q.y });
  }

  up(p: PointerInfo): void {
    this.points.push({ x: p.x, y: p.y });
    const pts = simplifyPolyline(smoothPolyline(this.points), Math.max(0.25, 1.5 / this.zoom));
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (pts.length < 2 || length * this.zoom < 4) return;
    const corners: number[] = [];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
      const b = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
      if (Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) > PEN_CORNER) corners.push(i);
    }
    actions.addRuler({ kind: 'curve', curve: 'spline', points: pts, ...(corners.length ? { corners } : {}) }, getState().activeLayerId, 'Ruler pen');
  }

  cancel(): void {}

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    ctx.save();
    ctx.strokeStyle = '#2f80ed';
    ctx.lineWidth = 1;
    ctx.beginPath();
    this.points.forEach((q, i) => {
      const s = applyMatrix(view.matrix, q.x, q.y);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Perspective ruler tool: each click adds a vanishing point to the current layer's perspective
 * ruler (up to three); the second one lands on the eye level of the first.
 */
function addVanishingPoint(p: PointerInfo): void {
  const s = getState();
  const layer = findLayer(s.doc.layers, s.activeLayerId);
  const existing = layer?.rulers?.items.find((r): r is Extract<Ruler, { kind: 'perspective' }> => r.kind === 'perspective');
  if (!existing || existing.vps.length >= 3) {
    actions.addRuler({ kind: 'perspective', vps: [{ x: p.x, y: p.y }] }, s.activeLayerId, 'Create perspective ruler');
    return;
  }
  const vp = existing.vps.length === 1 ? { x: p.x, y: existing.vps[0].y } : { x: p.x, y: p.y };
  actions.updateRuler(s.activeLayerId, { ...existing, vps: [...existing.vps, vp] }, 'Add vanishing point', `vp:${Date.now()}`);
  setState({ selectedRuler: { layerId: s.activeLayerId, rulerId: existing.id } });
}

class CreateRulerSession implements ToolSession {
  readonly cursor = 'crosshair';
  private end: PointerInfo;

  constructor(
    private sub: SubTool,
    private start: PointerInfo,
  ) {
    this.end = start;
  }

  /** The ruler the drag so far describes. */
  private ruler(m: Modifiers = this.end): RulerInput | null {
    const a: Pt = { x: this.start.x, y: this.start.y };
    let b: Pt = { x: this.end.x, y: this.end.y };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dragged = Math.hypot(this.end.sx - this.start.sx, this.end.sy - this.start.sy) >= DRAG_THRESHOLD;
    switch (this.sub.rulerKind) {
      case 'linear': {
        if (!dragged) return null;
        if (m.shift) {
          const step = Math.PI / 4;
          const ang = Math.round(Math.atan2(dy, dx) / step) * step;
          const l = Math.hypot(dx, dy);
          b = { x: a.x + Math.cos(ang) * l, y: a.y + Math.sin(ang) * l };
        }
        return { kind: 'linear', a, b };
      }
      case 'guide':
        if (!dragged) return null;
        // Dragging sideways makes a horizontal guide, up or down a vertical one.
        return Math.abs(dx) >= Math.abs(dy) ? { kind: 'guide', vertical: false, pos: a.y } : { kind: 'guide', vertical: true, pos: a.x };
      case 'symmetry':
        return {
          kind: 'symmetry',
          center: a,
          angle: dragged ? Math.atan2(dy, dx) : -Math.PI / 2,
          lines: this.sub.symmetryLines ?? 2,
          mirror: this.sub.symmetryMirror ?? true,
        };
      case 'special': {
        const type = this.sub.specialRuler ?? 'parallel';
        if (type === 'radial') return { kind: 'radial', center: a };
        if (!dragged) return null;
        if (type === 'parallel') return { kind: 'parallel', origin: a, angle: Math.atan2(dy, dx) };
        return { kind: 'concentric', center: a, rx: Math.max(1, Math.abs(dx)), ry: Math.max(1, Math.abs(dy)), angle: 0 };
      }
      case 'figure': {
        if (!dragged) return null;
        let { x: x0, y: y0 } = a;
        let { x: x1, y: y1 } = b;
        if (m.shift) {
          // Square / circle.
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          x1 = x0 + Math.sign(dx || 1) * d;
          y1 = y0 + Math.sign(dy || 1) * d;
        }
        if (m.alt) {
          // From the centre.
          x0 -= x1 - x0;
          y0 -= y1 - y0;
        }
        return {
          kind: 'figure',
          shape: this.sub.rulerFigure ?? 'ellipse',
          center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
          rx: Math.max(1, Math.abs(x1 - x0) / 2),
          ry: Math.max(1, Math.abs(y1 - y0) / 2),
          angle: 0,
          corners: this.sub.polygonCorners ?? 6,
        };
      }
      default:
        return null;
    }
  }

  move(p: PointerInfo): void {
    this.end = p;
  }

  modifiers(m: Modifiers): void {
    this.end = { ...this.end, ...m };
  }

  up(p: PointerInfo): void {
    this.end = p;
    const r = this.ruler();
    if (r) actions.addRuler(r);
  }

  cancel(): void {}

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    const r = this.ruler();
    if (!r) return;
    const s = getState();
    drawRuler(ctx, view, { ...r, id: 'preview' } as Ruler, { w: s.doc.width, h: s.doc.height }, '#2f80ed', false);
  }
}

// ------------------------------------------------------------------ drawing

const SNAP_ON = '#a24bdd';
const SNAP_OFF = '#2ea44f';

/** Draws one ruler in viewport space. */
function drawRuler(ctx: CanvasRenderingContext2D, view: OverlayView, r: Ruler, size: { w: number; h: number }, color: string, selected: boolean): void {
  const P = (x: number, y: number) => applyMatrix(view.matrix, x, y);
  const far = (size.w + size.h) * 4;
  const line = (a: Pt, b: Pt, alpha = 1) => {
    const p = P(a.x, a.y);
    const q = P(b.x, b.y);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  const through = (a: Pt, ang: number, alpha = 1) =>
    line({ x: a.x - Math.cos(ang) * far, y: a.y - Math.sin(ang) * far }, { x: a.x + Math.cos(ang) * far, y: a.y + Math.sin(ang) * far }, alpha);
  const poly = (pts: Pt[], alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    pts.forEach((q, i) => {
      const s = P(q.x, q.y);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  /** Space between the guide copies of special curve rulers: 10 screen px. */
  const gap = 10 / Math.max(0.01, view.zoom);
  ctx.save();
  ctx.lineWidth = selected ? 1.5 : 1;
  ctx.strokeStyle = color;
  switch (r.kind) {
    case 'linear':
      line(r.a, r.b);
      break;
    case 'curve':
      poly(curveSamples(r));
      break;
    case 'figure':
      poly(rulerPath(r).pts);
      break;
    case 'parallelCurve': {
      const pts = curveSamples(r);
      poly(pts);
      poly(offsetPath(pts, gap), 0.45);
      poly(offsetPath(pts, -gap), 0.45);
      break;
    }
    case 'multiCurve': {
      const pts = curveSamples(r);
      poly(pts);
      for (const k of [-gap, gap]) poly(translatePoints(pts, Math.cos(r.angle) * k * 1.2, Math.sin(r.angle) * k * 1.2), 0.45);
      if (selected) {
        const m = curveMiddle(r);
        line(m, { x: m.x + Math.cos(r.angle) * 80, y: m.y + Math.sin(r.angle) * 80 });
      }
      break;
    }
    case 'radialCurve': {
      poly(curveSamples(r));
      // The centre, like a small burst of focus lines.
      const c = P(r.center.x, r.center.y);
      ctx.beginPath();
      for (let k = 0; k < 12; k++) {
        const t = (k * Math.PI) / 6;
        ctx.moveTo(c.x + Math.cos(t) * 4, c.y + Math.sin(t) * 4);
        ctx.lineTo(c.x + Math.cos(t) * 10, c.y + Math.sin(t) * 10);
      }
      ctx.stroke();
      break;
    }
    case 'guide':
      if (r.vertical) line({ x: r.pos, y: -far }, { x: r.pos, y: far });
      else line({ x: -far, y: r.pos }, { x: far, y: r.pos });
      break;
    case 'parallel': {
      through(r.origin, r.angle);
      const nx = -Math.sin(r.angle);
      const ny = Math.cos(r.angle);
      for (let k = -4; k <= 4; k++) if (k) through({ x: r.origin.x + nx * k * 60, y: r.origin.y + ny * k * 60 }, r.angle, 0.3);
      break;
    }
    case 'radial':
      for (let k = 0; k < 24; k++) through(r.center, (k * Math.PI) / 24, k % 6 === 0 ? 0.8 : 0.3);
      break;
    case 'concentric':
      for (const s of [0.5, 1, 1.5, 2]) {
        ctx.globalAlpha = s === 1 ? 1 : 0.35;
        ctx.beginPath();
        for (let i = 0; i <= 64; i++) {
          const t = (i / 64) * Math.PI * 2;
          const ux = Math.cos(t) * r.rx * s;
          const uy = Math.sin(t) * r.ry * s;
          const q = P(r.center.x + ux * Math.cos(r.angle) - uy * Math.sin(r.angle), r.center.y + ux * Math.sin(r.angle) + uy * Math.cos(r.angle));
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    case 'symmetry': {
      const n = Math.max(2, Math.round(r.lines));
      for (let i = 0; i < n; i++) {
        const a = r.angle + (i * 2 * Math.PI) / n;
        line(r.center, { x: r.center.x + Math.cos(a) * far, y: r.center.y + Math.sin(a) * far }, i === 0 ? 1 : 0.7);
      }
      break;
    }
    case 'perspective': {
      const { a, dir } = eyeLevel(r);
      through(a, Math.atan2(dir.y, dir.x));
      for (const vp of r.vps) for (let k = 0; k < 12; k++) through(vp, (k * Math.PI) / 12, 0.22);
      break;
    }
  }
  // Direction points of a selected cubic Bezier curve.
  if (selected && 'curve' in r && r.curve === 'cubic') {
    for (let i = 0; i + 1 < r.points.length; i += 3) {
      line(r.points[i], r.points[i + 1], 0.6);
      if (i + 3 < r.points.length) line(r.points[i + 2], r.points[i + 3], 0.6);
    }
  }
  if (selected || r.kind === 'perspective' || r.kind === 'symmetry') {
    for (const h of rulerHandles(r, size)) {
      const q = P(h.at.x, h.at.y);
      ctx.fillStyle = selected ? '#ffffff' : color;
      ctx.fillRect(q.x - 4, q.y - 4, 8, 8);
      ctx.strokeRect(q.x - 4, q.y - 4, 8, 8);
    }
  }
  ctx.restore();
}

/** All rulers that apply to the current layer. */
export function drawRulers(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  const s = getState();
  const size = { w: s.doc.width, h: s.doc.height };
  for (const { ruler } of actions.activeRulers(s)) {
    const on = isSpecial(ruler) ? s.snapSpecial : s.snapRuler;
    drawRuler(ctx, view, ruler, size, on ? SNAP_ON : SNAP_OFF, s.selectedRuler?.rulerId === ruler.id);
  }
}
