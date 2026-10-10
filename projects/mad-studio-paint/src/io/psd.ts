/**
 * Photoshop documents (.psd, .psb) through ag-psd (MIT licence).
 *
 * Opening keeps the layer tree: folders, masks, clipping, blending modes, opacity, visibility, locks,
 * the adjustment layers that match a correction layer, text layers (as editable text boxes) and
 * layer styles (see psdStyles.ts). Shape and smart object layers come in as their pixels; a bottom
 * layer called "Paper" becomes the paper again.
 *
 * Saving writes the same structure. Text layers stay text (point or paragraph text; vertical text
 * and balloons as pixels), border (edge), layer colour, shadows and glows become layer styles.
 * Vector and gradient layers are rasterized, draft layers can be left out, and the paper is the
 * bottom layer "Paper". Layers with effects Photoshop lacks (screentone, watercolor edge) are
 * written as they look, with their mask applied. Frame border folders become groups masked by
 * their panels, with the border as a layer.
 *
 * Pure (no DOM): pixels go in and out as straight RGBA at document size.
 */
import { getCompositeImageData, getLayerImageData, getLayerMaskImageData, getLayerRealMaskImageData, initializeCanvas, readPsd, writePsdUint8Array } from 'ag-psd';
import type { AdjustmentLayer, BlendMode as PsdBlendMode, CurvesAdjustment, Layer as PsdLayer, LayerMaskData, LevelsAdjustment, PixelData, Psd } from 'ag-psd';
import { rgbToHex, hexToRgb } from '../model/color';
import { createDocument, MAX_CANVAS_SIDE } from '../model/document';
import { clipGroups, createCorrectionLayer, createFillLayer, createFolder, createLayerMask, createRasterLayer, createTextLayer } from '../model/layers';
import type { BlendMode, DrawnLayer, FolderBlendMode, FolderLayer, Id, Layer, LayerMask, PaintDocument, TextLayer } from '../model/types';
import { sanitizeCorrection, type Channel, type Correction, type Levels } from '../paint/tonal';
import { celAt } from '../paint/animation';
import type { TextBox } from '../paint/text';
import { colorHex, fromPsdEffects, psdColor, toPsdEffects } from './psdStyles';
import { opacityInExpression } from '../paint/effects';
import { fromPsdText, textLayerName, toPsdText } from './psdText';

/** Straight RGBA pixels. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

// ag-psd needs a canvas only for thumbnails and canvas-based layers. This module works with image
// data, which can be a plain object, so it runs without a DOM (tests, workers) too.
initializeCanvas(
  () => {
    throw new Error('PSD: no canvas');
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as unknown as ImageData,
);

// ------------------------------------------------------------------ blending modes

const TO_PSD: Record<FolderBlendMode, PsdBlendMode> = {
  'pass-through': 'pass through',
  normal: 'normal',
  darken: 'darken',
  multiply: 'multiply',
  'color-burn': 'color burn',
  'linear-burn': 'linear burn',
  subtract: 'subtract',
  lighten: 'lighten',
  screen: 'screen',
  'color-dodge': 'color dodge',
  // Photoshop has no glow modes; these are the closest ones.
  'glow-dodge': 'color dodge',
  add: 'linear dodge',
  'add-glow': 'linear dodge',
  overlay: 'overlay',
  'soft-light': 'soft light',
  'hard-light': 'hard light',
  difference: 'difference',
  'vivid-light': 'vivid light',
  'linear-light': 'linear light',
  'pin-light': 'pin light',
  'hard-mix': 'hard mix',
  exclusion: 'exclusion',
  'darker-color': 'darker color',
  'lighter-color': 'lighter color',
  divide: 'divide',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

/** Photoshop mode → ours (the first of ours that maps to it, so Color dodge and Add win over the glow modes). */
const FROM_PSD = new Map<PsdBlendMode, FolderBlendMode>([['subtraction', 'subtract']]);
for (const [ours, psd] of Object.entries(TO_PSD) as [FolderBlendMode, PsdBlendMode][]) if (!FROM_PSD.has(psd)) FROM_PSD.set(psd, ours);

export const toPsdBlend = (mode: FolderBlendMode): PsdBlendMode => TO_PSD[mode] ?? 'normal';

