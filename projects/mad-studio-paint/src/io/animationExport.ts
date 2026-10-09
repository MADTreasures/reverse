/**
 * File > Export animation: animated GIF (through gifenc, MIT; palette, dithering and transparency
 * are our own), animated PNG (APNG, own encoder; optionally reduced to 256 colours with alpha and
 * cropped to the drawn area) and image sequences (files in a ZIP). Pure (no DOM): frames come in as
 * straight RGBA.
 */
import { zipSync, zlibSync } from 'fflate';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { pngChunk as chunk } from './png';
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

/** PNG scanlines of an indexed image (filter None, as recommended for palettes). */
function indexedScanlines(index: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) out.set(index.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  return out;
}

/** One palette with alpha (at most 256 entries) for all frames, and each frame's palette indices. */
function reduceColors(frames: Pixels[]): { palette: Palette; indices: Uint8Array[] } {
  const total = frames.reduce((n, f) => n + f.width * f.height, 0);
  const stride = Math.max(1, Math.floor(total / 1_000_000));
  const sample: number[] = [];
  for (const f of frames) {
    for (let i = 0; i < f.width * f.height; i += stride) {
      const o = i * 4;
      sample.push(f.data[o], f.data[o + 1], f.data[o + 2], f.data[o + 3]);
    }
  }
  const palette = quantize(new Uint8Array(sample), 256, { format: 'rgba4444' });
  // applyPalette reads the whole buffer as 32-bit pixels.
  const own = (d: Uint8ClampedArray) => (d.byteOffset === 0 && d.byteLength === d.buffer.byteLength ? d : d.slice());
  return { palette, indices: frames.map((f) => applyPalette(own(f.data), palette, 'rgba4444')) };
}

/**
 * An animated PNG: every frame replaces the whole image; `plays` 0 = endlessly. `colors`: Color
 * reduction (an indexed image of 256 colours with transparency: smaller files).
 */
export function encodeApng(frames: Pixels[], delays: number[], plays: number, colors = false): Uint8Array {
  const { width, height } = frames[0];
  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  const ihdr = new Uint8Array(13);
  ihdr.set(u32s(width, height));
  const reduced = colors ? reduceColors(frames) : null;
  // 8 bits; RGBA (6) or indexed (3).
  ihdr.set([8, reduced ? 3 : 6, 0, 0, 0], 8);
  parts.push(chunk('IHDR', ihdr));
  if (reduced) {
    parts.push(chunk('PLTE', new Uint8Array(reduced.palette.flatMap((c) => [c[0], c[1], c[2]]))));
    // Alpha per entry (trailing opaque entries may be left out).
    const alphas = reduced.palette.map((c) => c[3] ?? 255);
    while (alphas.length && alphas[alphas.length - 1] === 255) alphas.pop();
    if (alphas.length) parts.push(chunk('tRNS', new Uint8Array(alphas)));
  }
  parts.push(chunk('acTL', u32s(frames.length, plays)));
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
    const data = zlibSync(reduced ? indexedScanlines(reduced.indices[k], width, height) : scanlines(f), { level: 6 });
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

/** The images in a ZIP: stored when they are compressed already (PNG, JPEG, WebP), else deflated. */
export function zipSequence(files: { name: string; data: Uint8Array }[], compress = false): Uint8Array {
  const level = compress ? 6 : 0;
  return zipSync(Object.fromEntries(files.map((f) => [f.name, [f.data, { level }] as [Uint8Array, { level: 0 | 6 }]])));
}

// ------------------------------------------------------------------ blank space

/**
 * Delete blank spaces: the smallest rectangle that holds every drawn (not fully transparent) pixel
 * of all frames, or null when nothing is drawn.
 */
export function drawnArea(frames: Pixels[]): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (const f of frames) {
    for (let y = 0; y < f.height; y++) {
      for (let x = 0, i = y * f.width * 4 + 3; x < f.width; x++, i += 4) {
        if (f.data[i] === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** A rectangle of a picture. */
export function cropPixels(p: Pixels, r: { x: number; y: number; w: number; h: number }): Pixels {
  const data = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) data.set(p.data.subarray(((r.y + y) * p.width + r.x) * 4, ((r.y + y) * p.width + r.x + r.w) * 4), y * r.w * 4);
  return { width: r.w, height: r.h, data };
}
