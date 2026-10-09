/**
 * Animation dialogs: Animation > Timeline > New timeline / Change settings, Show animation cels >
 * Onion skin settings, and File > Export animation (animated GIF, APNG, image sequence, movie).
 */
import { useEffect, useState } from 'react';
import { exportAnimation, exportMovie, type AnimationFormat } from '../../io/documentIO';
import { hasSound, isCameraFolder, outputRect } from '../../model/animation';
import { flatten } from '../../model/layers';
import { DEFAULT_TIMELINE, endOf, MAX_FPS, MAX_FRAMES, startOf, type OnionMode, type Timeline } from '../../paint/animation';
import { nextTimelineName, timelineIndex, timelineList, timelineName } from '../../model/timelines';
import { areaRect, type DrawingArea } from '../../paint/outputFrame';
import type { PaintDocument } from '../../model/types';
import * as anim from '../../store/animationActions';
import { getState, useStore } from '../../store/store';
import { closeDialog, openDialog } from '../overlays';

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

/** Animation > Timeline > New timeline: a canvas's first timeline, or another one (empty). */
export function NewTimelineDialog() {
  const doc = getState().doc;
  const [name, setName] = useState(nextTimelineName(doc));
  const [fps, setFps] = useState(doc.timeline?.fps ?? DEFAULT_TIMELINE.fps);
  const [frames, setFrames] = useState(doc.timeline?.frames ?? DEFAULT_TIMELINE.frames);
  return (
    <form
      className="modal"
      role="dialog"
      aria-label="New timeline"
      onSubmit={(e) => {
        e.preventDefault();
        anim.newTimeline({ name: name.trim(), fps, frames });
        closeDialog();
      }}
    >
      <h2>New timeline</h2>
      <div className="form-grid">
        <label htmlFor="tl-name">Timeline name</label>
        <input id="tl-name" value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} autoFocus />
        <label htmlFor="tl-fps">Frame rate</label>
        <span className="with-unit">
          <input id="tl-fps" type="number" min={1} max={MAX_FPS} value={fps} onChange={(e) => setFps(clampInt(e.target.value, 1, MAX_FPS, fps))} /> fps
        </span>
        <label htmlFor="tl-frames">Number of frames</label>
        <input id="tl-frames" type="number" min={1} max={MAX_FRAMES} value={frames} onChange={(e) => setFrames(clampInt(e.target.value, 1, MAX_FRAMES, frames))} />
        <label>Playback time</label>
        <span>{(frames / fps).toFixed(2)} s</span>
      </div>
      {doc.timeline && <p className="muted">The canvas keeps its other timelines; the new one starts empty.</p>}
      <Actions />
    </form>
  );
}

/** Settings of a timeline: name, number of frames, start and end frame (the frame rate: Change frame rate). */
function TimelineFields({ value, onChange }: { value: Timeline; onChange: (t: Timeline) => void }) {
  const start = startOf(value);
  const end = endOf(value);
  return (
    <>
      <label htmlFor="tl-name">Timeline name</label>
      <input id="tl-name" value={value.name ?? ''} onChange={(e) => onChange({ ...value, name: e.target.value.slice(0, 60) })} />
      <label>Frame rate</label>
      <span className="muted">{value.fps} fps (Animation &gt; Timeline &gt; Change frame rate)</span>
      <label htmlFor="tl-frames">Number of frames</label>
      <input id="tl-frames" type="number" min={1} max={MAX_FRAMES} value={value.frames} onChange={(e) => onChange({ ...value, frames: clampInt(e.target.value, 1, MAX_FRAMES, value.frames) })} />
      <label>Playback time</label>
      <span>{(value.frames / value.fps).toFixed(2)} s</span>
      <label>Start / end frame</label>
      <span className="with-unit">
        <input type="number" aria-label="Start frame" min={1} max={end} value={start} onChange={(e) => onChange({ ...value, start: clampInt(e.target.value, 1, end, start) })} /> –{' '}
        <input type="number" aria-label="End frame" min={start} max={value.frames} value={end} onChange={(e) => onChange({ ...value, end: clampInt(e.target.value, start, value.frames, end) })} />
      </span>
    </>
  );
}

/** Animation > Timeline > Change settings of the edited timeline. */
export function TimelineSettingsDialog() {
  const current = getState().doc.timeline ?? DEFAULT_TIMELINE;
  const [t, setT] = useState(current);
  return (
    <form
      className="modal"
      role="dialog"
      aria-label="Change timeline settings"
      onSubmit={(e) => {
        e.preventDefault();
        anim.setTimeline({ ...t, name: t.name?.trim() || undefined });
        closeDialog();
      }}
    >
      <h2>Change timeline settings</h2>
      <div className="form-grid">
        <TimelineFields value={t} onChange={setT} />
        <label />
        <label className="check">
          <input type="checkbox" checked={t.enabled} onChange={(e) => setT({ ...t, enabled: e.target.checked })} /> Enable timeline
        </label>
      </div>
      <Actions />
    </form>
  );
}

