import { describe, expect, it } from 'vitest';
import { BLEND_MODES, compositeOp, nativeOp } from './blend';
import { cmykToRgb, hexToRgb, hlsToRgb, hsvToRgb, pushHistory, rgbToCmyk, rgbToHex, rgbToHls, rgbToHsv } from './color';
import { clampCanvasSide, createDocument } from './document';
import {
  clipGroups,
  cloneLayer,
  createFolder,
  createLayerMask,
  createRasterLayer,
  findLayer,
  flatten,
  insertAbove,
  isEffectivelyLocked,
  isEffectivelyVisible,
  layerBelow,
  moveLayer,
  maskIds,
  nextLayerName,
  pixelIds,
  removeLayer,
  shiftLayer,
} from './layers';

describe('color spaces of the colour palettes', () => {
  it('converts HLS both ways', () => {
    expect(hlsToRgb({ h: 0, l: 0.5, s: 1 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hlsToRgb({ h: 120, l: 0.75, s: 1 })).toEqual({ r: 128, g: 255, b: 128 });
    expect(hlsToRgb({ h: 240, l: 0.25, s: 0 })).toEqual({ r: 64, g: 64, b: 64 });
    for (const rgb of [
      { r: 12, g: 200, b: 99 },
      { r: 255, g: 255, b: 255 },
      { r: 140, g: 30, b: 70 },
    ]) {
      const back = hlsToRgb(rgbToHls(rgb));
      for (const k of ['r', 'g', 'b'] as const) expect(Math.abs(back[k] - rgb[k])).toBeLessThanOrEqual(1);
    }
    // Grey keeps the hue it had.
    expect(rgbToHls({ r: 100, g: 100, b: 100 }, 200).h).toBe(200);
  });

  it('converts CMYK both ways with black taking the common part', () => {
    expect(rgbToCmyk({ r: 0, g: 0, b: 0 })).toEqual({ c: 0, m: 0, y: 0, k: 1 });
    expect(rgbToCmyk({ r: 255, g: 0, b: 0 })).toEqual({ c: 0, m: 1, y: 1, k: 0 });
    const c = rgbToCmyk({ r: 51, g: 102, b: 153 });
    expect(c.k).toBeCloseTo(0.4, 5);
    expect(cmykToRgb(c)).toEqual({ r: 51, g: 102, b: 153 });
  });
});

describe('color', () => {
  it('round-trips hex ↔ rgb ↔ hsv', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#12ab9f', '#7f7f7f', '#3366cc']) {
      const rgb = hexToRgb(hex)!;
      expect(rgbToHex(rgb)).toBe(hex);
      expect(rgbToHex(hsvToRgb(rgbToHsv(rgb)))).toBe(hex);
    }
  });

  it('parses short hex and rejects garbage', () => {
    expect(hexToRgb('#f80')).toEqual({ r: 255, g: 136, b: 0 });
    expect(hexToRgb('nope')).toBeNull();
  });

  it('keeps the hue for greys when given a fallback', () => {
    expect(rgbToHsv({ r: 128, g: 128, b: 128 }, 200).h).toBe(200);
  });

  it('color history moves repeats to the front and caps the length', () => {
    let h: string[] = [];
    for (let i = 0; i < 30; i++) h = pushHistory(h, `#0000${i.toString(16).padStart(2, '0')}`);
    expect(h).toHaveLength(24);
    h = pushHistory(h, '#00000A');
    expect(h[0]).toBe('#00000a');
    expect(h.filter((c) => c === '#00000a')).toHaveLength(1);
  });
});

