import { readPsd, writePsdUint8Array } from 'ag-psd';
import { describe, expect, it } from 'vitest';
import { BLEND_MODES } from '../model/blend';
import { createDocument } from '../model/document';
import { createCorrectionLayer, createFolder, createLayerMask, createRasterLayer, flatten } from '../model/layers';
import type { FolderLayer, Id, Layer } from '../model/types';
import { rectPoints } from '../paint/frames';
import { CORRECTIONS, defaultCorrection, type Correction } from '../paint/tonal';
import { isPsdFileName } from './format';
import { decodePsd, encodeFlatPsd, encodePsd, fromAdjustment, fromPsdBlend, to8bit, toAdjustment, toPsdBlend, type Pixels, type PsdSource } from './psd';

const W = 40;
const H = 30;

function image(fill: (x: number, y: number) => [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set(fill(x, y), (y * W + x) * 4);
  return { width: W, height: H, data };
}

const at = (p: Pixels, x: number, y: number) => [...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)];

function source(doc: ReturnType<typeof createDocument>, pixels: Map<Id, Pixels>, patch: Partial<PsdSource> = {}): PsdSource {
  return {
    doc,
    composite: image(() => [255, 255, 255, 255]),
    skipDraft: true,
    layerPixels: (l: Layer) => pixels.get(l.id) ?? null,
    bakedPixels: (l: Layer) => pixels.get(l.id) ?? null,
    maskPixels: (m) => pixels.get(m.id) ?? null,
    frameShapes: () => ({ area: image(() => [0, 0, 0, 255]), border: null }),
    textPixels: () => image((x, y) => (x > 5 && x < 30 && y > 5 && y < 15 ? [0, 0, 0, 255] : [0, 0, 0, 0])),
    ...patch,
  };
}

function open(bytes: Uint8Array) {
  const pixels = new Map<Id, Pixels>();
  const result = decodePsd(bytes, 'Opened', (id, p) => pixels.set(id, p));
  return { ...result, pixels };
}

describe('PSD blending modes', () => {
  it('maps every mode to Photoshop and back (glow modes to their nearest)', () => {
    for (const { id } of BLEND_MODES) {
      const back = fromPsdBlend(toPsdBlend(id), false);
      expect(back).toBe(id === 'glow-dodge' ? 'color-dodge' : id === 'add-glow' ? 'add' : id);
    }
    expect(fromPsdBlend('pass through', true)).toBe('pass-through');
    expect(fromPsdBlend('pass through', false)).toBe('normal');
    expect(fromPsdBlend('dissolve', false)).toBe('normal');
    expect(fromPsdBlend('subtraction', false)).toBe('subtract');
  });
});

describe('PSD adjustment layers', () => {
  it('round-trips every correction type', () => {
    for (const { type } of CORRECTIONS) {
      const c = defaultCorrection(type);
      expect(fromAdjustment(toAdjustment(c))).toEqual(c);
    }
    const custom: Correction[] = [
      { type: 'brightnessContrast', brightness: 20, contrast: -35 },
      { type: 'hsl', hue: 90, saturation: -20, luminosity: 10 },
      { type: 'colorBalance', shadows: [10, 0, -5], midtones: [0, 20, 0], highlights: [-30, 0, 40], preserveLuminosity: false },
      { type: 'posterize', levels: 6 },
      { type: 'binarize', threshold: 90 },
      {
        type: 'gradientMap',
        stops: [
          { pos: 0, color: '#102030', opacity: 1 },
          { pos: 0.4, color: '#ff8800', opacity: 1 },
          { pos: 1, color: '#fafafa', opacity: 1 },
        ],
      },
    ];
    for (const c of custom) expect(fromAdjustment(toAdjustment(c))).toEqual(c);
  });

  it('leaves out adjustment kinds we have no correction layer for', () => {
    expect(fromAdjustment({ type: 'exposure', exposure: 1 })).toBeNull();
    expect(fromAdjustment({ type: 'invert' })).toEqual({ type: 'reverse' });
  });
});