/** Dissolve and the 3D modes have no counterpart: Normal. Pass through only applies to folders. */
export function fromPsdBlend(mode: PsdBlendMode | undefined, folder: boolean): FolderBlendMode {
  const m = (mode && FROM_PSD.get(mode)) || 'normal';
  return m === 'pass-through' && !folder ? 'normal' : m;
}

// ------------------------------------------------------------------ correction ↔ adjustment layers

const CHANNEL_KEYS: [Channel, 'rgb' | 'red' | 'green' | 'blue'][] = [
  ['rgb', 'rgb'],
  ['r', 'red'],
  ['g', 'green'],
  ['b', 'blue'],
];

/** Photoshop's default colour ranges of Hue/Saturation (reds … magentas). */
const HUE_RANGES = {
  reds: [315, 345, 15, 45],
  yellows: [15, 45, 75, 105],
  greens: [75, 105, 135, 165],
  cyans: [135, 165, 195, 225],
  blues: [195, 225, 255, 285],
  magentas: [255, 285, 315, 345],
} as const;

const balance = ([cyanRed, magentaGreen, yellowBlue]: [number, number, number]) => ({ cyanRed, magentaGreen, yellowBlue });

/** The adjustment layer for a correction layer (all of ours have one; the maths differs a little). */
export function toAdjustment(c: Correction): AdjustmentLayer {
  switch (c.type) {
    case 'brightnessContrast':
      return { type: 'brightness/contrast', brightness: Math.round(c.brightness), contrast: Math.round(c.contrast), meanValue: 127, useLegacy: false, labColorOnly: false };
    case 'levels': {
      const out: LevelsAdjustment = { type: 'levels' };
      for (const [ours, theirs] of CHANNEL_KEYS) {
        const l = c.levels[ours];
        out[theirs] = { shadowInput: l.inBlack, highlightInput: l.inWhite, shadowOutput: l.outBlack, highlightOutput: l.outWhite, midtoneInput: l.gamma };
      }
      return out;
    }
    case 'toneCurve': {
      const out: CurvesAdjustment = { type: 'curves' };
      for (const [ours, theirs] of CHANNEL_KEYS) out[theirs] = c.curves[ours].map(([input, output]) => ({ input, output }));
      return out;
    }
    case 'hsl': {
      const none = { hue: 0, saturation: 0, lightness: 0 };
      const ranges = Object.fromEntries(Object.entries(HUE_RANGES).map(([k, [a, b, cc, d]]) => [k, { a, b, c: cc, d, ...none }]));
      return { type: 'hue/saturation', master: { a: 0, b: 0, c: 0, d: 0, hue: Math.round(c.hue), saturation: Math.round(c.saturation), lightness: Math.round(c.luminosity) }, ...ranges };
    }
    case 'colorBalance':
      return { type: 'color balance', shadows: balance(c.shadows), midtones: balance(c.midtones), highlights: balance(c.highlights), preserveLuminosity: c.preserveLuminosity };
    case 'reverse':
      return { type: 'invert' };
    case 'posterize':
      return { type: 'posterize', levels: c.levels };
    case 'binarize':
      return { type: 'threshold', level: Math.round(c.threshold) };
    case 'gradientMap':
      return {
        type: 'gradient map',
        name: 'Custom',
        gradientType: 'solid',
        smoothness: 1,
        colorStops: c.stops.map((s) => ({ color: hexToRgb(s.color) ?? { r: 0, g: 0, b: 0 }, location: s.pos, midpoint: 0.5 })),
        opacityStops: c.stops.map((s) => ({ opacity: s.opacity, location: s.pos, midpoint: 0.5 })),
      };
  }
}

