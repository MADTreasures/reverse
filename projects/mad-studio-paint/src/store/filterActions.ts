/**
 * Filter menu on the current layer: a session holds the layer's pixels while a dialog previews,
 * OK records one undo step. Inside a selection only the selected pixels change.
 */
import { hexToRgb } from '../model/color';
import { contentRect } from '../paint/filters/core';
import { filterRegion, filterSpec, runFilter, type FilterContext, type FilterId, type FilterValues, type Img, type Rect } from '../paint/filters';
import { maskBounds } from '../paint/mask';
import * as actions from './actions';
import { drawingColor, getState, setState } from './store';

export interface FilterSession {
  preview: actions.FilterPreview;
  /** The layer before the filter. */
  source: Img;
  /** The selection's bounds, or the whole layer. */
  area: Rect;
  content: Rect | null;
  ctx: FilterContext;
}

/** Starts filtering the current layer, or null (with the reason as a hint) when it cannot be filtered. */
export function startFilter(): FilterSession | null {
  const preview = new actions.FilterPreview();
  const pixels = preview.ok ? preview.pixels : null;
  if (!pixels) {
    setState({ hint: actions.rasterOnlyBlocker() ?? 'Select a raster layer first' });
    return null;
  }
  const source: Img = { data: pixels.data, width: pixels.width, height: pixels.height };
  const s = getState();
  const sel = s.selection ? maskBounds(s.selection) : null;
  const area = sel ?? { x: 0, y: 0, w: source.width, h: source.height };
  const rgb = hexToRgb(drawingColor(s.colors)) ?? { r: 0, g: 0, b: 0 };
  return {
    preview,
    source,
    area,
    content: contentRect(source),
    ctx: { bounds: area, color: [rgb.r, rgb.g, rgb.b], seed: Math.floor(Math.random() * 2 ** 31) },
  };
}

/** The rectangle filter `id` changes, or null when there is nothing for it to do. */
export const filterRect = (session: FilterSession, id: FilterId, values: FilterValues): Rect | null => filterRegion(id, values, session.source, session.area, session.content);

/** Filters without settings (Blur, Sharpen, Smoothing …) run straight from the menu. */
export function applyFilterNow(id: FilterId): void {
  const session = startFilter();
  if (!session) return;
  const rect = filterRect(session, id, {});
  if (!rect) {
    session.preview.cancel();
    return;
  }
  session.preview.applyPixels(runFilter(id, session.source, {}, rect, session.ctx), rect);
  session.preview.commit(filterSpec(id).label);
}
