/**
 * Ruler tool (create rulers), Object tool (select, move and edit them) and the ruler overlay.
 * Rulers are drawn purple while their kind of snapping is on, green while it is off.
 */
import { findLayer } from '../model/layers';
import type { Id } from '../model/types';
import {
  distanceToRuler,
  eyeLevel,
  isSpecial,
  moveHandle,
  rulerHandles,
  translateRuler,
  type Pt,
  type Ruler,
  type RulerInput,
} from '../paint/rulers';
import type { SubTool } from '../paint/tools';
import { apply as applyMatrix } from '../paint/viewMath';
import * as actions from '../store/actions';
import { getState, setState } from '../store/store';
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

/** Object tool: select a ruler, drag its handles or the ruler itself. */
export function objectSession(p: PointerInfo, view: OverlayView): ToolSession | null {
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

/** Ruler tool: drag to create the sub tool's ruler; dragging a handle edits an existing one. */
export function rulerSession(sub: SubTool, p: PointerInfo, view: OverlayView): ToolSession | null {
  const hit = hitHandle(p, view);
  if (hit) return new HandleSession(hit);
  if (actions.editBlocker() === 'No layer selected') return null;
  if (sub.rulerKind === 'perspective') {
    addVanishingPoint(p);
    return null;
  }
  return new CreateRulerSession(sub, p);
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
  ctx.save();
  ctx.lineWidth = selected ? 1.5 : 1;
  ctx.strokeStyle = color;
  switch (r.kind) {
    case 'linear':
      line(r.a, r.b);
      break;
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
