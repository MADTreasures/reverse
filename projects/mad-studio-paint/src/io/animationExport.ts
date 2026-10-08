/**
 * File > Export animation: animated GIF (through gifenc, MIT; palette, dithering and transparency
 * are our own), animated PNG (APNG, own encoder) and image sequences (PNG files in a ZIP). Pure (no
 * DOM): frames come in as straight RGBA.
 */
import { zipSync, zlibSync } from 'fflate';
import { GIFEncoder, quantize } from 'gifenc';
import type { Pixels } from './psd';

/**
 * The timeline frames the exported images show when `start…end` (played at `timelineFps`) is
 * exported at `fps`: the playing time stays the same, so a lower rate skips frames.
 */
export function exportFrames(start: number, end: number, timelineFps: number, fps: number): number[] {
  const count = end - start + 1;
  const n = Math.max(1, Math.round((count * fps) / timelineFps));
  return Array.from({ length: n }, (_, k) => start + Math.min(count - 1, Math.floor((k * timelineFps) / fps + 1e-9)));
}

/** Frame delays in `unit` ms steps that add up to the exact playing time (no drift). */
export function frameDelays(n: number, fps: number, unit = 10): number[] {
  const at = (k: number) => Math.round((k * 1000) / fps / unit);
  return Array.from({ length: n }, (_, k) => (at(k + 1) - at(k)) * unit);
}

// ------------------------------------------------------------------ GIF

type Palette = number[][];

/** Nearest palette colour for an RGB value, cached per 15-bit colour. */
function nearestIndexer(palette: Palette, first: number): (r: number, g: number, b: number) => number {
  const cache = new Int16Array(32768).fill(-1);
  return (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let best = cache[key];
    if (best >= 0) return best;
    let dist = Infinity;
    for (let i = first; i < palette.length; i++) {
      const p = palette[i];
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    cache[key] = best;
    return best;
  };
}

/** One palette for all frames (no flicker between them), from a sample of their opaque pixels. */
function sharedPalette(frames: Pixels[], colors: number): Palette {
  const total = frames.reduce((n, f) => n + f.width * f.height, 0);
  const stride = Math.max(1, Math.floor(total / 1_000_000));
  const sample: number[] = [];
  for (const f of frames) {
    for (let i = 0; i < f.width * f.height; i += stride) {
      const o = i * 4;
      if (f.data[o + 3] >= 128) sample.push(f.data[o], f.data[o + 1], f.data[o + 2], 255);
    }
  }
  if (sample.length === 0) sample.push(0, 0, 0, 255);
  return quantize(new Uint8Array(sample), colors);
}

export interface GifOptions {
  /** Delay of each frame in ms. */
  delays: number[];
  /** Times the animation plays (0: endlessly). */
  plays: number;
  /** Keep transparent pixels transparent (1-bit). */
  transparent: boolean;
  /** Floyd–Steinberg dithering. */
  dither: boolean;
}

export function encodeGif(frames: Pixels[], opts: GifOptions): Uint8Array {
  const { width, height } = frames[0];
  // Transparency takes palette entry 0.
  const first = opts.transparent ? 1 : 0;
  const palette = [...(opts.transparent ? [[0, 0, 0]] : []), ...sharedPalette(frames, 256 - first)];
  const nearest = nearestIndexer(palette, first);
  const gif = GIFEncoder();
  const index = new Uint8Array(width * height);
  const err = opts.dither ? new Float32Array(width * height * 3) : null;
  frames.forEach((f, k) => {
    err?.fill(0);
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++, i++) {
        const o = i * 4;
        if (opts.transparent && f.data[o + 3] < 128) {
          index[i] = 0;
          continue;
        }
        let r = f.data[o];
        let g = f.data[o + 1];
        let b = f.data[o + 2];
        if (err) {
          r = Math.min(255, Math.max(0, r + err[i * 3]));
          g = Math.min(255, Math.max(0, g + err[i * 3 + 1]));
          b = Math.min(255, Math.max(0, b + err[i * 3 + 2]));
        }
        const p = nearest(r | 0, g | 0, b | 0);
        index[i] = p;
        if (err) {
          const c = palette[p];
          const er = r - c[0];
          const eg = g - c[1];
          const eb = b - c[2];
          const spread = (dx: number, dy: number, w: number) => {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || xx >= width || yy >= height) return;
            const j = (yy * width + xx) * 3;
            err[j] += er * w;
            err[j + 1] += eg * w;
            err[j + 2] += eb * w;
          };
          spread(1, 0, 7 / 16);
          spread(-1, 1, 3 / 16);
          spread(0, 1, 5 / 16);
          spread(1, 1, 1 / 16);
        }
      }
    }
    gif.writeFrame(index, width, height, {
      ...(k === 0 ? { palette } : {}),
      delay: opts.delays[k] ?? 100,
      transparent: opts.transparent,
      transparentIndex: 0,
      // NETSCAPE loop count = repeats after the first play; none = play once.
      repeat: opts.plays === 0 ? 0 : opts.plays === 1 ? -1 : opts.plays - 1,
    });
  });
  gif.finish();
  return gif.bytes();
}