describe('layers', () => {
  const setup = () => {
    const a = createRasterLayer('A');
    const b = createRasterLayer('B');
    const c = createRasterLayer('C');
    const folder = createFolder('F', [b, c]);
    const layers = [a, folder];
    return { a, b, c, folder, layers };
  };

  it('finds, flattens and inserts layers', () => {
    const { a, c, folder, layers } = setup();
    expect(flatten(layers).map((l) => l.name)).toEqual(['A', 'F', 'B', 'C']);
    expect(findLayer(layers, c.id)).toBe(c);
    const n = createRasterLayer('N');
    insertAbove(layers, n, c.id);
    expect(folder.children.map((l) => l.name)).toEqual(['B', 'N', 'C']);
    insertAbove(layers, createRasterLayer('Top'), null);
    expect(layers[0].name).toBe('Top');
    expect(removeLayer(layers, a.id)).toBe(a);
    expect(findLayer(layers, a.id)).toBeNull();
  });

  it('moves layers, but never a folder into itself', () => {
    const { a, b, folder, layers } = setup();
    expect(moveLayer(layers, a.id, b.id, 'below')).toBe(true);
    expect(folder.children.map((l) => l.name)).toEqual(['B', 'A', 'C']);
    expect(moveLayer(layers, folder.id, b.id, 'above')).toBe(false);
    expect(moveLayer(layers, folder.id, folder.id, 'inside')).toBe(false);
    expect(moveLayer(layers, a.id, folder.id, 'inside')).toBe(true);
    expect(folder.children[0]).toBe(a);
  });

  it('shifts layers within their siblings', () => {
    const { b, c, folder, layers } = setup();
    expect(shiftLayer(layers, b.id, 1)).toBe(true);
    expect(folder.children).toEqual([c, b]);
    expect(shiftLayer(layers, b.id, 1)).toBe(false);
    expect(layerBelow(layers, c.id)).toBe(b);
  });

  it('inherits visibility and locks from folders', () => {
    const { b, folder, layers } = setup();
    expect(isEffectivelyVisible(layers, b.id)).toBe(true);
    folder.visible = false;
    expect(isEffectivelyVisible(layers, b.id)).toBe(false);
    folder.locked = true;
    expect(isEffectivelyLocked(layers, b.id)).toBe(true);
  });

  it('groups clipped layers onto the next non-clipped layer below', () => {
    const base = createRasterLayer('base');
    const shade = createRasterLayer('shade', { clip: true });
    const light = createRasterLayer('light', { clip: true });
    const top = createRasterLayer('top');
    const orphan = createRasterLayer('orphan', { clip: true });
    // Panel order: top-most first. The clipped layer at the very bottom has no base.
    const groups = clipGroups([top, light, shade, base, orphan]);
    expect(groups.map((g) => [g.base.name, ...g.clipped.map((l) => l.name)])).toEqual([['orphan'], ['base', 'shade', 'light'], ['top']]);
  });

  it('never clips onto a "Through" folder', () => {
    const through = createFolder('through', [], { blend: 'pass-through' });
    const clipped = createRasterLayer('clipped', { clip: true });
    const groups = clipGroups([clipped, through]);
    expect(groups.map((g) => [g.base.name, ...g.clipped.map((l) => l.name)])).toEqual([['through'], ['clipped']]);
    const normal = createFolder('normal');
    expect(clipGroups([clipped, normal])[0].clipped).toEqual([clipped]);
  });

  it('clones with fresh ids and an id map', () => {
    const { folder } = setup();
    const { copy, idMap } = cloneLayer(folder);
    expect(copy.id).not.toBe(folder.id);
    expect(idMap.size).toBe(3);
    expect(flatten([copy]).map((l) => l.name)).toEqual(['F', 'B', 'C']);
  });

  it('gives masks their own pixels: listed, and copied with fresh ids', () => {
    const inner = createRasterLayer('Inner', { mask: createLayerMask() });
    const folder = createFolder('F', [inner], { mask: createLayerMask() });
    expect(pixelIds([folder])).toEqual([folder.mask!.id, inner.id, inner.mask!.id]);
    expect(maskIds([folder])).toEqual([folder.mask!.id, inner.mask!.id]);
    const { copy, idMap } = cloneLayer(folder);
    const copied = flatten([copy]);
    expect(copy.mask!.id).not.toBe(folder.mask!.id);
    expect(idMap.get(inner.mask!.id)).toBe(copied[1].mask!.id);
    expect(idMap.size).toBe(4);
  });

  it('names new layers uniquely', () => {
    const doc = createDocument('x', 100, 100);
    expect(nextLayerName(doc)).toBe('Layer 2');
  });
});

describe('document & blend', () => {
  it('clamps canvas sizes', () => {
    expect(clampCanvasSide(0)).toBe(16);
    expect(clampCanvasSide(99999)).toBe(8000);
    expect(clampCanvasSide(Number.NaN)).toBe(16);
    expect(createDocument('d', 1000.4, 500).width).toBe(1000);
  });

  it('maps blend modes to canvas operations', () => {
    expect(compositeOp('normal')).toBe('source-over');
    expect(compositeOp('pass-through')).toBe('source-over');
    expect(compositeOp('add-glow')).toBe('lighter');
    expect(compositeOp('multiply')).toBe('multiply');
    // Modes the canvas lacks are blended per pixel.
    expect(nativeOp('subtract')).toBeNull();
    expect(nativeOp('luminosity')).toBe('luminosity');
    expect(BLEND_MODES).toHaveLength(28);
  });
});
