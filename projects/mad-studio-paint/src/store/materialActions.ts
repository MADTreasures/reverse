/**
 * Material palette state and actions, like the reference's: the folder tree with the user's own
 * folders, registered materials (Edit > Register material > Image), favourites, the view (details,
 * large or small thumbnails), search keywords and tags, and Toning per material – kept in the
 * browser's database. A material put on the canvas (dragged there or with Paste) makes an image
 * material layer, a tone layer, a focus / speed lines layer, frame border folders or a balloon.
 */
import { create } from 'zustand';
import { createImageLayer, createLinesLayer } from '../model/layers';
import { uid } from '../model/ids';
import type { Id } from '../model/types';
import { idbGet, idbSet } from '../io/idb';
import { createCanvas, ctx2d } from '../engine/canvas';
import { engine } from '../engine/engine';
import { getSurface, setSurface } from '../engine/surfaces';
import { builtInImage } from '../engine/materialImages';
import { placeImage } from '../paint/imageMaterial';
import {
  BUILT_IN_FOLDERS,
  BUILT_IN_MATERIALS,
  FAVORITES,
  newOwnId,
  OWN_IMAGES,
  sanitizeOwnFolders,
  sanitizeOwnMaterial,
  type Material,
  type MaterialFolder,
  type MaterialSort,
} from '../paint/materialLibrary';
import { maskBounds } from '../paint/mask';
import { mmToPx, polygonBounds } from '../paint/frames';
import { FRAME_TEMPLATES, templatePanels } from '../paint/frameTemplates';
import { newObjectId } from '../paint/text';
import { defaultTone } from '../paint/tone';
import type { Pt } from '../paint/rulers';
import { newLines } from '../tools/effectLinesTool';
import * as actions from './actions';
import { addFrameTemplate, pageFrame } from './frameActions';
import { addBalloon } from './textActions';
import { getState, setState } from './store';

/** Materials are drawn for 150 dpi: on a canvas of another resolution they keep their real size. */
export const MATERIAL_DPI = 150;

export type MaterialView = 'details' | 'large' | 'small';

interface MaterialState {
  /** The user's folders (the built-in ones are always there). */
  ownFolders: MaterialFolder[];
  /** Registered materials and their images. */
  own: Material[];
  images: Record<string, HTMLCanvasElement>;
  favorites: string[];
  /** Toning per material: put on the canvas as a tone (black and white dots). */
  toning: Record<string, boolean>;
  /** The folder the Material palette shows; null: closed. */
  open: string | null;
  selected: string | null;
  view: MaterialView;
  sort: MaterialSort;
  descending: boolean;
  keywords: string;
  tags: string[];
  /** Folders opened in the tree. */
  expanded: string[];
  /** Window > Material: the strip of material buttons at the right edge. */
  stripShown: boolean;
}

export const useMaterials = create<MaterialState>(() => ({
  ownFolders: [],
  own: [],
  images: {},
  favorites: [],
  toning: {},
  open: null,
  selected: null,
  view: 'large',
  sort: 'folder',
  descending: false,
  keywords: '',
  tags: [],
  expanded: ['all', 'color', 'mono', 'manga', 'image'],
  stripShown: true,
}));

const get = () => useMaterials.getState();
const set = useMaterials.setState;

export const allFolders = (s = get()): MaterialFolder[] => [...BUILT_IN_FOLDERS, ...s.ownFolders];
export const allMaterials = (s = get()): Material[] => [...BUILT_IN_MATERIALS, ...s.own];
export const findMaterial = (id: string, s = get()): Material | undefined => allMaterials(s).find((m) => m.id === id);

// ------------------------------------------------------------------ saving

const KEY = 'materials';
let loaded = false;

interface Saved {
  folders: unknown;
  own: { meta: unknown; blob: Blob }[];
  favorites: string[];
  toning: Record<string, boolean>;
  view: MaterialView;
  stripShown?: boolean;
}

