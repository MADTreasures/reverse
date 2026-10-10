/**
 * Animation > Label > Create timeline label / Create track label, Animation > Move frame > Go to
 * specified frame / Go to timeline label, and Animation > Timeline > Insert frame / Delete frame.
 */
import { useState } from 'react';
import { MAX_FRAMES } from '../../paint/animation';
import { labelTextTaken, MAX_LABEL_TEXT } from '../../paint/labels';
import * as anim from '../../store/animationActions';
import * as labels from '../../store/labelActions';
import { getState } from '../../store/store';
import { closeDialog } from '../overlays';

const clampInt = (v: string, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

function Actions({ disabled = false }: { disabled?: boolean }) {
  return (
    <div className="modal-actions">
      <button type="button" className="btn" onClick={closeDialog}>
        Cancel
      </button>
      <button type="submit" className="btn primary" disabled={disabled}>
        OK
      </button>
    </div>
  );
}

/** A label name not used by the timeline's labels yet: Label 1, Label 2, … */
function freeLabelName(): string {
  const used = new Set((getState().doc.timeline?.labels ?? []).map((l) => l.text));
  for (let n = 1; ; n++) if (!used.has(`Label ${n}`)) return `Label ${n}`;
}

/** Animation > Label > Create timeline label at the current frame. */
export function TimelineLabelDialog() {
  const s = getState();
  const current = labels.currentTimelineLabel(s);
  const [text, setText] = useState(current?.text ?? freeLabelName());
  const taken = labelTextTaken(s.doc.timeline?.labels, text, s.frame);
  return (
    <form
      className="modal small"
      role="dialog"
      aria-label="Create timeline label"
      onSubmit={(e) => {
        e.preventDefault();
        if (labels.createTimelineLabel(text)) closeDialog();
      }}
    >
      <h2>Create timeline label</h2>
      <div className="form-grid">
        <label htmlFor="label-name">Label name</label>
        <input id="label-name" value={text} maxLength={MAX_LABEL_TEXT} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setText(e.target.value)} />
      </div>
      {taken && (
        <p className="muted" role="alert">
          Another frame has a timeline label with this name. Add a number to tell them apart.
        </p>
      )}
      <Actions disabled={!text.trim() || taken} />
    </form>
  );
}

/** Animation > Label > Create track label on the current track at the current frame (Range: several frames). */
export function TrackLabelDialog() {
  const [text, setText] = useState('Track label');
  const [ranged, setRanged] = useState(false);
  const [length, setLength] = useState(2);
  return (
    <form
      className="modal small"
      role="dialog"
      aria-label="Create track label"
      onSubmit={(e) => {
        e.preventDefault();
        labels.createTrackLabel(text, ranged ? length : 1);
        closeDialog();
      }}
    >
      <h2>Create track label</h2>
      <div className="form-grid">
        <label htmlFor="track-label-name">Label name</label>
        <input id="track-label-name" value={text} maxLength={MAX_LABEL_TEXT} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setText(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={ranged} onChange={(e) => setRanged(e.target.checked)} /> Range
        </label>
        <span className="with-unit">
          <input type="number" aria-label="Range" min={1} max={MAX_FRAMES} value={length} disabled={!ranged} onChange={(e) => setLength(clampInt(e.target.value, 1, MAX_FRAMES, length))} /> Frame
        </span>
      </div>
      <Actions disabled={!text.trim()} />
    </form>
  );
}

/** Animation > Move frame > Go to specified frame (the number as the Timeline palette counts frames). */
export function GoToFrameDialog() {
  const s = getState();
  const t = s.doc.timeline;
  const base = t?.display === 'frame0' ? 0 : 1;
  const frames = t?.frames ?? 1;
  const [n, setN] = useState(s.frame - 1 + base);
  return (
    <form
      className="modal small"
      role="dialog"
      aria-label="Go to specified frame"
      onSubmit={(e) => {
        e.preventDefault();
        anim.goToFrame(n + 1 - base);
        closeDialog();
      }}
    >
      <h2>Go to specified frame</h2>
      <div className="form-grid">
        <label htmlFor="goto-frame">Frame number</label>
        <span className="with-unit">
          <input id="goto-frame" type="number" min={base} max={frames - 1 + base} value={n} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setN(clampInt(e.target.value, base, frames - 1 + base, n))} /> (Frame)
        </span>
      </div>
      <Actions />
    </form>
  );
}

/** Animation > Move frame > Go to timeline label: the list of the timeline's labels. */
export function GoToLabelDialog() {
  const list = getState().doc.timeline?.labels ?? [];
  const [picked, setPicked] = useState(list[0]?.text ?? '');
  const go = (text: string) => {
    anim.goToTimelineLabel(text);
    closeDialog();
  };
  return (
    <form
      className="modal small"
      role="dialog"
      aria-label="Go to timeline label"
      onSubmit={(e) => {
        e.preventDefault();
        if (picked) go(picked);
      }}
    >
      <h2>Go to timeline label</h2>
      <ul className="timeline-list label-list" role="listbox" aria-label="Timeline labels">
        {list.map((l) => (
          <li key={l.frame} role="option" aria-selected={l.text === picked} className={l.text === picked ? 'selected' : ''} onClick={() => setPicked(l.text)} onDoubleClick={() => go(l.text)}>
            {l.text}
          </li>
        ))}
      </ul>
      <Actions disabled={!picked} />
    </form>
  );
}

/** Animation > Timeline > Insert frame / Delete frame at the current frame. */
export function FrameEditDialog({ mode }: { mode: 'insert' | 'delete' }) {
  const s = getState();
  const t = s.doc.timeline;
  const track = anim.currentTrackId(s);
  const max = mode === 'insert' ? MAX_FRAMES : Math.max(1, (t?.frames ?? 1) - s.frame + 1);
  const [count, setCount] = useState(1);
  const [only, setOnly] = useState(false);
  const [split, setSplit] = useState(false);
  const title = mode === 'insert' ? 'Insert frame' : 'Delete frame';
  return (
    <form
      className="modal small"
      role="dialog"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault();
        const o = { ...(only && track ? { track } : {}), split };
        if (mode === 'insert') anim.insertFrame(count, o);
        else anim.deleteFrame(count, o);
        closeDialog();
      }}
    >
      <h2>{title}</h2>
      <div className="form-grid">
        <label htmlFor="frame-count">Number of frames</label>
        <input id="frame-count" type="number" min={1} max={max} value={count} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setCount(clampInt(e.target.value, 1, max, count))} />
        <label />
        <label className="check" title="Only the selected track changes; the timeline keeps its length">
          <input type="checkbox" checked={only} disabled={!track} onChange={(e) => setOnly(e.target.checked)} /> Selected layer only
        </label>
        <label />
        <label className="check" title={mode === 'insert' ? 'The clip at the frame is split: the inserted frames have no clip' : 'The clip at the frame is split into two clips'}>
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Split clip
        </label>
      </div>
      <p className="muted">
        {mode === 'insert'
          ? `From frame ${s.frame} on, clips, cels, keyframes and labels move back; a clip or ranged label over the frame gets longer.`
          : `Frames ${s.frame}–${s.frame + count - 1} go; later clips, cels, keyframes and labels move forward.`}
      </p>
      <Actions />
    </form>
  );
}
