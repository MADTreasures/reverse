/**
 * The .madpaint document format: a ZIP archive with
 *   document.json      – format tag, version, document structure (layer tree, flags)
 *   layers/<id>.png    – pixels of each raster layer and layer mask (document size, straight alpha);
 *                        vector and text layers store their lines, text and balloons in
 *                        document.json and are rendered on load
 *   preview.png        – merged image for previews (optional)
 * Pure (no DOM): PNG encoding/decoding happens in the browser layer.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { isBlendMode } from '../model/blend';
import { clampCanvasSide } from '../model/document';
import { createRasterLayer, flatten, nextRev } from '../model/layers';
import type { CorrectionLayer, FolderLayer, GradientLayer, Id, Layer, LayerMask, LayerRulers, PaintDocument, RasterLayer, TextLayer, VectorLayer } from '../model/types';
import { sanitizeGradientFill } from '../paint/gradient';
import { sanitizeEffects } from '../paint/effects';
import { sanitizeRuler, type Ruler } from '../paint/rulers';
import { sanitizeCorrection } from '../paint/tonal';
import { sanitizeBrush, type BrushSettings } from '../paint/tools';
import { packStroke, unpackStroke, type VectorStroke } from '../paint/vector';
import { sanitizeBalloon, sanitizeTextBox, type Balloon, type TextBox } from '../paint/text';
import { sanitizeFrame } from '../paint/frames';

export const FORMAT = 'mad-studio-paint';
/** 2: layer masks, correction layers, effects, rulers. 3: vector and text layers, comic frames. Older files open unchanged. */
export const FORMAT_VERSION = 3;
export const EXTENSION = 'madpaint';

export interface DocumentFile {
  doc: PaintDocument;
  activeLayerId: Id | null;
  /** PNG bytes per raster layer and mask id. */
  layers: Map<Id, Uint8Array>;
  preview?: Uint8Array;
}

const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const str = (v: unknown, fallback: string, maxLen = 200) => (typeof v === 'string' && v.length > 0 ? v.slice(0, maxLen) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const color = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);

const ID = /^[A-Za-z0-9_-]+$/;

function sanitizeMask(raw: unknown, seen: Set<string>): LayerMask | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, '', 64);
  // A mask needs its own pixels; an unusable id drops the mask rather than sharing another surface.
  if (!ID.test(id) || seen.has(id)) return undefined;
  seen.add(id);
  return { id, enabled: bool(r.enabled, true), linked: bool(r.linked, true) };
}

function sanitizeRulers(raw: unknown): LayerRulers | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items.slice(0, 64).map(sanitizeRuler).filter((x): x is Ruler => x !== null) : [];
  if (items.length === 0) return undefined;
  return { items, range: r.range === 'folder' || r.range === 'editing' ? r.range : 'all', visible: r.visible !== false };
}

function sanitizeLayer(raw: unknown, seen: Set<string>, depth: number): Layer | null {
  if (!raw || typeof raw !== 'object' || depth > 32) return null;
  const r = raw as Record<string, unknown>;
  let id = str(r.id, '', 64);
  if (!ID.test(id) || seen.has(id)) id = createRasterLayer('x').id;
  seen.add(id);
  const mask = sanitizeMask(r.mask, seen);
  const effects = sanitizeEffects(r.effects);
  const rulers = sanitizeRulers(r.rulers);
  const common = {
    id,
    name: str(r.name, 'Layer', 120),
    visible: bool(r.visible, true),
    opacity: num(r.opacity, 1, 0, 1),
    clip: bool(r.clip, false),
    locked: bool(r.locked, false),
    reference: bool(r.reference, false),
    draft: bool(r.draft, false),
    ...(mask ? { mask } : {}),
    ...(effects ? { effects } : {}),
    ...(rulers ? { rulers } : {}),
  };
  if (r.kind === 'folder') {
    const children = Array.isArray(r.children) ? r.children.map((c) => sanitizeLayer(c, seen, depth + 1)).filter((c): c is Layer => c !== null) : [];
    const folder: FolderLayer = {
      ...common,
      kind: 'folder',
      blend: r.blend === 'pass-through' || isBlendMode(r.blend) ? (r.blend as FolderLayer['blend']) : 'pass-through',
      expanded: bool(r.expanded, true),
      children,
    };
    const frame = sanitizeFrame(r.frame);
    if (frame) {
      folder.frame = frame;
      // Frame border folders are isolated.
      if (folder.blend === 'pass-through') folder.blend = 'normal';
    }
    return folder;
  }
  if (r.kind === 'correction') {
    const correction: CorrectionLayer = {
      ...common,
      kind: 'correction',
      blend: isBlendMode(r.blend) ? r.blend : 'normal',
      correction: sanitizeCorrection(r.correction),
    };
    return correction;
  }
  if (r.kind === 'vector') {
    // Lines refer to the layer's brush table by index (`b`).
    const brushes = Array.isArray(r.brushes) ? r.brushes.slice(0, 10000).map(sanitizeBrush) : [];
    const brushOf = (b: unknown): BrushSettings => (typeof b === 'number' ? brushes[b] ?? sanitizeBrush(null) : sanitizeBrush(b));
    const strokes = Array.isArray(r.strokes)
      ? r.strokes
          .slice(0, 200000)
          .map((x) => unpackStroke(x && typeof x === 'object' && 'b' in x ? { ...x, brush: (x as { b: unknown }).b } : x, brushOf))
          .filter((x): x is VectorStroke => x !== null)
      : [];
    const vector: VectorLayer = { ...common, kind: 'vector', blend: isBlendMode(r.blend) ? r.blend : 'normal', strokes, rev: nextRev() };
    return vector;
  }
  if (r.kind === 'gradient') {
    const gradient = sanitizeGradientFill(r.gradient);
    if (gradient) {
      const layer: GradientLayer = { ...common, kind: 'gradient', blend: isBlendMode(r.blend) ? r.blend : 'normal', gradient, rev: nextRev() };
      return layer;
    }
  }
  if (r.kind === 'text') {
    const texts = Array.isArray(r.texts) ? r.texts.slice(0, 10000).map(sanitizeTextBox).filter((x): x is TextBox => x !== null) : [];
    const balloons = Array.isArray(r.balloons) ? r.balloons.slice(0, 10000).map(sanitizeBalloon).filter((x): x is Balloon => x !== null) : [];
    const text: TextLayer = { ...common, kind: 'text', blend: isBlendMode(r.blend) ? r.blend : 'normal', texts, balloons, rev: nextRev() };
    return text;
  }
  const raster: RasterLayer = {
    ...common,
    kind: 'raster',
    blend: isBlendMode(r.blend) ? r.blend : 'normal',
    lockAlpha: bool(r.lockAlpha, false),
  };
  return raster;
}

