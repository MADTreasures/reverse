/**
 * Animation dialogs: Animation > Timeline > New timeline / Change settings, Show animation cels >
 * Onion skin settings, and File > Export animation (animated GIF, APNG, image sequence, movie).
 */
import { useEffect, useState } from 'react';
import { exportAnimation, exportMovie, type AnimationFormat } from '../../io/documentIO';
import { hasSound } from '../../model/animation';
import { DEFAULT_TIMELINE, MAX_FPS, MAX_FRAMES, type OnionMode } from '../../paint/animation';
import * as anim from '../../store/animationActions';
import { getState, useStore } from '../../store/store';
import { closeDialog } from '../overlays';

const clampInt = (v: string, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

function Actions({ ok = 'OK', busy = false }: { ok?: string; busy?: boolean }) {
  return (
    <div className="modal-actions">
      <button type="button" className="btn" onClick={closeDialog}>
        Cancel
      </button>
      <button type="submit" className="btn primary" disabled={busy}>
        {ok}
      </button>
    </div>
  );
}

/** Animation > Timeline > New timeline / Change settings: frame rate and length. */
export function TimelineSettingsDialog() {
  const current = getState().doc.timeline;
  const [fps, setFps] = useState(current?.fps ?? DEFAULT_TIMELINE.fps);
  const [frames, setFrames] = useState(current?.frames ?? DEFAULT_TIMELINE.frames);
  const [enabled, setEnabled] = useState(current?.enabled ?? true);
  const title = current ? 'Change timeline settings' : 'New timeline';
  return (
    <form
      className="modal"
      role="dialog"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault();
        anim.setTimeline({ fps, frames, enabled }, current ? 'Timeline settings' : 'New timeline');
        closeDialog();
      }}
    >
      <h2>{title}</h2>
      <div className="form-grid">
        <label htmlFor="tl-fps">Frame rate</label>
        <span className="with-unit">
          <input id="tl-fps" type="number" min={1} max={MAX_FPS} value={fps} onChange={(e) => setFps(clampInt(e.target.value, 1, MAX_FPS, fps))} /> fps
        </span>
        <label htmlFor="tl-frames">Number of frames</label>
        <input id="tl-frames" type="number" min={1} max={MAX_FRAMES} value={frames} onChange={(e) => setFrames(clampInt(e.target.value, 1, MAX_FRAMES, frames))} />
        <label>Playback time</label>
        <span>{(frames / fps).toFixed(2)} s</span>
        <label />
        <label className="check">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enable timeline
        </label>
      </div>
      <Actions />
    </form>
  );
}

/** Animation > Show animation cels > Onion skin settings. */
export function OnionSkinDialog() {
  const initial = useStore((s) => s.onion);
  const [o, setO] = useState(initial);
  const set = (patch: Partial<typeof o>) => setO((x) => ({ ...x, ...patch }));
  return (
    <form
      className="modal"
      role="dialog"
      aria-label="Onion skin settings"
      onSubmit={(e) => {
        e.preventDefault();
        anim.setOnion(o);
        closeDialog();
      }}
    >
      <h2>Onion skin settings</h2>
      <div className="form-grid">
        <label htmlFor="onion-before">Previous cels</label>
        <input id="onion-before" type="number" min={0} max={10} value={o.before} onChange={(e) => set({ before: clampInt(e.target.value, 0, 10, o.before) })} />
        <label htmlFor="onion-after">Next cels</label>
        <input id="onion-after" type="number" min={0} max={10} value={o.after} onChange={(e) => set({ after: clampInt(e.target.value, 0, 10, o.after) })} />
        <label htmlFor="onion-mode">Color mode</label>
        <select id="onion-mode" value={o.mode} onChange={(e) => set({ mode: e.target.value as OnionMode })}>
          <option value="color">Color</option>
          <option value="half">Half color</option>
          <option value="mono">Monochrome</option>
        </select>
        <label>Display color</label>
        <span className="with-unit">
          Previous <input type="color" aria-label="Previous frame color" value={o.prevColor} onChange={(e) => set({ prevColor: e.target.value })} /> Next{' '}
          <input type="color" aria-label="Next frame color" value={o.nextColor} onChange={(e) => set({ nextColor: e.target.value })} />
        </span>
        <label htmlFor="onion-opacity">Opacity</label>
        <span className="with-unit">
          <input id="onion-opacity" type="number" min={5} max={100} value={Math.round(o.opacity * 100)} onChange={(e) => set({ opacity: clampInt(e.target.value, 5, 100, 50) / 100 })} /> %
        </span>
        <label htmlFor="onion-step">Step opacity</label>
        <span className="with-unit">
          <input id="onion-step" type="number" min={0} max={100} value={Math.round(o.step * 100)} onChange={(e) => set({ step: clampInt(e.target.value, 0, 100, 15) / 100 })} /> %
        </span>
      </div>
      <Actions />
    </form>
  );
}

