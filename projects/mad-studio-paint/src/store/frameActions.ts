/**
 * Comic frames: frame border folders (a folder whose content shows only inside its panels), made
 * from the Layer menu or the frame tools, divided with gutters, edited with the Object tool.
 */
import { createFolder, findLayer, flatten, isEffectivelyVisible, locate, nextLayerName } from '../model/layers';
import type { Id, Layer, PaintDocument } from '../model/types';
import { divideEqually, insidePanel, mmToPx, newPanelId, rectPoints, splitPanel, type FrameBorder, type FramePanel } from '../paint/frames';
import type { Pt } from '../paint/rulers';
import * as actions from './actions';
import { getState, setState, type PaintState } from './store';

/** Index of the top-level layer that holds `id` (itself or a folder around it). */
function topLevelIndex(layers: Layer[], id: Id): number {
  return layers.findIndex((l) => l.id === id || (l.kind === 'folder' && flatten(l.children).some((c) => c.id === id)));
}

/** Frame border folders go to the top level, above the current layer's folder. */
function insertFrameFolder(doc: PaintDocument, folder: Layer, activeId: Id): void {
  const i = topLevelIndex(doc.layers, activeId);
  doc.layers.splice(Math.max(0, i), 0, folder);
}

const frameFolder = (name: string, frame: FrameBorder) => createFolder(name, [], { frame, blend: 'normal' });

/** A new frame border folder with one panel (frame tools, Layer > New frame border folder). */
export function addFrameFolder(points: Pt[], lineWidth: number, draw = true, color = '#000000'): void {
  const s = getState();
  const folder = frameFolder(nextLayerName(s.doc, 'Frame'), { panels: [{ id: newPanelId(), points }], lineWidth, color, draw });
  actions.changeDoc('New frame border folder', (doc, st) => {
    insertFrameFolder(doc, folder, st.activeLayerId);
    return folder.id;
  });
}

/**
 * Frame templates: one frame border folder per frame (in reading order, the first on top), or one
 * folder holding all frames.
 */
export function addFrameTemplate(panels: Pt[][], lineWidth: number, draw: boolean, separate: boolean): void {
  if (panels.length === 0) return;
  actions.changeDoc('Frame template', (doc, st) => {
    const border = (list: Pt[][]): FrameBorder => ({ panels: list.map((points) => ({ id: newPanelId(), points })), lineWidth, color: '#000000', draw });
    // Unique names, counting up from the free ones.
    const used = new Set(flatten(doc.layers).map((l) => l.name));
    let n = 1;
    const name = () => {
      while (used.has(`Frame ${n}`)) n++;
      used.add(`Frame ${n}`);
      return `Frame ${n}`;
    };
    const folders = separate ? panels.map((p) => frameFolder(name(), border([p]))) : [frameFolder(name(), border(panels))];
    // Each goes right above the current layer's place, below the ones before: the first ends on top.
    for (const f of folders) insertFrameFolder(doc, f, st.activeLayerId);
    return folders[0].id;
  });
}

/** The page frame: the canvas inside a margin of 5 % of its shorter side (there is no inner border setting). */
export function pageFrame(doc: PaintDocument): Pt[] {
  const m = Math.round(Math.min(doc.width, doc.height) * 0.05);
  return rectPoints(m, m, doc.width - 2 * m, doc.height - 2 * m);
}

/** The frame border folder of the active layer: the layer itself or the folder around it. */
export function activeFrameFolder(s: PaintState = getState()): actions.FrameFolder | null {
  let loc = locate(s.doc.layers, s.activeLayerId);
  while (loc) {
    if (actions.isFrameFolder(loc.layer)) return loc.layer;
    loc = loc.parent ? locate(s.doc.layers, loc.parent.id) : null;
  }
  return null;
}

/** The visible frame panel under p (the active layer's frame first). */
export function panelAt(p: Pt): { folder: actions.FrameFolder; panel: FramePanel } | null {
  const s = getState();
  const active = activeFrameFolder(s);
  const folders = flatten(s.doc.layers).filter((l): l is actions.FrameFolder => actions.isFrameFolder(l) && isEffectivelyVisible(s.doc.layers, l.id));
  folders.sort((a, b) => Number(b.id === active?.id) - Number(a.id === active?.id));
  for (const folder of folders) {
    const panel = folder.frame.panels.find((x) => insidePanel(x.points, p));
    if (panel) return { folder, panel };
  }
  return null;
}

