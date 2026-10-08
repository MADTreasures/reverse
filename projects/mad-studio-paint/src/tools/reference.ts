/** Pixel sources for fill and auto select. */
import { flatten } from '../model/layers';
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

/** Draft layers, hidden layers and the paper are never referenced (as in the reference app's defaults). */
export function referencePixels(doc: PaintDocument, activeLayerId: string, ref: FillReference): ImageData {
  const full = { x: 0, y: 0, w: doc.width, h: doc.height };
  if (ref === 'all') {
    const tmp = createCanvas(doc.width, doc.height);
    engine.compositor.compose(doc, ctx2d(tmp), full, { skipDraft: true });
    return ctx2d(tmp, true).getImageData(0, 0, doc.width, doc.height);
  }
  if (ref === 'reference') {
    const ids = referenceIds(doc);
    if (ids.size > 0) {
      const tmp = createCanvas(doc.width, doc.height);
      engine.compositor.compose(doc, ctx2d(tmp), full, { skipDraft: true, filter: (l) => ids.has(l.id) });
      return ctx2d(tmp, true).getImageData(0, 0, doc.width, doc.height);
    }
  }
  const s = getSurface(activeLayerId);
  if (!s) return new ImageData(doc.width, doc.height);
  return ctx2d(s, true).getImageData(0, 0, doc.width, doc.height);
}
