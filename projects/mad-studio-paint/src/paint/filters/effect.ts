/**
 * Filter > Effect: Artistic, Chromatic aberration, Crystallize, Mosaic, Noise, Normal map,
 * Pencil drawing, Remove jpeg noise, Retro film. Our own models of the documented settings.
 */
import {
  clamp,
  createImg,
  gaussianBlur,
  hash2,
  luma,
  premultiply,
  sample,
  smoothstep,
  unpremultiply,
  type Float,
  type Img,
} from './core';

/** Mosaic: square tiles of `size` pixels from the canvas origin, each its average colour. */
export function mosaic(src: Img, ox: number, oy: number, size: number): Img {
  const s = Math.max(1, size);
  const { width: w, height: h, data } = src;
  const pre = premultiply(src);
  const tile = (v: number) => Math.floor(v / s);
  const tx0 = tile(ox);
  const ty0 = tile(oy);
  const tw = tile(ox + w - 1) - tx0 + 1;
  const th = tile(oy + h - 1) - ty0 + 1;
  const acc = new Float64Array(tw * th * 5);
  for (let y = 0; y < h; y++) {
    const ty = tile(oy + y) - ty0;
    for (let x = 0; x < w; x++) {
      const q = (ty * tw + tile(ox + x) - tx0) * 5;
      const p = (y * w + x) * 4;
      acc[q] += pre.f[p];
      acc[q + 1] += pre.f[p + 1];
      acc[q + 2] += pre.f[p + 2];
      acc[q + 3] += pre.f[p + 3];
      acc[q + 4] += 1;
    }
  }
  const out: Float = { f: new Float32Array(data.length), w, h };
  for (let y = 0; y < h; y++) {
    const ty = tile(oy + y) - ty0;
    for (let x = 0; x < w; x++) {
      const q = (ty * tw + tile(ox + x) - tx0) * 5;
      const p = (y * w + x) * 4;
      const n = acc[q + 4];
      out.f[p] = acc[q] / n;
      out.f[p + 1] = acc[q + 1] / n;
      out.f[p + 2] = acc[q + 2] / n;
      out.f[p + 3] = acc[q + 3] / n;
    }
  }
  return unpremultiply(out);
}

/**
 * Crystallize: cells around jittered grid points (Voronoi), each filled with its average colour.
 * Randomness 0 gives a regular grid; Tiling makes the pattern repeat across the canvas edges.
 */
export function crystallize(src: Img, ox: number, oy: number, canvasW: number, canvasH: number, size: number, randomness: number, tiling: boolean, seed: number): Img {
  const { width: w, height: h } = src;
  const pre = premultiply(src);
  // With tiling the cell size is adjusted so a whole number of cells fits the canvas.
  const cols = tiling ? Math.max(1, Math.round(canvasW / size)) : 0;
  const rows = tiling ? Math.max(1, Math.round(canvasH / size)) : 0;
  const sx = tiling ? canvasW / cols : size;
  const sy = tiling ? canvasH / rows : size;
  const jitter = clamp(randomness, 0, 100) / 100;
  const wrap = (v: number, n: number) => (tiling ? ((v % n) + n) % n : v);
  const seedPoint = (i: number, j: number): [number, number] => {
    const wi = wrap(i, cols);
    const wj = wrap(j, rows);
    const jx = (hash2(wi, wj, seed) - 0.5) * jitter;
    const jy = (hash2(wi, wj, seed + 7919) - 0.5) * jitter;
    // Wrapped cells sit a whole canvas away.
    return [(i + 0.5 + jx) * sx, (j + 0.5 + jy) * sy];
  };
  const owner = new Int32Array(w * h * 2);
  const cells = new Map<number, number[]>();
  const key = (i: number, j: number) => (tiling ? wrap(j, rows) * 65536 + wrap(i, cols) : (j + 2) * 65536 + i + 2);
  for (let y = 0; y < h; y++) {
    const ly = oy + y + 0.5;
    const cj = Math.floor(ly / sy);
    for (let x = 0; x < w; x++) {
      const lx = ox + x + 0.5;
      const ci = Math.floor(lx / sx);
      let best = Infinity;
      let bi = ci;
      let bj = cj;
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (let i = ci - 1; i <= ci + 1; i++) {
          const [px, py] = seedPoint(i, j);
          const d = (px - lx) ** 2 + (py - ly) ** 2;
          if (d < best) (best = d), (bi = i), (bj = j);
        }
      }
      const p = (y * w + x) * 2;
      owner[p] = bi;
      owner[p + 1] = bj;
      const k = key(bi, bj);
      let acc = cells.get(k);
      if (!acc) cells.set(k, (acc = [0, 0, 0, 0, 0]));
      const q = (y * w + x) * 4;
      acc[0] += pre.f[q];
      acc[1] += pre.f[q + 1];
      acc[2] += pre.f[q + 2];
      acc[3] += pre.f[q + 3];
      acc[4] += 1;
    }
  }
  const out: Float = { f: new Float32Array(w * h * 4), w, h };
  for (let i = 0; i < w * h; i++) {
    const acc = cells.get(key(owner[i * 2], owner[i * 2 + 1]))!;
    for (let c = 0; c < 4; c++) out.f[i * 4 + c] = acc[c] / acc[4];
  }
  return unpremultiply(out);
}