/** Animation > Timeline > Change frame rate (Change total number of frames: the playing time stays). */
export function FrameRateDialog() {
  const current = getState().doc.timeline ?? DEFAULT_TIMELINE;
  const [fps, setFps] = useState(current.fps);
  const [rescale, setRescale] = useState(true);
  const frames = rescale ? Math.max(1, Math.min(MAX_FRAMES, Math.round((current.frames * fps) / current.fps))) : current.frames;
  return (
    <form
      className="modal"
      role="dialog"
      aria-label="Change frame rate"
      onSubmit={(e) => {
        e.preventDefault();
        anim.setFrameRate(fps, rescale);
        closeDialog();
      }}
    >
      <h2>Change frame rate</h2>
      <div className="form-grid">
        <label htmlFor="fr-fps">Frame rate</label>
        <span className="with-unit">
          <input id="fr-fps" type="number" min={1} max={MAX_FPS} value={fps} onChange={(e) => setFps(clampInt(e.target.value, 1, MAX_FPS, fps))} /> fps
        </span>
        <label />
        <label className="check">
          <input type="checkbox" checked={rescale} onChange={(e) => setRescale(e.target.checked)} /> Change total number of frames
        </label>
        <label>Result</label>
        <span data-testid="frame-rate-result">
          {frames} frames · {(frames / fps).toFixed(2)} s
        </span>
      </div>
      <p className="muted">With Change total number of frames, cels, clips and keyframes move so that the animation keeps its playing time.</p>
      <Actions />
    </form>
  );
}

/** Animation > Timeline > Manage timeline: the canvas's timelines; new, duplicate, delete, settings, order. */
export function ManageTimelinesDialog() {
  const doc = useStore((s) => s.doc);
  const list = timelineList(doc);
  const edited = timelineIndex(doc);
  const [selected, setSelected] = useState(edited);
  const sel = Math.min(selected, list.length - 1);
  const [draft, setDraft] = useState<Timeline | null>(null);
  const t = draft ?? list[sel];
  return (
    <div className="modal" role="dialog" aria-label="Manage timeline">
      <h2>Manage timeline</h2>
      <div className="timeline-manager">
        <ul className="timeline-list" role="listbox" aria-label="Timelines">
          {list.map((x, i) => (
            <li
              key={i}
              role="option"
              aria-selected={i === sel}
              className={`${i === sel ? 'selected' : ''} ${i === edited ? 'edited' : ''}`}
              onClick={() => {
                setSelected(i);
                setDraft(null);
              }}
              onDoubleClick={() => anim.switchToTimeline(i)}
            >
              {timelineName(x, i)}
              {i === edited && <span className="muted"> · edited</span>}
            </li>
          ))}
        </ul>
        <div className="timeline-buttons">
          <button type="button" className="btn small" onClick={() => openDialog('newTimeline')}>
            New timeline
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              if (sel !== edited) anim.switchToTimeline(sel);
              anim.duplicateTimeline();
              setSelected(timelineIndex(getState().doc));
            }}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="btn small"
            disabled={list.length <= 1}
            onClick={() => {
              anim.removeTimeline(sel);
              setSelected(Math.max(0, sel - 1));
              setDraft(null);
            }}
          >
            Delete
          </button>
          <button type="button" className="btn small" disabled={sel === edited} onClick={() => anim.switchToTimeline(sel)}>
            Edit this timeline
          </button>
          <button
            type="button"
            className="btn small"
            disabled={sel === 0}
            onClick={() => {
              anim.reorderTimeline(sel, -1);
              setSelected(sel - 1);
            }}
          >
            Move up
          </button>
          <button
            type="button"
            className="btn small"
            disabled={sel >= list.length - 1}
            onClick={() => {
              anim.reorderTimeline(sel, 1);
              setSelected(sel + 1);
            }}
          >
            Move down
          </button>
        </div>
      </div>
      {t && (
        <form
          className="form-grid"
          aria-label="Change settings"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft) anim.setStoredTimeline(sel, { ...draft, name: draft.name?.trim() || undefined });
            setDraft(null);
          }}
        >
          <TimelineFields value={t} onChange={setDraft} />
          <label />
          <button type="submit" className="btn small" disabled={!draft}>
            Change settings
          </button>
        </form>
      )}
      <div className="modal-actions">
        <button type="button" className="btn primary" onClick={closeDialog}>
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * Animation > New animation layer > 2D camera folder: its name and the size of the output frame
 * (added to a canvas without one; fixed once a camera folder uses it).
 */
