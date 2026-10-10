/**
 * Animation > Label and the track label area of the Timeline palette: timeline labels at the
 * current frame, track labels on the current track (a frame or a range), inbetween track labels
 * 〇 / ●, and editing track labels in the palette (select, rename, move, duplicate, change the
 * range, copy, paste, delete). Every change is one undo step.
 */
import { tracksOf } from '../model/animation';
import type { Id } from '../model/types';
import {
  addTrackLabel,
  copyTrackLabels,
  deleteTrackLabels,
  inbetweenRun,
  labelMoveDelta,
  lastFrameOf,
  labelTextTaken,
  moveTrackLabels,
  pasteTrackLabels,
  removeTrackLabel,
  renameTrackLabel,
  resizeTrackLabel,
  setTimelineLabel,
  timelineLabelAt,
  trackLabelAt,
  type LabelCopy,
  type LabelRef,
  type Labels,
  type TrackLabel,
} from '../paint/labels';
import * as actions from './actions';
import { getState, setState, type PaintState } from './store';

/** The track label commands work on: the current layer's track (an animation folder for its cels). */
const currentTrackId = (s: PaintState): Id | null => tracksOf(s.doc.layers, s.activeLayerId)[0]?.id ?? null;

/** Changes the edited timeline's labels (one undo step per `key`). */
function editLabels(label: string, fn: (t: Labels) => Labels, key?: string): void {
  actions.changeDoc(
    label,
    (doc) => {
      if (!doc.timeline) return;
      const { labels, trackLabels, ...rest } = doc.timeline;
      const next = fn({ ...(labels ? { labels } : {}), ...(trackLabels ? { trackLabels } : {}) });
      doc.timeline = { ...rest, ...(next.labels?.length ? { labels: next.labels } : {}), ...(next.trackLabels?.length ? { trackLabels: next.trackLabels } : {}) };
    },
    key ? { key } : {},
  );
}

// ------------------------------------------------------------------ timeline labels

/** The timeline label of the current frame. */
export const currentTimelineLabel = (s: PaintState = getState()) => timelineLabelAt(s.doc.timeline?.labels, s.frame);

/**
 * Animation > Label > Create timeline label at the current frame (replacing its label). A text
 * another frame's label has is refused, like in the reference: returns false.
 */
export function createTimelineLabel(text: string, frame = getState().frame): boolean {
  const s = getState();
  if (!s.doc.timeline || !text.trim()) return false;
  if (labelTextTaken(s.doc.timeline.labels, text, frame)) {
    setState({ hint: 'Another frame has a timeline label with this text: add a number to tell them apart' });
    return false;
  }
  editLabels('Create timeline label', (t) => ({ ...t, labels: setTimelineLabel(t.labels, frame, text) }));
  return true;
}

/** Animation > Label > Delete timeline label of the current frame. */
export function deleteTimelineLabel(frame = getState().frame): void {
  if (!timelineLabelAt(getState().doc.timeline?.labels, frame)) return;
  editLabels('Delete timeline label', (t) => ({ ...t, labels: setTimelineLabel(t.labels, frame, '') }));
}

// ------------------------------------------------------------------ track labels

/** The track label at the current track and frame. */
export function currentTrackLabel(s: PaintState = getState()): TrackLabel | undefined {
  const id = currentTrackId(s);
  return id ? trackLabelAt(s.doc.timeline?.trackLabels, id, s.frame) : undefined;
}

/** Whether a track label command has a track to work on. */
export const hasLabelTrack = (s: PaintState = getState()) => Boolean(s.doc.timeline && currentTrackId(s));

/** Adds a track label (from the Timeline palette: on any track and frame); selects it. */
export function addLabel(track: Id, frame: number, length: number, text: string, label = 'Create track label'): void {
  if (!text.trim() || !getState().doc.timeline) return;
  editLabels(label, (t) => ({ ...t, trackLabels: addTrackLabel(t.trackLabels, { track, frame, length, text }) }));
  setState({ labelSelection: [{ track, frame }], clipSelection: [], keySelection: [], celSelection: [] });
}

/** Animation > Label > Create track label on the current track at the current frame (Range: over `length` frames). */
export function createTrackLabel(text: string, length = 1): void {
  const s = getState();
  const track = currentTrackId(s);
  if (!track) {
    setState({ hint: 'Select a track (a layer) and a frame in the Timeline palette' });
    return;
  }
  addLabel(track, s.frame, length, text);
}

/** Animation > Label > Create inbetween track label 〇 / ●: a frame label with the mark. */
export function createInbetweenLabel(mark: string): void {
  const s = getState();
  const track = currentTrackId(s);
  if (!track) {
    setState({ hint: 'Select a track (a layer) and a frame in the Timeline palette' });
    return;
  }
  addLabel(track, s.frame, 1, mark, 'Create inbetween track label');
}

/**
 * Inbetween track labels at regular intervals (Alt+Enter after a right-drag in the reference): from
 * `from`, every `step` frames to the end of the timeline.
 */
export function createInbetweenRun(track: Id, from: number, step: number, mark: string): void {
  const t = getState().doc.timeline;
  if (!t || step < 1) return;
  editLabels('Create inbetween track label', (x) => ({ ...x, trackLabels: inbetweenRun(x.trackLabels, track, from, step, t.frames, mark) }));
}

