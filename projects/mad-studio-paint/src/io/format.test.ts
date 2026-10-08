import { describe, expect, it } from 'vitest';
import { createDocument } from '../model/document';
import { createFolder, createLayerMask, createRasterLayer, flatten } from '../model/layers';
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
