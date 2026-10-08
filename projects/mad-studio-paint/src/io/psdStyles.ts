/**
 * Photoshop layer styles ↔ our layer effects: stroke ↔ border effect (edge) or a text's edge,
 * colour overlay ↔ layer colour, drop shadow, inner shadow, outer and inner glow ↔ our layer styles.
 * Bevel and emboss, satin, gradient overlays and further strokes, fills and shadows are kept and
 * written back, but not shown. Pure.
 */
import type { Color, LayerEffectInnerGlow, LayerEffectShadow, LayerEffectsInfo, LayerEffectsOuterGlow, LayerEffectSolidFill, LayerEffectStroke, UnitsValue } from 'ag-psd';
import { hexToRgb, rgbToHex } from '../model/color';
import { DEFAULT_BORDER, type LayerEffects } from '../paint/effects';
import { sanitizeKeptStyles, type GlowStyle, type ShadowStyle } from '../paint/styles';

/** sRGB colour of a Photoshop colour record (other colour models: black). */
export function colorHex(c: Color | undefined): string {
  if (c && 'r' in c) return rgbToHex({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) });
  if (c && 'fr' in c) return rgbToHex({ r: Math.round(c.fr * 255), g: Math.round(c.fg * 255), b: Math.round(c.fb * 255) });
  if (c && 'k' in c && !('c' in c)) return rgbToHex({ r: Math.round(255 - c.k * 2.55), g: Math.round(255 - c.k * 2.55), b: Math.round(255 - c.k * 2.55) });
  return '#000000';
}

export const psdColor = (hex: string): Color => {
  const c = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  return { r: c.r, g: c.g, b: c.b };
};

const px = (value: number): UnitsValue => ({ units: 'Pixels', value: Math.round(value * 100) / 100 });

