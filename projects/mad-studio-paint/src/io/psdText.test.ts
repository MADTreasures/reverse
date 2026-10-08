import { readPsd } from 'ag-psd';
import { describe, expect, it } from 'vitest';
import { createDocument } from '../model/document';
import { createRasterLayer, createTextLayer } from '../model/layers';
import type { Id, TextLayer } from '../model/types';
import { DEFAULT_BORDER, type LayerEffects } from '../paint/effects';
import { DEFAULT_TEXT_STYLE, type TextBox } from '../paint/text';
import { decodePsd, encodePsd, type Pixels } from './psd';
import { fromPsdEffects, toPsdEffects } from './psdStyles';
import { fontFromPostScript, fromPsdText, postScriptName, toPsdText } from './psdText';

const W = 60;
const H = 40;
const blank = (): Pixels => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4) });
const ink = (): Pixels => {
  const p = blank();
  for (let y = 10; y < 20; y++) for (let x = 10; x < 40; x++) p.data.set([0, 0, 0, 255], (y * W + x) * 4);
  return p;
};
/** A stand-in for the browser's measuring: every character half the size wide. */
const fit = (t: TextBox): TextBox => ({ ...t, w: Math.max(...t.text.split('\n').map((l) => l.length)) * t.size * 0.5, h: t.text.split('\n').length * t.size * t.lineSpacing });

const box = (patch: Partial<TextBox> = {}): TextBox => ({ ...DEFAULT_TEXT_STYLE, id: 't1', x: 10, y: 5, angle: 0, w: 30, h: 12, wrap: false, text: 'Hello', size: 12, ...patch });

function write(layers: ReturnType<typeof createDocument>['layers']) {
  const doc = createDocument('T', W, H, 144);
  doc.layers = layers;
  const pixels = new Map<Id, Pixels>();
  for (const l of layers) pixels.set(l.id, ink());
  return encodePsd({
    doc,
    composite: blank(),
    skipDraft: true,
    layerPixels: (l) => pixels.get(l.id) ?? null,
    bakedPixels: (l) => pixels.get(l.id) ?? null,
    maskPixels: () => null,
    frameShapes: () => ({ area: blank(), border: null }),
    textPixels: () => ink(),
  });
}

describe('fonts', () => {
  it('maps CSS families to PostScript names and back', () => {
    expect(postScriptName('sans-serif')).toBe('ArialMT');
    expect(postScriptName('"Times New Roman", serif')).toBe('TimesNewRomanPSMT');
    expect(postScriptName('My Font')).toBe('MyFont');
    expect(fontFromPostScript('TimesNewRomanPS-BoldMT')).toEqual({ family: 'Times New Roman', bold: true, italic: false });
    expect(fontFromPostScript('ArialMT')).toEqual({ family: 'Arial', bold: false, italic: false });
    expect(fontFromPostScript('Helvetica-Oblique')).toEqual({ family: 'Helvetica', bold: false, italic: true });
    expect(fontFromPostScript('SourceSansPro-Regular').family).toBe('Source Sans Pro');
  });
});

describe('text boxes as Photoshop text', () => {
  it('point text: the anchor sits on the first baseline, at the aligned side', () => {
    const t = fit(box({ align: 'center', angle: 0.3, bold: true, color: '#ff0000', letterSpacing: 1.2, lineSpacing: 1.5 }));
    const d = toPsdText(t);
    expect(d.shapeType).toBe('point');
    expect(d.style).toMatchObject({ fontSize: 12, fauxBold: true, leading: 18, tracking: 100, fillColor: { r: 255, g: 0, b: 0 } });
    expect(d.paragraphStyle?.justification).toBe('center');
    const back = fromPsdText(d, fit);
    expect(back.x).toBeCloseTo(t.x, 6);
    expect(back.y).toBeCloseTo(t.y, 6);
    expect(back.angle).toBeCloseTo(0.3, 6);
    expect(back).toMatchObject({ text: 'Hello', size: 12, bold: true, color: '#ff0000', align: 'center', wrap: false });
    expect(back.letterSpacing).toBeCloseTo(1.2, 6);
    expect(back.lineSpacing).toBeCloseTo(1.5, 6);
  });

  it('paragraph text keeps its frame; lines break with \\r in Photoshop', () => {
    const t = box({ wrap: true, w: 40, h: 30, text: 'Two\nlines', angle: -0.2 });
    const d = toPsdText(t);
    expect(d.text).toBe('Two\rlines');
    expect(d.shapeType).toBe('box');
    const back = fromPsdText(d);
    expect(back).toMatchObject({ wrap: true, w: 40, h: 30, text: 'Two\nlines' });
    expect(back.x).toBeCloseTo(10, 6);
    expect(back.y).toBeCloseTo(5, 6);
  });
});

