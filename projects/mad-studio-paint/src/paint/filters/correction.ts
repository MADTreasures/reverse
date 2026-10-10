/**
 * Filter > Correction: Remove dust and Adjust line width, for scanned or drawn line art. Our own
 * models: dust is a connected group of pixels no larger than the dust size; line width changes
 * with an exact Euclidean distance transform.
 */
import { clamp, createImg, type Img } from './core';

const INF = 1e20;

/** 1D squared distance transform of f (lower envelope of parabolas), with the index of the nearest site. */
function dt1(f: Float64Array, n: number, d: Float64Array, at: Int32Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    if (f[q] >= INF) continue;
    if (f[v[k]] >= INF) {
      v[k] = q;
      continue;
    }
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = f[v[k]] >= INF ? INF : dq * dq + f[v[k]];
    at[q] = v[k];
  }
}

/**
 * Squared distance from every pixel to the nearest site (sites[i] = 1) and the index of that
 * site (−1 without any site). Felzenszwalb & Huttenlocher's linear-time transform.
 */
export function distanceTransform(sites: Uint8Array, w: number, h: number): { d2: Float64Array; nearest: Int32Array } {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const at = new Int32Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const col = new Float64Array(w * h);
  const colRow = new Int32Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = sites[y * w + x] ? 0 : INF;
    dt1(f, h, d, at, v, z);
    for (let y = 0; y < h; y++) {
      col[y * w + x] = d[y];
      colRow[y * w + x] = at[y];
    }
  }
  const d2 = new Float64Array(w * h);
  const nearest = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = col[y * w + x];
    dt1(f, w, d, at, v, z);
    for (let x = 0; x < w; x++) {
      d2[y * w + x] = d[x];
      const nx = at[x];
      nearest[y * w + x] = d[x] >= INF ? -1 : colRow[y * w + nx] * w + nx;
    }
  }
  return { d2, nearest };
}

/**
 * Adjust line width: Thicken grows the lines by `amount` pixels in the colour of the nearest
 * line pixel; Narrow shrinks them, keeping their middle line with "At least 1 pixel".
 */
export function adjustLineWidth(src: Img, thicken: boolean, amount: number, keepOne: boolean): Img {
  const { width: w, height: h, data } = src;
  const r = clamp(amount, 0, 100);
  const out = createImg(w, h);
  out.data.set(data);
  const line = new Uint8Array(w * h);
  for (let i = 0; i < line.length; i++) line[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  if (thicken) {
    const { d2, nearest } = distanceTransform(line, w, h);
    for (let i = 0; i < line.length; i++) {
      if (line[i] || nearest[i] < 0) continue;
      const cover = clamp(r + 1 - Math.sqrt(d2[i]), 0, 1);
      if (cover <= 0) continue;
      const s = nearest[i] * 4;
      const p = i * 4;
      const a = cover * data[s + 3];
      if (a <= data[p + 3]) continue;
      out.data[p] = data[s];
      out.data[p + 1] = data[s + 1];
      out.data[p + 2] = data[s + 2];
      out.data[p + 3] = a;
    }
    return out;
  }
  const background = new Uint8Array(w * h);
  for (let i = 0; i < line.length; i++) background[i] = line[i] ? 0 : 1;
  const { d2 } = distanceTransform(background, w, h);
  const dist = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : Math.sqrt(d2[y * w + x]));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!line[i]) {
        // Faint edge pixels go with the edge.
        if (r >= 0.5) out.data[i * 4 + 3] = 0;
        continue;
      }
      const d = dist(x, y);
      const keep = clamp(d - r, 0, 1);
      if (keep >= 1) continue;
      // The middle line: at least as far from the edge as both neighbours on one axis.
      const ridge = keepOne && ((d >= dist(x - 1, y) && d >= dist(x + 1, y)) || (d >= dist(x, y - 1) && d >= dist(x, y + 1)));
      if (ridge) continue;
      out.data[i * 4 + 3] = data[i * 4 + 3] * keep;
    }
  }
  return out;
}

export type DustMode = 'transparent' | 'white' | 'fillSurrounding' | 'fillColor';

/**
 * Remove dust: groups of connected pixels (8 neighbours) no larger than `size` in either
 * direction are dust. From transparency: small opaque spots are erased. From white background:
 * small non-white spots turn white. The fill modes close small transparent gaps inside opaque
 * areas with the surrounding colour or the drawing colour.
 */
export function removeDust(src: Img, size: number, mode: DustMode, color: [number, number, number]): Img {
  const { width: w, height: h, data } = src;
  const out = createImg(w, h);
  out.data.set(data);
  const isWhite = (p: number) => data[p + 3] === 0 || (data[p + 3] > 200 && Math.min(data[p], data[p + 1], data[p + 2]) >= 235);
  const member = new Uint8Array(w * h);
  for (let i = 0; i < member.length; i++) {
    const p = i * 4;
    if (mode === 'transparent') member[i] = data[p + 3] > 0 ? 1 : 0;
    else if (mode === 'white') member[i] = isWhite(p) ? 0 : 1;
    else member[i] = data[p + 3] < 255 ? 1 : 0;
  }
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const group: number[] = [];
  const limit = Math.max(1, size);
  for (let start = 0; start < member.length; start++) {
    if (!member[start] || seen[start]) continue;
    // Flood the group, tracking its bounds; stop collecting once it is too big to be dust.
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    group.length = 0;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    let touchesEdge = false;
    while (top > 0) {
      const i = stack[--top];
      const x = i % w;
      const y = (i / w) | 0;
      group.push(i);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (member[j] && !seen[j]) {
            seen[j] = 1;
            stack[top++] = j;
          }
        }
      }
    }
    if (x1 - x0 + 1 > limit || y1 - y0 + 1 > limit) continue;
    const fill = mode === 'fillSurrounding' || mode === 'fillColor';
    // A transparent gap that reaches the canvas edge is not enclosed.
    if (fill && touchesEdge) continue;
    let rgb: [number, number, number] = color;
    if (mode === 'fillSurrounding') rgb = surroundingColor(data, w, h, group, member);
    for (const i of group) {
      const p = i * 4;
      if (mode === 'transparent') {
        out.data[p] = out.data[p + 1] = out.data[p + 2] = out.data[p + 3] = 0;
      } else if (mode === 'white') {
        out.data[p] = out.data[p + 1] = out.data[p + 2] = out.data[p + 3] = 255;
      } else {
        out.data[p] = rgb[0];
        out.data[p + 1] = rgb[1];
        out.data[p + 2] = rgb[2];
        out.data[p + 3] = 255;
      }
    }
  }
  return out;
}

/** The most common colour (in 16 levels per channel, averaged within) around a group of pixels. */
function surroundingColor(data: Uint8ClampedArray, w: number, h: number, group: number[], member: Uint8Array): [number, number, number] {
  const counts = new Map<number, [number, number, number, number]>();
  for (const i of group) {
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (member[j]) continue;
        const p = j * 4;
        const key = ((data[p] >> 4) << 8) | ((data[p + 1] >> 4) << 4) | (data[p + 2] >> 4);
        const c = counts.get(key) ?? [0, 0, 0, 0];
        c[0]++;
        c[1] += data[p];
        c[2] += data[p + 1];
        c[3] += data[p + 2];
        counts.set(key, c);
      }
    }
  }
  let best: [number, number, number, number] | null = null;
  for (const c of counts.values()) if (!best || c[0] > best[0]) best = c;
  if (!best) return [0, 0, 0];
  return [Math.round(best[1] / best[0]), Math.round(best[2] / best[0]), Math.round(best[3] / best[0])];
}
