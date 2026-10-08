import { useState } from 'react';
import { DEFAULT_VELOCITY } from '../../model/defaults';
import { TICKS_PER_STEP, formatDuration, formatPosition, noteName, ticksPerBar } from '../../model/timing';
import { updateNotes } from '../../store/actions';
import { useStore } from '../../store/store';
import { Knob } from '../controls/Knob';
import { closeDialog } from '../overlays';

/** Parses BAR:STEP:TICK (1-based bar and step) or, as a length, BARS:STEPS:TICKS from zero. */
function parseTime(text: string, beatsPerBar: number, isLength: boolean): number | null {
  const parts = text.trim().split(':').map((p) => Number(p.trim()));
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  while (parts.length < 3) parts.push(0);
  const [bars, steps, ticks] = parts;
  const base = isLength ? 0 : 1;
  if (!isLength && (bars < 1 || steps < 1)) return null;
  return Math.round((bars - base) * ticksPerBar(beatsPerBar) + (steps - base) * TICKS_PER_STEP + ticks);
}

/** FL Studio's "Note properties" window: velocity, start time and duration of one note. */
export function NotePropertiesDialog({ patternId, channelId, noteId }: { patternId: string; channelId: string; noteId: string }) {
  const note = useStore((s) => s.project.patterns.find((p) => p.id === patternId)?.notes[channelId]?.find((n) => n.id === noteId));
  const beatsPerBar = useStore((s) => s.project.beatsPerBar);
  const [velocity, setVelocity] = useState(note?.velocity ?? DEFAULT_VELOCITY);
  const [start, setStart] = useState(note ? formatPosition(note.start, beatsPerBar) : '');
  const [length, setLength] = useState(note ? formatDuration(note.length, beatsPerBar) : '');
  if (!note) return null;

  const startTicks = parseTime(start, beatsPerBar, false);
  const lengthTicks = parseTime(length, beatsPerBar, true);
  const valid = startTicks !== null && lengthTicks !== null && lengthTicks > 0;

  const accept = () => {
    if (!valid) return;
    updateNotes(patternId, channelId, (list) => {
      const n = list.find((x) => x.id === noteId);
      if (!n) return;
      n.velocity = velocity;
      n.start = startTicks;
      n.length = lengthTicks;
    });
    closeDialog();
  };

  return (
    <form
      className="modal small note-props"
      role="dialog"
      aria-label="Note properties"
      onSubmit={(e) => {
        e.preventDefault();
        accept();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') closeDialog();
      }}
    >
      <h2>
        Note properties – <span className="accent">{noteName(note.key)}</span>
      </h2>
      <h3>Levels</h3>
      <div className="note-props-levels">
        <Knob
          size={36}
          label="Velocity"
          showLabel
          value={velocity}
          min={1 / 128}
          max={1}
          defaultValue={DEFAULT_VELOCITY}
          format={(v) => String(Math.round(v * 127))}
          onChange={(v) => setVelocity(v)}
        />
      </div>
      <h3>Time</h3>
      <div className="settings-grid">
        <label htmlFor="note-start">Start time</label>
        <input id="note-start" type="text" value={start} spellCheck={false} onChange={(e) => setStart(e.target.value)} aria-invalid={startTicks === null} />
        <label htmlFor="note-length">Duration</label>
        <input id="note-length" type="text" value={length} spellCheck={false} onChange={(e) => setLength(e.target.value)} aria-invalid={lengthTicks === null || lengthTicks <= 0} />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => setVelocity(DEFAULT_VELOCITY)} data-hint="Resets the levels">
          Reset
        </button>
        <button type="submit" className="btn primary" disabled={!valid}>
          Accept
        </button>
      </div>
    </form>
  );
}
