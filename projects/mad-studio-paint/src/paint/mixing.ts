/**
 * Ink > Color mixing: brushes pick up the colours they pass over. Our own model of the documented
 * behaviour: "Blend" keeps mixing what it picks up into the paint it carries; "Running color" mixes
 * only the drawing colour with the colour under each dab. Pure, unit tested.
 */

/** Colour 0..255 with alpha 0..1. */
export interface Paint {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * How much of the drawing colour a dab keeps at `distance` px into the stroke: the pure colour at
 * the start, settling to `paintAmount` over a distance set by Color stretch (relative to the size).
 */
export function amountAt(distance: number, size: number, stretch: number, paintAmount: number): number {
  if (stretch <= 0) return paintAmount;
  const reach = Math.max(1, stretch * size * 6);
  return paintAmount + (1 - paintAmount) * Math.exp(-distance / reach);
}

/** Mixes `under` into `paint`: `keep` of the paint's colour stays, weighted by how opaque `under` is. */
export function mixInto(paint: Paint, under: Paint, keep: number): Paint {
  const w = (1 - keep) * under.a;
  const sum = keep + w;
  if (sum <= 0) return { ...paint };
  return {
    r: (paint.r * keep + under.r * w) / sum,
    g: (paint.g * keep + under.g * w) / sum,
    b: (paint.b * keep + under.b * w) / sum,
    a: paint.a,
  };
}

/** Opacity factor of a dab: `density` 1 paints fully, 0 takes over the transparency under the brush. */
export const densityFactor = (underAlpha: number, density: number) => density + (1 - density) * underAlpha;

/**
 * Colour of the next dab and the paint carried afterwards.
 * Running color: drawing colour + colour under the dab (nothing is carried along).
 * Blend: the carried paint picks up the colour under the dab and keeps it for the next dabs.
 */
export function nextDab(mode: 'blend' | 'running', brush: Paint, carried: Paint, under: Paint, keep: number): { color: Paint; carried: Paint } {
  if (mode === 'running') return { color: mixInto(brush, under, keep), carried };
  const next = mixInto(carried, under, keep);
  return { color: next, carried: next };
}