describe('PSD documents', () => {
  it('round-trips layers, folders, masks, clipping and the paper', () => {
    const doc = createDocument('Test', W, H, 350);
    doc.paper = { visible: true, color: '#f0e8d0' };
    const ink = createRasterLayer('Ink', { blend: 'multiply', opacity: 0.5, lockAlpha: true });
    const shade = createRasterLayer('Shade', { clip: true, visible: false });
    const levels = createCorrectionLayer('Levels', { ...defaultCorrection('posterize'), levels: 5 } as Correction);
    const group = createFolder('Group', [shade, ink], { blend: 'pass-through', mask: createLayerMask() });
    const sketch = createRasterLayer('Sketch', { draft: true });
    doc.layers = [levels, group, sketch];
    const pixels = new Map<Id, Pixels>([
      [ink.id, image((x, y) => (x >= 10 && x < 20 && y >= 5 && y < 15 ? [200, 30, 40, 255] : [0, 0, 0, 0]))],
      [shade.id, image((x) => (x < 30 ? [0, 0, 255, 128] : [0, 0, 0, 0]))],
      [sketch.id, image(() => [9, 9, 9, 255])],
      [group.mask!.id, image((x) => [0, 0, 0, x < 20 ? 255 : 0])],
    ]);
    const bytes = encodePsd(source(doc, pixels));
    const { doc: back, pixels: got, notes } = open(bytes);

    expect(notes).toEqual([]);
    expect(back.width).toBe(W);
    expect(back.dpi).toBe(350);
    expect(back.paper).toEqual({ visible: true, color: '#f0e8d0' });
    // The draft layer was left out.
    expect(back.layers.map((l) => l.name)).toEqual(['Levels', 'Group']);
    const [c, g] = back.layers as [Layer, FolderLayer];
    expect(c.kind === 'correction' && c.correction).toEqual({ type: 'posterize', levels: 5 });
    expect(g.kind).toBe('folder');
    expect(g.blend).toBe('pass-through');
    expect(g.children.map((l) => [l.name, l.blend, l.clip, l.visible, l.opacity])).toEqual([
      ['Shade', 'normal', true, false, 1],
      ['Ink', 'multiply', false, true, expect.closeTo(0.5, 2)],
    ]);
    expect(g.children[1].kind === 'raster' && g.children[1].lockAlpha).toBe(true);
    const inkBack = got.get(g.children[1].id)!;
    expect(at(inkBack, 12, 7)).toEqual([200, 30, 40, 255]);
    expect(at(inkBack, 2, 2)).toEqual([0, 0, 0, 0]);
    expect(at(got.get(g.children[0].id)!, 5, 5)).toEqual([0, 0, 255, 128]);
    const mask = got.get(g.mask!.id)!;
    expect(at(mask, 3, 3)[3]).toBe(255);
    expect(at(mask, 30, 3)[3]).toBe(0);
    expect(flatten(back.layers).every((l) => !l.draft)).toBe(true);
  });

  it('keeps draft layers when asked, and a hidden paper', () => {
    const doc = createDocument('Drafts', W, H);
    doc.paper.visible = false;
    doc.layers[0].draft = true;
    const { doc: back } = open(encodePsd(source(doc, new Map(), { skipDraft: false })));
    expect(back.layers.map((l) => l.name)).toEqual(['Layer 1']);
    expect(back.paper.visible).toBe(false);
  });

  it('writes frame border folders as groups masked by their panels', () => {
    const doc = createDocument('Frames', W, H);
    const frame = createFolder('Frame', [createRasterLayer('Inside')], { frame: { panels: [{ id: 'p1', points: rectPoints(5, 5, 24, 19) }], lineWidth: 2, color: '#000000', draw: true }, blend: 'normal' });
    doc.layers = [frame];
    const border = image((x, y) => (x === 5 || y === 5 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    const area = image((x, y) => [0, 0, 0, x >= 4 && y >= 4 && x < 30 && y < 25 ? 255 : 0]);
    const psd = readPsd(encodePsd(source(doc, new Map(), { frameShapes: () => ({ area, border }) })), { useImageData: true });
    const group = psd.children![1];
    expect(group.name).toBe('Frame');
    expect(group.children!.map((l) => l.name)).toEqual(['Inside', 'Frame border']);
    expect(group.mask).toMatchObject({ defaultColor: 0, left: 4, top: 4, right: 30, bottom: 25 });
  });

  it('writes the cels of other frames hidden', () => {
    const doc = createDocument('Anim', W, H);
    const [c1, c2] = [createRasterLayer('1'), createRasterLayer('2')];
    doc.layers = [createFolder('A', [c2, c1], { animation: { cels: [{ frame: 1, cel: c1.id }, { frame: 2, cel: c2.id }] } })];
    doc.timeline = { enabled: true, fps: 8, frames: 2 };
    const read = (frame: number) => readPsd(encodePsd({ ...source(doc, new Map()), frame }), { useImageData: true }).children![1].children!.map((l) => [l.name, Boolean(l.hidden)]);
    expect(read(1)).toEqual([
      ['1', false],
      ['2', true],
    ]);
    expect(read(2)).toEqual([
      ['1', true],
      ['2', false],
    ]);
  });

  it('opens a flat document as one layer and refuses huge canvases', () => {
    const flat = writePsdUint8Array({ width: W, height: H, imageData: image(() => [10, 200, 30, 255]) });
    const { doc, pixels } = open(flat);
    expect(doc.layers.map((l) => l.name)).toEqual(['Background']);
    expect(at(pixels.get(doc.layers[0].id)!, 4, 4)).toEqual([10, 200, 30, 255]);
    expect(doc.paper.visible).toBe(false);
    const huge = writePsdUint8Array({ width: 8001, height: 16 });
    expect(() => open(huge)).toThrow(/larger than 8000/);
  });

  it('crops layers that reach past the canvas', () => {
    const big: Pixels = { width: W + 20, height: 4, data: new Uint8ClampedArray((W + 20) * 4 * 4).fill(255) };
    const bytes = writePsdUint8Array({ width: W, height: H, children: [{ name: 'Wide', left: -10, top: 2, imageData: big }] });
    const { doc, pixels } = open(bytes);
    const p = pixels.get(doc.layers[0].id)!;
    expect(at(p, 0, 2)).toEqual([255, 255, 255, 255]);
    expect(at(p, W - 1, 5)).toEqual([255, 255, 255, 255]);
    expect(at(p, 0, 6)).toEqual([0, 0, 0, 0]);
  });

  it('exports the merged image as one layer or as the background', () => {
    const merged = image((x) => (x < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    for (const background of [false, true]) {
      const psd = readPsd(encodeFlatPsd(merged, 144, background), { useImageData: true });
      expect(psd.children!.map((l) => l.name)).toEqual([background ? 'Background' : 'Layer 1']);
      expect(psd.imageResources?.resolutionInfo?.horizontalResolution).toBe(144);
      const { doc, pixels } = open(encodeFlatPsd(merged, 144, background));
      expect(at(pixels.get(doc.layers[0].id)!, 25, 3)).toEqual([0, 0, 255, 255]);
    }
  });

  it('cleans names and drops empty masks that would hide everything', () => {
    const px = image(() => [1, 2, 3, 255]);
    const bytes = writePsdUint8Array({
      width: W,
      height: H,
      children: [
        { name: 'Hidden all\u0000', left: 0, top: 0, imageData: px, mask: { defaultColor: 0 } },
        { name: 'Shown all', left: 0, top: 0, imageData: px, mask: { defaultColor: 255, disabled: true } },
      ],
    });
    const { doc, pixels } = open(bytes);
    expect(doc.layers.map((l) => [l.name, l.mask?.enabled ?? null])).toEqual([
      ['Shown all', false],
      ['Hidden all', null],
    ]);
    expect(at(pixels.get(doc.layers[0].mask!.id)!, 5, 5)[3]).toBe(255);
  });

  it('converts 16- and 32-bit pixels to 8 bits (32-bit is linear light)', () => {
    expect([...to8bit({ width: 1, height: 1, data: new Uint16Array([65535, 0, 32896, 65535]) })]).toEqual([255, 0, 128, 255]);
    expect([...to8bit({ width: 1, height: 1, data: new Float32Array([1, 0, 0.5, 0.5]) })]).toEqual([255, 0, 188, 128]);
  });

  it('recognises PSD and PSB file names', () => {
    expect(isPsdFileName('Page.psd')).toBe(true);
    expect(isPsdFileName('BIG.PSB')).toBe(true);
    expect(isPsdFileName('page.png')).toBe(false);
  });
});
