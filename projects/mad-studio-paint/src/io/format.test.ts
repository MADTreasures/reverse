import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createDocument } from '../model/document';
import { cloneDocument, createAudioLayer, createFillLayer, createFolder, createLayerMask, createMovieLayer, createRasterLayer, createVectorLayer, flatten } from '../model/layers';
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
    const k = { frame: 3, interp: 'smooth' as const, values: { x: 10, y: -4, scaleX: 1.5, scaleY: 1.5, rotation: 30, pivotX: 100, pivotY: 50, opacity: 0.5 } };
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

  it('keeps audio layers and their sound files', () => {
    const doc = createDocument('Sound', 200, 100, 72);
    doc.timeline = { enabled: true, fps: 12, frames: 12 };
    doc.sound = { files: [{ id: 'snd1', name: 'Beat', type: 'audio/wav', duration: 1.5 }] };
    doc.layers.unshift(createAudioLayer('Beat', { volume: 0.8, clips: [{ start: 2, end: 9, offset: 0.25, sound: 'snd1' }], keys: { enabled: true, frames: [{ frame: 2, interp: 'smooth', values: { volume: 0.4 } }] } }));
    const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);
    const back = unpackDocument(packDocument({ doc, activeLayerId: null, layers: new Map(), sounds: new Map([['snd1', bytes]]) }));
    expect(back.doc).toEqual(doc);
    expect([...back.sounds!.get('snd1')!]).toEqual([...bytes]);
    // Sound files the document does not list are not read.
    const stray = unpackDocument(packDocument({ doc: { ...doc, sound: undefined }, activeLayerId: null, layers: new Map(), sounds: new Map([['snd1', bytes]]) }));
    expect(stray.sounds!.size).toBe(0);
    // Clips of unknown sounds and keyframes of other settings are left out; audio layers have no mask.
    const odd = sanitizeDocument({
      sound: { files: [{ id: 'snd1', type: 'audio/wav' }] },
      layers: [{ id: 'a', kind: 'audio', volume: 3, mask: { id: 'm' }, clips: [{ start: 1, end: 4, sound: 'snd1' }, { start: 6, end: 8, sound: 'nope' }], keys: { enabled: false, frames: [{ frame: 1, values: { x: 3, volume: 0.5 } }] } }],
    });
    expect(odd.layers[0]).toMatchObject({ kind: 'audio', volume: 1, clips: [{ start: 1, end: 4, sound: 'snd1' }], keys: { enabled: true, frames: [{ frame: 1, interp: 'linear', values: { volume: 0.5 } }] } });
    expect(odd.layers[0].mask).toBeUndefined();
  });

  it('turns the audio tracks of earlier files into audio layers at the bottom', () => {
    const old = sanitizeDocument({
      layers: [{ id: 'l1', kind: 'raster' }],
      sound: {
        files: [{ id: 'snd1', name: 'Beat', type: 'audio/wav', duration: 1.5 }],
        tracks: [{ id: 's1', name: 'Beat', visible: false, volume: 0.8, clips: [{ start: 2, end: 9, offset: 0.25, sound: 'snd1' }], keys: [{ frame: 2, interp: 'smooth', volume: 0.4 }] }],
      },
    });
    expect(old.layers.map((l) => [l.id, l.kind])).toEqual([
      ['l1', 'raster'],
      ['s1', 'audio'],
    ]);
    expect(old.layers[1]).toMatchObject({ name: 'Beat', visible: false, volume: 0.8, clips: [{ start: 2, end: 9, offset: 0.25, sound: 'snd1' }], keys: { enabled: true, frames: [{ frame: 2, interp: 'smooth', values: { volume: 0.4 } }] } });
    expect(old.sound).toEqual({ files: [{ id: 'snd1', name: 'Beat', type: 'audio/wav', duration: 1.5 }] });
  });

  it('keeps several timelines, their tracks, start and end frames', () => {
    const doc = createDocument('Timelines', 200, 100, 72);
    const c1 = createRasterLayer('1');
    const folder = createFolder('A', [c1], { animation: { cels: [{ frame: 1, cel: c1.id }] } });
    doc.layers = [folder];
    doc.timeline = { enabled: true, fps: 8, frames: 8, name: 'Main', start: 2, end: 6 };
    doc.timelines = { others: [{ timeline: { enabled: true, fps: 12, frames: 6, name: 'Other' }, tracks: { [folder.id]: { cels: [{ frame: 3, cel: c1.id }], clips: [{ start: 2, end: 5 }] } } }], index: 1 };
    const back = unpackDocument(packDocument({ doc, activeLayerId: null, layers: new Map() }));
    expect(back.doc).toEqual(doc);
    // Start after end, end beyond the frames: kept within the frames.
    expect(sanitizeDocument({ timeline: { frames: 5, start: 4, end: 2 } }).timeline).toEqual({ enabled: true, fps: 8, frames: 5, start: 4, end: 4 });
  });

  it('keeps movie layers and their movie files', () => {
    const doc = createDocument('Movie', 200, 100, 72);
    doc.timeline = { enabled: true, fps: 8, frames: 16 };
    doc.movies = [{ id: 'mov1', name: 'Clip', type: 'video/webm', duration: 2, width: 64, height: 48 }];
    doc.layers.unshift(createMovieLayer('Clip', 'mov1', { clips: [{ start: 3, end: 10, offset: 0.5 }] }));
    const bytes = new Uint8Array([26, 69, 223, 163, 1, 2]);
    const back = unpackDocument(packDocument({ doc, activeLayerId: null, layers: new Map(), movies: new Map([['mov1', bytes]]) }));
    expect(back.doc).toEqual(doc);
    expect([...back.movies!.get('mov1')!]).toEqual([...bytes]);
    // A movie layer without its file is left out; files are videos.
    const odd = sanitizeDocument({ movies: [{ id: 'm2', type: 'text/html', width: 0 }], layers: [{ id: 'a', kind: 'movie', movie: 'nope' }, { id: 'b', kind: 'movie', movie: 'm2', clips: [{ start: 1, end: 2, sound: 'x' }] }] });
    expect(odd.layers.map((l) => l.id)).toEqual(['b']);
    expect(odd.layers[0]).toMatchObject({ kind: 'movie', movie: 'm2', volume: 1, clips: [{ start: 1, end: 2 }] });
    expect(odd.movies).toEqual([{ id: 'm2', name: 'Movie', type: 'video/mp4', duration: 0, width: 1, height: 1 }]);
  });

  it('keeps fill layers (their colour; the pixels are drawn again)', () => {
    const doc = createDocument('Fill', 200, 100, 72);
    const fill = createFillLayer('Fill 1', '#12ab34', { mask: createLayerMask(), opacity: 0.5 });
    doc.layers.unshift(fill);
    const back = unpackDocument(packDocument({ doc, activeLayerId: fill.id, layers: new Map() }));
    const l = back.doc.layers[0];
    expect(l).toMatchObject({ kind: 'fill', name: 'Fill 1', color: '#12ab34', opacity: 0.5 });
    expect(typeof (l.kind === 'fill' && l.rev)).toBe('number');
    // A bad colour becomes black.
    expect(sanitizeDocument({ layers: [{ id: 'f', kind: 'fill', color: 'red' }] }).layers[0]).toMatchObject({ kind: 'fill', color: '#000000' });
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

  it('keeps the keyframes of layer masks and what a mask is beyond its pixels', () => {
    const doc = createDocument('Mask keys', 200, 100, 72);
    doc.layers[0].mask = { ...createLayerMask(), outside: 'hide', keys: [{ frame: 2, interp: 'smooth', values: { x: 10, y: 0 } }] };
    doc.layers[0].keys = { enabled: true, frames: [] };
    const back = unpackDocument(packDocument({ doc, activeLayerId: null, layers: new Map() }));
    expect(back.doc.layers[0].mask).toEqual(doc.layers[0].mask);
    // A mask keyframe places the mask only: no opacity.
    const odd = sanitizeDocument({ layers: [{ id: 'l', kind: 'raster', mask: { id: 'm2', outside: 'x', keys: [{ frame: 1, values: { opacity: 0.5 } }, { frame: 3, values: { x: 4, opacity: 0.2 } }] } }] });
    expect(odd.layers[0].mask).toEqual({ id: 'm2', enabled: true, linked: true, keys: [{ frame: 3, interp: 'linear', values: { x: 4 } }] });
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