/** The correction layer for an adjustment layer, or null for kinds we lack (exposure, vibrance, …). */
export function fromAdjustment(a: AdjustmentLayer): Correction | null {
  switch (a.type) {
    case 'brightness/contrast':
      return sanitizeCorrection({ type: 'brightnessContrast', brightness: a.brightness ?? 0, contrast: a.contrast ?? 0 });
    case 'levels': {
      const levels = {} as Record<Channel, Levels>;
      for (const [ours, theirs] of CHANNEL_KEYS) {
        const l = a[theirs];
        levels[ours] = l
          ? { inBlack: l.shadowInput, inWhite: l.highlightInput, gamma: l.midtoneInput, outBlack: l.shadowOutput, outWhite: l.highlightOutput }
          : { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
      }
      return sanitizeCorrection({ type: 'levels', levels });
    }
    case 'curves': {
      const curves = Object.fromEntries(CHANNEL_KEYS.map(([ours, theirs]) => [ours, a[theirs]?.map((p) => [p.input, p.output]) ?? [[0, 0], [255, 255]]]));
      return sanitizeCorrection({ type: 'toneCurve', curves });
    }
    case 'hue/saturation':
      return sanitizeCorrection({ type: 'hsl', hue: a.master?.hue ?? 0, saturation: a.master?.saturation ?? 0, luminosity: a.master?.lightness ?? 0 });
    case 'color balance': {
      const b = (v: { cyanRed: number; magentaGreen: number; yellowBlue: number } | undefined) => (v ? [v.cyanRed, v.magentaGreen, v.yellowBlue] : [0, 0, 0]);
      return sanitizeCorrection({ type: 'colorBalance', shadows: b(a.shadows), midtones: b(a.midtones), highlights: b(a.highlights), preserveLuminosity: a.preserveLuminosity !== false });
    }
    case 'invert':
      return { type: 'reverse' };
    case 'posterize':
      return sanitizeCorrection({ type: 'posterize', levels: a.levels ?? 4 });
    case 'threshold':
      return sanitizeCorrection({ type: 'binarize', threshold: a.level ?? 128 });
    case 'gradient map': {
      if (a.gradientType !== 'solid' || !a.colorStops?.length) return null;
      const stops = a.colorStops.map((s) => ({ pos: a.reverse ? 1 - s.location : s.location, color: colorHex(s.color), opacity: 1 }));
      return sanitizeCorrection({ type: 'gradientMap', stops: stops.sort((x, y) => x.pos - y.pos) });
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------------ pixels

/** Bounding box of the pixels for which `keep(p)` is true (p: byte offset), or null. */
function boundsWhere(p: Pixels, keep: (offset: number) => boolean): { x: number; y: number; w: number; h: number } | null {
  let x0 = p.width;
  let y0 = p.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0, o = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++, o += 4) {
      if (!keep(o)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function crop(p: Pixels, r: { x: number; y: number; w: number; h: number }): PixelData {
  const data = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) data.set(p.data.subarray(((r.y + y) * p.width + r.x) * 4, ((r.y + y) * p.width + r.x + r.w) * 4), y * r.w * 4);
  return { width: r.w, height: r.h, data };
}

/** A layer's pixels trimmed to what is drawn (Photoshop stores layers at their own bounds). */
function trimmed(p: Pixels | null): Pick<PsdLayer, 'left' | 'top' | 'imageData'> {
  const r = p && boundsWhere(p, (o) => p.data[o + 3] !== 0);
  return p && r ? { left: r.x, top: r.y, imageData: crop(p, r) } : { left: 0, top: 0 };
}

/**
 * A mask (alpha = visibility) as a Photoshop user mask: grey levels in the first channel, trimmed to
 * where it differs from its default (shown or hidden, whichever leaves less to store).
 */
function maskData(alpha: Pixels, enabled: boolean): LayerMaskData {
  const grey: Pixels = { width: alpha.width, height: alpha.height, data: new Uint8ClampedArray(alpha.data.length) };
  for (let o = 0; o < alpha.data.length; o += 4) {
    const v = alpha.data[o + 3];
    grey.data[o] = v;
    grey.data[o + 1] = v;
    grey.data[o + 2] = v;
    grey.data[o + 3] = 255;
  }
  const notWhite = boundsWhere(grey, (o) => grey.data[o] !== 255);
  if (!notWhite) return { defaultColor: 255, disabled: !enabled };
  const notBlack = boundsWhere(grey, (o) => grey.data[o] !== 0);
  const [defaultColor, r] = notBlack && notBlack.w * notBlack.h < notWhite.w * notWhite.h ? [0, notBlack] : [255, notWhite];
  return { defaultColor, disabled: !enabled, left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h, imageData: crop(grey, r) };
}

function multiplyAlpha(a: Pixels, b: Pixels): Pixels {
  const data = new Uint8ClampedArray(a.data);
  for (let o = 3; o < data.length; o += 4) data[o] = Math.round((data[o] * b.data[o]) / 255);
  return { width: a.width, height: a.height, data };
}

function solid(width: number, height: number, hex: string): Pixels {
  const { r, g, b } = hexToRgb(hex) ?? { r: 255, g: 255, b: 255 };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let o = 0; o < data.length; o += 4) {
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  }
  return { width, height, data };
}

// ------------------------------------------------------------------ saving

export const PAPER_LAYER_NAME = 'Paper';

export interface PsdSource {
  doc: PaintDocument;
  /** Frame of the timeline: in animation folders only its cels are visible. */
  frame?: number;
  /** The merged image (with the paper when it is shown). */
  composite: Pixels;
  /** Leave out draft layers (the reference's default). */
  skipDraft: boolean;
  /** Stored pixels of a raster, vector, text or gradient layer. */
  layerPixels(layer: Layer): Pixels | null;
  /** A layer drawn on its own, with its mask and effects (for effects Photoshop lacks). */
  bakedPixels(layer: Layer): Pixels | null;
  /** A mask's pixels (alpha = visibility). */
  maskPixels(mask: LayerMask): Pixels | null;
  /** Frame border folders: the panels with their border line as alpha, and the border line itself. */
  frameShapes(folder: FolderLayer): { area: Pixels; border: Pixels | null };
  /** A text box of a text layer drawn on its own, or the layer's balloons. */
  textPixels(layer: TextLayer, part: TextBox | 'balloons'): Pixels | null;
}

/** Effects Photoshop has no layer style for: the layer is written as it looks. */
const bakes = (l: Layer) => Boolean(l.effects?.tone?.enabled || l.effects?.expression || (l.effects?.border?.enabled && l.effects.border.kind === 'watercolor'));

function common(l: DrawnLayer): PsdLayer {
  const out: PsdLayer = { name: l.name, hidden: !l.visible, opacity: l.opacity, clipping: l.clip, blendMode: toPsdBlend(l.blend) };
  if (l.locked) out.protected = { transparency: true, composite: true, position: true };
  else if (l.kind === 'raster' && l.lockAlpha) {
    out.protected = { transparency: true };
    out.transparencyProtected = true;
  }
  return out;
}

/** The layer's mask; for frame border folders combined with the panels (`frame`). */
function withMask(out: PsdLayer, l: Layer, src: PsdSource, frame?: Pixels): PsdLayer {
  const own = l.mask ? src.maskPixels(l.mask) : null;
  if (frame) out.mask = maskData(own && l.mask?.enabled ? multiplyAlpha(own, frame) : frame, true);
  else if (own) out.mask = maskData(own, l.mask?.enabled !== false);
  return out;
}

/** The layer's effects as Photoshop layer styles (when it has any). */
function styled(out: PsdLayer, l: Layer, edge?: { width: number; color: string }): PsdLayer {
  const effects = toPsdEffects(l.effects, edge);
  if (effects) out.effects = effects;
  return out;
}

/**
 * A text layer: one text box becomes a Photoshop text layer; several (or with balloons) a group of
 * them with the balloons as pixels below. Vertical text stays pixels (writing it as text can
 * break Photoshop documents).
 */
function exportText(l: TextLayer, src: PsdSource): PsdLayer {
  const part = (t: TextBox): PsdLayer => {
    const out: PsdLayer = { name: textLayerName(t), opacity: 1, blendMode: 'normal', ...trimmed(src.textPixels(l, t)) };
    if (t.vertical || !t.text.trim()) return out;
    out.text = toPsdText(t);
    if (t.edge > 0) out.effects = toPsdEffects(undefined, { width: t.edge, color: t.edgeColor });
    return out;
  };
  if (l.texts.length === 1 && l.balloons.length === 0) {
    const t = l.texts[0];
    const one = part(t);
    return withMask(styled({ ...common(l), ...one, name: l.name }, l, t.edge > 0 && one.text ? { width: t.edge, color: t.edgeColor } : undefined), l, src);
  }
  // Bottom first: the balloons, then the texts in their order.
  const children: PsdLayer[] = [];
  if (l.balloons.length) children.push({ name: 'Balloons', opacity: 1, blendMode: 'normal', ...trimmed(src.textPixels(l, 'balloons')) });
  children.push(...l.texts.map(part));
  return withMask(styled({ ...common(l), opened: true, children }, l), l, src);
}

function exportLayer(l: DrawnLayer, src: PsdSource): PsdLayer {
  if (l.kind === 'correction') return withMask({ ...common(l), adjustment: toAdjustment(l.correction) }, l, src);
  if (bakes(l)) {
    // Drawn as it looks: effects, mask and (for a screentone that shows the opacity in its dots) opacity.
    const tone = l.effects?.tone;
    const out: PsdLayer = { ...common(l), ...trimmed(src.bakedPixels(l)) };
    if ((tone?.enabled && tone.reflectOpacity) || opacityInExpression(l.effects)) out.opacity = 1;
    // A folder drawn as one layer was composed on its own.
    if (l.blend === 'pass-through') out.blendMode = 'normal';
    return out;
  }
  if (l.kind === 'text') return exportText(l, src);
  // A fill layer stays one (Photoshop's solid colour fill layer), with its pixels for other readers.
  if (l.kind === 'fill') return withMask(styled({ ...common(l), vectorFill: { type: 'color', color: psdColor(l.color) }, ...trimmed(src.layerPixels(l)) }, l), l, src);
  if (l.kind !== 'folder') return withMask(styled({ ...common(l), ...trimmed(src.layerPixels(l)) }, l), l, src);
  const children = exportList(l.children, src, l);
  if (!l.frame) return withMask(styled({ ...common(l), opened: l.expanded, children }, l), l, src);
  // Frame border folder: content masked by the panels; the border on top, inside the group.
  const shapes = src.frameShapes(l);
  if (shapes.border) children.push({ name: 'Frame border', opacity: 1, blendMode: 'normal', ...trimmed(shapes.border) });
  const blendMode = l.blend === 'pass-through' ? 'normal' : toPsdBlend(l.blend);
  return withMask(styled({ ...common(l), blendMode, opened: l.expanded, children }, l), l, src, shapes.area);
}

/**
 * Our layers (top first) as Photoshop layers (bottom first). Leaving out a base leaves out its
 * clipping group; a layer that clips to nothing here (see clipGroups) is written as unclipped.
 */
function exportList(layers: Layer[], src: PsdSource, parent?: FolderLayer): PsdLayer[] {
  // An animation folder shows the cel of the current frame; the other cels are written hidden.
  const shown = parent?.animation && src.doc.timeline?.enabled ? celAt(parent.animation, src.frame ?? 1) : undefined;
  const one = (l: DrawnLayer, clipping?: boolean): PsdLayer => {
    const out = exportLayer(l, src);
    if (clipping !== undefined) out.clipping = clipping;
    if (shown !== undefined && l.id !== shown) out.hidden = true;
    return out;
  };
  const out: PsdLayer[] = [];
  // Selection layers and the Quick Mask stay out of Photoshop documents (like the reference's other formats).
  const left = (l: DrawnLayer) => (src.skipDraft && l.draft) || (l.kind === 'raster' && (l.selectionLayer || l.quickMask));
  for (const group of clipGroups(layers)) {
    if (left(group.base)) continue;
    out.push(one(group.base, false));
    for (const l of group.clipped) if (!left(l)) out.push(one(l));
  }
  return out;
}

const resolution = (dpi: number): NonNullable<Psd['imageResources']> => ({
  resolutionInfo: { horizontalResolution: dpi, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: dpi, verticalResolutionUnit: 'PPI', heightUnit: 'Inches' },
});

/** The Photoshop document for our document. */
export function buildPsd(src: PsdSource): Psd {
  const { doc } = src;
  const paper: PsdLayer = { name: PAPER_LAYER_NAME, hidden: !doc.paper.visible, opacity: 1, blendMode: 'normal', left: 0, top: 0, imageData: solid(doc.width, doc.height, doc.paper.color) };
  return {
    width: doc.width,
    height: doc.height,
    children: [paper, ...exportList(doc.layers, src)],
    imageData: src.composite,
    imageResources: resolution(doc.dpi),
  };
}

/**
 * File > Export (single layer) as .psd: the merged image as one layer, or (opaque) as Photoshop's
 * background layer.
 */
/** The merged image as a one-layer Photoshop document (`psb`: a big document). */
export function encodeFlatPsd(image: Pixels, dpi: number, background: boolean, psb = false): Uint8Array {
  const layer: PsdLayer = { name: background ? 'Background' : 'Layer 1', left: 0, top: 0, opacity: 1, blendMode: 'normal', imageData: image };
  return writePsdUint8Array({ width: image.width, height: image.height, children: [layer], imageData: image, imageResources: resolution(dpi) }, { noBackground: !background, psb });
}

/** A Photoshop document with the layers (`psb`: a big document). */
export function encodePsd(src: PsdSource, psb = false): Uint8Array {
  // Without noBackground an opaque bottom layer (the paper) would become Photoshop's locked Background.
  try {
    return writePsdUint8Array(buildPsd(src), { noBackground: true, psb });
  } catch (err) {
    // Kept styles come from files: if one cannot be written, write the document without them.
    const clean = withoutKept(src.doc);
    if (clean === src.doc) throw err;
    return writePsdUint8Array(buildPsd({ ...src, doc: clean }), { noBackground: true, psb });
  }
}

/** The document without kept Photoshop styles (the same document when it has none). */
function withoutKept(doc: PaintDocument): PaintDocument {
  let found = false;
  const clean = (layers: Layer[]): Layer[] =>
    layers.map((l) => {
      let out = l;
      if (l.effects?.kept) {
        found = true;
        const { kept: _kept, ...rest } = l.effects;
        out = { ...l, effects: rest };
      }
      return out.kind === 'folder' ? { ...out, children: clean(out.children) } : out;
    });
  const layers = clean(doc.layers);
  return found ? { ...doc, layers } : doc;
}

// ------------------------------------------------------------------ opening

export interface PsdImport {
  doc: PaintDocument;
  /** Things that could not be kept as they were (shown to the user). */
  notes: string[];
}

/** Names of the reference's paper layer in a few languages. */
const PAPER_NAMES = new Set([PAPER_LAYER_NAME, '用紙', 'Papier', 'Papel', '용지', '紙張', '纸张']);
const MAX_LAYERS = 2000;
const MAX_DEPTH = 32;

/** Any bit depth → straight 8-bit RGBA (32-bit files hold linear light). */
export function to8bit(p: PixelData): Uint8ClampedArray {
  const src = p.data;
  if (src instanceof Uint8ClampedArray) return src;
  const out = new Uint8ClampedArray(src.length);
  if (src instanceof Uint16Array) for (let i = 0; i < src.length; i++) out[i] = Math.round(src[i] / 257);
  else if (src instanceof Float32Array) {
    for (let i = 0; i < src.length; i++) {
      const v = Math.min(1, Math.max(0, src[i]));
      out[i] = Math.round(255 * ((i & 3) === 3 ? v : v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
    }
  } else out.set(src);
  return out;
}

/**
 * A new document-size image with decoded pixels drawn at (left, top); parts outside are cut off.
 * `fill` sets the grey of the rest (masks), otherwise it is transparent.
 */
function placed(p: PixelData | undefined, left: number, top: number, width: number, height: number, fill?: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill !== undefined) {
    for (let o = 0; o < data.length; o += 4) {
      data[o] = fill;
      data[o + 1] = fill;
      data[o + 2] = fill;
      data[o + 3] = 255;
    }
  }
  if (!p) return { width, height, data };
  const src = to8bit(p);
  const x0 = Math.max(0, left);
  const x1 = Math.min(width, left + p.width);
  if (x1 > x0) {
    for (let y = Math.max(0, top); y < Math.min(height, top + p.height); y++) {
      const s = ((y - top) * p.width + (x0 - left)) * 4;
      data.set(src.subarray(s, s + (x1 - x0) * 4), (y * width + x0) * 4);
    }
  }
  return { width, height, data };
}

/** Photoshop's grey mask → our mask image (alpha = visibility). */
function maskAlpha(m: LayerMaskData, decoded: PixelData | undefined, width: number, height: number): Pixels {
  const grey = placed(decoded, m.left ?? 0, m.top ?? 0, width, height, m.defaultColor ?? 0);
  for (let o = 0; o < grey.data.length; o += 4) {
    grey.data[o + 3] = grey.data[o];
    grey.data[o] = 0;
    grey.data[o + 1] = 0;
    grey.data[o + 2] = 0;
  }
  return grey;
}

/** The colour of a document-size image that is one opaque colour, as '#rrggbb', or null. */
function uniformColor(p: Pixels): string | null {
  const d = p.data;
  for (let o = 0; o < d.length; o += 4) if (d[o] !== d[0] || d[o + 1] !== d[1] || d[o + 2] !== d[2] || d[o + 3] !== 255) return null;
  return rgbToHex({ r: d[0], g: d[1], b: d[2] });
}

/**
 * Reads a Photoshop document. `onPixels` receives the pixels of each raster layer and mask (by
 * layer or mask id) as soon as they are decoded, so only about one layer is held at a time.
 */
export function decodePsd(bytes: Uint8Array, name: string, onPixels: (id: Id, pixels: Pixels) => void, fit?: (t: TextBox) => TextBox): PsdImport {
  // Structure first; bitmaps are decoded layer by layer once their sizes are checked.
  const psd = readPsd(bytes, { useRawData: true, skipThumbnail: true, skipLinkedFilesData: true });
  const { width, height } = psd;
  if (!(width > 0 && height > 0)) throw new Error('The document has no size');
  if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE) throw new Error(`The canvas is larger than ${MAX_CANVAS_SIDE} × ${MAX_CANVAS_SIDE} pixels`);
  if (psd.colorMode !== undefined && ![0, 1, 2, 3, 4].includes(psd.colorMode)) throw new Error('Only RGB, CMYK, grayscale, indexed and bitmap documents can be opened');
  const notes = new Set<string>();
  const limit = 4 * width * height + 1_000_000;
  let count = 0;
  // The bottom layer may be the paper: its pixels wait until that is decided.
  const paperCandidate = psd.children?.[0];
  let held: { id: Id; pixels: Pixels } | null = null;

  const decode = (get: () => PixelData | undefined, w: number, h: number): PixelData | undefined => {
    if (w * h > limit) {
      notes.add('Layers far larger than the canvas were left empty');
      return undefined;
    }
    try {
      return get();
    } catch {
      notes.add('Some layer pixels could not be read');
      return undefined;
    }
  };

  const convert = (l: PsdLayer, depth: number): Layer | null => {
    if (++count > MAX_LAYERS) {
      notes.add(`Only the first ${MAX_LAYERS} layers were opened`);
      return null;
    }
    const base = {
      // Some writers leave padding (NUL) in names.
      name: (l.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) || 'Layer',
      visible: !l.hidden,
      opacity: Math.min(1, Math.max(0, l.opacity ?? 1)),
      clip: Boolean(l.clipping),
      locked: Boolean(l.protected?.composite && l.protected.position && l.protected.transparency),
    };
    const dpi = dpiOf(psd);
    // Text layers stay text (warped text comes in as its pixels).
    const asText = Boolean(l.text && !l.children && (!l.text.warp?.style || l.text.warp.style === 'none'));
    const styles = fromPsdEffects(l.effects, dpi, asText);
    for (const n of styles.notes) notes.add(n);
    let layer: Layer;
    if (l.children) {
      if (depth >= MAX_DEPTH) {
        notes.add('Very deeply nested folders were left out');
        return null;
      }
      layer = createFolder(base.name, convertList(l.children, depth + 1), { ...base, blend: fromPsdBlend(l.blendMode, true), expanded: l.opened !== false });
    } else if (l.adjustment) {
      const correction = fromAdjustment(l.adjustment);
      if (!correction) {
        notes.add(`Adjustment layers without a matching correction layer (${l.adjustment.type}) were left out`);
        return null;
      }
      layer = createCorrectionLayer(base.name, correction, { ...base, blend: fromPsdBlend(l.blendMode, false) as BlendMode });
    } else if (l.vectorFill?.type === 'color' && !l.vectorMask && !l.children) {
      // Photoshop's solid colour fill layer (a shape layer would have a vector mask too).
      layer = createFillLayer(base.name, colorHex(l.vectorFill.color), {
        ...base,
        opacity: base.opacity * Math.min(1, Math.max(0, l.fillOpacity ?? 1)),
        blend: fromPsdBlend(l.blendMode, false) as BlendMode,
      });
    } else if (asText && l.text) {
      let t = fromPsdText(l.text, fit);
      if (styles.edge) t = { ...t, edge: styles.edge.width, edgeColor: styles.edge.color };
      layer = createTextLayer(base.name, {
        ...base,
        // Photoshop's Fill opacity: without layer styles it is just more opacity.
        opacity: base.opacity * (styles.effects ? 1 : Math.min(1, Math.max(0, l.fillOpacity ?? 1))),
        blend: fromPsdBlend(l.blendMode, false) as BlendMode,
        texts: [t],
      });
    } else {
      layer = createRasterLayer(base.name, {
        ...base,
        // Photoshop's Fill opacity: without layer styles it is just more opacity.
        opacity: base.opacity * Math.min(1, Math.max(0, l.fillOpacity ?? 1)),
        blend: fromPsdBlend(l.blendMode, false) as BlendMode,
        lockAlpha: !base.locked && Boolean(l.transparencyProtected || l.protected?.transparency),
      });
      const left = l.left ?? 0;
      const top = l.top ?? 0;
      const w = Math.max(0, (l.right ?? 0) - left);
      const h = Math.max(0, (l.bottom ?? 0) - top);
      const img = w && h ? decode(() => getLayerImageData(l), w, h) : undefined;
      let pixels: Pixels | null = null;
      if (img) pixels = placed(img, left, top, width, height);
      // A fill layer stores no pixels of its own.
      else if (l.vectorFill?.type === 'color') pixels = solid(width, height, colorHex(l.vectorFill.color));
      if (pixels && l === paperCandidate && depth === 0) held = { id: layer.id, pixels };
      else if (pixels) onPixels(layer.id, pixels);
      if (l.text) notes.add('Warped text was opened as pixels');
      else if (l.placedLayer) notes.add('Smart objects were opened as raster layers');
      else if (l.vectorMask || l.vectorFill) notes.add('Shape layers and gradient or pattern fill layers were opened as raster layers');
    }
    if (styles.effects) layer.effects = styles.effects;
    // With a vector mask as well, the pixel mask is the "real" one; a lone vector mask comes in as its pixels.
    const m = l.realMask ?? l.mask;
    if (m) {
      const real = Boolean(l.realMask);
      const w = Math.max(0, (m.right ?? 0) - (m.left ?? 0));
      const h = Math.max(0, (m.bottom ?? 0) - (m.top ?? 0));
      const img = w && h ? decode(() => (real ? getLayerRealMaskImageData(l) : getLayerMaskImageData(l)), w, h) : undefined;
      // An empty mask that would hide everything is how some writers say "no mask" (other readers agree).
      if (img || (m.defaultColor ?? 0) !== 0) {
        // The default colour is what the mask is beyond its pixels.
        layer.mask = { ...createLayerMask(), enabled: !m.disabled, ...((m.defaultColor ?? 0) === 0 ? { outside: 'hide' as const } : {}) };
        onPixels(layer.mask.id, maskAlpha(m, img, width, height));
      }
    }
    delete l.rawData;
    return layer;
  };

  /** Photoshop's bottom-first list → ours, top first. */
  const convertList = (list: PsdLayer[], depth: number): Layer[] =>
    list
      .slice()
      .reverse()
      .map((l) => convert(l, depth))
      .filter((l): l is Layer => l !== null);

  // Writers put an empty placeholder layer into flat documents.
  const flat = !(psd.children ?? []).some((l) => l.children || l.adjustment || l.vectorFill || ((l.right ?? 0) > (l.left ?? 0) && (l.bottom ?? 0) > (l.top ?? 0)));
  let layers = flat ? [] : convertList(psd.children ?? [], 0);
  const doc = createDocument(name, width, height, dpiOf(psd));
  // Without a paper layer the document shows what Photoshop shows: transparency.
  doc.paper = { visible: false, color: '#ffffff' };
  const candidate = held as { id: Id; pixels: Pixels } | null;
  if (candidate) {
    const bottom = layers[layers.length - 1];
    const color = bottom?.kind === 'raster' && PAPER_NAMES.has(bottom.name) && bottom.opacity === 1 && bottom.blend === 'normal' && !bottom.clip && !bottom.mask ? uniformColor(candidate.pixels) : null;
    if (bottom && color) {
      // The reference's paper layer (and ours) becomes the paper again.
      doc.paper = { visible: bottom.visible, color };
      layers = layers.slice(0, -1);
    } else onPixels(candidate.id, candidate.pixels);
  }
  if (flat) {
    // A flat document: its merged image is the only layer.
    const layer = createRasterLayer('Background');
    const composite = decode(() => getCompositeImageData(psd), width, height);
    if (composite) onPixels(layer.id, placed(composite, 0, 0, width, height));
    layers = [layer];
  }
  doc.layers = layers.length ? layers : [createRasterLayer('Layer 1')];
  return { doc, notes: [...notes] };
}

function dpiOf(psd: Psd): number {
  const r = psd.imageResources?.resolutionInfo;
  if (!r || !(r.horizontalResolution > 0)) return 72;
  const dpi = r.horizontalResolutionUnit === 'PPCM' ? r.horizontalResolution * 2.54 : r.horizontalResolution;
  return Math.round(Math.min(2400, Math.max(1, dpi)));
}