/**
 * Noise: adds film-like grain to the colours (transparent pixels stay transparent). Color gives
 * each channel its own grain, Gray the same for all three.
 */
export function noise(src: Img, ox: number, oy: number, strength: number, gray: boolean, seed: number): Img {
  const out = createImg(src.width, src.height);
  const d = src.data;
  const o = out.data;
  const amp = (clamp(strength, 0, 100) / 100) * 160;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const p = (y * src.width + x) * 4;
      o[p + 3] = d[p + 3];
      if (d[p + 3] === 0) continue;
      const gx = ox + x;
      const gy = oy + y;
      // A triangular distribution (sum of two uniforms) looks like grain.
      const n0 = (hash2(gx, gy, seed) + hash2(gx, gy, seed + 1) - 1) * amp;
      for (let c = 0; c < 3; c++) {
        const n = gray ? n0 : (hash2(gx, gy, seed + 2 + c * 2) + hash2(gx, gy, seed + 3 + c * 2) - 1) * amp;
        o[p + c] = d[p + c] + n;
      }
    }
  }
  return out;
}

/**
 * Chromatic aberration: red and blue drift apart. Radial: they scale away from / towards the
 * centre (up to 3 % of the distance at intensity 100); Lateral: they shift by up to 12 px along the
 * angle.
 */
export function chromaticAberration(src: Img, ox: number, oy: number, cx: number, cy: number, radial: boolean, intensity: number, angle: number): Img {
  const pre = premultiply(src);
  const k = clamp(intensity, 0, 100) / 100;
  const a = (angle * Math.PI) / 180;
  const sx = Math.cos(a) * 12 * k;
  const sy = -Math.sin(a) * 12 * k;
  const s = 0.03 * k;
  const out: Float = { f: new Float32Array(pre.f.length), w: pre.w, h: pre.h };
  const r = new Float32Array(4);
  const b = new Float32Array(4);
  for (let y = 0; y < pre.h; y++) {
    for (let x = 0; x < pre.w; x++) {
      const lx = ox + x + 0.5;
      const ly = oy + y + 0.5;
      if (radial) {
        sample(pre, cx + (lx - cx) / (1 + s) - ox, cy + (ly - cy) / (1 + s) - oy, 'clamp', r);
        sample(pre, cx + (lx - cx) / (1 - s) - ox, cy + (ly - cy) / (1 - s) - oy, 'clamp', b);
      } else {
        sample(pre, x + 0.5 - sx, y + 0.5 - sy, 'clamp', r);
        sample(pre, x + 0.5 + sx, y + 0.5 + sy, 'clamp', b);
      }
      const p = (y * pre.w + x) * 4;
      const ga = pre.f[p + 3];
      const alpha = Math.max(r[3], ga, b[3]);
      out.f[p] = r[0];
      out.f[p + 1] = pre.f[p + 1];
      out.f[p + 2] = b[2];
      out.f[p + 3] = alpha;
    }
  }
  return unpremultiply(out);
}

