import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import { createAudioLayer, createFolder, createRasterLayer, createLayerMask } from './layers';
import { addTimeline, changeFrameRate, deleteTimeline, moveTimeline, nextTimelineName, sanitizeTimelines, switchTimeline, timelineIndex, timelineList, timelineName } from './timelines';
import type { FolderLayer } from './types';

function animated() {
  const doc = createDocument('T', 100, 100, 72);
  const c1 = createRasterLayer('1');
  const c2 = createRasterLayer('2');
  const folder = createFolder('A', [c2, c1], { animation: { cels: [{ frame: 1, cel: c1.id }, { frame: 3, cel: c2.id }] }, keys: { enabled: true, frames: [{ frame: 2, interp: 'linear', values: { x: 5 } }] } });
  const bg = createRasterLayer('BG', { clips: [{ start: 1, end: 4 }], mask: { ...createLayerMask(), keys: [{ frame: 1, interp: 'linear', values: { x: 1 } }] } });
  doc.layers = [folder, bg];
  doc.timeline = { enabled: true, fps: 8, frames: 8, name: 'Timeline 1' };
  return { doc, folder, c1, c2, bg };
}

describe('timelines', () => {
  it('a new timeline starts empty; switching swaps the track contents', () => {
    const { doc, folder, bg } = animated();
    addTimeline(doc, { enabled: true, fps: 12, frames: 24, name: nextTimelineName(doc) });
    expect(timelineList(doc).map((t, i) => timelineName(t, i))).toEqual(['Timeline 1', 'Timeline 2']);
    expect(timelineIndex(doc)).toBe(1);
    // The layers are the same, their tracks empty in the new timeline.
    const f = doc.layers[0] as FolderLayer;
    expect(f.id).toBe(folder.id);
    expect(f.animation!.cels).toEqual([]);
    expect(f.keys).toBeUndefined();
    expect(doc.layers[1].clips).toBeUndefined();
    expect(doc.layers[1].mask!.keys).toBeUndefined();
    // Something only in timeline 2.
    f.animation = { cels: [{ frame: 5, cel: null }] };
    switchTimeline(doc, 0);
    expect(doc.timeline).toEqual({ enabled: true, fps: 8, frames: 8, name: 'Timeline 1' });
    expect((doc.layers[0] as FolderLayer).animation!.cels.map((a) => a.frame)).toEqual([1, 3]);
    expect(doc.layers[0].keys!.frames.length).toBe(1);
    expect(doc.layers[1].clips).toEqual(bg.clips);
    expect(doc.layers[1].mask!.keys!.length).toBe(1);
    switchTimeline(doc, 1);
    expect((doc.layers[0] as FolderLayer).animation!.cels).toEqual([{ frame: 5, cel: null }]);
  });

  it('duplicates, deletes and orders timelines', () => {
    const { doc } = animated();
    addTimeline(doc, { enabled: true, fps: 8, frames: 8, name: 'Copy' }, true);
    expect((doc.layers[0] as FolderLayer).animation!.cels.length).toBe(2);
    addTimeline(doc, { enabled: true, fps: 8, frames: 8, name: 'Third' });
    expect(timelineList(doc).map((t) => t.name)).toEqual(['Timeline 1', 'Copy', 'Third']);
    // Moving the edited one up keeps it edited.
    moveTimeline(doc, 2, -1);
    expect(timelineList(doc).map((t) => t.name)).toEqual(['Timeline 1', 'Third', 'Copy']);
    expect(doc.timeline!.name).toBe('Third');
    moveTimeline(doc, 0, 1);
    expect(timelineList(doc).map((t) => t.name)).toEqual(['Third', 'Timeline 1', 'Copy']);
    // Deleting another one; deleting the edited one edits a neighbour; never the last one.
    expect(deleteTimeline(doc, 2)).toBe(true);
    expect(timelineList(doc).map((t) => t.name)).toEqual(['Third', 'Timeline 1']);
    expect(deleteTimeline(doc, 0)).toBe(true);
    expect(timelineList(doc).map((t) => t.name)).toEqual(['Timeline 1']);
    expect((doc.layers[0] as FolderLayer).animation!.cels.length).toBe(2);
    expect(doc.timelines).toBeUndefined();
    expect(deleteTimeline(doc, 0)).toBe(false);
  });

  it('audio layers keep their lists; camera folders keep keyframes on', () => {
    const doc = createDocument('T', 100, 100, 72);
    doc.layers = [createAudioLayer('Audio', { clips: [{ start: 1, end: 4, sound: 's' }] }), createFolder('Cam', [], { camera: true, keys: { enabled: true, frames: [{ frame: 1, interp: 'linear', values: { x: 3 } }] } })];
    doc.timeline = { enabled: true, fps: 8, frames: 8 };
    addTimeline(doc, { enabled: true, fps: 8, frames: 8 });
    expect(doc.layers[0]).toMatchObject({ clips: [], keys: { enabled: true, frames: [] } });
    expect(doc.layers[1].keys).toEqual({ enabled: true, frames: [] });
  });

  it('Change frame rate keeps the playing time when the number of frames changes', () => {
    const { doc } = animated();
    doc.timeline = { ...doc.timeline!, start: 3, end: 6 };
    changeFrameRate(doc, 24, true);
    expect(doc.timeline).toMatchObject({ fps: 24, frames: 24, start: 7, end: 18 });
    expect((doc.layers[0] as FolderLayer).animation!.cels.map((a) => a.frame)).toEqual([1, 7]);
    expect(doc.layers[0].keys!.frames[0].frame).toBe(4);
    expect(doc.layers[1].clips).toEqual([{ start: 1, end: 12 }]);
    // Without: only the rate changes.
    changeFrameRate(doc, 12, false);
    expect(doc.timeline).toMatchObject({ fps: 12, frames: 24 });
    expect((doc.layers[0] as FolderLayer).animation!.cels.map((a) => a.frame)).toEqual([1, 7]);
  });

  it('reads other timelines from files safely', () => {
    const { doc, folder, c1, bg } = animated();
    expect(sanitizeTimelines(null, doc.layers)).toBeUndefined();
    const set = sanitizeTimelines(
      {
        index: 9,
        others: [
          { timeline: { fps: 12, frames: 10, name: 'B' }, tracks: { [folder.id]: { cels: [{ frame: 2, cel: c1.id }, { frame: 3, cel: 'stranger' }], keys: { frames: [{ frame: 1, values: { x: 2, volume: 1 } }] } }, nope: { clips: [{ start: 1, end: 2 }] }, [bg.id]: { cels: [{ frame: 1, cel: null }] } } },
          { bogus: true },
        ],
      },
      doc.layers,
    )!;
    expect(set.index).toBe(1);
    expect(set.others.length).toBe(1);
    expect(set.others[0].timeline).toEqual({ enabled: true, fps: 12, frames: 10, name: 'B' });
    expect(set.others[0].tracks).toEqual({ [folder.id]: { cels: [{ frame: 2, cel: c1.id }], keys: { enabled: true, frames: [{ frame: 1, interp: 'linear', values: { x: 2 } }] } } });
  });
});
