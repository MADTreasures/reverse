import { describe, expect, it } from 'vitest';
import { celAt } from './animation';
import {
  canMoveClips,
  clipsOf,
  copyClip,
  deleteClipFrames,
  deleteClips,
  ensureClipAt,
  inClips,
  insertClipFrames,
  mergeClips,
  moveClips,
  nearestMove,
  pasteClip,
  sanitizeClips,
  setFirstDisplayed,
  setLastDisplayed,
  soundTimeAt,
  splitClip,
  stretchClip,
  trimClip,
  type TrackContent,
} from './clips';

const track = (clips: [number, number][], cels: [number, string | null][] = [], keys: number[] = []): TrackContent => ({
  clips: clips.map(([start, end]) => ({ start, end })),
  cels: cels.map(([frame, cel]) => ({ frame, cel })),
  keys: keys.map((frame) => ({ frame })),
});
const spans = (t: TrackContent) => t.clips.map((c) => [c.start, c.end]);
const cels = (t: TrackContent) => t.cels!.map((a) => [a.frame, a.cel]);
/** What each frame shows: the cel, or '-' outside the clips. */
const film = (t: TrackContent, n: number) =>
  Array.from({ length: n }, (_, i) => (inClips(t.clips, i + 1) ? (celAt({ cels: t.cels ?? [] }, i + 1) ?? '·') : '-')).join('');