/** Height for normal maps and pencil drawings: brightness where opaque, 0 where transparent. */
function heights(src: Img): Float32Array {
  const d = src.data;
  const out = new Float32Array(src.width * src.height);
  for (let i = 0; i < out.length; i++) out[i] = (luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) / 255) * (d[i * 4 + 3] / 255);
  return out;
}

/** Sobel gradient of a single-channel image (edges repeat). */
function sobel(v: Float32Array, w: number, h: number, x: number, y: number): [number, number] {
  const at = (xx: number, yy: number) => v[clamp(yy, 0, h - 1) * w + clamp(xx, 0, w - 1)];
  const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
  const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
  return [gx / 4, gy / 4];
}

/**
 * Normal map: brightness is height; the normal of that surface is stored as colour (x → red,
 * y → green, z → blue). Y up suits OpenGL, Y down DirectX. The result is opaque.
 */
export function normalMap(src: Img, strength: number, yUp: boolean): Img {
  const { width: w, height: h } = src;
  const hgt = heights(src);
  const out = createImg(w, h);
  const k = 1 + (clamp(strength, 0, 100) / 100) * 30;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [gx, gy] = sobel(hgt, w, h, x, y);
      let nx = -gx * k;
      // Image rows grow downwards: for Y up the green channel points up the image.
      let ny = (yUp ? gy : -gy) * k;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const p = (y * w + x) * 4;
      out.data[p] = (nx * 0.5 + 0.5) * 255;
      out.data[p + 1] = (ny * 0.5 + 0.5) * 255;
      out.data[p + 2] = (nz * 0.5 + 0.5) * 255;
      out.data[p + 3] = 255;
    }
  }
  return out;
}

/** Brightness of the image over white paper, 0..1. */
function paperGray(src: Img): Float32Array {
  const d = src.data;
  const out = new Float32Array(src.width * src.height);
  for (let i = 0; i < out.length; i++) {
    const a = d[i * 4 + 3] / 255;
    out[i] = (luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) / 255) * a + (1 - a);
  }
  return out;
}

/** Edge strength 0..1 from the Sobel gradient of a slightly blurred brightness. */
function edges(gray: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const f = new Float32Array(w * h * 4);
  for (let i = 0; i < gray.length; i++) f[i * 4] = f[i * 4 + 3] = gray[i] * 255;
  const soft = gaussianBlur({ f, w, h }, sigma);
  const g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = soft.f[i * 4] / 255;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [gx, gy] = sobel(g, w, h, x, y);
      out[y * w + x] = Math.hypot(gx, gy);
    }
  }
  return out;
}

export interface PencilOptions {
  outline: boolean;
  hatching: boolean;
  size: number;
  roughness: number;
  angle: number;
  grayscale: boolean;
}

/**
 * Pencil drawing: pencil outlines along the edges and hatching whose strokes thicken in dark
 * areas. Without grayscale output the paper takes on the image's colours.
 */
export function pencilDrawing(src: Img, ox: number, oy: number, o: PencilOptions, seed: number): Img {
  const { width: w, height: h, data } = src;
  const gray = paperGray(src);
  const edge = o.outline ? edges(gray, w, h, 0.8) : null;
  const spacing = Math.max(2, o.size * 2);
  const a = (o.angle * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = -Math.sin(a);
  const rough = clamp(o.roughness, 0, 100) / 100;
  const out = createImg(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const gx = ox + x;
      const gy = oy + y;
      let ink = 0;
      if (o.hatching) {
        // Distance across the strokes, wobbled along them by the roughness.
        const along = gx * ux + gy * uy;
        const across = -gx * uy + gy * ux + (hash2(Math.floor(along / 6), Math.floor((-gx * uy + gy * ux) / spacing), seed) - 0.5) * rough * spacing;
        const t = Math.abs(((across / spacing) % 1) + 1) % 1;
        const tri = Math.abs(t - 0.5) * 2;
        const dark = 1 - gray[i];
        ink = Math.max(ink, smoothstep(1 - dark * 1.1, 1 - dark * 1.1 + 0.25, tri) * (0.55 + 0.35 * hash2(gx, gy, seed + 3)));
      }
      if (edge) ink = Math.max(ink, smoothstep(0.06, 0.3, edge[i]) * 0.85);
      const p = i * 4;
      const paper = 1 - ink;
      if (o.grayscale) {
        out.data[p] = out.data[p + 1] = out.data[p + 2] = paper * 255;
      } else {
        // Colour pencil: the image's colour, lightened like a wash, darkened by the strokes.
        const al = data[p + 3] / 255;
        for (let c = 0; c < 3; c++) {
          const tint = (data[p + c] * al + 255 * (1 - al)) * 0.55 + 255 * 0.45;
          out.data[p + c] = tint * paper;
        }
      }
      out.data[p + 3] = data[p + 3];
    }
  }
  return out;
}

