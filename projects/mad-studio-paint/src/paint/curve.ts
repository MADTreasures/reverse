/** Smooth curves through control points (tone curves, pen pressure graphs). Pure, unit tested. */

export type CurvePoint = [number, number];

/**
 * Monotone cubic Hermite interpolation (Fritsch–Carlson) through the points: smooth, and without
 * overshoot between points. Points are sorted; duplicate x keep the first. Flat outside the points.
 */
export function monotoneCurve(points: CurvePoint[]): (x: number) => number {
  const pts = [...points].sort((a, b) => a[0] - b[0]).filter((p, i, all) => i === 0 || p[0] > all[i - 1][0]);
  if (pts.length === 0) return (x) => x;
  if (pts.length === 1) return () => pts[0][1];
  const n = pts.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  // Limit the tangents so each piece stays monotone.
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts[n - 1][0]) return pts[n - 1][1];
    let i = 0;
    while (x > pts[i + 1][0]) i++;
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = x1 - x0;
    const t = (x - x0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[i + 1];
  };
}

/** Pen pressure graphs work on 0..1. */
export const LINEAR: CurvePoint[] = [
  [0, 0],
  [1, 1],
];

const isLinear = (c: CurvePoint[] | undefined) => !c || c.length < 2 || (c.length === 2 && c[0][0] === 0 && c[0][1] === 0 && c[1][0] === 1 && c[1][1] === 1);

const cache = new WeakMap<CurvePoint[], (x: number) => number>();

/** Evaluates a 0..1 pressure graph (cached per points array), clamped to 0..1. */
export function evalPressureCurve(curve: CurvePoint[] | undefined, x: number): number {
  const v = Math.min(1, Math.max(0, x));
  if (isLinear(curve)) return v;
  let f = cache.get(curve!);
  if (!f) {
    f = monotoneCurve(curve!);
    cache.set(curve!, f);
  }
  return Math.min(1, Math.max(0, f(v)));
}

/**
 * "Stronger" / "Lighter" in the pen pressure settings: bends the graph so the same pressure gives
 * more (or less) output. `amount` > 0 is stronger.
 */
export function bendCurve(curve: CurvePoint[], amount: number): CurvePoint[] {
  const pts = curve.length >= 2 ? curve : LINEAR;
  const inner = pts.filter(([x]) => x > 0 && x < 1);
  const base = inner.length ? inner : [[0.5, 0.5] as CurvePoint];
  const bent = base.map(([x, y]) => [x, Math.min(0.98, Math.max(0.02, y + amount * Math.sin(Math.PI * x) * 0.5))] as CurvePoint);
  return [[0, pts[0][1]], ...bent, [1, pts[pts.length - 1][1]]];
}

/** Validates a pressure graph read from storage: 2–16 points inside 0..1, or null. */
export function sanitizeCurve01(raw: unknown): CurvePoint[] | null {
  if (!Array.isArray(raw)) return null;
  const pts = raw
    .slice(0, 16)
    .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)))
    .map(([x, y]) => [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))] as CurvePoint);
  return pts.length >= 2 ? pts : null;
}

/**
 * "Adjust from drawing": a graph that maps the 10th / 50th / 90th percentile of the pressures the
 * user drew with to 0.1 / 0.5 / 0.9, so their natural range uses the whole scale.
 */
export function curveFromSamples(samples: number[]): CurvePoint[] | null {
  if (samples.length < 20) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  const pts: CurvePoint[] = [
    [0, 0],
    [q(0.1), 0.1],
    [q(0.5), 0.5],
    [q(0.9), 0.9],
    [1, 1],
  ];
  // Keep it increasing.
  return pts.filter((p, i) => i === 0 || p[0] > pts[i - 1][0] + 0.01);
}