/** Animation > Label > Delete track label: the label on the current track at the current frame. */
export function deleteTrackLabel(): void {
  const s = getState();
  const l = currentTrackLabel(s);
  if (!l) return;
  editLabels('Delete track label', (t) => ({ ...t, trackLabels: removeTrackLabel(t.trackLabels, l.track, s.frame) }));
  setState({ labelSelection: s.labelSelection.filter((r) => !(r.track === l.track && r.frame === l.frame)) });
}

/** Timeline palette: a track label's new text; deleting the text deletes it. */
export function renameLabel(track: Id, frame: number, text: string): void {
  const l = getState().doc.timeline?.trackLabels?.find((x) => x.track === track && x.frame === frame);
  if (!l || l.text === text.trim()) return;
  editLabels(text.trim() ? 'Edit track label' : 'Delete track label', (t) => ({ ...t, trackLabels: renameTrackLabel(t.trackLabels, track, frame, text) }));
  if (!text.trim()) setState((st) => ({ labelSelection: st.labelSelection.filter((r) => !(r.track === track && r.frame === frame)) }));
}

/** Timeline palette: dragging an end of a ranged label (it stays selected). */
export function resizeLabel(track: Id, frame: number, edge: 'start' | 'end', to: number): void {
  const before = getState().doc.timeline?.trackLabels;
  const old = before?.find((x) => x.track === track && x.frame === frame);
  const after = resizeTrackLabel(before, track, frame, edge, to);
  if (!old || after === before) return;
  editLabels('Change track label range', (t) => ({ ...t, trackLabels: resizeTrackLabel(t.trackLabels, track, frame, edge, to) }));
  const start = edge === 'end' ? frame : (after.find((x) => x.track === track && lastFrameOf(x) === lastFrameOf(old))?.frame ?? frame);
  setState({ labelSelection: [{ track, frame: start }] });
}

// ------------------------------------------------------------------ selection

/** Selects a track label (`add`: Shift or Ctrl/⌘, adds it or takes it out). */
export function selectLabel(track: Id, frame: number, add = false): void {
  const s = getState();
  const same = (r: LabelRef) => r.track === track && r.frame === frame;
  const labelSelection = !add ? [{ track, frame }] : s.labelSelection.some(same) ? s.labelSelection.filter((r) => !same(r)) : [...s.labelSelection, { track, frame }];
  setState({ labelSelection, clipSelection: [], celSelection: [], ...(add ? {} : { keySelection: [] }) });
}

/** Track labels inside a rectangle dragged on the Timeline palette (Shift: adds, Ctrl/⌘: takes out). */
export function selectLabels(refs: LabelRef[], mode: 'set' | 'add' | 'remove' = 'set'): void {
  const s = getState();
  const id = (r: LabelRef) => `${r.track}|${r.frame}`;
  const these = new Set(refs.map(id));
  const rest = s.labelSelection.filter((r) => !these.has(id(r)));
  setState({ labelSelection: mode === 'set' ? refs : mode === 'add' ? [...rest, ...refs] : rest });
}

export const clearLabelSelection = () => {
  if (getState().labelSelection.length) setState({ labelSelection: [] });
};

/** Dragging the selected track labels: the move nearest to `delta` that keeps them from frame 1 on. */
export const labelDelta = (delta: number, s: PaintState = getState()) => labelMoveDelta(s.doc.timeline?.trackLabels, s.labelSelection, delta);

/** Drags the selected track labels by `delta` frames (Alt: duplicates them). */
export function moveSelectedLabels(delta: number, copy = false): void {
  const s = getState();
  const d = labelDelta(delta, s);
  if (!d || !s.labelSelection.length) return;
  editLabels(copy ? 'Duplicate track label' : 'Move track label', (t) => ({ ...t, trackLabels: moveTrackLabels(t.trackLabels, s.labelSelection, d, copy) }));
  setState({ labelSelection: s.labelSelection.map((r) => ({ ...r, frame: r.frame + d })) });
}

/** The track labels as they would be after dragging the selected ones (preview). */
export function movedLabels(delta: number, copy: boolean, s: PaintState = getState()): TrackLabel[] | null {
  const d = labelDelta(delta, s);
  return d ? moveTrackLabels(s.doc.timeline?.trackLabels, s.labelSelection, d, copy) : null;
}

// ------------------------------------------------------------------ clipboard

let labelClipboard: LabelCopy[] | null = null;

/** Copy (track labels): the selected ones. */
export function copySelectedLabels(): boolean {
  const s = getState();
  const items = copyTrackLabels(s.doc.timeline?.trackLabels, s.labelSelection);
  if (!items.length) return false;
  labelClipboard = items;
  return true;
}

export const hasCopiedLabels = () => labelClipboard !== null;

/** Paste (track labels) at the current frame: on the current track when they came from one track. */
export function pasteLabels(): void {
  const s = getState();
  const items = labelClipboard;
  if (!items || !s.doc.timeline) return;
  let pasted: LabelRef[] = [];
  editLabels('Paste track label', (t) => {
    const r = pasteTrackLabels(t.trackLabels, items, s.frame, currentTrackId(s) ?? undefined);
    pasted = r.pasted;
    return { ...t, trackLabels: r.labels };
  });
  setState({ labelSelection: pasted, clipSelection: [], keySelection: [], celSelection: [] });
}

/** Delete (track labels): the selected ones. */
export function deleteSelectedLabels(): void {
  const s = getState();
  if (!s.labelSelection.length) return;
  editLabels('Delete track label', (t) => ({ ...t, trackLabels: deleteTrackLabels(t.trackLabels, s.labelSelection) }));
  setState({ labelSelection: [] });
}