const TITLES: Record<AnimationFormat, string> = { gif: 'Animated GIF export settings', apng: 'Animated sticker (APNG) export settings', sequence: 'Image sequence export settings' };

/** File > Export animation > Animated GIF / Animated sticker (APNG) / Image sequence. */
export function AnimationExportDialog({ format }: { format: AnimationFormat }) {
  const doc = useStore((s) => s.doc);
  const t = doc.timeline ?? DEFAULT_TIMELINE;
  const [width, setWidth] = useState(doc.width);
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(t.frames);
  const [fps, setFps] = useState(t.fps);
  const [endless, setEndless] = useState(true);
  const [plays, setPlays] = useState(1);
  const [dither, setDither] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const [drafts, setDrafts] = useState(false);
  const [camera, setCamera] = useState(true);
  const [prefix, setPrefix] = useState(doc.name || 'frame');
  const [startNumber, setStartNumber] = useState(1);
  const [type, setType] = useState<'png' | 'jpeg'>('png');
  const [busy, setBusy] = useState(false);
  const height = Math.max(1, Math.round((width * doc.height) / doc.width));
  const seconds = (end - start + 1) / t.fps;
  const images = Math.max(1, Math.round(seconds * fps));
  const run = async () => {
    setBusy(true);
    // Let the dialog show that it is busy before the frames are drawn.
    await new Promise((r) => setTimeout(r, 30));
    const ok = await exportAnimation({
      format,
      width,
      height,
      start,
      end,
      fps,
      plays: endless ? 0 : plays,
      dither,
      transparent,
      drafts,
      camera,
      sequence: { prefix, suffix: '', separator: '_', startNumber, type },
    });
    setBusy(false);
    if (ok) closeDialog();
  };
  return (
    <form
      className="modal"
      role="dialog"
      aria-label={TITLES[format]}
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <h2>{TITLES[format]}</h2>
      <div className="form-grid">
        <label htmlFor="ex-width">Width</label>
        <span className="with-unit">
          <input id="ex-width" type="number" min={1} max={doc.width * 4} value={width} onChange={(e) => setWidth(clampInt(e.target.value, 1, doc.width * 4, width))} /> × {height} px
        </span>
        <label>Export range</label>
        <span className="with-unit">
          <input type="number" aria-label="Start frame" min={1} max={end} value={start} onChange={(e) => setStart(clampInt(e.target.value, 1, end, start))} /> –{' '}
          <input type="number" aria-label="End frame" min={start} max={t.frames} value={end} onChange={(e) => setEnd(clampInt(e.target.value, start, t.frames, end))} />
        </span>
        <label htmlFor="ex-fps">Frame rate</label>
        <span className="with-unit">
          <input id="ex-fps" type="number" min={1} max={MAX_FPS} value={fps} onChange={(e) => setFps(clampInt(e.target.value, 1, MAX_FPS, fps))} /> fps
        </span>
        <label>Playback time</label>
        <span data-testid="export-playback">
          {seconds.toFixed(2)} s · {images} images
        </span>
        {format !== 'sequence' && (
          <>
            <label>Loop count</label>
            <span className="with-unit">
              <label className="check">
                <input type="checkbox" checked={endless} onChange={(e) => setEndless(e.target.checked)} /> Unlimited
              </label>
              {!endless && <input type="number" aria-label="Number of loops" min={1} max={100} value={plays} onChange={(e) => setPlays(clampInt(e.target.value, 1, 100, plays))} />}
            </span>
          </>
        )}
        {format === 'gif' && (
          <>
            <label />
            <label className="check">
              <input type="checkbox" checked={dither} onChange={(e) => setDither(e.target.checked)} /> Dithering
            </label>
          </>
        )}
        {format === 'sequence' && (
          <>
            <label htmlFor="ex-prefix">File prefix</label>
            <input id="ex-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.slice(0, 60))} />
            <label htmlFor="ex-start-number">Start number</label>
            <input id="ex-start-number" type="number" min={0} max={99999} value={startNumber} onChange={(e) => setStartNumber(clampInt(e.target.value, 0, 99999, 1))} />
            <label htmlFor="ex-type">Type</label>
            <select id="ex-type" value={type} onChange={(e) => setType(e.target.value as 'png' | 'jpeg')}>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
            </select>
          </>
        )}
        {!(format === 'sequence' && type === 'jpeg') && (
          <>
            <label />
            <label className="check">
              <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> Export transparency
            </label>
          </>
        )}
        <label />
        <label className="check">
          <input type="checkbox" checked={drafts} onChange={(e) => setDrafts(e.target.checked)} /> Export draft
        </label>
        <label />
        <label className="check">
          <input type="checkbox" checked={camera} onChange={(e) => setCamera(e.target.checked)} /> Apply 2D camera effects
        </label>
      </div>
      {format === 'sequence' && <p className="muted">The images are saved together in a ZIP file.</p>}
      <Actions ok={busy ? 'Exporting…' : 'OK'} busy={busy} />
    </form>
  );
}

