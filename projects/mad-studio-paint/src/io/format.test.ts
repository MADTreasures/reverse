import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createDocument } from '../model/document';
import { cloneDocument, createFolder, createLayerMask, createRasterLayer, createVectorLayer, flatten } from '../model/layers';
import type { FolderLayer } from '../model/types';
import { DEFAULT_BRUSH } from '../paint/tools';
import { isDocumentFileName, isImageFileName, mimeForName, packDocument, sanitizeDocument, unpackDocument } from './format';

describe('.madpaint format', () => {
  it('round-trips structure and layer bytes', () => {
    const doc = createDocument('Test', 640, 480, 300);
    const ink = createRasterLayer('Ink', { blend: 'multiply', opacity: 0.5, lockAlpha: true });
    doc.layers.unshift(createFolder('Group', [ink], { blend: 'screen' }));
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const bytes = packDocument({ doc, activeLayerId: ink.id, layers: new Map([[ink.id, png]]) });
    const back = unpackDocument(bytes);
    expect(back.doc).toEqual(doc);
    expect(back.activeLayerId).toBe(ink.id);
    expect([...back.layers.get(ink.id)!]).toEqual([...png]);
  });

  it('keeps the timeline and animation tracks; assignments need a cel of the folder', () => {
    const doc = createDocument('Anim', 200, 100, 72);
    const [c1, c2] = [createRasterLayer('1'), createRasterLayer('2')];
    doc.layers = [createFolder('A', [c2, c1], { animation: { cels: [{ frame: 1, cel: c1.id }, { frame: 3, cel: c2.id }, { frame: 5, cel: null }] } })];
    doc.timeline = { enabled: true, fps: 12, frames: 24 };
    const back = unpackDocument(packDocument({ doc, activeLayerId: null, layers: new Map() }));
    expect(back.doc).toEqual(doc);
    const odd = sanitizeDocument({
      timeline: { fps: 0, frames: 5 },
      layers: [{ id: 'f', kind: 'folder', animation: { cels: [{ frame: 2, cel: 'x' }, { frame: 1, cel: 'c' }] }, children: [{ id: 'c', kind: 'raster' }] }],
    });
    expect(odd.timeline).toEqual({ enabled: true, fps: 1, frames: 5 });
    expect((odd.layers[0] as FolderLayer).animation).toEqual({ cels: [{ frame: 1, cel: 'c' }] });
  });

  it('keeps keyframes and 2D camera folders', () => {
    const doc = createDocument('Keys', 200, 100, 72);
    const k = { frame: 3, interp: 'smooth' as const, x: 10, y: -4, scaleX: 1.5, scaleY: 1.5, rotation: 30, pivotX: 100, pivotY: 50, opacity: 0.5 };
    doc.layers[0].keys = { enabled: true, frames: [k] };
    doc.layers.unshift(createFolder('2D camera folder', [], { camera: true, blend: 'normal', keys: { enabled: true, frames: [{ ...k, frame: 1 }] } }));
    doc.timeline = { enabled: true, fps: 12, frames: 12 };
    const back = unpackDocument(packDocument({ doc, activeLayerId: null, layers: new Map() }));
    expect(back.doc).toEqual(doc);
    // A camera folder's keyframes cannot be turned off; correction layers have none.
    const odd = sanitizeDocument({ layers: [{ id: 'c', kind: 'folder', camera: true, keys: { enabled: false }, children: [] }, { id: 'x', kind: 'correction', keys: { frames: [] } }] });
    expect((odd.layers[0] as FolderLayer).keys).toEqual({ enabled: true, frames: [] });
    expect(odd.layers[1].keys).toBeUndefined();
  });

  it('keeps the clips of tracks', () => {
    const doc = createDocument('Clips', 200, 100, 72);
    doc.layers[0].clips = [
      { start: 2, end: 4 },
      { start: 7, end: 9 },
    ];
    doc.timeline = { enabled: true, fps: 12, frames: 12 };
    const back = unpackDocument(packDocument({ doc, activeLayerId: null, layers: new Map() }));
    expect(back.doc.layers[0].clips).toEqual(doc.layers[0].clips);
    const odd = sanitizeDocument({ layers: [{ id: 'a', kind: 'raster', clips: [{ start: 3, end: 1 }, { start: 5, end: 'x' }, { start: 4, end: 6, offset: 2 }] }] });
    expect(odd.layers[0].clips).toEqual([{ start: 4, end: 6, offset: 2 }]);
  });

  it('keeps layer masks and drops masks that would share pixels', () => {
    const doc = createDocument('Masks', 100, 100, 72);
    doc.layers[0].mask = { ...createLayerMask(), enabled: false };
    const back = unpackDocument(packDocument({ doc, activeLayerId: null, layers: new Map() }));
    expect(back.doc.layers[0].mask).toEqual(doc.layers[0].mask);
    const clash = sanitizeDocument({
      layers: [
        { id: 'a', kind: 'raster', mask: { id: 'm1', linked: false } },
        { id: 'b', kind: 'raster', mask: { id: 'a' } },
        { id: 'c', kind: 'raster', mask: { id: 'm1' } },
      ],
    });
    expect(clash.layers.map((l) => l.mask)).toEqual([{ id: 'm1', enabled: true, linked: false }, undefined, undefined]);
  });

  it('stores vector lines with a shared brush table', () => {
    const doc = createDocument('Lines', 200, 100, 72);
    const brush = { ...DEFAULT_BRUSH, size: 6 };
    const line = (id: string, y: number) => ({ id, color: '#123456', brush, points: [0, 1, 2].map((i) => ({ x: 10 + i * 40, y, s: 1 - i * 0.2, d: 1 })) });
    const ink = createVectorLayer('Ink', { strokes: [line('a', 10), line('b', 20), { ...line('c', 30), erase: true }] });
    doc.layers.unshift(ink);
    const bytes = packDocument({ doc, activeLayerId: ink.id, layers: new Map() });
    const back = unpackDocument(bytes).doc.layers[0];
    expect(back.kind).toBe('vector');
    if (back.kind !== 'vector') return;
    expect(back.strokes.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(back.strokes[1].points).toEqual(ink.strokes[1].points);
    expect(back.strokes[0].brush.size).toBe(6);
    expect(back.strokes[2].erase).toBe(true);
    // One brush entry for all three lines.
    const stored = JSON.parse(strFromU8(unzipSync(bytes)['document.json'])) as { document: { layers: { brushes?: unknown[] }[] } };
    expect(stored.document.layers[0].brushes).toHaveLength(1);
    // Copies of the document share lines (they are never changed in place).
    const copy = cloneDocument(doc);
    expect(copy.layers[0] !== doc.layers[0] && (copy.layers[0] as typeof ink).strokes[0]).toBe(ink.strokes[0]);
  });

  it('rejects foreign or damaged files', () => {
    expect(() => unpackDocument(new Uint8Array([1, 2, 3]))).toThrow(/damaged/);
  });

  it('sanitizes untrusted JSON', () => {
    const doc = sanitizeDocument({
      width: 1e9,
      height: -5,
      paper: { color: 'red' },
      layers: [
        { id: 'a', kind: 'raster', blend: 'evil', opacity: 7 },
        { id: 'a', kind: 'folder', blend: 'pass-through', children: [{ id: '../x', name: 3 }] },
        'junk',
      ],
    });
    expect(doc.width).toBe(8000);
    expect(doc.height).toBe(16);
    expect(doc.paper.color).toBe('#ffffff');
    const all = flatten(doc.layers);
    expect(all).toHaveLength(3);
    expect(new Set(all.map((l) => l.id)).size).toBe(3);
    expect(all[0]).toMatchObject({ blend: 'normal', opacity: 1 });
    expect(all.every((l) => /^[A-Za-z0-9_-]+$/.test(l.id))).toBe(true);
    expect(sanitizeDocument({}).layers).toHaveLength(1);
    expect(() => sanitizeDocument(null)).toThrow();
  });

  it('recognises file types', () => {
    expect(isDocumentFileName('a.MADPAINT')).toBe(true);
    expect(isImageFileName('photo.JPG')).toBe(true);
    expect(isImageFileName('song.wav')).toBe(false);
    expect(mimeForName('x.jpeg')).toBe('image/jpeg');
  });
});
