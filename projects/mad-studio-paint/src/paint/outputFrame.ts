/**
 * Animation frame lines (New > Animation frame settings): the output frame, which exports show,
 * the title-safe area inside it, the overflow frame (the whole drawing area, for camera work) and
 * the blank space around them that makes up the rest of the canvas. Pure, unit tested.
 */

export interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A canvas's animation frame lines (document px). */
export interface OutputFrame extends FrameRect {
  /** Title-safe area: margins inside the output frame. */
  safe?: Margins;
  /** Overflow frame: the area beyond the output frame meant for drawing (camera work). */
  overflow?: FrameRect;
}

/** Where the output frame lies in the overflow frame: -1 left/top, 0 middle, 1 right/bottom. */
export type RefPoint = -1 | 0 | 1;

/** The New dialog's animation frame settings. */
export interface FrameSettings {
  /** Size of output frame (px). */
  width: number;
  height: number;
  safe: Margins | null;
  overflow: {
    /** Specified scale: `w`, `h` are multiples of the output frame; else sizes in px. */
    scale: boolean;
    w: number;
    h: number;
    refX: RefPoint;
    refY: RefPoint;
    /** Moves the output frame from the reference point (px). */
    offsetX: number;
    offsetY: number;
  } | null;
  /** Around the overflow frame (or the output frame without one). */
  blank: Margins;
}

const round = Math.round;

/** The reference's defaults for an output frame size: title-safe area and blank space of about a tenth. */
export function defaultFrameSettings(width: number, height: number): FrameSettings {
  const safe = round(Math.min(width, height) * 0.0926);
  return {
    width,
    height,
    safe: { top: safe, bottom: safe, left: safe, right: safe },
    overflow: null,
    blank: { top: round(height * 0.1), bottom: round(height * 0.1), left: round(width * 0.1), right: round(width * 0.1) },
  };
}

/** The canvas size and the frame lines the settings make. */
export function layoutFrames(s: FrameSettings): { width: number; height: number; frame: OutputFrame } {
  const w = Math.max(1, round(s.width));
  const h = Math.max(1, round(s.height));
  const b = { top: Math.max(0, round(s.blank.top)), bottom: Math.max(0, round(s.blank.bottom)), left: Math.max(0, round(s.blank.left)), right: Math.max(0, round(s.blank.right)) };
  const safe = s.safe ? clampMargins(s.safe, w, h) : undefined;
  if (!s.overflow) {
    return { width: w + b.left + b.right, height: h + b.top + b.bottom, frame: { x: b.left, y: b.top, w, h, ...(safe ? { safe } : {}) } };
  }
  const o = s.overflow;
  // The overflow frame holds at least the output frame.
  const ow = Math.max(w, round(o.scale ? w * o.w : o.w));
  const oh = Math.max(h, round(o.scale ? h * o.h : o.h));
  const x = Math.min(ow - w, Math.max(0, round(((ow - w) * (o.refX + 1)) / 2 + o.offsetX)));
  const y = Math.min(oh - h, Math.max(0, round(((oh - h) * (o.refY + 1)) / 2 + o.offsetY)));
  return {
    width: ow + b.left + b.right,
    height: oh + b.top + b.bottom,
    frame: { x: b.left + x, y: b.top + y, w, h, ...(safe ? { safe } : {}), overflow: { x: b.left, y: b.top, w: ow, h: oh } },
  };
}

function clampMargins(m: Margins, w: number, h: number): Margins {
  const c = (v: number, max: number) => Math.max(0, Math.min(max, round(v)));
  const top = c(m.top, h - 1);
  const left = c(m.left, w - 1);
  return { top, bottom: c(m.bottom, h - 1 - top), left, right: c(m.right, w - 1 - left) };
}

/** The title-safe area as a rectangle. */
export const safeRect = (f: OutputFrame): FrameRect | null =>
  f.safe ? { x: f.x + f.safe.left, y: f.y + f.safe.top, w: f.w - f.safe.left - f.safe.right, h: f.h - f.safe.top - f.safe.bottom } : null;

