import { uid } from './ids';
import { createRasterLayer } from './layers';
import type { PaintDocument } from './types';

export interface CanvasPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  dpi: number;
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: 'uxga', label: 'UXGA (1600 x 1200px)', width: 1600, height: 1200, dpi: 72 },
  { id: 'a4', label: 'A4 color (350dpi)', width: 2894, height: 4093, dpi: 350 },
  { id: 'b5-comic', label: 'B5 comic page (350dpi)', width: 2508, height: 3541, dpi: 350 },
  { id: 'fullhd', label: 'Full HD (1920 x 1080px)', width: 1920, height: 1080, dpi: 72 },
  { id: 'square', label: 'Square (2000 x 2000px)', width: 2000, height: 2000, dpi: 350 },
  { id: 'social', label: 'Social post (1080 x 1350px)', width: 1080, height: 1350, dpi: 72 },
];

export const MAX_CANVAS_SIDE = 8000;
export const MIN_CANVAS_SIDE = 16;

export function clampCanvasSide(n: number): number {
  if (!Number.isFinite(n)) return MIN_CANVAS_SIDE;
  return Math.min(MAX_CANVAS_SIDE, Math.max(MIN_CANVAS_SIDE, Math.round(n)));
}

export function createDocument(name: string, width: number, height: number, dpi = 72): PaintDocument {
  return {
    id: uid('d'),
    name,
    width: clampCanvasSide(width),
    height: clampCanvasSide(height),
    dpi,
    paper: { visible: true, color: '#ffffff' },
    layers: [createRasterLayer('Layer 1')],
  };
}
