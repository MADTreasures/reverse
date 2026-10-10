import { useState } from 'react';
import { NOTE_COLOR_COUNT, NOTE_PROPS, noteColor, noteValue, setNoteValue, type NotePropKey } from '../../model/notes';
import { TICKS_PER_STEP, formatDuration, formatPosition, noteName, ticksPerBar } from '../../model/timing';
import type { Note } from '../../model/types';
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

type NoteKind = 'normal' | 'slide' | 'porta';

/**
 * FL Studio's "Note properties" window: the levels (pan, velocity, release, Mod X, Mod Y, fine pitch),
 * colour group, slide/portamento and mute, start time and duration of one note.
 */
export function NotePropertiesDialog({ patternId, channelId, noteId }: { patternId: string; channelId: string; noteId: string }) {
  const note = useStore((s) => s.project.patterns.find((p) => p.id === patternId)?.notes[channelId]?.find((n) => n.id === noteId));
  const channelColor = useStore((s) => s.project.channels.find((c) => c.id === channelId)?.color ?? '#888');
  const beatsPerBar = useStore((s) => s.project.beatsPerBar);
  const [levels, setLevels] = useState<Record<NotePropKey, number>>(() =>
    Object.fromEntries(NOTE_PROPS.map((spec) => [spec.key, note ? noteValue(note, spec.key) : spec.def])) as Record<NotePropKey, number>,
  );
  const [color, setColor] = useState(note?.color ?? 0);
  const [kind, setKind] = useState<NoteKind>(note?.slide ? 'slide' : note?.porta ? 'porta' : 'normal');
  const [muted, setMuted] = useState(note?.muted ?? false);
  const [start, setStart] = useState(note ? formatPosition(note.start, beatsPerBar) : '');
  const [length, setLength] = useState(note ? formatDuration(note.length, beatsPerBar) : '');
  if (!note) return null;

  const startTicks = parseTime(start, beatsPerBar, false);
  const lengthTicks = parseTime(length, beatsPerBar, true);
  const valid = startTicks !== null && lengthTicks !== null && lengthTicks > 0;

  const accept = () => {
    if (!valid) return;
    updateNotes(patternId, channelId, (list) => {
      const n = list.find((x) => x.id === noteId) as Note | undefined;
      if (!n) return;
      for (const spec of NOTE_PROPS) setNoteValue(n, spec.key, levels[spec.key]);
      if (color > 0) n.color = color;
      else delete n.color;
      delete n.slide;
      delete n.porta;
      if (kind === 'slide') n.slide = true;
      else if (kind === 'porta') n.porta = true;
      if (muted) n.muted = true;
      else delete n.muted;
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
        {NOTE_PROPS.map((spec) => (
          <Knob
            key={spec.key}
            size={36}
            label={spec.label}
            showLabel
            value={levels[spec.key]}
            min={spec.key === 'velocity' ? 1 / 128 : spec.min}
            max={spec.max}
            bipolar={spec.bipolar}
            defaultValue={spec.def}
            format={spec.format}
            onChange={(v) => setLevels((l) => ({ ...l, [spec.key]: spec.key === 'fine' ? Math.round(v) : v }))}
          />
        ))}
      </div>
      <h3>Type</h3>
      <div className="note-props-kind">
        {(['normal', 'slide', 'porta'] as NoteKind[]).map((k) => (
          <label key={k}>
            <input type="radio" name="note-kind" checked={kind === k} onChange={() => setKind(k)} />
            {k === 'normal' ? 'Normal' : k === 'slide' ? 'Slide' : 'Portamento'}
          </label>
        ))}
        <label>
          <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
          Muted
        </label>
      </div>
      <h3>Colour group</h3>
      <div className="note-props-colors" role="group" aria-label="Colour group">
        {Array.from({ length: NOTE_COLOR_COUNT }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={color === i}
            aria-label={`Colour group ${i + 1}`}
            data-hint={`Colour group ${i + 1}${i === 0 ? ' (channel colour)' : ''} – plugins receive it as MIDI channel ${i + 1}`}
            style={{ background: noteColor(i, channelColor) }}
            onClick={() => setColor(i)}
          />
        ))}
      </div>
      <h3>Time</h3>
      <div className="settings-grid">
        <label htmlFor="note-start">Start time</label>
        <input id="note-start" type="text" value={start} spellCheck={false} onChange={(e) => setStart(e.target.value)} aria-invalid={startTicks === null} />
        <label htmlFor="note-length">Duration</label>
        <input id="note-length" type="text" value={length} spellCheck={false} onChange={(e) => setLength(e.target.value)} aria-invalid={lengthTicks === null || lengthTicks <= 0} />
      </div>
      <div className="modal-actions">
        <button
          type="button"
          className="btn"
          onClick={() => setLevels(Object.fromEntries(NOTE_PROPS.map((spec) => [spec.key, spec.def])) as Record<NotePropKey, number>)}
          data-hint="Resets the levels"
        >
          Reset
        </button>
        <button type="submit" className="btn primary" disabled={!valid}>
          Accept
        </button>
      </div>
    </form>
  );
}
