/**
 * Object tool on a track with keyframes (or a 2D camera folder): a box over the output frame (the
 * canvas) as placed at the current frame. Drag inside to move, a corner to scale (⇧ frees the
 * aspect ratio), the round handle above to rotate (⇧ in 15° steps), the centre point to move the
 * centre of rotation. Releasing records a keyframe at the current frame. For a 2D camera folder the
 * box is the camera frame (field guides).
 */
import { isCameraFolder } from '../model/animation';
import { applyAffine, movePivot, placedCorners, placementMatrix, type Placement } from '../paint/keyframes';
import { apply as applyMatrix } from '../paint/viewMath';
import { engine } from '../engine/engine';
import * as anim from '../store/animationActions';
import { getState, setState } from '../store/store';
import type { Layer } from '../model/types';
import type { Modifiers, OverlayView, PointerInfo, ToolSession } from './types';

const HANDLE_PX = 8;
const ROTATE_PX = 22;

type KeyHandle = { kind: 'scale'; corner: number } | { kind: 'rotate' } | { kind: 'pivot' } | { kind: 'move' };

/** The track the Object tool places (keyframes on, or a 2D camera folder), or null. */
export function keyframeTarget(): Layer | null {
  const s = getState();
  if (!s.doc.timeline?.enabled || s.editKeyed) return null;
  return anim.keyTrack(s);
}

interface Frame {
  corners: { x: number; y: number }[];
  pivot: { x: number; y: number };
}

function frameOf(p: Placement): Frame {
  const { width, height } = getState().doc;
  return { corners: placedCorners(p, width, height), pivot: applyAffine(placementMatrix(p), p.pivotX, p.pivotY) };
}

/** Screen position of the rotation handle: above the middle of the top edge. */
function rotateHandle(f: Frame, view: OverlayView): { x: number; y: number } {
  const top = applyMatrix(view.matrix, (f.corners[0].x + f.corners[1].x) / 2, (f.corners[0].y + f.corners[1].y) / 2);
  const mid = applyMatrix(view.matrix, (f.corners[0].x + f.corners[2].x) / 2, (f.corners[0].y + f.corners[2].y) / 2);
  const len = Math.hypot(top.x - mid.x, top.y - mid.y);
  const dir = len > 1e-6 ? { x: (top.x - mid.x) / len, y: (top.y - mid.y) / len } : { x: 0, y: -1 };
  return { x: top.x + dir.x * ROTATE_PX, y: top.y + dir.y * ROTATE_PX };
}

/** Whether a point lies in the (convex) placed box. */
function inside(f: Frame, x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = f.corners[i];
    const b = f.corners[(i + 1) % 4];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

function hitKeyHandle(p: PointerInfo, view: OverlayView, f: Frame): KeyHandle | null {
  const pv = applyMatrix(view.matrix, f.pivot.x, f.pivot.y);
  if (Math.hypot(pv.x - p.sx, pv.y - p.sy) <= HANDLE_PX) return { kind: 'pivot' };
  for (let corner = 0; corner < 4; corner++) {
    const q = applyMatrix(view.matrix, f.corners[corner].x, f.corners[corner].y);
    if (Math.abs(q.x - p.sx) <= HANDLE_PX && Math.abs(q.y - p.sy) <= HANDLE_PX) return { kind: 'scale', corner };
  }
  const r = rotateHandle(f, view);
  if (Math.hypot(r.x - p.sx, r.y - p.sy) <= HANDLE_PX) return { kind: 'rotate' };
  return inside(f, p.x, p.y) ? { kind: 'move' } : null;
}

/** Moves, scales or rotates a track's placement at the current frame; releasing records the keyframe. */
class KeyframeSession implements ToolSession {
  private placement: Placement;
  private last: PointerInfo;
  private moved = false;
  readonly cursor: string;

  constructor(
    private track: Layer,
    private handle: KeyHandle,
    private start: PointerInfo,
    private base: Placement,
  ) {
    this.placement = base;
    this.last = start;
    this.cursor = handle.kind === 'move' ? 'move' : handle.kind === 'rotate' ? 'alias' : handle.kind === 'pivot' ? 'crosshair' : 'nwse-resize';
  }

  private compute(p: PointerInfo, m: Modifiers): Placement {
    const b = this.base;
    const centre = { x: b.pivotX + b.x, y: b.pivotY + b.y };
    switch (this.handle.kind) {
      case 'move': {
        let dx = p.x - this.start.x;
        let dy = p.y - this.start.y;
        if (m.shift) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        return { ...b, x: b.x + dx, y: b.y + dy };
      }
      case 'pivot':
        return movePivot(b, b.pivotX + p.x - this.start.x, b.pivotY + p.y - this.start.y);
      case 'rotate': {
        let a = ((Math.atan2(p.y - centre.y, p.x - centre.x) - Math.atan2(this.start.y - centre.y, this.start.x - centre.x)) * 180) / Math.PI;
        if (m.shift) a = Math.round(a / 15) * 15;
        return { ...b, rotation: Math.round((b.rotation + a) * 100) / 100 };
      }
      case 'scale': {
        // In the layer's own (unrotated) directions, relative to the centre of rotation.
        const r = (-b.rotation * Math.PI) / 180;
        const local = (x: number, y: number) => ({ x: (x - centre.x) * Math.cos(r) - (y - centre.y) * Math.sin(r), y: (x - centre.x) * Math.sin(r) + (y - centre.y) * Math.cos(r) });
        const v0 = local(this.start.x, this.start.y);
        const v = local(p.x, p.y);
        let kx = Math.abs(v0.x) > 1 ? v.x / v0.x : 1;
        let ky = Math.abs(v0.y) > 1 ? v.y / v0.y : 1;
        if (!m.shift) {
          const k = (v.x * v0.x + v.y * v0.y) / Math.max(1e-6, v0.x * v0.x + v0.y * v0.y);
          kx = k;
          ky = k;
        }
        const clampScale = (s: number) => (Math.abs(s) < 0.01 ? 0.01 * (Math.sign(s) || 1) : Math.min(100, Math.max(-100, s)));
        return { ...b, scaleX: clampScale(b.scaleX * kx), scaleY: clampScale(b.scaleY * ky) };
      }
    }
  }

  private update(p: PointerInfo, m: Modifiers): void {
    if (!this.moved && Math.hypot(p.sx - this.start.sx, p.sy - this.start.sy) < 3) return;
    this.moved = true;
    this.placement = this.compute(p, m);
    engine.setKeyPreview(this.track.id, this.placement);
  }

  move(p: PointerInfo): void {
    this.last = p;
    this.update(p, p);
  }

  modifiers(m: Modifiers): void {
    this.update(this.last, m);
  }

  up(p: PointerInfo): void {
    this.update(p, p);
    engine.setKeyPreview(this.track.id, null);
    if (!this.moved) return;
    const label = this.handle.kind === 'move' ? 'Move' : this.handle.kind === 'rotate' ? 'Rotate' : this.handle.kind === 'pivot' ? 'Center of rotation' : 'Scale';
    anim.setKeyframe(this.track.id, getState().frame, this.placement, `Keyframe: ${label}`);
    setState({ keySelection: [{ track: this.track.id, frame: getState().frame }] });
  }

  cancel(): void {
    engine.setKeyPreview(this.track.id, null);
  }

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    drawKeyBox(ctx, view, this.track, this.placement);
  }
}