export function CameraFolderDialog() {
  const doc = useStore((s) => s.doc);
  const fixed = flatten(doc.layers).some(isCameraFolder);
  const current = outputRect(doc);
  const [name, setName] = useState('2D camera folder');
  const [w, setW] = useState(current.w);
  const [h, setH] = useState(current.h);
  return (
    <form
      className="modal"
      role="dialog"
      aria-label="2D camera folder"
      onSubmit={(e) => {
        e.preventDefault();
        closeDialog();
        anim.newCameraFolder(name.trim() || '2D camera folder', fixed ? undefined : { w, h });
      }}
    >
      <h2>2D camera folder</h2>
      <div className="form-grid">
        <label htmlFor="cam-name">Name</label>
        <input id="cam-name" value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} autoFocus />
        <label>Size of output frame</label>
        <span className="with-unit">
          <input type="number" aria-label="Output frame width" min={1} max={doc.width} value={w} disabled={fixed} onChange={(e) => setW(clampInt(e.target.value, 1, doc.width, w))} /> ×
          <input type="number" aria-label="Output frame height" min={1} max={doc.height} value={h} disabled={fixed} onChange={(e) => setH(clampInt(e.target.value, 1, doc.height, h))} /> px
        </span>
      </div>
      <p className="muted">{fixed ? 'Another 2D camera folder uses the output frame: its size stays.' : doc.outputFrame ? 'The output frame keeps its middle.' : 'The canvas gets an output frame in its middle.'}</p>
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

/** Drawing area (canvases with animation frame lines): the output frame, the overflow frame or the entire canvas. */
function DrawingAreaField({ doc, value, onChange }: { doc: PaintDocument; value: DrawingArea; onChange: (a: DrawingArea) => void }) {
  if (!doc.outputFrame) return null;
  return (
    <>
      <label htmlFor="ex-area">Drawing area</label>
      <select id="ex-area" value={value} onChange={(e) => onChange(e.target.value as DrawingArea)}>
        <option value="output">Output frame</option>
        {doc.outputFrame.overflow && <option value="overflow">Overflow frame</option>}
        <option value="canvas">Entire canvas</option>
      </select>
    </>
  );
}

const TITLES: Record<AnimationFormat, string> = { gif: 'Animated GIF export settings', apng: 'Animated sticker (APNG) export settings', sequence: 'Image sequence export settings' };

/** File > Export animation > Animated GIF / Animated sticker (APNG) / Image sequence. */
export function AnimationExportDialog({ format }: { format: AnimationFormat }) {
  const doc = useStore((s) => s.doc);
  const t = doc.timeline ?? DEFAULT_TIMELINE;
  const [area, setArea] = useState<DrawingArea>('output');
  const rect = areaRect(doc.outputFrame, area, doc.width, doc.height);
  const [width, setWidth] = useState(rect.w);
  const [frameLines, setFrameLines] = useState(false);
  // Export range: the start … end frame.
  const [start, setStart] = useState(startOf(t));
  const [end, setEnd] = useState(endOf(t));
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
  const height = Math.max(1, Math.round((width * rect.h) / rect.w));
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
      area,
      frameLines,
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
        <DrawingAreaField
          doc={doc}
          value={area}
          onChange={(a) => {
            setArea(a);
            setWidth(areaRect(doc.outputFrame, a, doc.width, doc.height).w);
          }}
        />
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
            {doc.outputFrame && (
              <>
                <label />
                <label className="check">
                  <input type="checkbox" checked={frameLines} onChange={(e) => setFrameLines(e.target.checked)} /> Export frames
                </label>
              </>
            )}
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
  const [area, setArea] = useState<DrawingArea>('output');
  const rect = areaRect(doc.outputFrame, area, doc.width, doc.height);
  const [width, setWidth] = useState(Math.min(rect.w, 1920));
  // Export range: the start … end frame.
  const [start, setStart] = useState(startOf(t));
  const [end, setEnd] = useState(endOf(t));
  const [fps, setFps] = useState(t.fps);
  const [camera, setCamera] = useState(true);
  const [sampleRate, setSampleRate] = useState(48000);
  const [channels, setChannels] = useState(2);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [codecs, setCodecs] = useState('…');
  const evenW = Math.max(2, Math.floor(width / 2) * 2);
  const height = Math.max(2, Math.floor(Math.round((width * rect.h) / rect.w) / 2) * 2);
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
    const ok = await exportMovie({ format, width, area, start, end, fps, camera, sampleRate, channels }, (done, total) => setProgress(`${done} / ${total}`));
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
        <DrawingAreaField
          doc={doc}
          value={area}
          onChange={(a) => {
            setArea(a);
            setWidth(Math.min(areaRect(doc.outputFrame, a, doc.width, doc.height).w, 1920));
          }}
        />
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
