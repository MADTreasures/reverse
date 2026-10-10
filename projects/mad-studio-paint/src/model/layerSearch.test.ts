import { describe, expect, it } from 'vitest';
import { fitZoom, moveItem, wrapAngle, zoomStep } from '../paint/subView';
import { createFillLayer, createFolder, createRasterLayer, createTextLayer, createVectorLayer } from './layers';
import { ALL_TYPES, NO_SEARCH, searchLayers, typesOf } from './layerSearch';
import { DEFAULT_HIDDEN_PALETTES, PALETTE_NAMES, stackOf } from './palettes';

function canvas() {
  const sky = createRasterLayer('Sky', { id: 'sky', locked: true });
  const ink = createVectorLayer('Ink lines', { id: 'ink', reference: true });
  const tone = createFillLayer('Dot tone', '#000000', { id: 'tone', effects: { tone: { frequency: 60, density: 'color', angle: 45, shape: 'circle', posterize: false } } as never });
  const words = createTextLayer('Words', { id: 'words', visible: false });
  const inner = createRasterLayer('Inner', { id: 'inner', draft: true });
  const frame = createFolder('Frame 1', [inner], { id: 'frame', frame: { panels: [], border: { width: 4, color: '#000000', visible: true } } as never });
  const flat = createRasterLayer('Flat colours', { id: 'flat', lockAlpha: true });
  const folder = createFolder('Character', [flat, words], { id: 'char' });
  return [ink, tone, folder, frame, sky];
}

const names = (q: Partial<typeof NO_SEARCH>, active = 'flat') => searchLayers(canvas(), { ...NO_SEARCH, ...q }, active).map((l) => l.id);

describe('Search Layer', () => {
  it('lists every layer, top to bottom, without filters', () => {
    expect(names({})).toEqual(['ink', 'tone', 'char', 'flat', 'words', 'frame', 'inner', 'sky']);
  });

  it('filters by layer type (a tone layer is a fill layer too)', () => {
    expect(names({ types: ['raster'] })).toEqual(['flat', 'inner', 'sky']);
    expect(names({ types: ['tone'] })).toEqual(['tone']);
    expect(names({ types: ['fill'] })).toEqual(['tone']);
    expect(names({ types: ['frame', 'text'] })).toEqual(['words', 'frame']);
    expect(typesOf(canvas()[0])).toEqual(['vector']);
    expect(ALL_TYPES.length).toBeGreaterThan(10);
  });

  it('Include keeps layers with every condition, Exclude drops layers with any', () => {
    expect(names({ include: ['locked'] })).toEqual(['sky']);
    expect(names({ include: ['reference'] })).toEqual(['ink']);
    expect(names({ include: ['lockAlpha'] })).toEqual(['flat']);
    expect(names({ exclude: ['visible'] })).toEqual(['words']);
    expect(names({ exclude: ['draft', 'locked', 'reference'] })).toEqual(['tone', 'char', 'flat', 'words', 'frame']);
  });

  it('Outside current folder / frame folder: relative to the layer being edited', () => {
    expect(names({ exclude: ['outsideFolder'] })).toEqual(['char', 'flat', 'words']);
    expect(names({ exclude: ['outsideFrame'] }, 'inner')).toEqual(['frame', 'inner']);
    // Not inside a frame border folder: nothing is outside it.
    expect(names({ exclude: ['outsideFrame'] }).length).toBe(8);
  });

  it('search keywords: a phrase in the name, any case', () => {
    expect(names({ text: 'IN' })).toEqual(['ink', 'inner']);
    expect(names({ text: ' colours ' })).toEqual(['flat']);
  });
});

describe('palettes', () => {
  it('every palette has a stack in both workspaces; the extra palettes start hidden', () => {
    for (const [id] of PALETTE_NAMES) {
      expect(stackOf(id, 'default')).toBeTruthy();
      expect(stackOf(id, 'classic')).toBeTruthy();
    }
    expect(stackOf('intermediateColor', 'default')).toBe('colorSet');
    expect(stackOf('colorWheel', 'classic')).toBe(stackOf('approximateColor', 'classic'));
    expect(DEFAULT_HIDDEN_PALETTES).toEqual(['subView', 'intermediateColor', 'approximateColor', 'searchLayer', 'quickAccess', 'autoAction']);
    expect(stackOf('quickAccess', 'default')).toBe('colorSet');
    expect(stackOf('autoAction', 'default')).toBe('layerProperty');
  });
});

describe('Sub View', () => {
  it('fits an image, also turned', () => {
    expect(fitZoom({ w: 400, h: 200 }, { w: 200, h: 200 }, 0)).toBe(0.5);
    // Turned by 90°: 200 wide, 400 high.
    expect(fitZoom({ w: 400, h: 200 }, { w: 200, h: 200 }, 90)).toBeCloseTo(0.5, 6);
    expect(fitZoom({ w: 100, h: 100 }, { w: 200, h: 200 }, 45)).toBeCloseTo(200 / (100 * Math.SQRT2), 6);
  });

  it('zooms in steps, wraps angles and reorders the image list', () => {
    expect(zoomStep(1, 1)).toBe(1.25);
    expect(zoomStep(1, -1)).toBe(0.7);
    expect(zoomStep(0.43, 1)).toBe(0.5);
    expect(zoomStep(32, 1)).toBe(32);
    expect(wrapAngle(185)).toBe(-175);
    expect(wrapAngle(-185)).toBe(175);
    expect(wrapAngle(180)).toBe(180);
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });
});