/** What exports draw (Drawing area): the output frame, the overflow frame or the entire canvas. */
export type DrawingArea = 'output' | 'overflow' | 'canvas';

export function areaRect(frame: OutputFrame | undefined, area: DrawingArea, width: number, height: number): FrameRect {
  if (!frame || area === 'canvas') return { x: 0, y: 0, w: width, h: height };
  if (area === 'overflow' && frame.overflow) return { ...frame.overflow };
  return { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
}

/** The frame lines after the canvas changes: scaled by (sx, sy), moved by (dx, dy), kept on a w × h canvas. */
export function mapOutputFrame(f: OutputFrame, sx: number, sy: number, dx: number, dy: number, width: number, height: number): OutputFrame | undefined {
  const map = (r: FrameRect): FrameRect | null => {
    const x0 = Math.max(0, round(r.x * sx + dx));
    const y0 = Math.max(0, round(r.y * sy + dy));
    const x1 = Math.min(width, round((r.x + r.w) * sx + dx));
    const y1 = Math.min(height, round((r.y + r.h) * sy + dy));
    return x1 - x0 >= 1 && y1 - y0 >= 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  };
  const out = map(f);
  if (!out) return undefined;
  const overflow = f.overflow ? map(f.overflow) : null;
  const safe = f.safe ? clampMargins({ top: f.safe.top * sy, bottom: f.safe.bottom * sy, left: f.safe.left * sx, right: f.safe.right * sx }, out.w, out.h) : undefined;
  return { ...out, ...(safe ? { safe } : {}), ...(overflow ? { overflow } : {}) };
}

/** The output frame at a new size about its middle (a new one: in the middle of the canvas), kept on the canvas. */
export function resizeOutputFrame(f: OutputFrame | undefined, w: number, h: number, width: number, height: number): OutputFrame {
  const fw = Math.max(1, Math.min(width, round(w)));
  const fh = Math.max(1, Math.min(height, round(h)));
  const cx = f ? f.x + f.w / 2 : width / 2;
  const cy = f ? f.y + f.h / 2 : height / 2;
  const x = Math.max(0, Math.min(width - fw, round(cx - fw / 2)));
  const y = Math.max(0, Math.min(height - fh, round(cy - fh / 2)));
  const safe = f?.safe ? clampMargins(f.safe, fw, fh) : undefined;
  return { x, y, w: fw, h: fh, ...(safe ? { safe } : {}), ...(f?.overflow ? { overflow: f.overflow } : {}) };
}

// ------------------------------------------------------------------ files

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function rect(raw: unknown, width: number, height: number): FrameRect | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const [x, y, w, h] = [n(r.x), n(r.y), n(r.w), n(r.h)];
  if (x === null || y === null || w === null || h === null) return null;
  const x0 = Math.max(0, Math.min(width - 1, round(x)));
  const y0 = Math.max(0, Math.min(height - 1, round(y)));
  return { x: x0, y: y0, w: Math.max(1, Math.min(width - x0, round(w))), h: Math.max(1, Math.min(height - y0, round(h))) };
}

/** Frame lines from a file, kept on the canvas. */
export function sanitizeOutputFrame(raw: unknown, width: number, height: number): OutputFrame | undefined {
  const r = rect(raw, width, height);
  if (!r) return undefined;
  const x = raw as Record<string, unknown>;
  const overflow = rect(x.overflow, width, height);
  const s = x.safe && typeof x.safe === 'object' ? (x.safe as Record<string, unknown>) : null;
  const safe = s ? clampMargins({ top: n(s.top) ?? 0, bottom: n(s.bottom) ?? 0, left: n(s.left) ?? 0, right: n(s.right) ?? 0 }, r.w, r.h) : undefined;
  return { ...r, ...(safe ? { safe } : {}), ...(overflow ? { overflow } : {}) };
}