/** True when the segment a–b crosses an edge of the polygon. */
function crosses(points: Pt[], a: Pt, b: Pt): boolean {
  const side = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const c = points[j];
    const d = points[i];
    if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true;
  }
  return false;
}

/**
 * The frame a dividing cut (a–b) is meant for: the one around its middle, else the first one it
 * crosses (the active layer's frames first).
 */
export function panelForCut(a: Pt, b: Pt): { folder: actions.FrameFolder; panel: FramePanel } | null {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const inside = panelAt(mid);
  if (inside) return inside;
  const s = getState();
  const active = activeFrameFolder(s);
  const folders = flatten(s.doc.layers).filter((l): l is actions.FrameFolder => actions.isFrameFolder(l) && isEffectivelyVisible(s.doc.layers, l.id));
  folders.sort((x, y) => Number(y.id === active?.id) - Number(x.id === active?.id));
  for (const folder of folders) {
    const panel = folder.frame.panels.find((x) => crosses(x.points, a, b));
    if (panel) return { folder, panel };
  }
  return null;
}

/**
 * Divide frame border: splits a panel along a cut with a gutter. The second part (below or right)
 * becomes a new, empty frame border folder above (or another panel of the same folder).
 */
export function dividePanel(folderId: Id, panelId: string, a: Pt, b: Pt, gap: number, newFolder: boolean): boolean {
  const s = getState();
  const folder = findLayer(s.doc.layers, folderId);
  if (!actions.isFrameFolder(folder)) return false;
  const panel = folder.frame.panels.find((x) => x.id === panelId);
  const parts = panel ? splitPanel(panel.points, a, b, gap) : null;
  if (!parts) return false;
  replacePanel(folderId, panelId, parts, newFolder, 'Divide frame border');
  return true;
}

/** Replaces a panel by several: the first keeps its place, the others go into new folders or stay. */
function replacePanel(folderId: Id, panelId: string, parts: Pt[][], newFolders: boolean, label: string): void {
  actions.changeDoc(label, (doc) => {
    const f = findLayer(doc.layers, folderId);
    if (!actions.isFrameFolder(f)) return;
    const [first, ...rest] = parts;
    const panels = f.frame.panels.map((x) => (x.id === panelId ? { ...x, points: first } : x));
    if (!newFolders) {
      f.frame = { ...f.frame, panels: [...panels, ...rest.map((points) => ({ id: newPanelId(), points }))] };
      return f.id;
    }
    f.frame = { ...f.frame, panels };
    const loc = locate(doc.layers, folderId)!;
    // New folders above, in reading order from the top.
    rest
      .slice()
      .reverse()
      .forEach((points) => loc.siblings.splice(loc.index, 0, frameFolder(nextLayerName(doc, 'Frame'), { ...f.frame, panels: [{ id: newPanelId(), points }] })));
    return f.id;
  });
}

/** Layer > Ruler/Frame > Divide frame border equally: the selected panel (or the first) of the current frame folder. */
export function divideFrameEqually(cols: number, rows: number, gapXmm: number, gapYmm: number, newFolders: boolean): void {
  const s = getState();
  const folder = activeFrameFolder(s);
  if (!folder) {
    setState({ hint: 'Select a frame border folder first' });
    return;
  }
  const panel = folder.frame.panels.find((x) => s.selectedObjects.includes(x.id)) ?? folder.frame.panels[0];
  const parts = divideEqually(panel.points, Math.max(1, Math.round(cols)), Math.max(1, Math.round(rows)), mmToPx(gapXmm, s.doc.dpi), mmToPx(gapYmm, s.doc.dpi));
  if (parts.length < 2) {
    setState({ hint: 'The frame is too small for that many divisions' });
    return;
  }
  replacePanel(folder.id, panel.id, parts, newFolders, 'Divide frame border equally');
}

/** Border settings of the frame border folder (Object tool): line width, colour, draw border. */
export function setFrameProps(folderId: Id, patch: Partial<Pick<FrameBorder, 'lineWidth' | 'color' | 'draw'>>, key?: string): void {
  actions.changeDoc(
    'Frame border',
    (doc) => {
      const f = findLayer(doc.layers, folderId);
      if (actions.isFrameFolder(f)) f.frame = { ...f.frame, ...patch };
    },
    { key },
  );
}
