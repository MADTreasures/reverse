/**
 * Sub View palette state: the reference images (kept in the browser's database, so they stay when
 * another canvas opens and after a restart, like in the reference), the one shown, how it is shown
 * (zoom or fit, rotation, flips, pan) and the palette's switches (eyedropper, command bar).
 */
import { create } from 'zustand';
import { idbGet, idbSet } from '../io/idb';
import { moveItem } from '../paint/subView';

export interface SubImage {
  id: string;
  name: string;
  blob: Blob;
  /** Object URL for thumbnails. */
  url: string;
  bitmap: ImageBitmap;
}

export interface SubViewView {
  zoom: number;
  /** Fit to Navigator: the zoom follows the palette size until zoomed by hand. */
  fit: boolean;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  panX: number;
  panY: number;
}

interface SubViewState {
  images: SubImage[];
  index: number;
  view: SubViewView;
  /** Switch to eyedropper automatically: clicking the image picks its colour (off: the hand pans). */
  eyedropper: boolean;
  commandBar: boolean;
  listOpen: boolean;
}

const FIT_VIEW: SubViewView = { zoom: 1, fit: true, rotation: 0, flipH: false, flipV: false, panX: 0, panY: 0 };

export const useSubView = create<SubViewState>(() => ({ images: [], index: 0, view: { ...FIT_VIEW }, eyedropper: true, commandBar: true, listOpen: false }));

const get = () => useSubView.getState();
const set = useSubView.setState;

export const currentImage = (s: SubViewState = get()): SubImage | null => s.images[Math.min(s.index, s.images.length - 1)] ?? null;

// ------------------------------------------------------------------ saving

const KEY = 'subview';
let loaded = false;

interface Saved {
  images: { id: string; name: string; blob: Blob }[];
  index: number;
  eyedropper: boolean;
  commandBar: boolean;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save(): void {
  if (!loaded) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = get();
    const data: Saved = { images: s.images.map(({ id, name, blob }) => ({ id, name, blob })), index: s.index, eyedropper: s.eyedropper, commandBar: s.commandBar };
    void idbSet(KEY, data);
  }, 200);
}

async function decode(id: string, name: string, blob: Blob): Promise<SubImage | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    return { id, name, blob, url: URL.createObjectURL(blob), bitmap };
  } catch {
    return null;
  }
}

/** The images of the last session. */
export async function loadSubView(): Promise<void> {
  const saved = await idbGet<Saved>(KEY);
  if (saved && Array.isArray(saved.images)) {
    const images = (await Promise.all(saved.images.filter((x) => x && x.blob instanceof Blob).map((x) => decode(String(x.id), String(x.name ?? 'Image'), x.blob)))).filter((x): x is SubImage => x !== null);
    set((s) => ({
      images: [...images, ...s.images],
      index: Math.max(0, Math.min(images.length - 1, Number(saved.index) || 0)),
      eyedropper: saved.eyedropper !== false,
      commandBar: saved.commandBar !== false,
    }));
  }
  loaded = true;
}

// ------------------------------------------------------------------ images

let nextId = 0;
const newId = () => `sv${Date.now().toString(36)}${(nextId++).toString(36)}`;

/** Import: images added after the others; the first of them is shown, fitted. */
export async function importImages(files: { name: string; blob: Blob }[]): Promise<number> {
  const added = (await Promise.all(files.map((f) => decode(newId(), f.name, f.blob)))).filter((x): x is SubImage => x !== null);
  if (!added.length) return 0;
  set((s) => ({ images: [...s.images, ...added], index: s.images.length, view: { ...FIT_VIEW }, listOpen: false }));
  save();
  return added.length;
}

/** Palette menu > Import from clipboard: the images on the system clipboard. */
export async function importFromClipboard(): Promise<number> {
  try {
    const items = await navigator.clipboard.read();
    const blobs: { name: string; blob: Blob }[] = [];
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) blobs.push({ name: 'Clipboard', blob: await item.getType(type) });
    }
    return await importImages(blobs);
  } catch {
    return 0;
  }
}

/** Shows the image at `i` (fitted). */
export function showImage(i: number): void {
  const s = get();
  if (!s.images.length) return;
  set({ index: ((i % s.images.length) + s.images.length) % s.images.length, view: { ...FIT_VIEW } });
  save();
}

export const nextImage = () => showImage(get().index + 1);
export const previousImage = () => showImage(get().index - 1);

/** Image list: drags an image to another place. */
export function moveImage(from: number, to: number): void {
  const s = get();
  const shown = s.images[s.index];
  const images = moveItem(s.images, from, to);
  set({ images, index: Math.max(0, images.indexOf(shown)) });
  save();
}

/** Clear (or the image list's ×): takes an image out of the palette. */
export function removeImage(i = get().index): void {
  const s = get();
  const img = s.images[i];
  if (!img) return;
  URL.revokeObjectURL(img.url);
  img.bitmap.close();
  const images = s.images.filter((_, k) => k !== i);
  const index = Math.max(0, Math.min(images.length - 1, i < s.index ? s.index - 1 : s.index));
  set({ images, index, ...(i === s.index ? { view: { ...FIT_VIEW } } : {}) });
  save();
}

// ------------------------------------------------------------------ view and switches

export function setSubView(patch: Partial<SubViewView>): void {
  set((s) => ({ view: { ...s.view, ...patch } }));
}

/** Fit to Navigator: the whole image in the palette, centred. */
export const fitSubView = () => setSubView({ fit: true, panX: 0, panY: 0 });

export function setEyedropper(on: boolean): void {
  set({ eyedropper: on });
  save();
}

export function setCommandBar(on: boolean): void {
  set({ commandBar: on });
  save();
}

export const toggleImageList = () => set((s) => ({ listOpen: !s.listOpen }));