describe('clips', () => {
  it('a track without clips of its own shows over the whole timeline', () => {
    expect(clipsOf(undefined, 12)).toEqual([{ start: 1, end: 12 }]);
    expect(inClips(undefined, 500)).toBe(true);
    expect(inClips([{ start: 3, end: 5 }], 2)).toBe(false);
    expect(inClips([{ start: 3, end: 5 }], 5)).toBe(true);
  });

  it('moves clips with their cels and keys, never onto another clip', () => {
    const t = track(
      [
        [1, 4],
        [8, 10],
      ],
      [
        [1, 'a'],
        [3, 'b'],
        [8, 'c'],
      ],
      [2],
    );
    expect(film(t, 12)).toBe('aabb---ccc--');
    const moved = moveClips(t, [0], 2);
    expect(film(moved, 12)).toBe('--aabb-ccc--');
    expect(moved.keys).toEqual([{ frame: 4 }]);
    // Onto the next clip: refused (the nearest allowed move is 3, the one after it 7).
    expect(canMoveClips(t.clips, [0], 4)).toBe(false);
    expect(moveClips(t, [0], 4)).toBe(t);
    expect(nearestMove([{ clips: t.clips, indices: [0] }], 5)).toBe(3);
    expect(nearestMove([{ clips: t.clips, indices: [0] }], 9)).toBe(10);
    expect(nearestMove([{ clips: t.clips, indices: [0] }], -2)).toBe(0);
    // A clip that showed the cel of the clip before keeps showing it after a move.
    const held = track(
      [
        [1, 2],
        [5, 6],
      ],
      [[1, 'a']],
    );
    expect(film(held, 8)).toBe('aa--aa--');
    expect(film(moveClips(held, [1], 2), 8)).toBe('aa----aa');
    expect(film(moveClips(held, [0], 2), 8)).toBe('--aaaa--');
  });

  it('trims: cels outside go, the cel shown at a later start stays, an earlier start shows the first cel', () => {
    const t = track(
      [[3, 8]],
      [
        [3, 'a'],
        [5, 'b'],
        [7, 'c'],
      ],
    );
    expect(film(t, 10)).toBe('--aabbcc--');
    const later = trimClip(t, 0, 'start', 6);
    expect(film(later, 10)).toBe('-----bcc--');
    expect(cels(later)).toEqual([
      [6, 'b'],
      [7, 'c'],
    ]);
    expect(film(trimClip(t, 0, 'start', 1), 10)).toBe('aaaabbcc--');
    expect(film(trimClip(t, 0, 'end', 6), 10)).toBe('--aabb----');
    expect(cels(trimClip(t, 0, 'end', 6))).toEqual([
      [3, 'a'],
      [5, 'b'],
    ]);
    expect(film(trimClip(t, 0, 'end', 10), 10)).toBe('--aabbcccc');
    // Not past the other edge or a neighbour.
    expect(spans(trimClip(t, 0, 'start', 20))).toEqual([[8, 8]]);
    const two = track([
      [1, 3],
      [6, 9],
    ]);
    expect(spans(trimClip(two, 0, 'end', 8))).toEqual([
      [1, 5],
      [6, 9],
    ]);
  });

  it('time stretch spreads the cels with the clip', () => {
    const t = track(
      [[1, 8]],
      [
        [1, 'a'],
        [3, 'b'],
        [5, 'c'],
        [7, 'd'],
      ],
    );
    const long = stretchClip(t, 0, 'end', 16);
    expect(film(long, 16)).toBe('aaaabbbbccccdddd');
    const short = stretchClip(t, 0, 'end', 4);
    expect(film(short, 8)).toBe('abcd----');
    const shorter = stretchClip(t, 0, 'end', 2);
    expect(film(shorter, 3)).toBe('ac-');
    // From the start: the clip begins later and the cels close up behind it.
    expect(film(stretchClip(t, 0, 'start', 5), 8)).toBe('----abcd');
  });

  it('audio clips trim instead of stretching, and play further into their sound', () => {
    const t: TrackContent = { clips: [{ start: 1, end: 48, offset: 0 }] };
    const trimmed = stretchClip(t, 0, 'start', 25, 24);
    expect(trimmed.clips).toEqual([{ start: 25, end: 48, offset: 1 }]);
    expect(soundTimeAt(trimmed.clips, 25, 24)).toBe(1);
    expect(soundTimeAt(trimmed.clips, 37, 24)).toBe(1.5);
    expect(soundTimeAt(trimmed.clips, 3, 24)).toBeNull();
    const split = splitClip(t, 13, 24)!;
    expect(split.clips).toEqual([
      { start: 1, end: 12, offset: 0 },
      { start: 13, end: 48, offset: 0.5 },
    ]);
  });

  it('set as first displayed frame: a new clip with the last cel, or an earlier start', () => {
    const t = track(
      [[1, 4]],
      [
        [1, 'a'],
        [3, 'b'],
      ],
    );
    const added = setFirstDisplayed(t, 7, 10)!;
    expect(film(added, 10)).toBe('aabb--bbbb');
    expect(spans(added)).toEqual([
      [1, 4],
      [7, 10],
    ]);
    // Inside a clip, or on a track without clips: does not apply.
    expect(setFirstDisplayed(t, 2, 10)).toBeNull();
    expect(setFirstDisplayed(track([]), 2, 10)).toBeNull();
    const late = track([[5, 8]], [[5, 'a']]);
    expect(film(setFirstDisplayed(late, 2, 8)!, 8)).toBe('-aaaaaaa');
  });

  it('set as last displayed frame: ends the clip before the frame, up to the next cel', () => {
    const t = track(
      [[1, 10]],
      [
        [1, 'a'],
        [4, 'b'],
        [7, 'c'],
      ],
    );
    const cut = setLastDisplayed(t, 5)!;
    expect(film(cut, 10)).toBe('aaab--cccc');
    expect(spans(cut)).toEqual([
      [1, 4],
      [7, 10],
    ]);
    // On an assigned cel: it is unassigned.
    expect(film(setLastDisplayed(t, 4)!, 10)).toBe('aaa---cccc');
    // After the last cel: the rest goes.
    expect(film(setLastDisplayed(t, 9)!, 10)).toBe('aaabbbcc--');
    // After a clip: it reaches up to the frame before.
    expect(spans(setLastDisplayed(track([[1, 3]]), 7)!)).toEqual([[1, 6]]);
    expect(setLastDisplayed(track([[5, 6]]), 2)).toBeNull();
    // Other tracks just end there.
    expect(spans(setLastDisplayed({ clips: [{ start: 1, end: 10 }] }, 5)!)).toEqual([[1, 4]]);
  });

  it('deletes, merges and splits clips', () => {
    const t = track(
      [
        [1, 3],
        [6, 8],
        [10, 12],
      ],
      [
        [1, 'a'],
        [2, 'b'],
        [6, 'c'],
        [10, 'd'],
      ],
    );
    expect(film(deleteClips(t, [1]), 12)).toBe('abb------ddd');
    // Merging: the gap shows the last cel of the clip before.
    const merged = mergeClips(t, [0, 1])!;
    expect(film(merged, 12)).toBe('abbbbccc-ddd');
    expect(spans(merged)).toEqual([
      [1, 8],
      [10, 12],
    ]);
    // One selected: merges with the next; from the first to the last selected over the ones between.
    expect(spans(mergeClips(t, [1])!)).toEqual([
      [1, 3],
      [6, 12],
    ]);
    expect(spans(mergeClips(t, [0, 2])!)).toEqual([[1, 12]]);
    expect(mergeClips(t, [2])).toBeNull();
    const split = splitClip(t, 7)!;
    expect(spans(split)).toEqual([
      [1, 3],
      [6, 6],
      [7, 8],
      [10, 12],
    ]);
    expect(film(split, 12)).toBe(film(t, 12));
    expect(splitClip(t, 6)).toBeNull();
    expect(splitClip(t, 4)).toBeNull();
  });

  it('copies a clip and pastes it over what lies there', () => {
    const t = track(
      [[1, 6]],
      [
        [1, 'a'],
        [3, 'b'],
        [5, 'c'],
      ],
      [1, 4],
    );
    const copy = copyClip(t, 0)!;
    expect(copy).toEqual({
      length: 6,
      cels: [
        { frame: 0, cel: 'a' },
        { frame: 2, cel: 'b' },
        { frame: 4, cel: 'c' },
      ],
      keys: [{ frame: 0 }, { frame: 3 }],
    });
    const pasted = pasteClip(t, copy, 9);
    expect(film(pasted, 16)).toBe('aabbcc--aabbcc--');
    expect(pasted.keys!.map((k) => k.frame)).toEqual([1, 4, 9, 12]);
    // Over the clip itself: the part before stays, the copy covers the rest.
    const over = pasteClip(t, copy, 4);
    expect(film(over, 10)).toBe('aabaabbcc-');
    expect(spans(over)).toEqual([
      [1, 3],
      [4, 9],
    ]);
  });

  it('assigning outside the clips makes a clip from there', () => {
    const t = track([[1, 4]], [[1, 'a']]);
    expect(spans(ensureClipAt(t, 7, 10))).toEqual([
      [1, 4],
      [7, 10],
    ]);
    expect(spans(ensureClipAt(t, 12, 10))).toEqual([
      [1, 4],
      [12, 12],
    ]);
    // Keys pasted outside the clips: a clip over the whole gap.
    expect(spans(ensureClipAt(track([[1, 2], [9, 10]]), 5, 10, true))).toEqual([
      [1, 2],
      [3, 8],
      [9, 10],
    ]);
    expect(ensureClipAt(t, 2, 10)).toBe(t);
  });

  it('inserting and deleting frames moves and resizes clips', () => {
    const t = track(
      [
        [1, 4],
        [7, 9],
      ],
      [
        [1, 'a'],
        [3, 'b'],
        [7, 'c'],
      ],
      [8],
    );
    const ins = insertClipFrames(t, 3, 2);
    expect(film(ins, 12)).toBe('aaaabb--ccc-');
    expect(ins.keys).toEqual([{ frame: 10 }]);
    const del = deleteClipFrames(t, 2, 2);
    expect(spans(del)).toEqual([
      [1, 2],
      [5, 7],
    ]);
    expect(film(del, 8)).toBe('ab--ccc-');
    // A clip that starts inside the deleted frames: starts where they were, further into its sound.
    const audio: TrackContent = { clips: [{ start: 5, end: 10, offset: 0 }] };
    expect(deleteClipFrames(audio, 4, 3, 2).clips).toEqual([{ start: 4, end: 7, offset: 1 }]);
  });

  it('reads clips from files safely', () => {
    expect(sanitizeClips('x')).toBeUndefined();
    expect(
      sanitizeClips([
        { start: 5, end: 3 },
        { start: 4, end: 9 },
        { start: 2, end: 6 },
        null,
        { start: 0, end: 1e9, offset: 1 },
      ]),
    ).toEqual([
      { start: 1, end: 1000, offset: 1 },
    ]);
    expect(sanitizeClips([{ start: 3, end: 4 }, { start: 8, end: 9, offset: 'x' }])).toEqual([
      { start: 3, end: 4 },
      { start: 8, end: 9 },
    ]);
  });
});
