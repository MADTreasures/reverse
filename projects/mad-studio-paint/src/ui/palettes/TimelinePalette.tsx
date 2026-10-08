/**
 * Timeline palette: a track per layer (animation folders show their cels per frame; layer folders
 * open and close), the clips of each track, the frame ruler, playback (start, previous, play/stop,
 * next, end, loop), new animation folder / cel, delete assigned cel and onion skin.
 *
 * Clips: click the strip at a clip's top to select it (Ctrl/⌘-click: several), drag it to move the
 * clips, drag its ends to trim them (Alt: time stretch). Right-click or double-click a frame for
 * the track's pop-up menu (assign a cel, clip commands).
 */
import { memo, useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { isAnimationFolder, isCameraFolder, keysOn, timelineTracks, trackContent, type AnimationFolder, type TrackRow as Row } from '../../model/animation';
import type { Id, Layer } from '../../model/types';
import { assignmentAt, entryAt } from '../../paint/animation';
import { clipIndexAt, type ClipEdge, type Timed, type TrackContent } from '../../paint/clips';
import { moveKeys, type Interp, type Keyframe } from '../../paint/keyframes';
import type { SoundFile, SoundTrack } from '../../paint/sound';
import { soundPeaks, soundsVersion, subscribeSounds } from '../../engine/sounds';
import * as sound from '../../store/soundActions';
import * as actions from '../../store/actions';
import * as anim from '../../store/animationActions';
import { getState, setState, useStore, type ClipRef, type KeyRef } from '../../store/store';
import { Icon } from '../controls/Icons';
import { openDialog, showMenu, type MenuItem } from '../overlays';

const CELL = 24;
/** Pixels at a clip's ends where dragging trims it. */
const EDGE = 5;

function Button({ icon, label, onClick, on, disabled }: { icon: string; label: string; onClick: () => void; on?: boolean; disabled?: boolean }) {
  return (
    <button className={`icon-btn ${on ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={on === undefined ? undefined : on} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

/** The clip commands of the pop-up menu and Animation > Edit track. */
function clipItems(): MenuItem[] {
  const s = getState();
  const selected = s.clipSelection.length > 0;
  return [
    { label: 'Set as first displayed frame', onClick: anim.setFirstDisplayedFrame },
    { label: 'Set as last displayed frame', onClick: anim.setLastDisplayedFrame },
    { label: 'Split clip', onClick: anim.splitClipAtFrame },
    { label: 'Merge clips', onClick: anim.mergeSelectedClips },
    { separator: true },
    { label: 'Copy clip', onClick: anim.copySelectedClip },
    { label: 'Paste clip', disabled: !anim.hasCopiedClip(), onClick: anim.pasteCopiedClip },
    { label: selected ? 'Delete clips' : 'Delete clip', onClick: anim.deleteSelectedClips },
    { separator: true },
    { label: 'Add keyframe', onClick: anim.addKeyframe },
    { label: 'Delete keyframe', disabled: s.keySelection.length === 0, onClick: anim.deleteKeyframes },
    { label: 'Delete all keyframes', onClick: anim.deleteAllKeyframes },
    { label: 'Switch keyframe to hold interpolation', onClick: () => anim.setKeyInterp('hold') },
    { label: 'Switch keyframe to linear interpolation', onClick: () => anim.setKeyInterp('linear') },
    { label: 'Switch keyframe to smooth interpolation', onClick: () => anim.setKeyInterp('smooth') },
  ];
}

/** The pop-up menu of a track's frame: for animation folders, assigning a cel first (the reference's pop-up on a frame). */
function trackMenu(track: Layer, frame: number): MenuItem[] {
  if (!isAnimationFolder(track)) return clipItems();
  const entry = entryAt(track.animation, frame);
  return [
    ...track.children.map((c) => ({ label: c.name, checked: entry?.cel === c.id, onClick: () => anim.assignCel(track.id, frame, c.id) })),
    ...(track.children.length ? [{ separator: true }] : []),
    { label: 'Blank (no cel)', checked: entry !== undefined && entry.cel === null, onClick: () => anim.assignCel(track.id, frame, null) },
    { label: 'Delete assigned cel', disabled: !entry, onClick: () => anim.removeAssignedCel(track.id, frame) },
    { separator: true },
    {
      label: 'New animation cel',
      onClick: () => {
        anim.selectTrackFrame(track.id, frame);
        anim.newAnimationCel();
      },
    },
    { separator: true },
    ...clipItems(),
  ];
}

/** Animation > Edit track > Assign cel to frame: the menu for the current track's current frame. */
export function openAssignMenu(): void {
  const s = getState();
  const track = anim.activeTrack(s);
  if (!track) {
    setState({ hint: 'Select an animation folder or one of its cels' });
    return;
  }
  const el = document.querySelector(`[data-testid=timeline] [data-track-id="${track.id}"] .tl-cell[data-frame="${s.frame}"]`);
  const box = el?.getBoundingClientRect();
  showMenu({ x: box?.left ?? window.innerWidth / 2, y: box ? box.bottom + 2 : window.innerHeight / 2 }, trackMenu(track, s.frame));
}

/** A clip being dragged: moved (all selected clips), or one edge trimmed or stretched; or keyframes moved (Alt: copied). */
type Drag =
  | { kind: 'move'; x0: number; delta: number }
  | { kind: 'edge'; track: Id; start: number; edge: ClipEdge; stretch: boolean; frame: number }
  | { kind: 'keys'; x0: number; delta: number; copy: boolean };

const ICONS: Record<Layer['kind'], string> = { raster: 'layer', vector: 'vector', text: 'text', gradient: 'gradient', correction: 'correction', folder: 'folder' };
const trackIcon = (l: Layer) => (isAnimationFolder(l) ? 'animFolder' : l.kind === 'folder' && l.camera ? 'camera' : l.kind === 'folder' && l.frame ? 'frame' : ICONS[l.kind]);
const INTERP_LABELS: Record<Interp, string> = { hold: 'Hold', linear: 'Linear', smooth: 'Smooth' };

interface RowProps {
  row: Row;
  frames: number;
  active: boolean;
  /** First frames of this track's selected clips. */
  selected: string;
  /** Frames of this track's selected keyframes. */
  selectedKeys: string;
  /** What the track shows while a clip is dragged. */
  preview: TrackContent<Timed> | null;
  onGrip: (e: React.PointerEvent<HTMLDivElement>, track: Id, start: number, lane: HTMLElement) => void;
  onKey: (e: React.PointerEvent<HTMLDivElement>, track: Id, frame: number) => void;
}

/** Keyframe marks of a lane. */
function KeyMarks({ keys, frames, selected, onKey, track, menu }: { keys: { frame: number; interp: Interp }[]; frames: number; selected: Set<number>; track: Id; onKey: RowProps['onKey']; menu: (e: React.MouseEvent, f: number) => void }) {
  return (
    <>
      {keys
        .filter((k) => k.frame <= frames)
        .map((k) => (
          <div
            key={`k${k.frame}`}
            className={`tl-key ${k.interp} ${selected.has(k.frame) ? 'selected' : ''}`}
            data-testid="timeline-key"
            data-frame={k.frame}
            title={`Keyframe on frame ${k.frame} (${INTERP_LABELS[k.interp]}): drag to move, Alt+drag to duplicate`}
            style={{ left: (k.frame - 0.5) * CELL }}
            onPointerDown={(e) => onKey(e, track, k.frame)}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => menu(e, k.frame)}
          />
        ))}
    </>
  );
}

const TrackRow = memo(function TrackRow({ row, frames, active, selected, selectedKeys, preview, onGrip, onKey }: RowProps) {
  const track = row.layer;
  const content = preview ?? trackContent(track, frames);
  const keys = keysOn(track) ? ((content.keys ?? []) as Keyframe[]) : [];
  const keySel = new Set(selectedKeys ? selectedKeys.split(',').map(Number) : []);
  const animation = isAnimationFolder(track) ? (content.cels ? { cels: content.cels } : track.animation) : null;
  const starts = new Set(selected ? selected.split(',').map(Number) : []);
  const lane = useRef<HTMLDivElement>(null);
  const frameAt = (clientX: number) => Math.floor((clientX - (lane.current?.getBoundingClientRect().left ?? 0)) / CELL) + 1;
  const menu = (e: React.MouseEvent, f: number) => {
    e.preventDefault();
    anim.selectTrackFrame(track.id, f);
    showMenu({ x: e.clientX, y: e.clientY }, trackMenu(findTrack(track.id) ?? track, f));
  };

  const cells = [];
  if (animation) {
    for (let f = 1; f <= frames; f++) {
      const entry = entryAt(animation, f);
      const shown = assignmentAt(animation, f);
      const inClip = clipIndexAt(content.clips, f) >= 0;
      const cel = entry?.cel ? (track as AnimationFolder).children.find((c) => c.id === entry.cel) : undefined;
      const kind = !inClip ? 'off' : entry ? (entry.cel ? 'start' : 'blank') : shown?.cel ? 'hold' : '';
      cells.push(
        <div
          key={f}
          className={`tl-cell ${kind}`}
          data-frame={f}
          title={cel ? `Frame ${f}: ${cel.name}` : `Frame ${f}`}
          onClick={() => {
            anim.clearClipSelection();
            anim.clearKeySelection();
            anim.selectTrackFrame(track.id, f);
          }}
          onDoubleClick={(e) => showMenu({ x: e.clientX, y: e.clientY }, trackMenu(track, f))}
          onContextMenu={(e) => menu(e, f)}
        >
          {kind === 'start' && <span className="tl-cel-name">{cel?.name}</span>}
          {kind === 'blank' && <span className="tl-cel-name">×</span>}
        </div>,
      );
    }
  }

  return (
    <div className={`tl-row ${active ? 'active' : ''}`} data-testid="timeline-track" data-track={track.name} data-track-id={track.id}>
      <div className="tl-name" style={{ paddingLeft: 4 + row.depth * 12 }}>
        {track.kind === 'folder' && !track.animation ? (
          <button className="tl-twisty" aria-label={track.expanded ? 'Close folder' : 'Open folder'} onClick={() => actions.setLayerProps(track.id, { expanded: !track.expanded }, 'Expand folder', `expand:${track.id}`)}>
            <Icon name={track.expanded ? 'chevronDown' : 'chevronRight'} size={12} />
          </button>
        ) : (
          <span className="tl-twisty" />
        )}
        <button className={`eye ${track.visible ? 'on' : ''}`} aria-label={track.visible ? 'Hide track' : 'Show track'} onClick={() => actions.setLayerProps(track.id, { visible: !track.visible }, 'Show/hide track')}>
          <Icon name="eye" size={14} />
        </button>
        <span className="tl-track-icon">
          <Icon name={trackIcon(track)} size={14} />
        </span>
        <button className="tl-track-name" title={track.name} onClick={() => anim.selectTrackFrame(track.id, getState().frame)}>
          {track.name}
        </button>
        {track.keys?.enabled && !isCameraFolder(track) && (
          <span className="tl-keyed" title="Keyframes are on for this layer">
            <Icon name="keyEnable" size={12} />
          </span>
        )}
      </div>
      <div
        ref={lane}
        className={`tl-lane ${animation ? 'cels' : ''}`}
        onClick={
          animation
            ? undefined
            : (e) => {
                anim.clearClipSelection();
                anim.clearKeySelection();
                anim.selectTrackFrame(track.id, frameAt(e.clientX));
              }
        }
        onContextMenu={animation ? undefined : (e) => menu(e, frameAt(e.clientX))}
      >
        {content.clips
          .filter((c) => c.start <= frames)
          .map((c) => (
            <div
              key={c.start}
              className={`tl-clip ${starts.has(c.start) ? 'selected' : ''}`}
              data-testid="timeline-clip"
              data-start={c.start}
              data-end={c.end}
              style={{ left: (c.start - 1) * CELL, width: (Math.min(c.end, frames) - c.start + 1) * CELL }}
            >
              <div
                className="tl-clip-grip"
                title="Clip: drag to move, drag an end to trim (Alt: stretch); Ctrl/⌘-click selects several"
                onPointerDown={(e) => lane.current && onGrip(e, track.id, c.start, lane.current)}
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => menu(e, c.start)}
              />
            </div>
          ))}
        {animation && <div className="tl-cells">{cells}</div>}
        <KeyMarks keys={keys} frames={frames} selected={keySel} track={track.id} onKey={onKey} menu={menu} />
      </div>
    </div>
  );
});

/** The waveform of a stretch of sound, as bars across `width` × `height` px. */
function Waveform({ sound: id, offset, seconds, width, height }: { sound: string; offset: number; seconds: number; width: number; height: number }) {
  useSyncExternalStore(subscribeSounds, soundsVersion);
  const buckets = Math.max(1, Math.floor(width / 2));
  const p = soundPeaks(id, Math.max(0, offset), seconds, buckets);
  if (p.length === 0) return null;
  let d = '';
  const mid = height / 2;
  p.forEach((v, i) => {
    const h = Math.max(0.5, v * mid);
    d += `M${i * 2 + 1} ${(mid - h).toFixed(1)}V${(mid + h).toFixed(1)}`;
  });
  return (
    <svg className="tl-wave" width={width} height={height} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

interface SoundRowProps {
  track: SoundTrack;
  files: SoundFile[];
  frames: number;
  fps: number;
  active: boolean;
  selected: string;
  selectedKeys: string;
  preview: TrackContent<Timed> | null;
  onGrip: RowProps['onGrip'];
  onKey: RowProps['onKey'];
}

/** An audio track: its clips with their waveforms, and volume keyframes. */
const SoundRow = memo(function SoundRow({ track, files, frames, fps, active, selected, selectedKeys, preview, onGrip, onKey }: SoundRowProps) {
  const clips = preview?.clips ?? track.clips;
  const keys = (preview?.keys ?? track.keys) as SoundTrack['keys'];
  const starts = new Set(selected ? selected.split(',').map(Number) : []);
  const keySel = new Set(selectedKeys ? selectedKeys.split(',').map(Number) : []);
  const lane = useRef<HTMLDivElement>(null);
  const frameAt = (clientX: number) => Math.floor((clientX - (lane.current?.getBoundingClientRect().left ?? 0)) / CELL) + 1;
  const menu = (e: React.MouseEvent, f: number) => {
    e.preventDefault();
    sound.selectSoundTrack(track.id, f);
    showMenu({ x: e.clientX, y: e.clientY }, [...clipItems(), { separator: true }, { label: 'Delete audio track', onClick: () => sound.deleteSoundTrack(track.id) }]);
  };
  return (
    <div className={`tl-row tl-sound ${active ? 'active' : ''}`} data-testid="timeline-audio" data-track={track.name} data-track-id={track.id}>
      <div className="tl-name" style={{ paddingLeft: 4 }}>
        <span className="tl-twisty" />
        <button className={`eye ${track.visible ? 'on' : ''}`} aria-label={track.visible ? 'Mute track' : 'Unmute track'} onClick={() => sound.setSoundTrack(track.id, { visible: !track.visible }, track.visible ? 'Mute audio track' : 'Unmute audio track')}>
          <Icon name="eye" size={14} />
        </button>
        <span className="tl-track-icon">
          <Icon name="audio" size={14} />
        </span>
        <button className="tl-track-name" title={track.name} onClick={() => sound.selectSoundTrack(track.id)}>
          {track.name}
        </button>
      </div>
      <div
        ref={lane}
        className="tl-lane"
        onClick={(e) => {
          anim.clearClipSelection();
          anim.clearKeySelection();
          sound.selectSoundTrack(track.id, frameAt(e.clientX));
        }}
        onContextMenu={(e) => menu(e, frameAt(e.clientX))}
      >
        {clips
          .filter((c) => c.start <= frames)
          .map((c) => {
            const file = files.find((f) => f.id === c.sound);
            const width = (Math.min(c.end, frames) - c.start + 1) * CELL;
            return (
              <div
                key={c.start}
                className={`tl-clip ${starts.has(c.start) ? 'selected' : ''}`}
                data-testid="timeline-clip"
                data-start={c.start}
                data-end={c.end}
                title={file?.name}
                style={{ left: (c.start - 1) * CELL, width }}
              >
                {file && <Waveform sound={file.id} offset={c.offset ?? 0} seconds={(Math.min(c.end, frames) - c.start + 1) / fps} width={width} height={20} />}
                <div
                  className="tl-clip-grip"
                  title="Clip: drag to move, drag an end to trim; Ctrl/⌘-click selects several"
                  onPointerDown={(e) => lane.current && onGrip(e, track.id, c.start, lane.current)}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => menu(e, c.start)}
                />
              </div>
            );
          })}
        <KeyMarks keys={keys} frames={frames} selected={keySel} track={track.id} onKey={onKey} menu={menu} />
      </div>
    </div>
  );
});

/** Selects a frame of a track: a layer's (and the cel shown there) or an audio track's. */
function selectAt(track: Id, frame: number): void {
  if (getState().doc.sound?.tracks.some((t) => t.id === track)) sound.selectSoundTrack(track, frame);
  else anim.selectTrackFrame(track, frame);
}

/** The current version of a track (rows may hold an older one in a menu). */
const findTrack = (id: Id) => timelineTracks(getState().doc.layers).find((r) => r.layer.id === id)?.layer ?? null;

export function TimelinePalette() {
  const timeline = useStore((s) => s.doc.timeline);
  const layers = useStore((s) => s.doc.layers);
  const { frame, playing, loop, onionSkin, clipSelection } = useStore(
    useShallow((s) => ({ frame: s.frame, playing: s.playing, loop: s.loop, onionSkin: s.onionSkin, clipSelection: s.clipSelection })),
  );
  const activeId = useStore((s) => anim.currentTrackId(s));
  const soundDoc = useStore((s) => s.doc.sound);
  const hasCels = useStore((s) => anim.activeTrack(s) !== null);
  const { keySelection, editKeyed } = useStore(useShallow((s) => ({ keySelection: s.keySelection, editKeyed: s.editKeyed })));
  const keyOn = useStore((s) => {
    if (sound.activeSoundTrack(s)) return true;
    const t = anim.currentTrack(s);
    return Boolean(t && keysOn(t));
  });
  // The interpolation shown: the selected keyframe's, else the one for new keyframes.
  const shownInterp = useStore((s) => {
    const k = s.keySelection[0];
    const keys = k ? (anim.trackContentOf(k.track, s)?.keys as { frame: number; interp: Interp }[] | undefined) : undefined;
    return keys?.find((x) => x.frame === k!.frame)?.interp ?? s.keyInterp;
  });
  const rows = useMemo(() => timelineTracks(layers), [layers]);
  const scrub = useRef(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDragBoth = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const enabled = Boolean(timeline?.enabled);
  const frames = timeline?.frames ?? 0;
  const fps = timeline?.fps ?? 24;
  const frameFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.floor((e.clientX - box.left) / CELL) + 1;
  };

  /** Follows the pointer until it is released anywhere on the page, then commits the drag. */
  const follow = (update: (ev: PointerEvent, cur: Drag) => Drag | null) => {
    const move = (ev: PointerEvent) => {
      const cur = dragRef.current;
      const next = cur && update(ev, cur);
      if (next && next !== cur) setDragBoth(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      const d = dragRef.current;
      setDragBoth(null);
      if (!d) return;
      if (d.kind === 'move') anim.moveSelectedClips(d.delta);
      else if (d.kind === 'keys') anim.moveSelectedKeys(d.delta, d.copy);
      else anim.dragClipEdge(d.track, d.start, d.edge, d.frame, d.stretch);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const onGrip = (e: React.PointerEvent<HTMLDivElement>, track: Id, start: number, lane: HTMLElement) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const clip = anim.trackContentOf(track)?.clips.find((c) => c.start === start);
    if (!clip) return;
    const left = lane.getBoundingClientRect().left;
    const x = e.clientX - left;
    const atStart = x - (clip.start - 1) * CELL < EDGE;
    const atEnd = clip.end * CELL - x < EDGE;
    const frameOf = (clientX: number) => Math.floor((clientX - left) / CELL) + 1;
    const add = e.ctrlKey || e.metaKey;
    if (add) {
      anim.selectClip(track, start, true);
      return;
    }
    if (atStart || atEnd) {
      anim.selectClip(track, start);
      const edge: ClipEdge = atStart ? 'start' : 'end';
      const d: Drag = { kind: 'edge', track, start, edge, stretch: e.altKey, frame: edge === 'start' ? clip.start : clip.end };
      setDragBoth(d);
      follow((ev, cur) => (cur.kind === 'edge' ? { ...cur, stretch: ev.altKey, frame: frameOf(ev.clientX) } : null));
      return;
    }
    if (!getState().clipSelection.some((c) => c.track === track && c.start === start)) anim.selectClip(track, start);
    selectAt(track, Math.max(clip.start, Math.min(clip.end, frameOf(e.clientX))));
    const x0 = e.clientX;
    setDragBoth({ kind: 'move', x0, delta: 0 });
    follow((ev, cur) => {
      if (cur.kind !== 'move') return null;
      const delta = Math.round((ev.clientX - x0) / CELL);
      return delta === cur.delta ? cur : { ...cur, delta };
    });
  };
  const onKey = (e: React.PointerEvent<HTMLDivElement>, track: Id, frame: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const add = e.ctrlKey || e.metaKey;
    if (add || !getState().keySelection.some((k) => k.track === track && k.frame === frame)) anim.selectKeyframe(track, frame, add);
    else selectAt(track, frame);
    if (add) return;
    const x0 = e.clientX;
    setDragBoth({ kind: 'keys', x0, delta: 0, copy: e.altKey });
    follow((ev, cur) => {
      if (cur.kind !== 'keys') return null;
      const delta = Math.round((ev.clientX - x0) / CELL);
      return delta === cur.delta && ev.altKey === cur.copy ? cur : { ...cur, delta, copy: ev.altKey };
    });
  };

  // Rows keep one handler each (they are memoised); it always sees the current state.
  const gripRef = useRef(onGrip);
  gripRef.current = onGrip;
  const stableGrip = useCallback<RowProps['onGrip']>((...args) => gripRef.current(...args), []);
  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  const stableKey = useCallback<RowProps['onKey']>((...args) => keyRef.current(...args), []);

  // What dragged tracks look like before the drop.
  const soundTracks = soundDoc?.tracks;
  const previews = useMemo(() => {
    const out = new Map<Id, TrackContent<Timed>>();
    if (!drag || !timeline) return out;
    const s = getState();
    if (drag.kind === 'edge') {
      const t = anim.trackContentOf(drag.track, s);
      const i = t ? t.clips.findIndex((c) => c.start === drag.start) : -1;
      if (t && i >= 0) out.set(drag.track, anim.draggedEdge(t, i, drag.edge, drag.frame, drag.stretch, fps));
      return out;
    }
    const ids = [...rows.map((r) => r.layer.id), ...(soundTracks ?? []).map((t) => t.id)];
    if (drag.kind === 'keys') {
      if (!drag.delta) return out;
      for (const id of ids) {
        const frames0 = keySelection.filter((k) => k.track === id).map((k) => k.frame);
        const t = frames0.length ? anim.trackContentOf(id, s) : null;
        if (!t?.keys) continue;
        out.set(id, { ...t, keys: moveKeys(t.keys as Keyframe[], frames0, drag.delta, drag.copy) });
      }
      return out;
    }
    const d = anim.clipMoveDelta(drag.delta, s);
    if (!d) return out;
    for (const id of ids) {
      const starts = clipSelection.filter((c) => c.track === id).map((c) => c.start);
      const t = starts.length ? anim.trackContentOf(id, s) : null;
      if (!t) continue;
      out.set(id, { ...t, clips: t.clips.map((c) => (starts.includes(c.start) ? { ...c, start: c.start + d, end: c.end + d } : c)) });
    }
    return out;
  }, [drag, rows, soundTracks, fps, timeline, clipSelection, keySelection]);

  const keysOf = (id: Id) =>
    keySelection
      .filter((k: KeyRef) => k.track === id)
      .map((k) => Math.max(1, k.frame + (drag?.kind === 'keys' ? drag.delta : 0)))
      .join(',');

  const selectedOf = (id: Id) =>
    clipSelection
      .filter((c: ClipRef) => c.track === id)
      .map((c) => c.start + (drag?.kind === 'move' ? anim.clipMoveDelta(drag.delta) : 0))
      .join(',');

  return (
    <section className="timeline-palette" data-testid="timeline" aria-label="Timeline">
      <div className="timeline-bar">
        <span className="palette-title">Timeline</span>
        <Button icon="frameFirst" label="Go to start" disabled={!enabled} onClick={anim.firstFrame} />
        <Button icon="framePrev" label="Go to previous frame" disabled={!enabled} onClick={anim.previousFrame} />
        <Button icon={playing ? 'stop' : 'play'} label={playing ? 'Stop' : 'Play'} disabled={!enabled} onClick={anim.togglePlay} />
        <Button icon="frameNext" label="Go to next frame" disabled={!enabled} onClick={anim.nextFrame} />
        <Button icon="frameLast" label="Go to end" disabled={!enabled} onClick={anim.lastFrame} />
        <Button icon="loop" label="Loop play" on={loop} onClick={anim.toggleLoop} />
        <span className="sep" />
        <Button icon="newAnimFolder" label="New animation folder" onClick={() => void anim.newAnimationFolder()} />
        <Button icon="newCel" label="New animation cel" disabled={!enabled} onClick={() => void anim.newAnimationCel()} />
        <Button icon="newLayer" label="Assign cel to frame" disabled={!enabled || !hasCels} onClick={openAssignMenu} />
        <Button icon="removeCel" label="Delete assigned cel" disabled={!enabled || !hasCels} onClick={() => anim.removeAssignedCel()} />
        <span className="sep" />
        <Button icon="onion" label="Enable onion skin" on={onionSkin} disabled={!enabled} onClick={anim.toggleOnionSkin} />
        <span className="sep" />
        <Button icon="keyAdd" label="Add keyframe" disabled={!enabled || !activeId} onClick={anim.addKeyframe} />
        <select className="tl-interp" aria-label="Keyframe interpolation" title="Keyframe interpolation" value={shownInterp} disabled={!enabled} onChange={(e) => anim.setKeyInterp(e.target.value as Interp)}>
          {(Object.keys(INTERP_LABELS) as Interp[]).map((k) => (
            <option key={k} value={k}>
              {INTERP_LABELS[k]}
            </option>
          ))}
        </select>
        <Button icon="keyDelete" label="Delete keyframe" disabled={!enabled || !keyOn} onClick={anim.deleteKeyframes} />
        <Button icon="keyEnable" label="Enable keyframes on this layer" on={keyOn} disabled={!enabled || !activeId} onClick={anim.toggleKeyframes} />
        <Button icon="keyEdit" label="Edit layers with active keyframes" on={editKeyed} disabled={!enabled || !keyOn} onClick={anim.toggleEditKeyed} />
        <span className="spacer" />
        {timeline && (
          <button className="tl-info" title="Animation > Timeline > Change settings" onClick={() => openDialog('timelineSettings')}>
            <span data-testid="timeline-frame">{frame}</span> / {frames} · {timeline.fps} fps{enabled ? '' : ' · off'}
          </button>
        )}
      </div>
      {!timeline ? (
        <div className="timeline-empty">This canvas has no timeline. New animation folder makes one (with a track); Animation &gt; Timeline &gt; New timeline sets its frame rate and length.</div>
      ) : (
        <div className={`timeline-body ${enabled ? '' : 'disabled'} ${drag ? 'dragging' : ''}`} style={{ ['--cell' as string]: `${CELL}px`, ['--frames' as string]: frames }}>
          <div className="tl-rows">
            <div className="tl-row tl-head">
              <div className="tl-name">Frame</div>
              <div
                className="tl-cells tl-ruler"
                data-testid="timeline-ruler"
                onPointerDown={(e) => {
                  scrub.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  anim.setFrame(frameFromEvent(e));
                }}
                onPointerMove={(e) => {
                  if (scrub.current) anim.setFrame(frameFromEvent(e));
                }}
                onPointerUp={() => (scrub.current = false)}
              >
                {Array.from({ length: frames }, (_, i) => (
                  <div key={i} className={`tl-cell ${i + 1 === frame ? 'current' : ''}`}>
                    {i + 1}
                  </div>
                ))}
              </div>
            </div>
            {rows.map((r) => (
              <TrackRow
                key={r.layer.id}
                row={r}
                frames={frames}
                active={r.layer.id === activeId}
                selected={selectedOf(r.layer.id)}
                selectedKeys={keysOf(r.layer.id)}
                preview={previews.get(r.layer.id) ?? null}
                onGrip={stableGrip}
                onKey={stableKey}
              />
            ))}
            {soundDoc?.tracks.map((t) => (
              <SoundRow
                key={t.id}
                track={t}
                files={soundDoc.files}
                frames={frames}
                fps={fps}
                active={t.id === activeId}
                selected={selectedOf(t.id)}
                selectedKeys={keysOf(t.id)}
                preview={previews.get(t.id) ?? null}
                onGrip={stableGrip}
                onKey={stableKey}
              />
            ))}
            <div className="tl-now" style={{ left: `calc(var(--name-w) + ${(frame - 1) * CELL}px)` }} aria-hidden="true" />
          </div>
        </div>
      )}
    </section>
  );
}