/**
 * Remove jpeg noise: an edge-preserving (bilateral) smoothing over 5 × 5 pixels that evens out
 * the speckles around edges and the 8 × 8 blocks while keeping the edges themselves.
 */
export function removeJpegNoise(src: Img): Img {
  const { width: w, height: h, data } = src;
  const out = createImg(w, h);
  const spatial: number[] = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) spatial.push(Math.exp(-(dx * dx + dy * dy) / (2 * 1.5 * 1.5)));
  // Colour distance weights, looked up in steps of 16 (squared distances up to 4 · 255²).
  const lut = new Float64Array((4 * 255 * 255) / 16 + 1);
  for (let i = 0; i < lut.length; i++) lut[i] = Math.exp((-i * 16) / (2 * 18 * 18));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const r0 = data[p];
      const g0 = data[p + 1];
      const b0 = data[p + 2];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let sum = 0;
      let s = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = clamp(y + dy, 0, h - 1);
        for (let dx = -2; dx <= 2; dx++, s++) {
          const q = (yy * w + clamp(x + dx, 0, w - 1)) * 4;
          const dc = (data[q] - r0) ** 2 + (data[q + 1] - g0) ** 2 + (data[q + 2] - b0) ** 2 + (data[q + 3] - data[p + 3]) ** 2;
          const k = spatial[s] * lut[dc >> 4];
          r += data[q] * k;
          g += data[q + 1] * k;
          b += data[q + 2] * k;
          a += data[q + 3] * k;
          sum += k;
        }
      }
      out.data[p] = r / sum;
      out.data[p + 1] = g / sum;
      out.data[p + 2] = b / sum;
      out.data[p + 3] = a / sum;
    }
  }
  return out;
}

export type ArtisticProcess = 'colorLines' | 'colorOnly' | 'linesOnly';

export interface ArtisticOptions {
  process: ArtisticProcess;
  lineWidth: number;
  lineSimplicity: number;
  lineDensity: number;
  lineOpacity: number;
  lineAntialias: number;
  colorBlending: number;
  colorBlur: number;
  colors: number;
}

/**
 * Artistic: colours flattened like paint (edge-preserving blending, blur, a limited number of
 * levels per channel) and/or extracted dark lines along the edges.
 */
export function artistic(src: Img, o: ArtisticOptions): Img {
  const { width: w, height: h } = src;
  let colour: Img = src;
  const withColour = o.process !== 'linesOnly';
  const withLines = o.process !== 'colorOnly';
  if (withColour) {
    for (let i = 0; i < Math.round(clamp(o.colorBlending, 0, 100) / 25); i++) colour = removeJpegNoise(colour);
    if (o.colorBlur > 0) colour = unpremultiply(gaussianBlur(premultiply(colour), (clamp(o.colorBlur, 0, 100) / 100) * 4));
    const levels = clamp(Math.round(o.colors), 2, 64);
    const step = 255 / (levels - 1);
    const d = colour === src ? src.data.slice() : colour.data;
    for (let p = 0; p < d.length; p += 4) for (let c = 0; c < 3; c++) d[p + c] = Math.round(d[p + c] / step) * step;
    colour = { data: d, width: w, height: h };
  }
  if (!withLines) return colour;
  const gray = paperGray(src);
  const edge = edges(gray, w, h, 0.6 + (clamp(o.lineSimplicity, 0, 100) / 100) * 2.4);
  // Density lowers the threshold (more lines); width thickens them; anti-aliasing softens their edge.
  const threshold = 0.3 - (clamp(o.lineDensity, 0, 100) / 100) * 0.26;
  const soft = 0.01 + (clamp(o.lineAntialias, 0, 100) / 100) * 0.12;
  let line = new Float32Array(w * h);
  for (let i = 0; i < line.length; i++) line[i] = smoothstep(threshold - soft, threshold + soft, edge[i]);
  for (let pass = 1; pass < Math.round(clamp(o.lineWidth, 1, 10)); pass++) {
    const grown = new Float32Array(line.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let m = line[y * w + x];
        if (x > 0) m = Math.max(m, line[y * w + x - 1]);
        if (x < w - 1) m = Math.max(m, line[y * w + x + 1]);
        if (y > 0) m = Math.max(m, line[(y - 1) * w + x]);
        if (y < h - 1) m = Math.max(m, line[(y + 1) * w + x]);
        grown[y * w + x] = m;
      }
    line = grown;
  }
  const opacity = clamp(o.lineOpacity, 0, 100) / 100;
  const out = createImg(w, h);
  const base = withColour ? colour.data : null;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const k = line[i] * opacity;
    if (base) {
      // Lines darken the paint (they are the paint's colour, much darker).
      for (let c = 0; c < 3; c++) out.data[p + c] = base[p + c] * (1 - k * 0.85);
      out.data[p + 3] = Math.max(base[p + 3], k * 255);
    } else {
      // Lines only: dark lines on transparency.
      out.data[p] = out.data[p + 1] = out.data[p + 2] = 24;
      out.data[p + 3] = k * 255;
    }
  }
  return out;
}

