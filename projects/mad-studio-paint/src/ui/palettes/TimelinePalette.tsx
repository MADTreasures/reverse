/**
 * Timeline palette: a track per layer (animation folders show their cels per frame; layer folders
 * open and close), the clips of each track, the frame ruler, playback (start, previous, play/stop,
 * next, end, loop), new animation folder / cel, delete assigned cel and onion skin.
 *
 * Clips: click the strip at a clip's top to select it (Ctrl/⌘-click: several), drag it to move the
 * clips, drag its ends to trim them (Alt: time stretch). Right-click or double-click a frame for
 * the track's pop-up menu (assign a cel, clip commands).
 */
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { isAnimationFolder, timelineTracks, trackContent, type AnimationFolder, type TrackRow as Row } from '../../model/animation';
import type { Id, Layer } from '../../model/types';
import { assignmentAt, entryAt } from '../../paint/animation';
import { clipIndexAt, type ClipEdge, type TrackContent } from '../../paint/clips';
import * as actions from '../../store/actions';
import * as anim from '../../store/animationActions';
import { getState, setState, useStore, type ClipRef } from '../../store/store';
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

/** A clip being dragged: moved (all selected clips), or one edge trimmed or stretched. */
type Drag = { kind: 'move'; x0: number; delta: number } | { kind: 'edge'; track: Id; start: number; edge: ClipEdge; stretch: boolean; frame: number };

const ICONS: Record<Layer['kind'], string> = { raster: 'layer', vector: 'vector', text: 'text', gradient: 'gradient', correction: 'correction', folder: 'folder' };
const trackIcon = (l: Layer) => (isAnimationFolder(l) ? 'animFolder' : l.kind === 'folder' && l.frame ? 'frame' : ICONS[l.kind]);

interface RowProps {
  row: Row;
  frames: number;
  active: boolean;
  /** First frames of this track's selected clips. */
  selected: string;
  /** What the track shows while a clip is dragged. */
  preview: TrackContent | null;
  onGrip: (e: React.PointerEvent<HTMLDivElement>, track: Layer, start: number, lane: HTMLElement) => void;
}

const TrackRow = memo(function TrackRow({ row, frames, active, selected, preview, onGrip }: RowProps) {
  const track = row.layer;
  const content = preview ?? trackContent(track, frames);
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
      </div>
      <div
        ref={lane}
        className={`tl-lane ${animation ? 'cels' : ''}`}
        onClick={
          animation
            ? undefined
            : (e) => {
                anim.clearClipSelection();
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
                onPointerDown={(e) => lane.current && onGrip(e, track, c.start, lane.current)}
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => menu(e, c.start)}
              />
            </div>
          ))}
        {animation && <div className="tl-cells">{cells}</div>}
      </div>
    </div>
  );
});

/** The current version of a track (rows may hold an older one in a menu). */
const findTrack = (id: Id) => timelineTracks(getState().doc.layers).find((r) => r.layer.id === id)?.layer ?? null;

export function TimelinePalette() {
  const timeline = useStore((s) => s.doc.timeline);
  const layers = useStore((s) => s.doc.layers);
  const { frame, playing, loop, onionSkin, clipSelection } = useStore(
    useShallow((s) => ({ frame: s.frame, playing: s.playing, loop: s.loop, onionSkin: s.onionSkin, clipSelection: s.clipSelection })),
  );
  const activeId = useStore((s) => anim.currentTrack(s)?.id ?? null);
  const hasCels = useStore((s) => anim.activeTrack(s) !== null);
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
      else anim.dragClipEdge(d.track, d.start, d.edge, d.frame, d.stretch);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const onGrip = (e: React.PointerEvent<HTMLDivElement>, track: Layer, start: number, lane: HTMLElement) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const clip = trackContent(track, frames).clips.find((c) => c.start === start);
    if (!clip) return;
    const left = lane.getBoundingClientRect().left;
    const x = e.clientX - left;
    const atStart = x - (clip.start - 1) * CELL < EDGE;
    const atEnd = clip.end * CELL - x < EDGE;
    const frameOf = (clientX: number) => Math.floor((clientX - left) / CELL) + 1;
    const add = e.ctrlKey || e.metaKey;
    if (add) {
      anim.selectClip(track.id, start, true);
      return;
    }
    if (atStart || atEnd) {
      anim.selectClip(track.id, start);
      const edge: ClipEdge = atStart ? 'start' : 'end';
      const d: Drag = { kind: 'edge', track: track.id, start, edge, stretch: e.altKey, frame: edge === 'start' ? clip.start : clip.end };
      setDragBoth(d);
      follow((ev, cur) => (cur.kind === 'edge' ? { ...cur, stretch: ev.altKey, frame: frameOf(ev.clientX) } : null));
      return;
    }
    if (!getState().clipSelection.some((c) => c.track === track.id && c.start === start)) anim.selectClip(track.id, start);
    anim.selectTrackFrame(track.id, Math.max(clip.start, Math.min(clip.end, frameOf(e.clientX))));
    const x0 = e.clientX;
    setDragBoth({ kind: 'move', x0, delta: 0 });
    follow((ev, cur) => {
      if (cur.kind !== 'move') return null;
      const delta = Math.round((ev.clientX - x0) / CELL);
      return delta === cur.delta ? cur : { ...cur, delta };
    });
  };
  // Rows keep one handler (they are memoised); it always sees the current state.
  const gripRef = useRef(onGrip);
  gripRef.current = onGrip;
  const stableGrip = useCallback<RowProps['onGrip']>((...args) => gripRef.current(...args), []);

  // What dragged tracks look like before the drop.
  const previews = useMemo(() => {
    const out = new Map<Id, TrackContent>();
    if (!drag || !timeline) return out;
    const s = getState();
    if (drag.kind === 'edge') {
      const track = rows.find((r) => r.layer.id === drag.track)?.layer;
      if (!track) return out;
      const t = trackContent(track, frames);
      const i = t.clips.findIndex((c) => c.start === drag.start);
      if (i >= 0) out.set(track.id, anim.draggedEdge(t, i, drag.edge, drag.frame, drag.stretch, fps));
      return out;
    }
    const d = anim.clipMoveDelta(drag.delta, s);
    if (!d) return out;
    for (const r of rows) {
      const starts = clipSelection.filter((c) => c.track === r.layer.id).map((c) => c.start);
      if (!starts.length) continue;
      const t = trackContent(r.layer, frames);
      out.set(r.layer.id, { ...t, clips: t.clips.map((c) => (starts.includes(c.start) ? { ...c, start: c.start + d, end: c.end + d } : c)) });
    }
    return out;
  }, [drag, rows, frames, fps, timeline, clipSelection]);

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
              <TrackRow key={r.layer.id} row={r} frames={frames} active={r.layer.id === activeId} selected={selectedOf(r.layer.id)} preview={previews.get(r.layer.id) ?? null} onGrip={stableGrip} />
            ))}
            <div className="tl-now" style={{ left: `calc(var(--name-w) + ${(frame - 1) * CELL}px)` }} aria-hidden="true" />
          </div>
        </div>
      )}
    </section>
  );
}
