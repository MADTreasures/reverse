/** Color conversions. RGB channels are 0..255, h is 0..360, s/v/l are 0..1. */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface HSV {
  h: number;
  s: number;
  v: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function rgbToHsv({ r, g, b }: RGB, fallbackHue = 0): HSV {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = fallbackHue;
  if (d > 0) {
    if (max === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const p = (x: number) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`;
}

/** Accepts #rgb, #rrggbb (with or without #). Returns null for anything else. */
export function hexToRgb(hex: string): RGB | null {
  let s = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const hsvToHex = (hsv: HSV) => rgbToHex(hsvToRgb(hsv));

/** Pushes a color to the front of a history list without duplicates. */
export function pushHistory(history: string[], hex: string, max = 24): string[] {
  const key = hex.toLowerCase();
  return [key, ...history.filter((c) => c !== key)].slice(0, max);
}
