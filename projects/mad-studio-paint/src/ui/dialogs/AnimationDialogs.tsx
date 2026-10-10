/**
 * Animation dialogs: Animation > Timeline > New timeline / Change settings, Show animation cels >
 * Onion skin settings, and File > Export animation (image sequence, animated GIF, APNG, WebP, movie).
 */
import { useEffect, useMemo, useState } from 'react';
import { celFiles, exportAnimation, exportAnimationCels, exportAudio, exportMovie, type AnimationFormat } from '../../io/documentIO';
import { CEL_NAME_FORMATS, type CelNameFormat } from '../../io/animationCels';
import { SEQUENCE_EXT, sequenceNames, type SequenceType } from '../../io/sequence';
import { hasSound, isCameraFolder, outputRect } from '../../model/animation';
import { findLayer, flatten } from '../../model/layers';
import { celsBetween, celsByNumber, DEFAULT_TIMELINE, endOf, FRAME_DISPLAYS, frameLabel, MAX_FPS, MAX_FRAMES, startOf, type FrameDisplay, type OnionMode, type Timeline } from '../../paint/animation';
import { nextTimelineName, timelineIndex, timelineList, timelineName } from '../../model/timelines';
import { areaRect, type DrawingArea } from '../../paint/outputFrame';
import type { PaintDocument } from '../../model/types';
import * as anim from '../../store/animationActions';
import * as light from '../../store/lightTableActions';
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
  const [display, setDisplay] = useState<FrameDisplay>(doc.timeline?.display ?? 'frame1');
  const [division, setDivision] = useState(doc.timeline?.division ?? 0);
  return (
    <form
      className="modal"
      role="dialog"
      aria-label="New timeline"
      onSubmit={(e) => {
        e.preventDefault();
        anim.newTimeline({ name: name.trim(), fps, frames, display, division });
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
        <DisplayFields display={display} division={division} onDisplay={setDisplay} onDivision={setDivision} />
      </div>
      {doc.timeline && <p className="muted">The canvas keeps its other timelines; the new one starts empty.</p>}
      <Actions />
    </form>
  );
}

/** How the Timeline palette shows frames (Playback time) and its division lines. */
function DisplayFields({ display, division, onDisplay, onDivision }: { display: FrameDisplay; division: number; onDisplay: (d: FrameDisplay) => void; onDivision: (n: number) => void }) {
  return (
    <>
      <label htmlFor="tl-display">Frame display</label>
      <select id="tl-display" value={display} onChange={(e) => onDisplay(e.target.value as FrameDisplay)}>
        {FRAME_DISPLAYS.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <label htmlFor="tl-division">Division line</label>
      <span className="with-unit">
        <input id="tl-division" type="number" min={0} max={100} value={division} onChange={(e) => onDivision(clampInt(e.target.value, 0, 100, division))} /> frames (0: none)
      </span>
    </>
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
        <span data-testid="timeline-range-label">
          ({frameLabel(start, value.fps, value.display)} – {frameLabel(end, value.fps, value.display)})
        </span>
      </span>
      <DisplayFields
        display={value.display ?? 'frame1'}
        division={value.division ?? 0}
        onDisplay={(d) => {
          const { display: _d, ...rest } = value;
          onChange(d === 'frame1' ? rest : { ...rest, display: d });
        }}
        onDivision={(n) => {
          const { division: _n, ...rest } = value;
          onChange(n ? { ...rest, division: n } : rest);
        }}
      />
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
        anim.setTimeline({ ...t, name: t.name?.trim() || undefined, display: t.display, division: t.division });
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

const TITLES: Record<AnimationFormat, string> = {
  gif: 'Animated GIF export settings',
  apng: 'Animated sticker (APNG) export settings',
  webp: 'Animated WebP export settings',
  sequence: 'Image sequence export settings',
};

const SEQUENCE_TYPES: [SequenceType, string][] = [
  ['bmp', 'BMP'],
  ['jpeg', 'JPEG'],
  ['png', 'PNG'],
  ['webp', 'WEBP'],
  ['tiff', 'TIFF'],
  ['tga', 'TGA'],
];

/** "1.0": tenths of a second when they are exact, else hundredths. */
const secondsText = (s: number) => s.toFixed(Math.abs(s * 10 - Math.round(s * 10)) < 1e-6 ? 1 : 2);

/** WebP: Prioritize quality (lossless) or Prioritize file size with a quality. */
function WebpCompression({ lossless, quality, onLossless, onQuality }: { lossless: boolean; quality: number; onLossless: (v: boolean) => void; onQuality: (v: number) => void }) {
  return (
    <fieldset className="group">
      <legend>Compression method</legend>
      <label className="check">
        <input type="radio" name="webp-method" checked={lossless} onChange={() => onLossless(true)} /> Prioritize quality
      </label>
      <label className="check">
        <input type="radio" name="webp-method" checked={!lossless} onChange={() => onLossless(false)} /> Prioritize file size
      </label>
      <span className="with-unit indent">
        <label htmlFor="webp-quality">Quality</label>
        <input id="webp-quality" type="number" min={1} max={100} value={quality} disabled={lossless} onChange={(e) => onQuality(clampInt(e.target.value, 1, 100, quality))} />
      </span>
    </fieldset>
  );
}

/**
 * File > Export animation > Image sequence / Animated GIF / Animated sticker (APNG) / Animated
 * WebP, laid out like the reference's export settings dialogs.
 */
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
  const [cropBlank, setCropBlank] = useState(false);
  const [reduce, setReduce] = useState(false);
  const [lossless, setLossless] = useState(true);
  const [quality, setQuality] = useState(100);
  const [drafts, setDrafts] = useState(false);
  const [camera, setCamera] = useState(true);
  const [prefix, setPrefix] = useState(doc.name || 'Sequence');
  const [suffix, setSuffix] = useState('');
  const [separator, setSeparator] = useState('_');
  const [startNumber, setStartNumber] = useState(1);
  const [type, setType] = useState<SequenceType>('png');
  const [busy, setBusy] = useState(false);
  const maxWidth = doc.width * 4;
  const height = Math.max(1, Math.round((width * rect.h) / rect.w));
  const setHeight = (h: number) => setWidth(Math.max(1, Math.min(maxWidth, Math.round((h * rect.w) / rect.h))));
  const seconds = (end - start + 1) / t.fps;
  const images = Math.max(1, Math.round(seconds * fps));
  const sequence = format === 'sequence';
  // An empty separator: spaces between the parts (as in the reference).
  const names = { prefix, suffix, separator: separator || ' ', startNumber, type, quality: quality / 100, lossless };
  const firstName = sequenceNames(images, { ...names, start: startNumber, ext: SEQUENCE_EXT[type] })[0];
  const opaqueType = sequence && (type === 'jpeg' || type === 'bmp');
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
      cropBlank,
      reduceColors: reduce,
      webp: { lossless, quality: quality / 100 },
      sequence: names,
    });
    setBusy(false);
    if (ok) closeDialog();
  };
  const area$ = (
    <DrawingAreaField
      doc={doc}
      value={area}
      onChange={(a) => {
        setArea(a);
        setWidth(areaRect(doc.outputFrame, a, doc.width, doc.height).w);
      }}
    />
  );
  const size = (
    <span className="with-unit">
      <input id="ex-width" type="number" min={1} max={maxWidth} value={width} onChange={(e) => setWidth(clampInt(e.target.value, 1, maxWidth, width))} />
      <label htmlFor="ex-height">Height</label>
      <input id="ex-height" type="number" min={1} max={maxWidth * 4} value={height} onChange={(e) => setHeight(clampInt(e.target.value, 1, maxWidth * 4, height))} /> px
    </span>
  );
  const range = (
    <span className="with-unit">
      <input type="number" aria-label="Start frame" min={1} max={end} value={start} onChange={(e) => setStart(clampInt(e.target.value, 1, end, start))} /> to{' '}
      <input type="number" aria-label="End frame" min={start} max={t.frames} value={end} onChange={(e) => setEnd(clampInt(e.target.value, start, t.frames, end))} /> (Frame)
    </span>
  );
  const rate = (
    <span className="with-unit">
      <input id="ex-fps" type="number" min={1} max={MAX_FPS} value={fps} onChange={(e) => setFps(clampInt(e.target.value, 1, MAX_FPS, fps))} /> fps
    </span>
  );
  const playback = (
    <span data-testid="export-playback">
      Playback time: {secondsText(seconds)} s ( Image number: {images} )
    </span>
  );
  const check = (label: string, value: boolean, set: (v: boolean) => void) => (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} /> {label}
    </label>
  );
  return (
    <form
      className="modal export-settings"
      role="dialog"
      aria-label={TITLES[format]}
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <h2>{TITLES[format]}</h2>
      {sequence ? (
        <>
          <fieldset className="group">
            <legend>File name settings</legend>
            <div className="form-grid">
              <label>File name</label>
              <span data-testid="sequence-name">{firstName}</span>
              <label htmlFor="ex-prefix">File prefix</label>
              <input id="ex-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.slice(0, 60))} />
              <label htmlFor="ex-suffix">File suffix</label>
              <input id="ex-suffix" value={suffix} onChange={(e) => setSuffix(e.target.value.slice(0, 60))} />
              <label htmlFor="ex-separator">Separator</label>
              <span className="with-unit">
                <input id="ex-separator" value={separator} onChange={(e) => setSeparator(e.target.value.slice(0, 8))} />
                <label htmlFor="ex-start-number">Start number</label>
                <input id="ex-start-number" type="number" min={0} max={99999} value={startNumber} onChange={(e) => setStartNumber(clampInt(e.target.value, 0, 99999, 1))} />
              </span>
            </div>
          </fieldset>
          <fieldset className="group">
            <legend>Advanced settings</legend>
            <div className="form-grid">
              <label htmlFor="ex-type">Type</label>
              <select id="ex-type" value={type} onChange={(e) => setType(e.target.value as SequenceType)}>
                {SEQUENCE_TYPES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
              {type === 'jpeg' && (
                <>
                  <label htmlFor="ex-quality">Quality</label>
                  <input id="ex-quality" type="number" min={1} max={100} value={quality} onChange={(e) => setQuality(clampInt(e.target.value, 1, 100, quality))} />
                </>
              )}
              <label />
              <span className="checks">
                {check('Export draft', drafts, setDrafts)}
                {doc.outputFrame && check('Export frames', frameLines, setFrameLines)}
                {!opaqueType && check('Export transparency', transparent, setTransparent)}
              </span>
            </div>
            {type === 'webp' && <WebpCompression lossless={lossless} quality={quality} onLossless={setLossless} onQuality={setQuality} />}
          </fieldset>
          <fieldset className="group">
            <legend>Size settings</legend>
            <div className="form-grid">
              {area$}
              <label htmlFor="ex-width">Width</label>
              {size}
              <label />
              {check('Apply 2D camera effects', camera, setCamera)}
            </div>
          </fieldset>
          <fieldset className="group">
            <legend>Frame export</legend>
            <div className="form-grid">
              <label>Export range</label>
              {range}
              <label htmlFor="ex-fps">Frame rate</label>
              {rate}
              <label />
              {playback}
            </div>
          </fieldset>
          <p className="muted">The images are saved together in a ZIP file.</p>
        </>
      ) : (
        <>
          <div className="form-grid">
            {area$}
            <label htmlFor="ex-width">Width</label>
            {size}
            <label>Export range</label>
            {range}
            <label htmlFor="ex-fps">Frame rate</label>
            {rate}
            <label htmlFor="ex-loop">Loop count</label>
            <span className="with-unit">
              <select id="ex-loop" value={endless ? 'unlimited' : 'count'} onChange={(e) => setEndless(e.target.value === 'unlimited')}>
                <option value="unlimited">Unlimited</option>
                <option value="count">Number of loops</option>
              </select>
              {!endless && (
                <>
                  <input type="number" aria-label="Number of loops" min={1} max={100} value={plays} onChange={(e) => setPlays(clampInt(e.target.value, 1, 100, plays))} /> Time(s)
                </>
              )}
            </span>
            <label />
            {playback}
          </div>
          <fieldset className="group">
            <legend>Export options</legend>
            {format === 'gif' && (
              <>
                {check('Dithering', dither, setDither)}
                {check('Export transparency', transparent, setTransparent)}
              </>
            )}
            {format === 'apng' && (
              <>
                {check('Delete blank spaces', cropBlank, setCropBlank)}
                {check('Color reduction', reduce, setReduce)}
              </>
            )}
            {format === 'webp' && (
              <>
                {check('Export transparency', transparent, setTransparent)}
                <WebpCompression lossless={lossless} quality={quality} onLossless={setLossless} onQuality={setQuality} />
              </>
            )}
            {check('Export draft', drafts, setDrafts)}
            {check('Apply 2D camera effects', camera, setCamera)}
          </fieldset>
        </>
      )}
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

/**
 * Animation > Light table > Move canvas to center: a slider between two light table layers (their
 * names at its ends) moves and turns the canvas towards either; 50 puts it in the middle. The
 * canvas follows while the slider moves; Cancel puts it back.
 */
export function CenterCanvasDialog() {
  const pair = useMemo(() => light.centerPair(), []);
  const layers = useStore((s) => s.doc.layers);
  const names = pair?.map((l) => (l.source.kind === 'image' ? l.source.name : (findLayer(layers, l.source.layer)?.name ?? ''))) ?? ['', ''];
  const [value, setValue] = useState(50);
  useEffect(() => {
    light.previewCanvasCenter(0.5);
    // Closed without OK: the canvas goes back.
    return () => light.finishCanvasCenter(null);
  }, []);
  const set = (v: number) => {
    setValue(v);
    light.previewCanvasCenter(v / 100);
  };
  return (
    <form
      className="modal small"
      role="dialog"
      aria-label="Move canvas to center"
      onSubmit={(e) => {
        e.preventDefault();
        light.finishCanvasCenter(value / 100);
        closeDialog();
      }}
    >
      <h2>Move canvas to center</h2>
      <div className="center-slider">
        <span data-testid="center-from">{names[0]}</span>
        <input type="range" aria-label="Canvas position between the light table layers" min={0} max={100} value={value} onChange={(e) => set(Number(e.target.value))} />
        <span data-testid="center-to">{names[1]}</span>
      </div>
      <div className="form-grid">
        <label htmlFor="center-value">Position</label>
        <input id="center-value" type="number" min={0} max={100} value={value} onChange={(e) => set(clampInt(e.target.value, 0, 100, value))} />
      </div>
      <Actions />
    </form>
  );
}

/**
 * Animation > Edit track > Assign multiple cels: from the current frame on, the cels from a start to
 * an end number (or cel), each for a number of frames, repeated, with empty frames between them or
 * cel numbers skipped.
 */
export function AssignMultipleDialog() {
  const folder = anim.activeTrack();
  const frame = getState().frame;
  // Cels in the order the reference lists them: the lowest layer first.
  const cels = folder ? [...folder.children].reverse().map((c) => ({ id: c.id, name: c.name })) : [];
  const numbers = cels.map((c) => c.name.trim()).filter((n) => /^\d+$/.test(n)).map(Number);
  const [byName, setByName] = useState(numbers.length === 0);
  const [startNumber, setStartNumber] = useState(numbers.length ? Math.min(...numbers) : 1);
  const [endNumber, setEndNumber] = useState(numbers.length ? Math.max(...numbers) : 1);
  const [first, setFirst] = useState(cels[0]?.id ?? '');
  const [last, setLast] = useState(cels[cels.length - 1]?.id ?? '');
  const [frames, setFrames] = useState(1);
  const [repeat, setRepeat] = useState(false);
  const [repeats, setRepeats] = useState(2);
  const [toEnd, setToEnd] = useState(false);
  const [gapOn, setGapOn] = useState(false);
  const [gap, setGap] = useState(1);
  const [skipOn, setSkipOn] = useState(false);
  const [skip, setSkip] = useState(1);
  if (!folder) return null;
  const picked = byName ? celsBetween(cels.map((c) => c.id), first, last) : celsByNumber(cels, startNumber, endNumber);
  return (
    <form
      className="modal"
      role="dialog"
      aria-label="Assign multiple cels"
      onSubmit={(e) => {
        e.preventDefault();
        anim.assignMultipleCels(folder.id, frame, { cels: picked, frames, repeats: toEnd ? Infinity : repeat ? repeats : 1, gap: gapOn ? gap : 0, skip: skipOn ? skip : 0 });
        closeDialog();
      }}
    >
      <h2>Assign multiple cels</h2>
      <p className="muted">
        {folder.name}: from frame {frame} on
      </p>
      <fieldset className="group">
        <legend>How to assign</legend>
        <label className="check">
          <input type="radio" name="am-how" checked={!byName} onChange={() => setByName(false)} /> Assign by value
        </label>
        <label className="check">
          <input type="radio" name="am-how" checked={byName} onChange={() => setByName(true)} /> Assign by cel name
        </label>
      </fieldset>
      <fieldset className="group">
        <legend>Assign cels</legend>
        <div className="form-grid">
          {byName ? (
            <>
              <label htmlFor="am-first">Start cel</label>
              <select id="am-first" value={first} onChange={(e) => setFirst(e.target.value)}>
                {cels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label htmlFor="am-last">End cel</label>
              <select id="am-last" value={last} onChange={(e) => setLast(e.target.value)}>
                {cels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <label htmlFor="am-start">Start number</label>
              <input id="am-start" type="number" min={0} max={9999} value={startNumber} onChange={(e) => setStartNumber(clampInt(e.target.value, 0, 9999, startNumber))} />
              <label htmlFor="am-end">End number</label>
              <input id="am-end" type="number" min={0} max={9999} value={endNumber} onChange={(e) => setEndNumber(clampInt(e.target.value, 0, 9999, endNumber))} />
            </>
          )}
          <label htmlFor="am-frames">Number of frames</label>
          <input id="am-frames" type="number" min={1} max={MAX_FRAMES} value={frames} onChange={(e) => setFrames(clampInt(e.target.value, 1, MAX_FRAMES, frames))} />
          <label>Cels</label>
          <span data-testid="assign-multiple-cels">{picked.length ? picked.map((id) => cels.find((c) => c.id === id)?.name).join(', ') : 'none'}</span>
        </div>
      </fieldset>
      <fieldset className="group">
        <legend>Repeat settings</legend>
        <span className="with-unit">
          <label className="check">
            <input type="checkbox" checked={repeat} disabled={toEnd} onChange={(e) => setRepeat(e.target.checked)} /> Number of repeats
          </label>
          <input type="number" aria-label="Repeats" min={1} max={100} value={repeats} disabled={!repeat || toEnd} onChange={(e) => setRepeats(clampInt(e.target.value, 1, 100, repeats))} />
        </span>
        <label className="check">
          <input type="checkbox" checked={toEnd} onChange={(e) => setToEnd(e.target.checked)} /> Repeat to end
        </label>
      </fieldset>
      <fieldset className="group">
        <legend>Advanced settings</legend>
        <span className="with-unit">
          <label className="check">
            <input type="checkbox" checked={gapOn} onChange={(e) => setGapOn(e.target.checked)} /> Add empty frames between cels
          </label>
          <input type="number" aria-label="Empty frames" min={1} max={100} value={gap} disabled={!gapOn} onChange={(e) => setGap(clampInt(e.target.value, 1, 100, gap))} />
        </span>
        <span className="with-unit">
          <label className="check">
            <input type="checkbox" checked={skipOn} onChange={(e) => setSkipOn(e.target.checked)} /> Skip cel numbers
          </label>
          <input type="number" aria-label="Cels to skip" min={1} max={100} value={skip} disabled={!skipOn} onChange={(e) => setSkip(clampInt(e.target.value, 1, 100, skip))} />
        </span>
      </fieldset>
      <Actions />
    </form>
  );
}

/**
 * File > Export animation > Export animation cels: every cel of every animation folder as an image
 * (a folder per animation folder, saved together in a ZIP), named like the reference's options.
 */
export function AnimationCelsExportDialog() {
  const doc = useStore((s) => s.doc);
  const [folder, setFolder] = useState(doc.name || 'Cels');
  const [format, setFormat] = useState<CelNameFormat>('cel');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [separator, setSeparator] = useState('_');
  const [type, setType] = useState<SequenceType>('png');
  const [area, setArea] = useState<DrawingArea>(doc.outputFrame?.overflow ? 'overflow' : doc.outputFrame ? 'output' : 'canvas');
  const [drafts, setDrafts] = useState(false);
  const [frameLines, setFrameLines] = useState(false);
  const [busy, setBusy] = useState(false);
  const names = { format, prefix, suffix, separator };
  const groups = celFiles({ names });
  const first = groups.find((g) => g.cels.length);
  const count = groups.reduce((n, g) => n + g.cels.length, 0);
  return (
    <form
      className="modal export-settings"
      role="dialog"
      aria-label="Export animation cels"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await new Promise((r) => setTimeout(r, 20));
        const ok = await exportAnimationCels({ folder, names, type, area, drafts, frameLines });
        setBusy(false);
        if (ok) closeDialog();
      }}
    >
      <h2>Export animation cels</h2>
      <fieldset className="group">
        <legend>File name settings</legend>
        <div className="form-grid">
          <label htmlFor="ac-folder">Export folder name</label>
          <input id="ac-folder" value={folder} onChange={(e) => setFolder(e.target.value.slice(0, 60))} />
          <label>File name</label>
          <span data-testid="cel-file-name">{first ? `${first.folderName}/${first.cels[0].file}.${SEQUENCE_EXT[type]}` : '—'}</span>
          <label htmlFor="ac-format">File name format</label>
          <select id="ac-format" value={format} onChange={(e) => setFormat(e.target.value as CelNameFormat)}>
            {CEL_NAME_FORMATS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <label htmlFor="ac-prefix">File prefix</label>
          <input id="ac-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value.slice(0, 60))} />
          <label htmlFor="ac-suffix">File suffix</label>
          <input id="ac-suffix" value={suffix} onChange={(e) => setSuffix(e.target.value.slice(0, 60))} />
          <label htmlFor="ac-separator">Separator</label>
          <input id="ac-separator" value={separator} onChange={(e) => setSeparator(e.target.value.slice(0, 8))} />
        </div>
      </fieldset>
      <fieldset className="group">
        <legend>Export settings</legend>
        <div className="form-grid">
          <label htmlFor="ac-type">File format</label>
          <select id="ac-type" value={type} onChange={(e) => setType(e.target.value as SequenceType)}>
            {SEQUENCE_TYPES.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <label htmlFor="ac-area">Export range</label>
          <select id="ac-area" value={area} onChange={(e) => setArea(e.target.value as DrawingArea)}>
            {doc.outputFrame && <option value="output">Output frame</option>}
            {doc.outputFrame?.overflow && <option value="overflow">Overflow frame</option>}
            <option value="canvas">Entire canvas</option>
          </select>
          <label />
          <span className="checks">
            <label className="check">
              <input type="checkbox" checked={drafts} onChange={(e) => setDrafts(e.target.checked)} /> Export drafts within animation cels
            </label>
            {doc.outputFrame && (
              <label className="check">
                <input type="checkbox" checked={frameLines} onChange={(e) => setFrameLines(e.target.checked)} /> Export frames
              </label>
            )}
          </span>
        </div>
      </fieldset>
      <p className="muted" data-testid="cel-count">
        {count} cels in {groups.filter((g) => g.cels.length).length} animation folders, saved together in a ZIP file.
      </p>
      <Actions ok={busy ? 'Exporting…' : 'OK'} busy={busy} />
    </form>
  );
}

/** File > Export animation > Audio: the timeline's sound as a WAV file. */
export function AudioExportDialog() {
  const doc = useStore((s) => s.doc);
  const t = doc.timeline ?? DEFAULT_TIMELINE;
  const [start, setStart] = useState(startOf(t));
  const [end, setEnd] = useState(endOf(t));
  const [sampleRate, setSampleRate] = useState(48000);
  const [bits, setBits] = useState<16 | 24>(16);
  const [channels, setChannels] = useState(2);
  const [busy, setBusy] = useState(false);
  const sound = hasSound(doc);
  return (
    <form
      className="modal"
      role="dialog"
      aria-label="Audio export settings"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await exportAudio({ start, end, sampleRate, bits, channels });
        setBusy(false);
        if (ok) closeDialog();
      }}
    >
      <h2>Audio export settings</h2>
      <div className="form-grid">
        <label>Export frames</label>
        <span className="with-unit">
          <input type="number" aria-label="Start frame" min={1} max={end} value={start} onChange={(e) => setStart(clampInt(e.target.value, 1, end, start))} /> to{' '}
          <input type="number" aria-label="End frame" min={start} max={t.frames} value={end} onChange={(e) => setEnd(clampInt(e.target.value, start, t.frames, end))} /> ({frameLabel(start, t.fps, t.display)} – {frameLabel(end, t.fps, t.display)})
        </span>
        <label htmlFor="au-format">Format</label>
        <select id="au-format" value="wav" disabled>
          <option value="wav">WAV (.wav)</option>
        </select>
        <label>Audio settings</label>
        <span className="with-unit">
          <select aria-label="Sampling frequency" value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value))}>
            <option value={44100}>44.1 kHz</option>
            <option value={48000}>48 kHz</option>
          </select>
          <select aria-label="Bits" value={bits} onChange={(e) => setBits(Number(e.target.value) as 16 | 24)}>
            <option value={16}>16 bit</option>
            <option value={24}>24 bit</option>
          </select>
          <select aria-label="Channels" value={channels} onChange={(e) => setChannels(Number(e.target.value))}>
            <option value={2}>Stereo</option>
            <option value={1}>Mono</option>
          </select>
        </span>
      </div>
      {!sound && <p className="muted">The timeline has no audio layers with sound.</p>}
      <Actions ok={busy ? 'Exporting…' : 'OK'} busy={busy || !sound} />
    </form>
  );
}