/** A length in px (points and other units through the resolution). */
function length(v: UnitsValue | undefined, dpi: number, fallback = 0): number {
  if (!v || !Number.isFinite(v.value)) return fallback;
  switch (v.units) {
    case 'Points':
      return (v.value * dpi) / 72;
    case 'Millimeters':
      return (v.value * dpi) / 25.4;
    case 'Centimeters':
      return (v.value * dpi) / 2.54;
    case 'Inches':
      return v.value * dpi;
    case 'Picas':
      return (v.value * dpi) / 6;
    default:
      return v.value;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const percent = (v: number | undefined, fallback: number) => clamp(Math.round((v ?? fallback) * 100), 0, 100);
/** Spread and choke come as "pixels" that hold a percentage. */
const spreadOf = (v: UnitsValue | undefined) => clamp(v && Number.isFinite(v.value) ? v.value : 0, 0, 100);

export interface StylesIn {
  effects?: LayerEffects;
  /** Text layers: the stroke becomes the letters' edge. */
  edge?: { width: number; color: string };
  notes: string[];
}

/** Our effects for a Photoshop layer's styles (`text`: its stroke edges the letters). */
export function fromPsdEffects(fx: LayerEffectsInfo | undefined, dpi: number, text = false): StylesIn {
  const out: LayerEffects = {};
  const notes: string[] = [];
  if (!fx) return { notes };
  const off = fx.disabled === true;
  const on = (e: { enabled?: boolean } | undefined) => !off && e?.enabled !== false;
  const kept: Record<string, unknown> = {};
  let edge: StylesIn['edge'];

  const strokes = fx.stroke ?? [];
  const stroke = strokes[0];
  if (stroke && (stroke.fillType ?? 'color') === 'color') {
    const width = clamp(length(stroke.size, dpi, 3), 0.5, 100);
    if (text) {
      if (on(stroke)) edge = { width, color: colorHex(stroke.color) };
    } else {
      out.border = { ...DEFAULT_BORDER, enabled: on(stroke), kind: 'edge', width, color: colorHex(stroke.color) };
      if (stroke.position && stroke.position !== 'outside') notes.push('Strokes inside or on the edge are shown outside it');
    }
  }
  const moreStrokes = strokes.filter((s) => s !== stroke || (s.fillType ?? 'color') !== 'color');
  if (moreStrokes.length) kept.extraStrokes = moreStrokes;

  const fills = fx.solidFill ?? [];
  if (fills[0]) {
    const color = colorHex(fills[0].color);
    // Every pixel in the colour (light ones too), like a colour overlay.
    out.layerColor = { enabled: on(fills[0]), color, sub: color };
    if ((fills[0].opacity ?? 1) < 0.99) notes.push('Colour overlays are shown fully opaque');
  }
  if (fills.length > 1) kept.extraFills = fills.slice(1);

  const shadow = (s: LayerEffectShadow): ShadowStyle => ({
    enabled: on(s),
    color: colorHex(s.color),
    opacity: percent(s.opacity, 0.75),
    angle: clamp(s.angle ?? 120, -360, 360),
    distance: clamp(length(s.distance, dpi, 5), 0, 1000),
    size: clamp(length(s.size, dpi, 5), 0, 250),
    spread: spreadOf(s.choke),
  });
  const glow = (g: LayerEffectsOuterGlow | LayerEffectInnerGlow): GlowStyle => ({
    enabled: on(g),
    color: colorHex(g.color),
    opacity: percent(g.opacity, 0.75),
    size: clamp(length(g.size, dpi, 5), 0, 250),
    spread: spreadOf(g.choke),
  });
  if (fx.dropShadow?.[0]) out.dropShadow = shadow(fx.dropShadow[0]);
  if ((fx.dropShadow?.length ?? 0) > 1) kept.extraDropShadows = fx.dropShadow!.slice(1);
  if (fx.innerShadow?.[0]) out.innerShadow = shadow(fx.innerShadow[0]);
  if ((fx.innerShadow?.length ?? 0) > 1) kept.extraInnerShadows = fx.innerShadow!.slice(1);
  if (fx.outerGlow) out.outerGlow = glow(fx.outerGlow);
  if (fx.innerGlow) out.innerGlow = glow(fx.innerGlow);

  if (fx.bevel) kept.bevel = fx.bevel;
  if (fx.satin) kept.satin = fx.satin;
  if (fx.gradientOverlay?.length) kept.gradientOverlay = fx.gradientOverlay;
  if (fx.patternOverlay) notes.push('Pattern overlays were left out');
  const safe = sanitizeKeptStyles(kept);
  if (safe) {
    out.kept = safe;
    notes.push('Bevel and emboss, satin and gradient overlays are kept for Photoshop but not shown');
  }
  return { effects: Object.keys(out).length ? out : undefined, edge, notes };
}

const flags = (enabled: boolean) => ({ present: true, showInDialog: true, enabled });

/** Photoshop layer styles for our effects (`edge`: a text's edge as its first stroke). */
export function toPsdEffects(fx: LayerEffects | undefined, edge?: { width: number; color: string }): LayerEffectsInfo | undefined {
  const out: LayerEffectsInfo = {};
  const kept = (fx?.kept ?? {}) as Record<string, unknown>;
  const list = <T>(key: string) => (Array.isArray(kept[key]) ? (kept[key] as T[]) : []);
  const stroke = (enabled: boolean, width: number, color: string): LayerEffectStroke => ({
    ...flags(enabled),
    size: px(width),
    position: 'outside',
    fillType: 'color',
    blendMode: 'normal',
    opacity: 1,
    color: psdColor(color),
  });
  const strokes: LayerEffectStroke[] = [];
  if (edge && edge.width > 0) strokes.push(stroke(true, edge.width, edge.color));
  if (fx?.border && fx.border.kind === 'edge') strokes.push(stroke(fx.border.enabled, fx.border.width, fx.border.color));
  strokes.push(...list<LayerEffectStroke>('extraStrokes'));
  if (strokes.length) out.stroke = strokes;

  const fills: LayerEffectSolidFill[] = [];
  if (fx?.layerColor) fills.push({ ...flags(fx.layerColor.enabled), blendMode: 'normal', color: psdColor(fx.layerColor.color), opacity: 1 });
  fills.push(...list<LayerEffectSolidFill>('extraFills'));
  if (fills.length) out.solidFill = fills;

  const shadow = (s: ShadowStyle): LayerEffectShadow => ({
    ...flags(s.enabled),
    size: px(s.size),
    angle: s.angle,
    distance: px(s.distance),
    color: psdColor(s.color),
    blendMode: 'normal',
    opacity: s.opacity / 100,
    useGlobalLight: false,
    choke: px(s.spread),
  });
  const glow = (g: GlowStyle) => ({ ...flags(g.enabled), size: px(g.size), color: psdColor(g.color), blendMode: 'normal' as const, opacity: g.opacity / 100, choke: px(g.spread) });
  const drop = [...(fx?.dropShadow ? [shadow(fx.dropShadow)] : []), ...list<LayerEffectShadow>('extraDropShadows')];
  if (drop.length) out.dropShadow = drop;
  const inner = [...(fx?.innerShadow ? [shadow(fx.innerShadow)] : []), ...list<LayerEffectShadow>('extraInnerShadows')];
  if (inner.length) out.innerShadow = inner;
  if (fx?.outerGlow) out.outerGlow = glow(fx.outerGlow);
  if (fx?.innerGlow) out.innerGlow = { ...glow(fx.innerGlow), source: 'edge' };
  if (kept.bevel && typeof kept.bevel === 'object') out.bevel = kept.bevel as LayerEffectsInfo['bevel'];
  if (kept.satin && typeof kept.satin === 'object') out.satin = kept.satin as LayerEffectsInfo['satin'];
  if (Array.isArray(kept.gradientOverlay)) out.gradientOverlay = kept.gradientOverlay as LayerEffectsInfo['gradientOverlay'];
  return Object.keys(out).length ? out : undefined;
}