/** File > Export animation > Movie: MP4 or QuickTime (MOV), with the sound of the audio tracks. */
export function MovieExportDialog() {
  const doc = useStore((s) => s.doc);
  const t = doc.timeline ?? DEFAULT_TIMELINE;
  const [format, setFormat] = useState<'mp4' | 'mov'>('mp4');
  const [width, setWidth] = useState(Math.min(doc.width, 1920));
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(t.frames);
  const [fps, setFps] = useState(t.fps);
  const [camera, setCamera] = useState(true);
  const [sampleRate, setSampleRate] = useState(48000);
  const [channels, setChannels] = useState(2);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [codecs, setCodecs] = useState('…');
  const evenW = Math.max(2, Math.floor(width / 2) * 2);
  const height = Math.max(2, Math.floor(Math.round((width * doc.height) / doc.width) / 2) * 2);
  const sound = hasSound(doc);
  useEffect(() => {
    let live = true;
    void import('../../io/movie').then(async ({ chooseCodecs, codecLabel }) => {
      const c = await chooseCodecs(format, evenW, height, fps, sampleRate, channels, sound);
      if (live) setCodecs(c ? codecLabel(c) : 'not available on this system (choose MOV)');
    });
    return () => {
      live = false;
    };
  }, [format, evenW, height, fps, sampleRate, channels, sound]);
  const run = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 30));
    const ok = await exportMovie({ format, width, start, end, fps, camera, sampleRate, channels }, (done, total) => setProgress(`${done} / ${total}`));
    setBusy(false);
    setProgress('');
    if (ok) closeDialog();
  };
  return (
    <form
      className="modal"
      role="dialog"
      aria-label="Movie export settings"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <h2>Movie export settings</h2>
      <div className="form-grid">
        <label htmlFor="mv-format">Format</label>
        <select id="mv-format" value={format} onChange={(e) => setFormat(e.target.value as 'mp4' | 'mov')}>
          <option value="mp4">MP4 (.mp4)</option>
          <option value="mov">QuickTime (.mov)</option>
        </select>
        <label>Codecs</label>
        <span className="muted" data-testid="movie-codecs">
          {codecs}
        </span>
        <label htmlFor="mv-width">Width</label>
        <span className="with-unit">
          <input id="mv-width" type="number" min={16} max={doc.width * 4} value={width} onChange={(e) => setWidth(clampInt(e.target.value, 16, doc.width * 4, width))} /> × {height} px
        </span>
        <label>Export range</label>
        <span className="with-unit">
          <input type="number" aria-label="Start frame" min={1} max={end} value={start} onChange={(e) => setStart(clampInt(e.target.value, 1, end, start))} /> –{' '}
          <input type="number" aria-label="End frame" min={start} max={t.frames} value={end} onChange={(e) => setEnd(clampInt(e.target.value, start, t.frames, end))} />
        </span>
        <label htmlFor="mv-fps">Frame rate</label>
        <span className="with-unit">
          <input id="mv-fps" type="number" min={1} max={MAX_FPS} value={fps} onChange={(e) => setFps(clampInt(e.target.value, 1, MAX_FPS, fps))} /> fps
        </span>
        <label />
        <label className="check">
          <input type="checkbox" checked={camera} onChange={(e) => setCamera(e.target.checked)} /> Apply 2D camera effects
        </label>
        <label htmlFor="mv-rate">Audio settings</label>
        <span className="with-unit">
          <select id="mv-rate" aria-label="Sampling frequency" value={sampleRate} disabled={!sound} onChange={(e) => setSampleRate(Number(e.target.value))}>
            <option value={44100}>44.1 kHz</option>
            <option value={48000}>48 kHz</option>
          </select>
          <select aria-label="Channels" value={channels} disabled={!sound} onChange={(e) => setChannels(Number(e.target.value))}>
            <option value={2}>Stereo</option>
            <option value={1}>Mono</option>
          </select>
          {!sound && <span className="muted">no audio tracks</span>}
        </span>
      </div>
      {progress && <p className="muted" data-testid="movie-progress">Encoding frame {progress}</p>}
      <Actions ok={busy ? 'Exporting…' : 'OK'} busy={busy} />
    </form>
  );
}