describe('Photoshop documents with text and layer styles', () => {
  it('a text layer stays text, with its edge as a stroke', () => {
    const layer = createTextLayer('Title', { texts: [box({ edge: 2, edgeColor: '#00ff00', text: 'Hi there' })] });
    const bytes = write([layer]);
    const psd = readPsd(bytes, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
    const written = psd.children!.find((l) => l.name === 'Title')!;
    expect(written.text?.text).toBe('Hi there');
    expect(written.effects?.stroke?.[0]).toMatchObject({ enabled: true, position: 'outside' });
    const { doc } = decodePsd(bytes, 'Back', () => {}, fit);
    const back = doc.layers.find((l) => l.name === 'Title') as TextLayer;
    expect(back.kind).toBe('text');
    expect(back.texts[0]).toMatchObject({ text: 'Hi there', edge: 2, edgeColor: '#00ff00', size: 12 });
    expect(back.effects).toBeUndefined();
  });

  it('several texts and balloons become a group of text layers', () => {
    const layer = createTextLayer('Page', {
      texts: [box({ id: 'a', text: 'One' }), box({ id: 'b', text: 'Two', vertical: true })],
      balloons: [{ id: 'bl', shape: 'ellipse', x: 0, y: 0, w: 20, h: 10, angle: 0, lineWidth: 2, lineColor: '#000000', fillColor: '#ffffff', tails: [] }],
    });
    const psd = readPsd(write([layer]), { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
    const group = psd.children!.find((l) => l.name === 'Page')!;
    expect(group.children?.map((c) => c.name)).toEqual(['Balloons', 'One', 'Two']);
    expect(group.children?.[1].text?.text).toBe('One');
    // Vertical text stays pixels.
    expect(group.children?.[2].text).toBeUndefined();
  });

  it('border, layer colour, shadows and glows go to Photoshop and come back; other styles are kept', () => {
    const effects: LayerEffects = {
      border: { ...DEFAULT_BORDER, width: 3, color: '#123456' },
      layerColor: { enabled: false, color: '#ff8800', sub: '#ff8800' },
      dropShadow: { enabled: true, color: '#000000', opacity: 50, angle: 135, distance: 6, size: 4, spread: 10 },
      innerShadow: { enabled: true, color: '#202020', opacity: 40, angle: 90, distance: 2, size: 3, spread: 0 },
      outerGlow: { enabled: true, color: '#ffff00', opacity: 70, size: 8, spread: 20 },
      innerGlow: { enabled: false, color: '#ffffff', opacity: 60, size: 5, spread: 0 },
      kept: { bevel: { enabled: true, present: true, showInDialog: true, style: 'inner bevel', size: { units: 'Pixels', value: 4 } } },
    };
    const layer = createRasterLayer('Styled', { effects });
    const bytes = write([layer]);
    const psd = readPsd(bytes, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
    const fx = psd.children!.find((l) => l.name === 'Styled')!.effects!;
    expect(fx.stroke?.[0].size?.value).toBe(3);
    expect(fx.dropShadow?.[0]).toMatchObject({ enabled: true, angle: 135 });
    expect(fx.bevel?.style).toBe('inner bevel');
    const { doc, notes } = decodePsd(bytes, 'Back', () => {});
    const back = doc.layers.find((l) => l.name === 'Styled')!;
    expect(back.effects).toMatchObject({
      border: { enabled: true, kind: 'edge', width: 3, color: '#123456' },
      layerColor: { enabled: false, color: '#ff8800' },
      dropShadow: { enabled: true, color: '#000000', opacity: 50, angle: 135, distance: 6, size: 4, spread: 10 },
      innerShadow: { enabled: true, opacity: 40, distance: 2, size: 3 },
      outerGlow: { enabled: true, color: '#ffff00', opacity: 70, size: 8, spread: 20 },
      innerGlow: { enabled: false },
    });
    expect((back.effects?.kept?.bevel as { style: string }).style).toBe('inner bevel');
    expect(notes.join(' ')).toContain('kept for Photoshop');
  });

  it('reads styles of other writers: units, disabled styles, text strokes', () => {
    const fx = fromPsdEffects({ disabled: true, stroke: [{ enabled: true, size: { units: 'Points', value: 3 }, fillType: 'color', color: { r: 255, g: 0, b: 0 } }] }, 144);
    expect(fx.effects?.border).toMatchObject({ enabled: false, width: 6, color: '#ff0000' });
    const text = fromPsdEffects({ stroke: [{ enabled: true, size: { units: 'Pixels', value: 2 }, color: { fr: 0, fg: 0, fb: 1 } }] }, 72, true);
    expect(text.edge).toEqual({ width: 2, color: '#0000ff' });
    expect(text.effects).toBeUndefined();
    expect(toPsdEffects(undefined)).toBeUndefined();
  });
});
