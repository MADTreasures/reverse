/**
 * The Material palette's library, like the reference's: materials in a tree of folders – Color
 * pattern, Monochromatic pattern, Manga material, Image material, Favorites and the user's own
 * folders – found by keywords and tags and sorted. The built-in materials are this program's own
 * (patterns, textures and pictures drawn by code, tones, focus / speed lines, frame templates,
 * balloons); registered ones are the user's images. Pure, unit tested.
 */
import type { BalloonShape } from './text';
import type { DotShape } from './tone';
import { EFFECT_LINE_TOOLS } from './tools';
import { FRAME_TEMPLATES } from './frameTemplates';

/** What a material makes when it is put on the canvas. */
export type MaterialSpec =
  /** An image material layer: tiled (seamless patterns and textures), or one picture (`cover`: as big as the canvas). */
  | { kind: 'image'; tiled: boolean; cover?: boolean }
  /** A tone layer. */
  | { kind: 'tone'; shape: DotShape; value: number; angle: number }
  /** A focus / speed lines layer with a sub tool's settings. */
  | { kind: 'lines'; subTool: string }
  /** Frame border folders from a frame template. */
  | { kind: 'frame'; template: string }
  /** A balloon (with a tail). */
  | { kind: 'balloon'; shape: BalloonShape };

export type MaterialKind = MaterialSpec['kind'];

export const KIND_LABELS: Record<MaterialKind, string> = {
  image: 'Image material',
  tone: 'Tone',
  lines: 'Focus / speed lines',
  frame: 'Framing template',
  balloon: 'Balloon',
};

export interface Material {
  id: string;
  name: string;
  folder: string;
  tags: string[];
  spec: MaterialSpec;
  /** The user's own (registered) material: it can be deleted. */
  own?: boolean;
  /** When it was added (for sorting; built-in: 0). */
  added: number;
}

export interface MaterialFolder {
  id: string;
  name: string;
  parent: string | null;
  /** The user's own folder: it can be renamed and deleted. */
  own?: boolean;
}

export const ALL_MATERIALS = 'all';
export const FAVORITES = 'favorites';
/** Where registered images go unless another folder is chosen. */
export const OWN_IMAGES = 'image/own';

export const BUILT_IN_FOLDERS: MaterialFolder[] = [
  { id: ALL_MATERIALS, name: 'All materials', parent: null },
  { id: 'color', name: 'Color pattern', parent: ALL_MATERIALS },
  { id: 'color/pattern', name: 'Pattern', parent: 'color' },
  { id: 'color/background', name: 'Background', parent: 'color' },
  { id: 'color/texture', name: 'Texture', parent: 'color' },
  { id: 'mono', name: 'Monochromatic pattern', parent: ALL_MATERIALS },
  { id: 'mono/tone', name: 'Basic tones', parent: 'mono' },
  { id: 'mono/pattern', name: 'Pattern', parent: 'mono' },
  { id: 'manga', name: 'Manga material', parent: ALL_MATERIALS },
  { id: 'manga/lines', name: 'Effect lines', parent: 'manga' },
  { id: 'manga/frame', name: 'Framing template', parent: 'manga' },
  { id: 'manga/balloon', name: 'Balloon', parent: 'manga' },
  { id: 'image', name: 'Image material', parent: ALL_MATERIALS },
  { id: 'image/decoration', name: 'Decoration', parent: 'image' },
  { id: OWN_IMAGES, name: 'Registered', parent: 'image' },
  { id: FAVORITES, name: 'Favorites', parent: ALL_MATERIALS },
];

const image = (id: string, name: string, folder: string, tags: string[], tiled: boolean, cover = false): Material => ({ id, name, folder, tags, spec: { kind: 'image', tiled, ...(cover ? { cover } : {}) }, added: 0 });
const tone = (id: string, name: string, shape: DotShape, value: number, angle = 45): Material => ({ id, name, folder: 'mono/tone', tags: ['Tone', 'Monochrome'], spec: { kind: 'tone', shape, value, angle }, added: 0 });

