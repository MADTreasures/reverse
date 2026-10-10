import { useState } from 'react';
import { CLIP_GAIN_MAX_DB, CLIP_GAIN_MIN_DB, CLIP_PITCH_RANGE, CLIP_STRETCH_MAX, CLIP_STRETCH_MIN } from '../../model/clips';
import { secondsToTicks, ticksToSeconds } from '../../model/timing';
import type { AudioClip } from '../../model/types';
import { endCoalesce, gestureKey, setClipStretch, updateAudioClips } from '../../store/actions';
import { useStore } from '../../store/store';
import { DragNumber } from '../controls/DragNumber';
import { Knob } from '../controls/Knob';
import { closeDialog } from '../overlays';

const formatGain = (db: number) => (db <= CLIP_GAIN_MIN_DB ? '-∞ dB' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`);
const formatTension = (t: number) => `${Math.round(t * 100)}%`;

/**
 * FL Studio's audio clip properties (Alt+double-click a clip): gain, pitch and fine (the length stays),
 * reverse, time stretch and the fades of this clip instance. The channel settings apply to all instances.
 */
export function AudioClipPropertiesDialog({ clipId }: { clipId: string }) {
  const clip = useStore((s) => s.project.clips.find((c): c is AudioClip => c.id === clipId && c.kind === 'audio'));
  const bpm = useStore((s) => s.project.bpm);
  const name = useStore((s) => {
    const ch = clip ? s.project.channels.find((c) => c.id === clip.channelId) : undefined;
    return ch?.name ?? 'Audio clip';
  });
  const ms = (ticks: number | undefined) => Math.round(ticksToSeconds(ticks ?? 0, bpm) * 1000);
  const [gain, setGain] = useState(clip?.gain ?? 0);
  const [pitch, setPitch] = useState(clip?.pitch ?? 0);
  const [fine, setFine] = useState(clip?.fine ?? 0);
  const [reverse, setReverse] = useState(clip?.reverse ?? false);
  const [stretch, setStretch] = useState(clip?.stretch ?? 1);
  const [fadeIn, setFadeIn] = useState(ms(clip?.fadeIn));
  const [fadeOut, setFadeOut] = useState(ms(clip?.fadeOut));
  const [fadeInTension, setFadeInTension] = useState(clip?.fadeInTension ?? 0);
  const [fadeOutTension, setFadeOutTension] = useState(clip?.fadeOutTension ?? 0);
  if (!clip) return null;

  const accept = () => {
    const key = gestureKey('clip-properties');
    const toTicks = (milliseconds: number) => Math.round(secondsToTicks(milliseconds / 1000, bpm));
    updateAudioClips(
      [clipId],
      (c) => {
        c.gain = gain;
        c.pitch = pitch;
        c.fine = fine;
        c.reverse = reverse;
        c.fadeIn = toTicks(fadeIn);
        c.fadeOut = toTicks(fadeOut);
        c.fadeInTension = fadeInTension;
        c.fadeOutTension = fadeOutTension;
      },
      { coalesce: key, label: 'playlist clip properties' },
    );
    if (Math.abs(stretch - (clip.stretch ?? 1)) > 1e-6) setClipStretch([clipId], stretch, { coalesce: key, label: 'playlist clip properties' });
    endCoalesce();
    closeDialog();
  };

  return (
    <form
      className="modal small clip-props"
      role="dialog"
      aria-label="Clip properties"
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
        Clip properties – <span className="accent">{name}</span>
      </h2>
      <h3>Level and pitch</h3>
      <div className="note-props-levels">
        <Knob size={36} label="Gain" showLabel value={gain} min={CLIP_GAIN_MIN_DB} max={CLIP_GAIN_MAX_DB} defaultValue={0} format={formatGain} onChange={(v) => setGain(Math.round(v * 10) / 10)} />
        <Knob size={36} label="Pitch" showLabel value={pitch} min={-CLIP_PITCH_RANGE} max={CLIP_PITCH_RANGE} defaultValue={0} bipolar integer format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} st`} onChange={(v) => setPitch(Math.round(v))} />
        <Knob size={36} label="Fine" showLabel value={fine} min={-100} max={100} defaultValue={0} bipolar format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} ct`} onChange={(v) => setFine(Math.round(v))} />
      </div>
      <div className="note-props-kind">
        <label>
          <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
          Reverse
        </label>
        <label className="clip-props-stretch">
          Stretch
          <DragNumber
            className="tb-number"
            value={stretch}
            min={CLIP_STRETCH_MIN}
            max={CLIP_STRETCH_MAX}
            step={0.005}
            decimals={3}
            defaultValue={1}
            hint="Time stretch: the clip plays this many times longer at the same pitch (drag or double-click to type)"
            format={(v) => `×${v.toFixed(3)}`}
            onChange={(v) => setStretch(Math.round(v * 1000) / 1000)}
          />
        </label>
      </div>
      <h3>Fades</h3>
      <div className="settings-grid">
        <label>Fade in</label>
        <DragNumber className="tb-number" value={fadeIn} min={0} max={60000} step={2} defaultValue={0} hint="Fade-in length (ms)" format={(v) => `${Math.round(v)} ms`} onChange={(v) => setFadeIn(Math.round(v))} />
        <label>Fade-in tension</label>
        <Knob size={26} label="Fade-in tension" value={fadeInTension} min={-1} max={1} defaultValue={0} bipolar format={formatTension} onChange={setFadeInTension} />
        <label>Fade out</label>
        <DragNumber className="tb-number" value={fadeOut} min={0} max={60000} step={2} defaultValue={0} hint="Fade-out length (ms)" format={(v) => `${Math.round(v)} ms`} onChange={(v) => setFadeOut(Math.round(v))} />
        <label>Fade-out tension</label>
        <Knob size={26} label="Fade-out tension" value={fadeOutTension} min={-1} max={1} defaultValue={0} bipolar format={formatTension} onChange={setFadeOutTension} />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => closeDialog()}>
          Cancel
        </button>
        <button type="submit" className="btn primary">
          Accept
        </button>
      </div>
    </form>
  );
}