/** Validates untrusted document JSON and fills in defaults. */
export function sanitizeDocument(raw: unknown): PaintDocument {
  if (!raw || typeof raw !== 'object') throw new Error('Not a MAD Studio Paint document');
  const r = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const layers = Array.isArray(r.layers) ? r.layers.map((l) => sanitizeLayer(l, seen, 0)).filter((l): l is Layer => l !== null) : [];
  const paper = (r.paper && typeof r.paper === 'object' ? r.paper : {}) as Record<string, unknown>;
  return {
    id: str(r.id, 'd-imported', 64),
    name: str(r.name, 'Untitled', 120),
    width: clampCanvasSide(num(r.width, 1000, 1, 1e6)),
    height: clampCanvasSide(num(r.height, 1000, 1, 1e6)),
    dpi: Math.round(num(r.dpi, 72, 1, 2400)),
    paper: { visible: bool(paper.visible, true), color: color(paper.color, '#ffffff') },
    layers: layers.length ? layers : [createRasterLayer('Layer 1')],
  };
}

/** A vector layer for the file: compact lines that share a table of the brushes they use. */
function packVectorLayer(l: VectorLayer): Record<string, unknown> {
  const brushes: BrushSettings[] = [];
  const index = new Map<string, number>();
  const strokes = l.strokes.map((x) => {
    const { brush, ...rest } = packStroke(x);
    const key = JSON.stringify(brush);
    let b = index.get(key);
    if (b === undefined) {
      b = brushes.push(brush) - 1;
      index.set(key, b);
    }
    return { ...rest, b };
  });
  const { rev: _rev, strokes: _strokes, ...rest } = l;
  return { ...rest, brushes, strokes };
}

/** The document structure as stored in document.json. */
function documentJson(doc: PaintDocument): unknown {
  const pack = (layers: Layer[]): unknown[] =>
    layers.map((l) => {
      if (l.kind === 'vector') return packVectorLayer(l);
      if (l.kind === 'text' || l.kind === 'gradient') {
        const { rev: _rev, ...rest } = l;
        return rest;
      }
      return l.kind === 'folder' ? { ...l, children: pack(l.children) } : l;
    });
  return flatten(doc.layers).some((l) => l.kind === 'vector' || l.kind === 'text' || l.kind === 'gradient') ? { ...doc, layers: pack(doc.layers) } : doc;
}

export function packDocument(file: DocumentFile): Uint8Array {
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    'document.json': strToU8(JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, activeLayerId: file.activeLayerId, document: documentJson(file.doc) })),
  };
  // PNGs are already compressed: store them.
  for (const [id, png] of file.layers) entries[`layers/${id}.png`] = [png, { level: 0 }];
  if (file.preview) entries['preview.png'] = [file.preview, { level: 0 }];
  return zipSync(entries, { level: 6 });
}

export function unpackDocument(bytes: Uint8Array): DocumentFile {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('The file is damaged or not a MAD Studio Paint document');
  }
  const json = files['document.json'];
  if (!json) throw new Error('document.json is missing');
  const meta = JSON.parse(strFromU8(json)) as { format?: string; version?: number; activeLayerId?: string; document?: unknown };
  if (meta.format !== FORMAT) throw new Error('Not a MAD Studio Paint document');
  if (typeof meta.version === 'number' && meta.version > FORMAT_VERSION) throw new Error('This document was saved by a newer version of MAD Studio Paint');
  const doc = sanitizeDocument(meta.document);
  const layers = new Map<Id, Uint8Array>();
  for (const [path, data] of Object.entries(files)) {
    const m = /^layers\/([A-Za-z0-9_-]+)\.png$/.exec(path);
    if (m) layers.set(m[1], data);
  }
  return { doc, activeLayerId: typeof meta.activeLayerId === 'string' ? meta.activeLayerId : null, layers, preview: files['preview.png'] };
}

export function isDocumentFileName(name: string): boolean {
  return name.toLowerCase().endsWith(`.${EXTENSION}`);
}

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];

export function isImageFileName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.includes(ext);
}

export function mimeForName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : 'image/png';
}
