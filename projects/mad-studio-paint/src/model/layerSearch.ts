/**
 * Search Layer palette, like the reference's: the layers of the canvas filtered by layer type, by
 * properties they must have (Include) or must not have (Exclude) and by a phrase in their name.
 * Pure, unit tested.
 */
import { findLayer, flatten } from './layers';
import type { Id, Layer } from './types';

export type LayerType =
  | 'raster'
  | 'vector'
  | 'text'
  | 'balloon'
  | 'gradient'
  | 'fill'
  | 'tone'
  | 'focusLines'
  | 'speedLines'
  | 'correction'
  | 'folder'
  | 'frame'
  | 'animation'
  | 'camera'
  | 'audio'
  | 'movie'
  | 'mask'
  | 'ruler';

export const LAYER_TYPES: [LayerType, string][] = [
  ['raster', 'Raster layer'],
  ['vector', 'Vector layer'],
  ['text', 'Text layer'],
  ['balloon', 'Balloon layer'],
  ['gradient', 'Gradient layer'],
  ['fill', 'Fill layer'],
  ['tone', 'Tone layer'],
  ['focusLines', 'Focus lines layer'],
  ['speedLines', 'Speed lines layer'],
  ['correction', 'Correction layer'],
  ['folder', 'Layer folder'],
  ['frame', 'Frame border folder'],
  ['animation', 'Animation folder'],
  ['camera', '2D camera folder'],
  ['audio', 'Audio layer'],
  ['movie', 'Movie layer'],
  ['mask', 'Layer mask'],
  ['ruler', 'Ruler'],
];

/** Include / Exclude conditions. */
export type LayerCondition = 'visible' | 'locked' | 'lockAlpha' | 'reference' | 'draft' | 'outsideFolder' | 'outsideFrame' | 'outsideAnimation';

export const INCLUDE_CONDITIONS: [LayerCondition, string][] = [
  ['visible', 'Visible'],
  ['locked', 'Locked'],
  ['lockAlpha', 'Locked transparent pixels'],
  ['reference', 'Reference layer'],
];

export const EXCLUDE_CONDITIONS: [LayerCondition, string][] = [
  ['visible', 'Visible'],
  ['locked', 'Locked'],
  ['lockAlpha', 'Locked transparent pixels'],
  ['reference', 'Reference layer'],
  ['draft', 'Draft layer'],
  ['outsideFolder', 'Outside current folder'],
  ['outsideFrame', 'Outside current frame folder'],
  ['outsideAnimation', 'Outside current animation folder'],
];

export interface LayerSearch {
  /** Layer types shown (all of them: no filter). */
  types: LayerType[];
  include: LayerCondition[];
  exclude: LayerCondition[];
  /** Search keywords: a phrase the name contains (any case). */
  text: string;
}

export const ALL_TYPES: LayerType[] = LAYER_TYPES.map(([t]) => t);
export const NO_SEARCH: LayerSearch = { types: ALL_TYPES, include: [], exclude: [], text: '' };

/** The types a layer counts as (a tone layer is a fill layer too; a masked layer is also a layer mask). */
export function typesOf(l: Layer): LayerType[] {
  const out: LayerType[] = [];
  if (l.kind === 'folder') out.push(l.frame ? 'frame' : l.animation ? 'animation' : l.camera ? 'camera' : 'folder');
  else if (l.kind === 'text') out.push(l.balloons.length ? 'balloon' : 'text');
  else if (l.kind === 'lines') out.push(l.items[0]?.kind === 'speed' ? 'speedLines' : 'focusLines');
  else out.push(l.kind);
  if (l.effects?.tone) out.push('tone');
  if (l.mask) out.push('mask');
  if (l.rulers) out.push('ruler');
  return out;
}

/** The folders a layer is inside, innermost first. */
function parentsOf(layers: Layer[], id: Id): Layer[] {
  const out: Layer[] = [];
  const walk = (list: Layer[], trail: Layer[]): boolean => {
    for (const l of list) {
      if (l.id === id) {
        out.push(...[...trail].reverse());
        return true;
      }
      if (l.kind === 'folder' && walk(l.children, [...trail, l])) return true;
    }
    return false;
  };
  walk(layers, []);
  return out;
}

interface Context {
  /** The current folder, frame border folder and animation folder: around the layer being edited (or it). */
  current: Partial<Record<LayerCondition, Layer>>;
  parents: (id: Id) => Layer[];
}

function context(layers: Layer[], active: Id): Context {
  const a = findLayer(layers, active);
  const around = a ? [a, ...parentsOf(layers, active)] : [];
  const folder = (test: (f: Layer) => boolean) => around.find((x) => x.kind === 'folder' && test(x));
  return {
    current: { outsideFolder: folder(() => true), outsideFrame: folder((f) => f.kind === 'folder' && Boolean(f.frame)), outsideAnimation: folder((f) => f.kind === 'folder' && Boolean(f.animation)) },
    parents: (id) => parentsOf(layers, id),
  };
}

/** Whether a layer has a property; "outside": not in the current folder of that kind (when there is one). */
function has(l: Layer, c: LayerCondition, ctx: Context): boolean {
  switch (c) {
    case 'visible':
      return l.visible;
    case 'locked':
      return l.locked;
    case 'lockAlpha':
      return l.kind === 'raster' && l.lockAlpha;
    case 'reference':
      return l.reference;
    case 'draft':
      return l.draft;
    default: {
      const f = ctx.current[c];
      return f !== undefined && l.id !== f.id && !ctx.parents(l.id).some((p) => p.id === f.id);
    }
  }
}

/** The layers that pass the search, top to bottom. */
export function searchLayers(layers: Layer[], q: LayerSearch, active: Id): Layer[] {
  const text = q.text.trim().toLowerCase();
  const ctx = context(layers, active);
  const allTypes = ALL_TYPES.every((t) => q.types.includes(t));
  return flatten(layers).filter(
    (l) =>
      (allTypes || typesOf(l).some((t) => q.types.includes(t))) &&
      q.include.every((c) => has(l, c, ctx)) &&
      !q.exclude.some((c) => has(l, c, ctx)) &&
      (!text || l.name.toLowerCase().includes(text)),
  );
}