/** Object tool on a placed track: a session for the handle under the pointer (null: nothing there). */
export function keyframeSession(p: PointerInfo, view: OverlayView, track: Layer): ToolSession | null {
  const base = anim.placementNow(track);
  const handle = hitKeyHandle(p, view, frameOf(base));
  if (!handle) return null;
  if (isCameraFolder(track) && getState().cameraView) {
    setState({ hint: "Turn off Show camera's field of view to move the camera frame" });
    return null;
  }
  return new KeyframeSession(track, handle, p, base);
}

/** The placed box, its handles and centre of rotation (camera frame: also a cross at its centre). */
export function drawKeyBox(ctx: CanvasRenderingContext2D, view: OverlayView, track: Layer, placement?: Placement): void {
  const p = placement ?? anim.placementNow(track);
  const f = frameOf(p);
  const camera = isCameraFolder(track);
  const pts = f.corners.map((c) => applyMatrix(view.matrix, c.x, c.y));
  ctx.save();
  ctx.lineWidth = camera ? 2 : 1;
  ctx.strokeStyle = camera ? '#e0457b' : '#2f80ed';
  if (!camera) ctx.setLineDash([4, 3]);
  ctx.beginPath();
  pts.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  const topMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  const rot = rotateHandle(f, view);
  ctx.beginPath();
  ctx.moveTo(topMid.x, topMid.y);
  ctx.lineTo(rot.x, rot.y);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  for (const c of pts) {
    ctx.fillRect(c.x - 4, c.y - 4, 8, 8);
    ctx.strokeRect(c.x - 4, c.y - 4, 8, 8);
  }
  ctx.beginPath();
  ctx.arc(rot.x, rot.y, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Centre of rotation.
  const pv = applyMatrix(view.matrix, f.pivot.x, f.pivot.y);
  ctx.beginPath();
  ctx.arc(pv.x, pv.y, 5, 0, Math.PI * 2);
  ctx.moveTo(pv.x - 8, pv.y);
  ctx.lineTo(pv.x + 8, pv.y);
  ctx.moveTo(pv.x, pv.y - 8);
  ctx.lineTo(pv.x, pv.y + 8);
  ctx.stroke();
  ctx.restore();
}

/** Cursor over the placed box's handles (Object tool, no drag). */
export function keyHandleCursor(p: PointerInfo, view: OverlayView, track: Layer): string | null {
  const h = hitKeyHandle(p, view, frameOf(anim.placementNow(track)));
  if (!h) return null;
  return h.kind === 'move' ? 'move' : h.kind === 'rotate' ? 'alias' : h.kind === 'pivot' ? 'crosshair' : 'nwse-resize';
}

/** Field guides: the camera frames of the 2D camera folders the current layer lies in (camera view off). */
export function drawCameraGuides(ctx: CanvasRenderingContext2D, view: OverlayView, folders: Layer[]): void {
  for (const folder of folders) {
    const f = frameOf(anim.placementNow(folder));
    const pts = f.corners.map((c) => applyMatrix(view.matrix, c.x, c.y));
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#e0457b';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    pts.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}