async function save(): Promise<void> {
  if (!loaded) return;
  const s = get();
  const own = await Promise.all(
    s.own.map(async (m) => {
      const img = s.images[m.id];
      const blob = img ? await new Promise<Blob | null>((resolve) => img.toBlob(resolve, 'image/png')) : null;
      return blob ? { meta: m, blob } : null;
    }),
  );
  const saved: Saved = { folders: s.ownFolders, own: own.filter((x): x is { meta: Material; blob: Blob } => x !== null), favorites: s.favorites, toning: s.toning, view: s.view, stripShown: s.stripShown };
  await idbSet(KEY, saved);
}

/** Loads the user's folders, materials and settings (once, at start). */
export async function loadMaterials(): Promise<void> {
  const saved = await idbGet<Saved>(KEY);
  if (saved && typeof saved === 'object') {
    const ownFolders = sanitizeOwnFolders(saved.folders);
    const folders = [...BUILT_IN_FOLDERS, ...ownFolders];
    const own: Material[] = [];
    const images: Record<string, HTMLCanvasElement> = {};
    for (const entry of Array.isArray(saved.own) ? saved.own : []) {
      const m = sanitizeOwnMaterial(entry?.meta, folders);
      if (!m || !(entry.blob instanceof Blob)) continue;
      try {
        const bitmap = await createImageBitmap(entry.blob);
        const c = createCanvas(bitmap.width, bitmap.height);
        ctx2d(c).drawImage(bitmap, 0, 0);
        images[m.id] = c;
        own.push(m);
      } catch {
        // A damaged image is left out.
      }
    }
    const known = new Set([...BUILT_IN_MATERIALS, ...own].map((m) => m.id));
    set({
      ownFolders,
      own,
      images,
      favorites: Array.isArray(saved.favorites) ? saved.favorites.filter((id) => typeof id === 'string' && known.has(id)) : [],
      toning: saved.toning && typeof saved.toning === 'object' ? Object.fromEntries(Object.entries(saved.toning).filter(([id, v]) => known.has(id) && typeof v === 'boolean')) : {},
      view: saved.view === 'details' || saved.view === 'small' ? saved.view : 'large',
      stripShown: saved.stripShown !== false,
    });
  }
  loaded = true;
}

const changed = (patch: Partial<MaterialState>) => {
  set(patch);
  void save();
};

// ------------------------------------------------------------------ the palette

/** Opens the Material palette at a folder (again: closes it). */
export function toggleMaterialPalette(folder: string): void {
  const s = get();
  if (s.open === folder) set({ open: null });
  else set({ open: folder, expanded: [...new Set([...s.expanded, ...ancestors(folder)])] });
}

export const closeMaterialPalette = () => set({ open: null });
/** Window > Material: shows or hides the material strip. */
export const toggleMaterialStrip = () => changed({ stripShown: !get().stripShown, open: null });
export const showFolder = (folder: string) => set({ open: folder });
export const selectMaterial = (id: string | null) => set({ selected: id });
export const setMaterialView = (view: MaterialView) => changed({ view });
export const setMaterialSort = (sort: MaterialSort, descending = get().descending) => set({ sort, descending });
export const setKeywords = (keywords: string) => set({ keywords });
export const toggleTag = (tag: string) => set((s) => ({ tags: s.tags.includes(tag) ? s.tags.filter((t) => t !== tag) : [...s.tags, tag] }));
export const toggleExpanded = (id: string) => set((s) => ({ expanded: s.expanded.includes(id) ? s.expanded.filter((x) => x !== id) : [...s.expanded, id] }));

function ancestors(id: string): string[] {
  const byId = new Map(allFolders().map((f) => [f.id, f]));
  const out: string[] = [];
  for (let at = byId.get(id)?.parent ?? null; at; at = byId.get(at)?.parent ?? null) out.push(at);
  return out;
}

/** Adds the selected material to the favourites, or takes it out. */
export function toggleFavorite(id = get().selected): void {
  if (!id) return;
  const f = get().favorites;
  changed({ favorites: f.includes(id) ? f.filter((x) => x !== id) : [...f, id] });
}

