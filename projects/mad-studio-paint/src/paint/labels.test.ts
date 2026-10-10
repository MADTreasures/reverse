import { describe, expect, it } from 'vitest';
import { sanitizeTimeline } from './animation';
import {
  addTrackLabel,
  copyTrackLabels,
  deleteLabelFrames,
  deleteTrackLabels,
  inbetweenRun,
  INBETWEEN_FILLED,
  INBETWEEN_OPEN,
  insertLabelFrames,
  isInbetween,
  labelTextTaken,
  moveTrackLabels,
  pasteTrackLabels,
  pruneLabels,
  removeTrackLabel,
  renameTrackLabel,
  resizeTrackLabel,
  scaleLabels,
  setTimelineLabel,
  timelineLabelAt,
  trackLabelAt,
  type TrackLabel,
} from './labels';

const label = (track: string, frame: number, length: number, text: string): TrackLabel => ({ track, frame, length, text });

describe('timeline labels', () => {
  it('one per frame, sorted; empty text removes it; each text only once', () => {
    let l = setTimelineLabel(undefined, 5, ' Walk ');
    l = setTimelineLabel(l, 2, 'Start');
    expect(l).toEqual([
      { frame: 2, text: 'Start' },
      { frame: 5, text: 'Walk' },
    ]);
    l = setTimelineLabel(l, 5, 'Run');
    expect(timelineLabelAt(l, 5)?.text).toBe('Run');
    expect(labelTextTaken(l, 'Start', 7)).toBe(true);
    // Renaming the label of its own frame is fine.
    expect(labelTextTaken(l, 'Start', 2)).toBe(false);
    expect(setTimelineLabel(l, 2, '  ')).toEqual([{ frame: 5, text: 'Run' }]);
  });
});

describe('track labels', () => {
  it('cover a frame or a range; a new label replaces the ones it overlaps on its track', () => {
    let l = addTrackLabel(undefined, label('a', 3, 4, 'Pan'));
    l = addTrackLabel(l, label('b', 4, 1, 'Other track'));
    expect(trackLabelAt(l, 'a', 6)?.text).toBe('Pan');
    expect(trackLabelAt(l, 'a', 7)).toBeUndefined();
    l = addTrackLabel(l, label('a', 6, 2, 'Zoom'));
    expect(l.map((x) => x.text)).toEqual(['Zoom', 'Other track']);
    expect(addTrackLabel(l, label('a', 1, 1, ' '))).toBe(l);
    expect(removeTrackLabel(l, 'a', 7).map((x) => x.text)).toEqual(['Other track']);
  });

  it('rename (empty text deletes) and inbetween marks', () => {
    const l = [label('a', 2, 1, INBETWEEN_OPEN), label('a', 4, 3, 'Hold')];
    expect(isInbetween(l[0])).toBe(true);
    expect(isInbetween({ ...l[0], text: INBETWEEN_FILLED })).toBe(true);
    expect(isInbetween(l[1])).toBe(false);
    expect(renameTrackLabel(l, 'a', 4, 'Shake')[1].text).toBe('Shake');
    expect(renameTrackLabel(l, 'a', 4, '')).toEqual([l[0]]);
  });

  it('dragging an end changes the range, not past the neighbouring labels', () => {
    const l = [label('a', 2, 2, 'One'), label('a', 6, 2, 'Two'), label('b', 4, 1, 'B')];
    expect(trackLabelAt(resizeTrackLabel(l, 'a', 6, 'end', 10), 'a', 10)?.text).toBe('Two');
    // The start stops right after One; the end of One stops before Two.
    expect(resizeTrackLabel(l, 'a', 6, 'start', 1).find((x) => x.text === 'Two')).toEqual(label('a', 4, 4, 'Two'));
    expect(resizeTrackLabel(l, 'a', 2, 'end', 9).find((x) => x.text === 'One')).toEqual(label('a', 2, 4, 'One'));
    // At least one frame stays.
    expect(resizeTrackLabel(l, 'a', 2, 'start', 8).find((x) => x.text === 'One')).toEqual(label('a', 3, 1, 'One'));
  });

  it('move (Alt: duplicate), copy and paste, delete', () => {
    const l = [label('a', 2, 2, 'One'), label('a', 6, 1, 'Two'), label('b', 3, 1, 'B')];
    const refs = [{ track: 'a', frame: 2 }];
    expect(moveTrackLabels(l, refs, 3).map((x) => [x.track, x.frame, x.text])).toEqual([
      ['a', 5, 'One'],
      ['b', 3, 'B'],
    ]);
    expect(moveTrackLabels(l, refs, 10, true).filter((x) => x.text === 'One').map((x) => x.frame)).toEqual([2, 12]);
    // Not before frame 1.
    expect(moveTrackLabels(l, refs, -5).find((x) => x.text === 'One')?.frame).toBe(1);

    const copied = copyTrackLabels(l, [
      { track: 'a', frame: 6 },
      { track: 'a', frame: 2 },
    ]);
    expect(copied.map((c) => [c.offset, c.text])).toEqual([
      [0, 'One'],
      [4, 'Two'],
    ]);
    // Copied from one track: they go to the track pasted on.
    const { labels: pasted, pasted: refsOut } = pasteTrackLabels(l, copied, 10, 'b');
    expect(refsOut).toEqual([
      { track: 'b', frame: 10 },
      { track: 'b', frame: 14 },
    ]);
    expect(trackLabelAt(pasted, 'b', 11)?.text).toBe('One');
    expect(deleteTrackLabels(l, [{ track: 'b', frame: 3 }]).map((x) => x.text)).toEqual(['One', 'Two']);
  });

  it('inbetween labels at regular intervals', () => {
    expect(inbetweenRun(undefined, 'a', 3, 2, 9, INBETWEEN_FILLED).map((x) => x.frame)).toEqual([3, 5, 7, 9]);
  });
});

