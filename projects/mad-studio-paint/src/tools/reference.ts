/** Pixel sources for fill and auto select. */
import { flatten, locate } from '../model/layers';
import type { PaintDocument } from '../model/types';
import type { FillReference } from '../paint/tools';
import { createCanvas, ctx2d } from '../engine/canvas';
import { engine } from '../engine/engine';
import { getSurface } from '../engine/surfaces';

/** Ids of layers marked as reference layers, including everything inside reference folders. */
function referenceIds(doc: PaintDocument): Set<string> {
  const ids = new Set<string>();
  for (const l of flatten(doc.layers)) if (l.reference) for (const x of flatten([l])) ids.add(x.id);
  return ids;
}

/** Layer in folder: the layers in the same folder as the editing layer (at the top: every layer); a mask counts as its layer. */
function folderIds(doc: PaintDocument, editSurfaceId: string): Set<string> {
  const owner = flatten(doc.layers).find((l) => l.id === editSurfaceId || l.mask?.id === editSurfaceId);
  const parent = owner ? locate(doc.layers, owner.id)?.parent : null;
  return new Set(flatten(parent ? [parent] : doc.layers).map((l) => l.id));
}

/**
 * Draft layers, hidden layers and the paper are never referenced (as in the reference app's defaults).
 * "Editing layer only" reads `editSurfaceId`: the current layer, or its mask while the mask is edited.
 */
export function referencePixels(doc: PaintDocument, editSurfaceId: string, ref: FillReference): ImageData {
  const full = { x: 0, y: 0, w: doc.width, h: doc.height };
  if (ref === 'all') {
    const tmp = createCanvas(doc.width, doc.height);
    engine.compositor.compose(doc, ctx2d(tmp), full, { skipDraft: true });
    return ctx2d(tmp, true).getImageData(0, 0, doc.width, doc.height);
  }
  if (ref === 'reference' || ref === 'folder') {
    const ids = ref === 'reference' ? referenceIds(doc) : folderIds(doc, editSurfaceId);
    if (ids.size > 0) {
      const tmp = createCanvas(doc.width, doc.height);
      engine.compositor.compose(doc, ctx2d(tmp), full, { skipDraft: true, filter: (l) => ids.has(l.id) });
      return ctx2d(tmp, true).getImageData(0, 0, doc.width, doc.height);
    }
  }
  const s = getSurface(editSurfaceId);
  if (!s) return new ImageData(doc.width, doc.height);
  return ctx2d(s, true).getImageData(0, 0, doc.width, doc.height);
}