export function setToning(id: string, on: boolean): void {
  changed({ toning: { ...get().toning, [id]: on } });
}

// ------------------------------------------------------------------ the user's folders and materials

/** A new folder inside `parent` (not in Favorites). */
export function newMaterialFolder(parent: string, name = 'New folder'): string | null {
  if (parent === FAVORITES || !allFolders().some((f) => f.id === parent)) return null;
  const folder: MaterialFolder = { id: newOwnId(), name: name.trim().slice(0, 60) || 'New folder', parent, own: true };
  changed({ ownFolders: [...get().ownFolders, folder], expanded: [...new Set([...get().expanded, parent])] });
  return folder.id;
}

export function renameMaterialFolder(id: string, name: string): void {
  const n = name.trim().slice(0, 60);
  if (!n) return;
  changed({ ownFolders: get().ownFolders.map((f) => (f.id === id ? { ...f, name: n } : f)) });
}

/** Deletes one of the user's folders with the folders and materials in it. */
export function deleteMaterialFolder(id: string): void {
  const s = get();
  if (!s.ownFolders.some((f) => f.id === id)) return;
  const gone = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of s.ownFolders)
      if (f.parent && gone.has(f.parent) && !gone.has(f.id)) {
        gone.add(f.id);
        grew = true;
      }
  }
  const own = s.own.filter((m) => !gone.has(m.folder));
  const images = Object.fromEntries(Object.entries(s.images).filter(([k]) => own.some((m) => m.id === k)));
  changed({ ownFolders: s.ownFolders.filter((f) => !gone.has(f.id)), own, images, open: s.open && gone.has(s.open) ? OWN_IMAGES : s.open });
}

/** Deletes a registered material (built-in ones stay). */
export function deleteMaterial(id: string): void {
  const s = get();
  if (!s.own.some((m) => m.id === id)) return;
  const { [id]: _gone, ...images } = s.images;
  changed({ own: s.own.filter((m) => m.id !== id), images, favorites: s.favorites.filter((x) => x !== id), selected: s.selected === id ? null : s.selected });
}

/**
 * Edit > Register material > Image: the active layer's pixels (inside the selection, else all it
 * shows) become a material in `folder`.
 */
export function registerMaterial(name: string, folder: string, tags: string[], tiled: boolean): string | null {
  const s = getState();
  const target = actions.editTarget(s);
  const surface = target ? getSurface(target.surfaceId) : null;
  if (!surface) {
    setState({ hint: 'Select a raster layer whose image to register' });
    return null;
  }
  const r = s.selection ? maskBounds(s.selection) : contentRect(surface);
  if (!r || r.w < 1 || r.h < 1) {
    setState({ hint: 'There is nothing to register on this layer' });
    return null;
  }
  const c = createCanvas(r.w, r.h);
  const ctx = ctx2d(c);
  ctx.drawImage(surface, -r.x, -r.y);
  const sel = engine.selectionCanvas();
  if (sel) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(sel, -r.x, -r.y);
  }
  const material: Material = {
    id: newOwnId(),
    name: name.trim().slice(0, 80) || 'Material',
    folder: allFolders().some((f) => f.id === folder) && folder !== FAVORITES ? folder : OWN_IMAGES,
    tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 20),
    spec: { kind: 'image', tiled },
    own: true,
    added: Date.now(),
  };
  const m = get();
  changed({ own: [...m.own, material], images: { ...m.images, [material.id]: c }, selected: material.id });
  return material.id;
}