describe('labels and frames', () => {
  const t = { labels: [{ frame: 2, text: 'A' }, { frame: 6, text: 'B' }], trackLabels: [label('a', 3, 4, 'Range'), label('b', 7, 1, 'Late')] };

  it('Insert frame: later labels move back, a range over the frame gets longer', () => {
    const r = insertLabelFrames(t, 4, 2);
    expect(r.labels?.map((l) => l.frame)).toEqual([2, 8]);
    expect(r.trackLabels).toEqual([label('a', 3, 6, 'Range'), label('b', 9, 1, 'Late')]);
    // Selected layer only: the other tracks and the timeline labels stay.
    const one = insertLabelFrames(t, 4, 2, 'b');
    expect(one.labels).toEqual(t.labels);
    expect(one.trackLabels).toEqual([label('a', 3, 4, 'Range'), label('b', 9, 1, 'Late')]);
  });

  it('Delete frame: labels there go, a range gets shorter, later ones move forward', () => {
    const r = deleteLabelFrames(t, 5, 2);
    expect(r.labels).toEqual([{ frame: 2, text: 'A' }]);
    expect(r.trackLabels).toEqual([label('a', 3, 2, 'Range'), label('b', 5, 1, 'Late')]);
    expect(deleteLabelFrames(t, 3, 4).trackLabels).toEqual([label('b', 3, 1, 'Late')]);
  });

  it('Change frame rate keeps their time, within the frames', () => {
    const r = scaleLabels(t, 2, 16);
    expect(r.labels?.map((l) => l.frame)).toEqual([3, 11]);
    expect(r.trackLabels).toEqual([label('a', 5, 8, 'Range'), label('b', 13, 1, 'Late')]);
    expect(scaleLabels({ labels: [{ frame: 8, text: 'End' }] }, 0.5, 4).labels).toEqual([{ frame: 4, text: 'End' }]);
  });
});

describe('labels in files', () => {
  it('are checked: frames inside the timeline, texts once, no overlaps, known tracks', () => {
    const t = sanitizeTimeline({
      fps: 12,
      frames: 10,
      labels: [{ frame: 3, text: 'Key' }, { frame: 4, text: 'Key' }, { frame: 40, text: 'Out' }, { frame: 5, text: 7 }, null],
      trackLabels: [
        { track: 'a', frame: 2, length: 30, text: 'Long' },
        { track: 'a', frame: 4, length: 1, text: 'Over' },
        { track: 'b', frame: 0, length: 1, text: 'Bad' },
        { track: 'gone', frame: 1, length: 1, text: 'Gone' },
      ],
    })!;
    expect(t.labels).toEqual([{ frame: 3, text: 'Key' }]);
    // A later label replaces the one it overlaps; lengths end at the last frame.
    expect(t.trackLabels).toEqual([label('a', 4, 1, 'Over'), label('gone', 1, 1, 'Gone')]);
    expect(pruneLabels(t, new Set(['a'])).trackLabels).toEqual([label('a', 4, 1, 'Over')]);
    expect(pruneLabels(t, new Set()).trackLabels).toBeUndefined();
    expect(sanitizeTimeline({ fps: 12, frames: 10 })).not.toHaveProperty('labels');
  });
});