/** This program's own materials (drawn by code; none are the reference's). */
export const BUILT_IN_MATERIALS: Material[] = [
  // Color pattern > Pattern: seamless, tiled.
  image('pat-check', 'Checker', 'color/pattern', ['Seamless', 'Checker', 'Color'], true),
  image('pat-gingham', 'Gingham', 'color/pattern', ['Seamless', 'Checker', 'Clothes pattern'], true),
  image('pat-stripes', 'Color stripes', 'color/pattern', ['Seamless', 'Stripe', 'Clothes pattern'], true),
  image('pat-diagonal', 'Diagonal stripes', 'color/pattern', ['Seamless', 'Stripe'], true),
  image('pat-polka', 'Polka dots', 'color/pattern', ['Seamless', 'Dot', 'Clothes pattern'], true),
  image('pat-argyle', 'Argyle', 'color/pattern', ['Seamless', 'Clothes pattern'], true),
  image('pat-tartan', 'Tartan', 'color/pattern', ['Seamless', 'Checker', 'Clothes pattern'], true),
  image('pat-herringbone', 'Herringbone', 'color/pattern', ['Seamless', 'Clothes pattern'], true),
  image('pat-brick', 'Brick wall', 'color/pattern', ['Seamless', 'Building'], true),
  image('pat-waves', 'Waves', 'color/pattern', ['Seamless', 'Japanese'], true),
  image('pat-honeycomb', 'Honeycomb', 'color/pattern', ['Seamless', 'Geometric'], true),
  image('pat-stars', 'Stars', 'color/pattern', ['Seamless', 'Star'], true),
  image('pat-hearts', 'Hearts', 'color/pattern', ['Seamless', 'Heart'], true),
  image('pat-chevron', 'Chevron', 'color/pattern', ['Seamless', 'Geometric'], true),
  image('pat-scales', 'Scales', 'color/pattern', ['Seamless', 'Japanese'], true),
  image('pat-hemp', 'Hemp leaf', 'color/pattern', ['Seamless', 'Japanese', 'Geometric'], true),
  // Color pattern > Texture: seamless, tiled.
  image('tex-paper', 'Drawing paper', 'color/texture', ['Seamless', 'Texture', 'Paper'], true),
  image('tex-canvas', 'Canvas', 'color/texture', ['Seamless', 'Texture'], true),
  image('tex-watercolor', 'Watercolor paper', 'color/texture', ['Seamless', 'Texture', 'Paper'], true),
  image('tex-wood', 'Wood grain', 'color/texture', ['Seamless', 'Texture', 'Building'], true),
  image('tex-stone', 'Stone', 'color/texture', ['Seamless', 'Texture', 'Building'], true),
  image('tex-denim', 'Denim', 'color/texture', ['Seamless', 'Texture', 'Clothes pattern'], true),
  // Color pattern > Background: one picture as big as the canvas.
  image('bg-sky', 'Blue sky', 'color/background', ['Background', 'Sky'], false, true),
  image('bg-sunset', 'Sunset', 'color/background', ['Background', 'Sky'], false, true),
  image('bg-night', 'Starry night', 'color/background', ['Background', 'Sky', 'Star'], false, true),
  image('bg-bokeh', 'Bokeh', 'color/background', ['Background', 'Effect'], false, true),
  image('bg-glitter', 'Glitter', 'color/background', ['Background', 'Effect', 'Star'], false, true),
  image('bg-light', 'Soft light', 'color/background', ['Background', 'Effect'], false, true),
  // Monochromatic pattern > Basic tones: tone layers.
  tone('tone-dot10', 'Dot 10%', 'circle', 10),
  tone('tone-dot20', 'Dot 20%', 'circle', 20),
  tone('tone-dot30', 'Dot 30%', 'circle', 30),
  tone('tone-dot50', 'Dot 50%', 'circle', 50),
  tone('tone-dot70', 'Dot 70%', 'circle', 70),
  tone('tone-square40', 'Square 40%', 'square', 40),
  tone('tone-diamond40', 'Diamond 40%', 'lozenge', 40),
  tone('tone-line30', 'Line 30%', 'line', 30, 0),
  tone('tone-cross20', 'Cross 20%', 'cross', 20),
  tone('tone-noise30', 'Noise 30%', 'noise', 30),
  // Monochromatic pattern > Pattern: grey seamless images.
  image('mono-check', 'Checks', 'mono/pattern', ['Seamless', 'Monochrome', 'Checker'], true),
  image('mono-stripes', 'Stripes', 'mono/pattern', ['Seamless', 'Monochrome', 'Stripe'], true),
  image('mono-dots', 'Dots', 'mono/pattern', ['Seamless', 'Monochrome', 'Dot'], true),
  image('mono-hatching', 'Cross-hatching', 'mono/pattern', ['Seamless', 'Monochrome'], true),
  image('mono-sand', 'Sand', 'mono/pattern', ['Seamless', 'Monochrome', 'Texture'], true),
  image('mono-scales', 'Scales', 'mono/pattern', ['Seamless', 'Monochrome', 'Japanese'], true),
  // Manga material: effect lines, frame templates, balloons.
  ...EFFECT_LINE_TOOLS.map(
    (t): Material => ({
      id: `lines-${t.id}`,
      name: t.name,
      folder: 'manga/lines',
      tags: ['Effect line', t.tool === 'speedLines' ? 'Speed lines' : t.tool === 'flash' ? 'Flash' : 'Focus lines'],
      spec: { kind: 'lines', subTool: t.id },
      added: 0,
    }),
  ),
  ...FRAME_TEMPLATES.map((t): Material => ({ id: `frame-${t.id}`, name: t.name, folder: 'manga/frame', tags: ['Frame'], spec: { kind: 'frame', template: t.id }, added: 0 })),
  { id: 'balloon-ellipse', name: 'Round balloon', folder: 'manga/balloon', tags: ['Balloon'], spec: { kind: 'balloon', shape: 'ellipse' }, added: 0 },
  { id: 'balloon-rounded', name: 'Rounded balloon', folder: 'manga/balloon', tags: ['Balloon'], spec: { kind: 'balloon', shape: 'rounded' }, added: 0 },
  { id: 'balloon-rect', name: 'Box balloon', folder: 'manga/balloon', tags: ['Balloon'], spec: { kind: 'balloon', shape: 'rect' }, added: 0 },
  { id: 'balloon-cloud', name: 'Thought balloon', folder: 'manga/balloon', tags: ['Balloon'], spec: { kind: 'balloon', shape: 'cloud' }, added: 0 },
  // Image material > Decoration: single pictures.
  image('img-star', 'Star', 'image/decoration', ['Star', 'Color'], false),
  image('img-heart', 'Heart', 'image/decoration', ['Heart', 'Color'], false),
  image('img-flower', 'Flower', 'image/decoration', ['Plant', 'Color'], false),
  image('img-leaf', 'Leaf', 'image/decoration', ['Plant', 'Color'], false),
  image('img-sparkle', 'Sparkle', 'image/decoration', ['Effect', 'Star'], false),
  image('img-cloud', 'Cloud', 'image/decoration', ['Sky'], false),
];

