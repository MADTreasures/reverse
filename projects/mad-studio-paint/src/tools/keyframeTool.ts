/**
 * Object tool on a track with keyframes (or a 2D camera folder): a box over the output frame (the
 * canvas) as placed at the current frame (see placementBox.ts for its handles). Releasing records
 * what changed (moving: the position; a corner: the scale ratio; …) in the keyframe at the current
 * frame. For a 2D camera folder the box is the camera frame (field guides); with the track's layer
 * mask selected, the box places the mask within the (placed) layer.
 */
import { isCameraFolder, maskTrackId, outputRect } from '../model/animation';
import { applyAffine, changedChannels, invert, placementMatrix, type Placement } from '../paint/keyframes';
import type { Affine } from '../paint/rulers';
import { apply as applyMatrix } from '../paint/viewMath';
import { engine } from '../engine/engine';
import * as anim from '../store/animationActions';
import { getState, setState } from '../store/store';
import type { Layer } from '../model/types';
import { boxCursor, boxOf, dragPlacement, drawBox, hitBox, type Box, type BoxHandle } from './placementBox';
import type { Modifiers, OverlayView, PointerInfo, ToolSession } from './types';

const CAMERA = '#e0457b';
const MASK = '#9b6bd6';

/** The track the Object tool places (keyframes on, or a 2D camera folder), or null. */
export function keyframeTarget(): Layer | null {
  const s = getState();
  if (!s.doc.timeline?.enabled || s.editKeyed) return null;
  return anim.keyTrack(s);
}

/** The output frame the boxes lie over (the whole canvas without animation frame lines). */
const canvasRect = () => outputRect(getState().doc);

/** What the Object tool places on a track: the track itself, or its layer mask within the placed layer. */
interface Target {
  /** Keyframe track id (a mask's: maskTrackId). */
  id: string;
  mask: boolean;
  /** The placement at the current frame. */
  base: Placement;
  /** Layer → document (masks: the layer's own placement), or null. */
  outer: Affine | null;
}

function targetOf(track: Layer): Target {
  if (anim.maskKeyed()?.id === track.id) return { id: maskTrackId(track.id), mask: true, base: anim.maskPlacementNow(track), outer: placementMatrix(anim.placementNow(track)) };
  return { id: track.id, mask: false, base: anim.placementNow(track), outer: null };
}

/** The placed box in document space. */
function boxFor(p: Placement, outer: Affine | null): Box {
  const b = boxOf(p, canvasRect());
  if (!outer) return b;
  const map = (q: { x: number; y: number }) => applyAffine(outer, q.x, q.y);
  return { corners: b.corners.map(map), pivot: map(b.pivot) };
}

/** Moves, scales or rotates a track's (or its mask's) placement at the current frame; releasing records the keyframe. */
class KeyframeSession implements ToolSession {
  private placement: Placement;
  private last: PointerInfo;
  private moved = false;
  private base: Placement;
  /** Document → the space the placement lives in. */
  private inner: Affine | null;
  readonly cursor: string;

  constructor(
    private track: Layer,
    private target: Target,
    private handle: BoxHandle,
    private start: PointerInfo,
  ) {
    this.base = target.base;
    this.placement = target.base;
    this.inner = target.outer ? invert(target.outer) : null;
    this.last = start;
    this.cursor = boxCursor(handle);
  }

  private local(p: { x: number; y: number }): { x: number; y: number } {
    return this.inner ? applyAffine(this.inner, p.x, p.y) : p;
  }

  private update(p: PointerInfo, m: Modifiers): void {
    if (!this.moved && Math.hypot(p.sx - this.start.sx, p.sy - this.start.sy) < 3) return;
    this.moved = true;
    this.placement = dragPlacement(this.base, this.handle, this.local(this.start), this.local(p), m);
    engine.setKeyPreview(this.target.id, this.placement);
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
    engine.setKeyPreview(this.target.id, null);
    if (!this.moved) return;
    const label = this.handle.kind === 'move' ? 'Move' : this.handle.kind === 'rotate' ? 'Rotate' : this.handle.kind === 'pivot' ? 'Center of rotation' : 'Scale';
    anim.setKeyframe(this.target.id, getState().frame, this.placement, `Keyframe: ${this.target.mask ? 'Mask ' : ''}${label}`, undefined, false, changedChannels(this.base, this.placement));
    setState({ keySelection: [{ track: this.target.id, frame: getState().frame }] });
  }

  cancel(): void {
    engine.setKeyPreview(this.target.id, null);
  }

  overlay(ctx: CanvasRenderingContext2D, view: OverlayView): void {
    drawKeyBox(ctx, view, this.track, this.placement);
  }
}

/** Object tool on a placed track (or its mask): a session for the handle under the pointer (null: nothing there). */
export function keyframeSession(p: PointerInfo, view: OverlayView, track: Layer): ToolSession | null {
  const target = targetOf(track);
  const handle = hitBox(p, view, boxFor(target.base, target.outer));
  if (!handle) return null;
  if (isCameraFolder(track) && getState().cameraView) {
    setState({ hint: "Turn off Show camera's field of view to move the camera frame" });
    return null;
  }
  return new KeyframeSession(track, target, handle, p);
}

/** The placed box over the output frame (for a 2D camera folder: the camera frame; a selected mask: the mask in the layer). */
export function drawKeyBox(ctx: CanvasRenderingContext2D, view: OverlayView, track: Layer, placement?: Placement): void {
  const t = targetOf(track);
  const style = isCameraFolder(track) ? { color: CAMERA, width: 2 } : t.mask ? { color: MASK, dashed: true } : { color: '#2f80ed', dashed: true };
  drawBox(ctx, view, boxFor(placement ?? t.base, t.outer), style);
}

/** Cursor over the placed box's handles (Object tool, no drag). */
export function keyHandleCursor(p: PointerInfo, view: OverlayView, track: Layer): string | null {
  const t = targetOf(track);
  const h = hitBox(p, view, boxFor(t.base, t.outer));
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
