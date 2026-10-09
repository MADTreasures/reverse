/**
 * Object tool on a track with keyframes (or a 2D camera folder): a box over the output frame (the
 * canvas) as placed at the current frame (see placementBox.ts for its handles). Releasing records
 * what changed (moving: the position; a corner: the scale ratio; …) in the keyframe at the current
 * frame. For a 2D camera folder the box is the camera frame (field guides).
 */
import { isCameraFolder } from '../model/animation';
import { changedChannels, type Placement } from '../paint/keyframes';
import { apply as applyMatrix } from '../paint/viewMath';
import { engine } from '../engine/engine';
import * as anim from '../store/animationActions';
import { getState, setState } from '../store/store';
import type { Layer } from '../model/types';
import { boxCursor, boxOf, dragPlacement, drawBox, hitBox, type BoxHandle } from './placementBox';
import type { Modifiers, OverlayView, PointerInfo, ToolSession } from './types';

const CAMERA = '#e0457b';

/** The track the Object tool places (keyframes on, or a 2D camera folder), or null. */
export function keyframeTarget(): Layer | null {
  const s = getState();
  if (!s.doc.timeline?.enabled || s.editKeyed) return null;
  return anim.keyTrack(s);
}

const canvasRect = () => ({ x: 0, y: 0, w: getState().doc.width, h: getState().doc.height });

/** Moves, scales or rotates a track's placement at the current frame; releasing records the keyframe. */
class KeyframeSession implements ToolSession {
  private placement: Placement;
  private last: PointerInfo;
  private moved = false;
  readonly cursor: string;

  constructor(
    private track: Layer,
    private handle: BoxHandle,
    private start: PointerInfo,
    private base: Placement,
  ) {
    this.placement = base;
    this.last = start;
    this.cursor = boxCursor(handle);
  }

  private update(p: PointerInfo, m: Modifiers): void {
    if (!this.moved && Math.hypot(p.sx - this.start.sx, p.sy - this.start.sy) < 3) return;
    this.moved = true;
    this.placement = dragPlacement(this.base, this.handle, this.start, p, m);
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
    anim.setKeyframe(this.track.id, getState().frame, this.placement, `Keyframe: ${label}`, undefined, false, changedChannels(this.base, this.placement));
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
  const handle = hitBox(p, view, boxOf(base, canvasRect()));
  if (!handle) return null;
  if (isCameraFolder(track) && getState().cameraView) {
    setState({ hint: "Turn off Show camera's field of view to move the camera frame" });
    return null;
  }
  return new KeyframeSession(track, handle, p, base);
}

/** The placed box over the output frame (for a 2D camera folder: the camera frame). */
export function drawKeyBox(ctx: CanvasRenderingContext2D, view: OverlayView, track: Layer, placement?: Placement): void {
  const camera = isCameraFolder(track);
  drawBox(ctx, view, boxOf(placement ?? anim.placementNow(track), canvasRect()), camera ? { color: CAMERA, width: 2 } : { color: '#2f80ed', dashed: true });
}

/** Cursor over the placed box's handles (Object tool, no drag). */
export function keyHandleCursor(p: PointerInfo, view: OverlayView, track: Layer): string | null {
  const h = hitBox(p, view, boxOf(anim.placementNow(track), canvasRect()));
  return h ? boxCursor(h) : null;
}

/** Field guides: the camera frames of the 2D camera folders the current layer lies in (camera view off). */
export function drawCameraGuides(ctx: CanvasRenderingContext2D, view: OverlayView, folders: Layer[]): void {
  for (const folder of folders) {
    const b = boxOf(anim.placementNow(folder), canvasRect());
    const pts = b.corners.map((c) => applyMatrix(view.matrix, c.x, c.y));
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = CAMERA;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    pts.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}