/** The folders right inside `id`, in order. */
export const childFolders = (folders: MaterialFolder[], id: string): MaterialFolder[] => folders.filter((f) => f.parent === id);

/** Whether folder `id` is `ancestor` or inside it. */
export function inFolder(folders: MaterialFolder[], id: string, ancestor: string): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  for (let at: string | null = id, n = 0; at && n < 64; at = byId.get(at)?.parent ?? null, n++) if (at === ancestor) return true;
  return false;
}

/** What a folder shows: the materials in it and in the folders inside it (Favorites: the favourites). */
export function materialsIn(materials: Material[], folders: MaterialFolder[], folder: string, favorites: ReadonlySet<string>): Material[] {
  if (folder === FAVORITES) return materials.filter((m) => favorites.has(m.id));
  return materials.filter((m) => inFolder(folders, m.folder, folder));
}

/** Keywords (each in the name or a tag, any case) and chosen tags (all of them). */
export function searchMaterials(list: Material[], keywords: string, tags: string[] = []): Material[] {
  const words = keywords.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((m) => {
    const text = [m.name, ...m.tags, KIND_LABELS[m.spec.kind]].join(' ').toLowerCase();
    return words.every((w) => text.includes(w)) && tags.every((t) => m.tags.includes(t) || KIND_LABELS[m.spec.kind] === t);
  });
}