/** The box round a canvas's visible pixels (null when it is empty). */
function contentRect(c: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const data = ctx2d(c, true).getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width;
  let y0 = c.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (data[(y * c.width + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ------------------------------------------------------------------ putting materials on the canvas

/** The image of an image material (built-in or registered). */
export const materialImage = (m: Material): HTMLCanvasElement | null => (m.own ? (get().images[m.id] ?? null) : builtInImage(m.id));

/**
 * Puts a material on the canvas with its middle at `at` (the middle of the canvas without), as one
 * undo step. Returns the new layer's id when it made one.
 */
export function applyMaterial(id: string, at?: Pt): Id | null {
  const m = findMaterial(id);
  if (!m) return null;
  const s = getState();
  const { width, height, dpi } = s.doc;
  const p = at ?? { x: width / 2, y: height / 2 };
  const spec = m.spec;
  const toning = Boolean(get().toning[m.id]);
  const scale = dpi / MATERIAL_DPI;
  switch (spec.kind) {
    case 'image': {
      const src = materialImage(m);
      if (!src) return null;
      // The image stays as it is: the layer keeps its own copy, saved with the document.
      const image = uid('x');
      const copy = createCanvas(src.width, src.height);
      ctx2d(copy).drawImage(src, 0, 0);
      setSurface(image, copy);
      let placement = placeImage(image, src.width, src.height, p.x, p.y, scale, { w: width, h: height }, spec.tiled ? 'repeat' : null);
      if (spec.cover) {
        // A background covers the canvas.
        const k = Math.max(width / src.width, height / src.height);
        placement = { ...placement, cx: width / 2, cy: height / 2, sx: k, sy: k };
      }
      const layer = createImageLayer(m.name, placement, {
        ...(s.selection ? { mask: actions.maskFromSelection() } : {}),
        ...(toning ? { effects: { tone: defaultTone(dpi) } } : {}),
      });
      actions.changeDoc(`Paste material`, (doc, st) => {
        actions.insertNew(doc, layer, st.activeLayerId);
        return layer.id;
      });
      return layer.id;
    }
    case 'tone':
      return actions.addToneLayer({ frequency: defaultTone(dpi).frequency, value: spec.value, shape: spec.shape, angle: spec.angle });
    case 'lines': {
      const sub = getState().subTools.find((t) => t.id === spec.subTool);
      if (!sub?.effectLines) return null;
      const o = { ...sub.effectLines, destination: 'new' as const };
      const focus = o.style.kind === 'focus';
      const r = Math.min(width, height) * 0.18;
      const item = newLines(o, focus ? { cx: p.x, cy: p.y, rx: r, ry: r, rotation: 0 } : { cx: p.x, cy: p.y, rx: height * 0.3, ry: 0, rotation: Math.PI / 2 }, null);
      const layer = createLinesLayer(m.name, [item], o.toning ? { effects: { tone: defaultTone(dpi) } } : {});
      actions.changeDoc(`Paste material`, (doc, st) => {
        actions.insertNew(doc, layer, st.activeLayerId);
        return layer.id;
      });
      return layer.id;
    }
    case 'frame': {
      const t = FRAME_TEMPLATES.find((x) => x.id === spec.template);
      if (!t) return null;
      const page = polygonBounds(pageFrame(s.doc));
      addFrameTemplate(templatePanels(t, page, mmToPx(2, dpi), mmToPx(4, dpi), { w: width, h: height }), Math.max(1, Math.round(mmToPx(0.4, dpi))), true, false);
      return getState().activeLayerId;
    }
    case 'balloon': {
      const w = Math.min(width, height) * 0.32;
      const h = w * 0.66;
      addBalloon({
        id: newObjectId('b'),
        shape: spec.shape,
        x: p.x - w / 2,
        y: p.y - h / 2,
        w,
        h,
        angle: 0,
        lineWidth: Math.max(1, Math.round(mmToPx(0.3, dpi))),
        lineColor: '#000000',
        fillColor: '#ffffff',
        tails: [{ id: newObjectId('q'), tip: { x: p.x - w * 0.35, y: p.y + h * 0.9 }, width: w * 0.12, bend: 0.3, kind: spec.shape === 'cloud' ? 'thought' : 'pointed' }],
      });
      return getState().activeLayerId;
    }
  }
}

/** The MIME type a material is dragged with. */
export const MATERIAL_MIME = 'application/x-mad-material';