// ------------------------------------------------------------------ APNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function u32s(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v));
  return out;
}

/** PNG scanlines of an RGBA image, each row with the filter (None, Sub or Up) that leaves the smallest values. */
function scanlines(p: Pixels): Uint8Array {
  const row = p.width * 4;
  const out = new Uint8Array((row + 1) * p.height);
  const cand = [new Uint8Array(row), new Uint8Array(row), new Uint8Array(row)];
  for (let y = 0; y < p.height; y++) {
    const cur = p.data.subarray(y * row, (y + 1) * row);
    const up = y > 0 ? p.data.subarray((y - 1) * row, y * row) : null;
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 3; f++) {
      const c = cand[f];
      let sum = 0;
      for (let i = 0; i < row; i++) {
        const v = f === 0 ? cur[i] : f === 1 ? cur[i] - (i >= 4 ? cur[i - 4] : 0) : cur[i] - (up ? up[i] : 0);
        c[i] = v;
        const s = c[i];
        sum += s < 128 ? s : 256 - s;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    out[y * (row + 1)] = best;
    out.set(cand[best], y * (row + 1) + 1);
  }
  return out;
}

/** An animated PNG: every frame replaces the whole image; `plays` 0 = endlessly. */
export function encodeApng(frames: Pixels[], delays: number[], plays: number): Uint8Array {
  const { width, height } = frames[0];
  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  const ihdr = new Uint8Array(13);
  ihdr.set(u32s(width, height));
  ihdr.set([8, 6, 0, 0, 0], 8);
  parts.push(chunk('IHDR', ihdr), chunk('acTL', u32s(frames.length, plays)));
  let seq = 0;
  frames.forEach((f, k) => {
    const fc = new Uint8Array(26);
    const view = new DataView(fc.buffer);
    view.setUint32(0, seq++);
    view.setUint32(4, width);
    view.setUint32(8, height);
    view.setUint32(12, 0);
    view.setUint32(16, 0);
    view.setUint16(20, Math.max(0, Math.min(65535, Math.round(delays[k] ?? 100))));
    view.setUint16(22, 1000);
    // Dispose: none; blend: source (the frame replaces what was there).
    fc[24] = 0;
    fc[25] = 0;
    parts.push(chunk('fcTL', fc));
    const data = zlibSync(scanlines(f), { level: 6 });
    if (k === 0) parts.push(chunk('IDAT', data));
    else {
      const fd = new Uint8Array(4 + data.length);
      new DataView(fd.buffer).setUint32(0, seq++);
      fd.set(data, 4);
      parts.push(chunk('fdAT', fd));
    }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ------------------------------------------------------------------ image sequence

/** File names like the reference's: prefix, separator, sequence number (zero-padded), suffix. */
export function sequenceNames(count: number, opts: { prefix: string; suffix: string; separator: string; start: number; ext: string }): string[] {
  const digits = Math.max(4, String(opts.start + count - 1).length);
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '');
  return Array.from({ length: count }, (_, i) => {
    const parts = [clean(opts.prefix), String(opts.start + i).padStart(digits, '0'), clean(opts.suffix)].filter(Boolean);
    return `${parts.join(opts.separator)}.${opts.ext}`;
  });
}

/** The images in a ZIP (stored: PNG and JPEG are compressed already). */
export function zipSequence(files: { name: string; data: Uint8Array }[]): Uint8Array {
  return zipSync(Object.fromEntries(files.map((f) => [f.name, [f.data, { level: 0 }] as [Uint8Array, { level: 0 }]])));
}