/** The tags of materials (with their kinds), for the tag buttons. */
export function tagsOf(list: Material[]): string[] {
  const kinds = [...new Set(list.map((m) => KIND_LABELS[m.spec.kind]))];
  const tags = [...new Set(list.flatMap((m) => m.tags))].filter((t) => !kinds.includes(t)).sort((a, b) => a.localeCompare(b));
  return [...kinds, ...tags];
}

export type MaterialSort = 'name' | 'added' | 'folder';

export function sortMaterials(list: Material[], by: MaterialSort, descending = false): Material[] {
  const key = (m: Material) => (by === 'name' ? m.name.toLowerCase() : by === 'folder' ? `${m.folder}/${m.name.toLowerCase()}` : m.added);
  const out = [...list].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return descending ? out.reverse() : out;
}

/** "Color pattern > Pattern". */
export function folderPath(folders: MaterialFolder[], id: string): string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const names: string[] = [];
  for (let at: string | null = id, n = 0; at && at !== ALL_MATERIALS && n < 64; at = byId.get(at)?.parent ?? null, n++) names.unshift(byId.get(at)?.name ?? at);
  return names.join(' > ');
}

const OWN_ID = /^own-[A-Za-z0-9_-]{1,40}$/;
const text = (v: unknown, max: number, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);

/** The user's folders from storage: valid ids and names, each inside a folder that exists. */
export function sanitizeOwnFolders(raw: unknown): MaterialFolder[] {
  if (!Array.isArray(raw)) return [];
  const out: MaterialFolder[] = [];
  const known = new Set(BUILT_IN_FOLDERS.map((f) => f.id));
  // Parents first: keep adding while folders find their parent.
  let rest = raw.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object' && typeof r.id === 'string' && OWN_ID.test(r.id));
  for (let pass = 0; pass < 32 && rest.length; pass++) {
    const next: typeof rest = [];
    for (const r of rest) {
      const parent = typeof r.parent === 'string' ? r.parent : '';
      if (known.has(r.id as string)) continue;
      if (!known.has(parent) || parent === FAVORITES) {
        next.push(r);
        continue;
      }
      out.push({ id: r.id as string, name: text(r.name, 60, 'New folder'), parent, own: true });
      known.add(r.id as string);
    }
    if (next.length === rest.length) break;
    rest = next;
  }
  return out;
}

/** A registered material's description from storage (its image is stored with it). */
export function sanitizeOwnMaterial(raw: unknown, folders: MaterialFolder[]): Material | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !OWN_ID.test(r.id)) return null;
  const folder = typeof r.folder === 'string' && folders.some((f) => f.id === r.folder) && r.folder !== FAVORITES ? r.folder : OWN_IMAGES;
  const tags = Array.isArray(r.tags) ? [...new Set(r.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim().slice(0, 40)))].slice(0, 20) : [];
  const tiled = Boolean(r.spec && typeof r.spec === 'object' && (r.spec as Record<string, unknown>).tiled === true);
  return {
    id: r.id,
    name: text(r.name, 80, 'Material'),
    folder,
    tags,
    spec: { kind: 'image', tiled },
    own: true,
    added: typeof r.added === 'number' && Number.isFinite(r.added) ? r.added : 0,
  };
}

/** A new id for the user's own folders and materials. */
export const newOwnId = (): string => `own-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
