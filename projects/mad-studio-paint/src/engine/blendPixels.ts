/**
 * Per-pixel blending for the modes Canvas 2D does not provide. Works on straight-alpha RGBA
 * (as returned by getImageData). Pure, unit tested.
 *
 * Compositing follows the W3C model: result = αs·(1−αb)·Cs + αs·αb·B(Cb, Cs) + (1−αs)·αb·Cb,
 * with αo = αs + αb·(1−αs). Glow dodge adds without the αs lerp (stronger on soft pixels).
 */
import type { BlendMode } from '../model/types';

type Channel = (cb: number, cs: number) => number;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

const SEPARABLE: Partial<Record<BlendMode, Channel>> = {
  'linear-burn': (b, s) => clamp01(b + s - 1),
  subtract: (b, s) => clamp01(b - s),
  add: (b, s) => clamp01(b + s),
  'vivid-light': (b, s) => {
    if (s <= 0.5) return s <= 0 ? (b >= 1 ? 1 : 0) : clamp01(1 - (1 - b) / (2 * s));
    return s >= 1 ? (b <= 0 ? 0 : 1) : clamp01(b / (2 * (1 - s)));
  },
  'linear-light': (b, s) => clamp01(b + 2 * s - 1),
  'pin-light': (b, s) => (s >= 0.5 ? Math.max(b, 2 * s - 1) : Math.min(b, 2 * s)),
  'hard-mix': (b, s) => (b + s >= 1 - 1e-9 ? 1 : 0),
  divide: (b, s) => (s <= 0 ? 1 : clamp01(b / s)),
};

const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;

/** Modes handled here (everything else is drawn by the canvas). */
export const PIXEL_MODES: BlendMode[] = ['linear-burn', 'subtract', 'glow-dodge', 'add', 'vivid-light', 'linear-light', 'pin-light', 'hard-mix', 'darker-color', 'lighter-color', 'divide'];

/** Blends `src` onto `dst` in place with the given mode and layer opacity (0..1). Arrays must match in size. */
export function blendInto(dst: Uint8ClampedArray, src: Uint8ClampedArray, mode: BlendMode, opacity = 1): void {
  const sep = SEPARABLE[mode];
  const out = [0, 0, 0];
  for (let i = 0; i < dst.length; i += 4) {
    const as = (src[i + 3] / 255) * opacity;
    if (as <= 0) continue;
    const ab = dst[i + 3] / 255;
    const cbr = dst[i] / 255;
    const cbg = dst[i + 1] / 255;
    const cbb = dst[i + 2] / 255;
    const csr = src[i] / 255;
    const csg = src[i + 1] / 255;
    const csb = src[i + 2] / 255;
    if (mode === 'glow-dodge') {
      // Dodge by the colour weighted with its own alpha; no lerp, so soft pixels glow strongly.
      const g = (cb: number, cs: number) => (as * cs >= 1 ? (cb > 0 ? 1 : 0) : clamp01(cb / (1 - as * cs)));
      out[0] = g(cbr, csr);
      out[1] = g(cbg, csg);
      out[2] = g(cbb, csb);
      const ao = as + ab * (1 - as);
      for (let k = 0; k < 3; k++) {
        const cs = k === 0 ? csr : k === 1 ? csg : csb;
        dst[i + k] = Math.round(((as * (1 - ab) * cs + ab * out[k]) / ao) * 255);
      }
      dst[i + 3] = Math.round(ao * 255);
      continue;
    }
    if (sep) {
      out[0] = sep(cbr, csr);
      out[1] = sep(cbg, csg);
      out[2] = sep(cbb, csb);
    } else if (mode === 'darker-color' || mode === 'lighter-color') {
      const sDark = lum(csr, csg, csb) < lum(cbr, cbg, cbb);
      const useSrc = mode === 'darker-color' ? sDark : !sDark;
      out[0] = useSrc ? csr : cbr;
      out[1] = useSrc ? csg : cbg;
      out[2] = useSrc ? csb : cbb;
    } else {
      out[0] = csr;
      out[1] = csg;
      out[2] = csb;
    }
    const ao = as + ab * (1 - as);
    const cs = [csr, csg, csb];
    const cb = [cbr, cbg, cbb];
    for (let k = 0; k < 3; k++) {
      const co = as * (1 - ab) * cs[k] + as * ab * out[k] + (1 - as) * ab * cb[k];
      dst[i + k] = Math.round((co / ao) * 255);
    }
    dst[i + 3] = Math.round(ao * 255);
  }
}
