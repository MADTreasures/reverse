/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled
 * Functions", 2012): two separable passes of the 1-D lower envelope of parabolas. Pure, unit tested.
 */

const INF = 1e20;

/** 1-D squared distance transform of `f` (length n) into `d`, using scratch arrays v and z. */
function edt1d(f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array, n: number): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
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
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * Distance (in pixels) from every pixel to the nearest pixel where `inside` is true.
 * Pixels that are inside have distance 0.
 */
export function distanceToInside(inside: (i: number) => boolean, width: number, height: number): Float32Array {
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = inside(i) ? 0 : INF;
  // Columns, then rows.
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
    edt1d(f, d, v, z, height);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = grid[row + x];
    edt1d(f, d, v, z, width);
    for (let x = 0; x < width; x++) out[row + x] = Math.sqrt(d[x]);
  }
  return out;
}