export type RetroPreset = 'vintage' | 'modern' | 'warm';
export type RetroEffect = 'none' | 'sepia' | 'leakSlant' | 'leakAll' | 'sepiaLeakSlant' | 'sepiaLeakAll';

/** The settings each Retro film preset selects (our own values). */
export const RETRO_PRESETS: Record<RetroPreset, { effect: RetroEffect; intensity: number; noise: number }> = {
  vintage: { effect: 'sepiaLeakSlant', intensity: 20, noise: 40 },
  modern: { effect: 'leakSlant', intensity: 60, noise: 20 },
  warm: { effect: 'sepiaLeakAll', intensity: 0, noise: 0 },
};

/** Retro film: sepia and/or an orange light leak, radial chromatic aberration and grain. */
export function retroFilm(src: Img, ox: number, oy: number, canvasW: number, canvasH: number, cx: number, cy: number, effect: RetroEffect, intensity: number, noiseStrength: number, seed: number): Img {
  let img = intensity > 0 ? chromaticAberration(src, ox, oy, cx, cy, true, intensity, 0) : { ...src, data: src.data.slice() };
  const sepia = effect === 'sepia' || effect === 'sepiaLeakSlant' || effect === 'sepiaLeakAll';
  const leak = effect === 'leakSlant' || effect === 'sepiaLeakSlant' ? 'slant' : effect === 'leakAll' || effect === 'sepiaLeakAll' ? 'all' : null;
  const d = img.data;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const p = (y * img.width + x) * 4;
      if (d[p + 3] === 0) continue;
      let r = d[p];
      let g = d[p + 1];
      let b = d[p + 2];
      if (sepia) {
        const l = luma(r, g, b);
        r = r * 0.25 + Math.min(255, l * 1.07 + 18) * 0.75;
        g = g * 0.25 + l * 0.88 * 0.75 + 4;
        b = b * 0.25 + l * 0.66 * 0.75;
      }
      if (leak) {
        // Orange light from the right (all) or the bottom right corner (slant), added like Screen.
        const u = (ox + x) / canvasW;
        const v = (oy + y) / canvasH;
        const t = leak === 'all' ? smoothstep(0.15, 1, u) : smoothstep(0.55, 1.6, u + v);
        const lr = 255 * t * 0.9;
        const lg = 140 * t * 0.9;
        const lb = 40 * t * 0.9;
        r = 255 - ((255 - r) * (255 - lr)) / 255;
        g = 255 - ((255 - g) * (255 - lg)) / 255;
        b = 255 - ((255 - b) * (255 - lb)) / 255;
      }
      d[p] = r;
      d[p + 1] = g;
      d[p + 2] = b;
    }
  }
  if (noiseStrength > 0) img = noise(img, ox, oy, noiseStrength * 0.6, true, seed);
  return img;
}
