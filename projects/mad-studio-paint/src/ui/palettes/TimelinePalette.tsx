/**
 * Timeline palette: a track per layer (animation folders show their cels per frame; layer folders
 * open and close), the clips of each track, the frame ruler, playback (start, previous, play/stop,
 * next, end, loop), new animation folder / cel, delete assigned cel and onion skin.
 *
 * Clips: click the strip at a clip's top to select it (Ctrl/⌘-click: several), drag it to move the
 * clips, drag its ends to trim them (Alt: time stretch). Right-click or double-click a frame for
 * the track's pop-up menu (assign a cel, clip commands).
 *
 * Keyframes: Details (+) in front of a track name shows its property rows (Transform, whose > opens
 * Position, Scale ratio, Rotate and Center of rotation; Opacity; Mask for a track with a layer
 * mask, whose keyframes place the mask). A keyframe that records only some
 * of a row's properties shows small. Click selects (Ctrl/⌘: several), dragging around keyframes
 * selects them (Shift: adds, Ctrl/⌘: takes out); drag to move, Alt+drag to duplicate.
 *
 * Labels: timeline labels show on the frame ruler (double-click a frame there to name it or rename
 * its label; right-click: create, rename or delete). Details (+) also shows a track's label area:
 * right-click a frame (or right-drag over several) to type a new label (Alt+Enter /
 * Shift+Alt+Enter: inbetween labels 〇 / ● at the dragged spacing), click to select (Shift,
 * Ctrl/⌘: several), click a selected one or double-click to edit (empty text deletes), drag to
 * move (Alt: duplicate), drag an end to change the range. With the area closed the labels show at
 * the top of the track.
 */
import { memo, useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { isAnimationFolder, isCameraFolder, keysOn, maskTrackId, timelineTracks, trackContent, type AnimationFolder, type TrackRow as Row } from '../../model/animation';
import type { AudioLayer, Id, Layer } from '../../model/types';
import { assignmentAt, endOf, entryAt, frameLabel, startOf, startsSecond } from '../../paint/animation';
import { INBETWEEN_FILLED, INBETWEEN_OPEN, isInbetween, lastFrameOf, MAX_LABEL_TEXT, resizeTrackLabel, timelineLabelAt, trackLabelAt, type TrackLabel } from '../../paint/labels';
import { timelineIndex, timelineList, timelineName } from '../../model/timelines';
import { clipIndexAt, type ClipEdge, type Timed, type TrackContent } from '../../paint/clips';
import { curveInterp, GROUPS, groupInterp, PLACEMENT_CHANNELS, records, touches, TRANSFORM_GROUPS, type Channel, type ChannelGroup, type Interp, type Keyframe } from '../../paint/keyframes';
import type { SoundFile } from '../../paint/sound';
import { soundPeaks, soundsVersion, subscribeSounds } from '../../engine/sounds';
import * as sound from '../../store/soundActions';
import * as actions from '../../store/actions';
import * as anim from '../../store/animationActions';
import * as labels from '../../store/labelActions';
import { getState, setState, useStore, type ClipRef, type KeyRef, type LabelRef } from '../../store/store';
import { Icon } from '../controls/Icons';
import { openDialog, showMenu, type MenuItem } from '../overlays';
import { GraphEditor, useGraphTrackName } from './GraphEditor';

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
    { label: 'Cut', onClick: anim.timelineCut },
    { label: 'Copy', onClick: anim.timelineCopy },
    { label: 'Paste', disabled: !anim.hasTimelineCopy(), onClick: anim.timelinePaste },
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

/** The label commands of the pop-up menu (Animation > Label): on the track and frame clicked. */
function labelItems(track: Id, frame: number): MenuItem[] {
  const here = trackLabelAt(getState().doc.timeline?.trackLabels, track, frame);
  return [
    { label: 'Create track label…', onClick: () => openDialog('trackLabel') },
    { label: `Create inbetween track label ${INBETWEEN_OPEN}`, onClick: () => labels.createInbetweenLabel(INBETWEEN_OPEN) },
    { label: `Create inbetween track label ${INBETWEEN_FILLED}`, onClick: () => labels.createInbetweenLabel(INBETWEEN_FILLED) },
    { label: 'Delete track label', disabled: !here, onClick: labels.deleteTrackLabel },
  ];
}

/** The pop-up menu of a track's frame: for animation folders, assigning a cel first (the reference's pop-up on a frame). */
function trackMenu(track: Layer, frame: number): MenuItem[] {
  if (!isAnimationFolder(track)) return [...clipItems(), { separator: true }, ...labelItems(track.id, frame)];
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
    { separator: true },
    ...labelItems(track.id, frame),
  ];
}

/** The frame ruler's pop-up menu: timeline labels at the frame clicked. */
function rulerMenu(frame: number): MenuItem[] {
  const here = timelineLabelAt(getState().doc.timeline?.labels, frame);
  return [
    { label: here ? 'Rename timeline label…' : 'Create timeline label…', onClick: () => openDialog('timelineLabel') },
    { label: 'Delete timeline label', disabled: !here, onClick: () => labels.deleteTimelineLabel(frame) },
    { separator: true },
    { label: 'Go to timeline label…', disabled: !getState().doc.timeline?.labels?.length, onClick: () => openDialog('goToLabel') },
    { label: 'Go to specified frame…', onClick: () => openDialog('goToFrame') },
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

/** A clip being dragged: moved (all selected clips), or one edge trimmed or stretched; or keyframes, cels or track labels moved (Alt: copied). */
type Drag =
  | { kind: 'move'; x0: number; delta: number }
  | { kind: 'edge'; track: Id; start: number; edge: ClipEdge; stretch: boolean; frame: number }
  | { kind: 'keys'; x0: number; delta: number; copy: boolean }
  | { kind: 'cels'; x0: number; delta: number; copy: boolean }
  | { kind: 'labels'; x0: number; delta: number; copy: boolean };

const ICONS: Record<Layer['kind'], string> = { raster: 'layer', vector: 'vector', text: 'text', gradient: 'gradient', fill: 'fill', correction: 'correction', folder: 'folder', audio: 'audio', movie: 'movie' };
const trackIcon = (l: Layer) => (isAnimationFolder(l) ? 'animFolder' : l.kind === 'folder' && l.camera ? 'camera' : l.kind === 'folder' && l.frame ? 'frame' : ICONS[l.kind]);
const INTERP_LABELS: Record<Interp, string> = { hold: 'Hold', linear: 'Linear', smooth: 'Smooth' };

interface RowProps {
  row: Row;
  frames: number;
  active: boolean;
  /** First frames of this track's selected clips. */
  selected: string;
  /** This track's selected keyframes as "row:frame" ("*": whole keyframes). */
  selectedKeys: string;
  /** What the track shows while a clip is dragged. */
  preview: TrackContent<Timed> | null;
  /** Details (+) open: the property rows show; `transformOpen`: with the parts of Transform. */
  details: boolean;
  transformOpen: boolean;
  /** The track's layer mask: its selected keyframes, how they look while dragged, and whether it is selected. */
  maskKeys: string;
  maskPreview: Keyframe[] | null;
  maskActive: boolean;
  onGrip: (e: React.PointerEvent<HTMLDivElement>, track: Id, start: number, lane: HTMLElement) => void;
  onKey: (e: React.PointerEvent<HTMLDivElement>, track: Id, frame: number, group?: ChannelGroup) => void;
  /** Frames of this animation folder's selected assigned cels (as they show while dragged). */
  selectedCels: string;
  onCel: (e: React.PointerEvent<HTMLDivElement>, track: Id, frame: number) => void;
  /** The track's labels (as they show while dragged), and the first frames of its selected ones. */
  trackLabels: TrackLabel[];
  selectedLabels: string;
  onLabel: LabelLaneProps['onLabel'];
}

/** Selected keyframes of a row: whole keyframes, and "group:frame" of property rows. */
interface KeySel {
  whole: Set<number>;
  parts: Set<string>;
}

function parseKeySel(text: string): KeySel {
  const whole = new Set<number>();
  const parts = new Set<string>();
  for (const e of text ? text.split(',') : []) {
    const [g, f] = e.split(':');
    if (g === '*') whole.add(Number(f));
    else parts.add(`${g}:${f}`);
  }
  return { whole, parts };
}

/** Frame under the pointer in a lane. */
const frameIn = (e: React.MouseEvent<HTMLElement>) => Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / CELL) + 1;

/**
 * Keyframe marks of a lane: of a property row (`group`), or of the whole track (`full`: what a
 * keyframe records to show full size there).
 */
function KeyMarks({ keys, frames, sel, onKey, track, menu, group, full }: { keys: Keyframe[]; frames: number; sel: KeySel; track: Id; group?: ChannelGroup; full: readonly Channel[]; onKey: RowProps['onKey']; menu: (e: React.MouseEvent, f: number) => void }) {
  const channels = group ? GROUPS[group].channels : full;
  return (
    <>
      {keys
        .filter((k) => k.frame <= frames && touches(k, channels))
        .map((k) => {
          const interp = group ? groupInterp(k, channels) : k.interp;
          const partial = !records(k, channels);
          const selected = sel.whole.has(k.frame) || (group ? sel.parts.has(`${group}:${k.frame}`) : [...sel.parts].some((p) => p.endsWith(`:${k.frame}`)));
          return (
            <div
              key={`k${k.frame}`}
              className={`tl-key ${interp} ${partial ? 'partial' : ''} ${selected ? 'selected' : ''}`}
              data-testid="timeline-key"
              data-frame={k.frame}
              data-key-track={track}
              data-group={group ?? ''}
              title={`Keyframe on frame ${k.frame} (${INTERP_LABELS[interp]}${partial ? ', some properties' : ''}): drag to move, Alt+drag to duplicate`}
              style={{ left: (k.frame - 0.5) * CELL }}
              onPointerDown={(e) => onKey(e, track, k.frame, group)}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => menu(e, k.frame)}
            />
          );
        })}
    </>
  );
}

/** A label typed in the track label area: a new one (right-click or right-drag) or one being edited. */
interface LabelDraft {
  frame: number;
  length: number;
  text: string;
  editing: boolean;
  /** Right-drag: inbetween labels go from where it started, at the dragged spacing (Alt+Enter). */
  next: number;
  step: number;
}

interface LabelLaneProps {
  track: Id;
  labels: TrackLabel[];
  frames: number;
  /** First frames of the selected labels. */
  selected: string;
  onLabel: (e: React.PointerEvent<HTMLDivElement>, track: Id, frame: number) => void;
}

/** The track label area of a track (Details open): its labels, made and edited there. */
const LabelLane = memo(function LabelLane({ track, labels: list, frames, selected, onLabel }: LabelLaneProps) {
  const lane = useRef<HTMLDivElement>(null);
  const [draft, setDraftState] = useState<LabelDraft | null>(null);
  // The draft as typed so far: Enter, Esc and losing focus each end it once.
  const draftRef = useRef<LabelDraft | null>(null);
  const setDraft = (d: LabelDraft | null) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const [span, setSpan] = useState<{ from: number; to: number } | null>(null);
  const [resize, setResize] = useState<{ frame: number; edge: 'start' | 'end'; to: number } | null>(null);
  const picked = new Set(selected ? selected.split(',').map(Number) : []);
  const frameAt = (clientX: number) => Math.max(1, Math.min(frames, Math.floor((clientX - (lane.current?.getBoundingClientRect().left ?? 0)) / CELL) + 1));
  const shown = resize ? resizeTrackLabel(list, track, resize.frame, resize.edge, resize.to) : list;
  // Which label a pointer press started on, and whether it was selected then (a click on a selected label edits it).
  const press = useRef<{ frame: number; x: number; selected: boolean } | null>(null);

  const edit = (l: TrackLabel) => setDraft({ frame: l.frame, length: l.length, text: l.text, editing: true, next: l.frame, step: 0 });
  const commit = () => {
    const d = draftRef.current;
    setDraft(null);
    if (!d) return;
    if (d.editing) labels.renameLabel(track, d.frame, d.text);
    else if (d.text.trim()) labels.addLabel(track, d.frame, d.length, d.text);
  };

  // Right-click on a frame (or right-drag over several): type a new label there.
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 2 || (e.target as HTMLElement).closest('.tl-tracklabel, .tl-label-input')) return;
    e.preventDefault();
    e.stopPropagation();
    const from = frameAt(e.clientX);
    setSpan({ from, to: from });
    const move = (ev: PointerEvent) => setSpan({ from, to: frameAt(ev.clientX) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      const to = frameAt(ev.clientX);
      setSpan(null);
      const a = Math.min(from, to);
      anim.selectTrackFrame(track, a);
      setDraft({ frame: a, length: Math.abs(to - from) + 1, text: '', editing: false, next: from, step: Math.abs(to - from) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const onLabelDown = (e: React.PointerEvent<HTMLDivElement>, l: TrackLabel) => {
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const atStart = e.clientX - box.left < EDGE;
    const atEnd = box.right - e.clientX < EDGE;
    if ((atStart || atEnd) && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // An end: change the range.
      e.stopPropagation();
      e.preventDefault();
      const edge = atStart ? 'start' : 'end';
      labels.selectLabel(track, l.frame);
      setResize({ frame: l.frame, edge, to: edge === 'start' ? l.frame : lastFrameOf(l) });
      const move = (ev: PointerEvent) => setResize({ frame: l.frame, edge, to: frameAt(ev.clientX) });
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        setResize(null);
        labels.resizeLabel(track, l.frame, edge, frameAt(ev.clientX));
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
      return;
    }
    press.current = { frame: l.frame, x: e.clientX, selected: picked.has(l.frame) && !e.shiftKey && !e.ctrlKey && !e.metaKey };
    onLabel(e, track, l.frame);
  };

  return (
    <div
      ref={lane}
      className="tl-lane tl-label-lane"
      data-testid="track-label-lane"
      onPointerDown={onDown}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.tl-tracklabel, .tl-label-input')) return;
        labels.clearLabelSelection();
        anim.clearClipSelection();
        anim.clearKeySelection();
        anim.selectTrackFrame(track, frameAt(e.clientX));
      }}
    >
      {shown
        .filter((l) => l.frame <= frames && !(draft?.editing && draft.frame === l.frame))
        .map((l) => (
          <div
            key={`${l.frame}:${l.length}`}
            className={`tl-tracklabel ${picked.has(l.frame) ? 'selected' : ''} ${isInbetween(l) ? 'inbetween' : ''}`}
            data-testid="track-label"
            data-label-track={track}
            data-frame={l.frame}
            data-length={l.length}
            title={`${l.text} (frame ${l.frame}${l.length > 1 ? `–${lastFrameOf(l)}` : ''}): click to select, click again to edit, drag to move (Alt: duplicate), drag an end to change the range`}
            style={{ left: (l.frame - 1) * CELL, width: Math.min(l.length, frames - l.frame + 1) * CELL }}
            onPointerDown={(e) => onLabelDown(e, l)}
            onPointerUp={(e) => {
              const p = press.current;
              press.current = null;
              if (p && p.frame === l.frame && p.selected && Math.abs(e.clientX - p.x) < 3) edit(l);
            }}
            onDoubleClick={() => edit(l)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!picked.has(l.frame)) labels.selectLabel(track, l.frame);
              anim.selectTrackFrame(track, l.frame);
              showMenu({ x: e.clientX, y: e.clientY }, [
                { label: 'Edit track label', onClick: () => edit(l) },
                { label: 'Delete track label', onClick: labels.deleteSelectedLabels },
                { separator: true },
                { label: 'Cut', onClick: anim.timelineCut },
                { label: 'Copy', onClick: anim.timelineCopy },
              ]);
            }}
          >
            {l.text}
          </div>
        ))}
      {span && <div className="tl-label-span" aria-hidden="true" style={{ left: (Math.min(span.from, span.to) - 1) * CELL, width: (Math.abs(span.to - span.from) + 1) * CELL }} />}
      {draft && (
        <input
          className="tl-label-input"
          aria-label={draft.editing ? 'Track label' : 'New track label'}
          autoFocus
          maxLength={MAX_LABEL_TEXT}
          value={draft.text}
          style={{ left: (draft.frame - 1) * CELL, width: Math.max(96, draft.length * CELL) }}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              setDraft(null);
            } else if (e.key === 'Enter' && e.altKey && !draft.editing) {
              // Inbetween labels at regular intervals: one more with each Alt+Enter.
              e.preventDefault();
              if (draft.next > frames) return;
              labels.addLabel(track, draft.next, 1, e.shiftKey ? INBETWEEN_FILLED : INBETWEEN_OPEN, 'Create inbetween track label');
              setDraft({ ...draft, next: draft.step ? draft.next + draft.step : frames + 1 });
            } else if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
      )}
    </div>
  );
});

/** A track's labels at the top of the track while its label area is closed (not editable there). */
function MiniLabels({ labels: list, frames }: { labels: TrackLabel[]; frames: number }) {
  return (
    <>
      {list
        .filter((l) => l.frame <= frames)
        .map((l) => (
          <div key={l.frame} className={`tl-label-mini ${isInbetween(l) ? 'inbetween' : ''}`} data-testid="track-label-mini" title={l.text} style={{ left: (l.frame - 1) * CELL, width: Math.min(l.length, frames - l.frame + 1) * CELL }}>
            {l.text}
          </div>
        ))}
    </>
  );
}

/** The property rows of a track with Details (+) open. */
function detailRows(transformOpen: boolean): { group: ChannelGroup; indent: number }[] {
  return [...(transformOpen ? TRANSFORM_GROUPS.map((group) => ({ group, indent: 2 })) : []), { group: 'opacity', indent: 1 }];
}

const TrackRow = memo(function TrackRow({ row, frames, active, selected, selectedKeys, selectedCels, preview, details, transformOpen, maskKeys, maskPreview, maskActive, onGrip, onKey, onCel, trackLabels, selectedLabels, onLabel }: RowProps) {
  const track = row.layer;
  const content = preview ?? trackContent(track, frames);
  const keyed = keysOn(track);
  const keys = keyed ? ((content.keys ?? []) as Keyframe[]) : [];
  const keySel = parseKeySel(selectedKeys);
  // Details (+): the track label area, and the keyframe rows when keyframes are on.
  const open = keyed && details;
  const animation = isAnimationFolder(track) ? (content.cels ? { cels: content.cels } : track.animation) : null;
  const starts = new Set(selected ? selected.split(',').map(Number) : []);
  const pickedCels = new Set(selectedCels ? selectedCels.split(',').map(Number) : []);
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
          className={`tl-cell ${kind} ${pickedCels.has(f) ? 'picked' : ''}`}
          data-frame={f}
          data-assigned={entry ? '' : undefined}
          title={cel ? `Frame ${f}: ${cel.name} (drag to move, Alt: duplicate; Ctrl/⌘ or Shift: select several)` : `Frame ${f}`}
          // An assigned cel is selected (and dragged) on pointer down.
          onPointerDown={entry ? (e) => onCel(e, track.id, f) : undefined}
          onClick={() => {
            if (entry) return;
            anim.clearClipSelection();
            anim.clearKeySelection();
            anim.clearCelSelection();
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

  const laneClick = (f: number) => {
    anim.clearClipSelection();
    anim.clearKeySelection();
    anim.selectTrackFrame(track.id, f);
  };

  return (
    <>
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
          <button
            className="tl-details"
            title={details ? 'Hide details' : keyed ? 'Details: the rows of the properties keyframes record, and the track label area' : 'Details: the track label area'}
            aria-label={details ? 'Hide details' : 'Details'}
            aria-expanded={details}
            onClick={() => anim.toggleKeyDetails(track.id)}
          >
            {details ? '−' : '+'}
          </button>
          {open && (
            <button className="tl-twisty" aria-label={transformOpen ? 'Close Transform' : 'Open Transform'} aria-expanded={transformOpen} onClick={() => anim.toggleTransformDetails(track.id)}>
              <Icon name={transformOpen ? 'chevronDown' : 'chevronRight'} size={12} />
            </button>
          )}
          <button className="tl-track-name" title={track.name} onClick={() => anim.selectTrackFrame(track.id, getState().frame)}>
            {track.name}
            {open && <span className="tl-prop"> : Transform</span>}
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
          onClick={animation ? undefined : (e) => laneClick(frameAt(e.clientX))}
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
          {!details && <MiniLabels labels={trackLabels} frames={frames} />}
          <KeyMarks keys={keys} frames={frames} sel={keySel} track={track.id} group={open ? 'transform' : undefined} full={PLACEMENT_CHANNELS} onKey={onKey} menu={menu} />
        </div>
      </div>
      {open &&
        detailRows(transformOpen).map(({ group, indent }) => (
          <div key={group} className={`tl-row tl-sub ${active ? 'active' : ''}`} data-testid="timeline-subtrack" data-track-id={track.id} data-group={group}>
            <div className="tl-name" style={{ paddingLeft: 4 + row.depth * 12 + 24 + indent * 10 }}>
              <span className="tl-prop-name">{GROUPS[group].label}</span>
            </div>
            <div className="tl-lane" onClick={(e) => laneClick(frameIn(e))} onContextMenu={(e) => menu(e, frameIn(e))}>
              <KeyMarks keys={keys} frames={frames} sel={keySel} track={track.id} group={group} full={PLACEMENT_CHANNELS} onKey={onKey} menu={menu} />
            </div>
          </div>
        ))}
      {open && track.mask && (
        <div className={`tl-row tl-sub ${maskActive ? 'active' : ''}`} data-testid="timeline-subtrack" data-track-id={track.id} data-group="mask">
          <div className="tl-name" style={{ paddingLeft: 4 + row.depth * 12 + 34 }}>
            <button className="tl-prop-name tl-mask-name" title="Select the layer mask: the Object tool places it" onClick={() => anim.selectMaskFrame(track.id, getState().frame)}>
              Mask
            </button>
          </div>
          <div
            className="tl-lane"
            onClick={(e) => {
              anim.clearClipSelection();
              anim.clearKeySelection();
              anim.selectMaskFrame(track.id, frameIn(e));
            }}
          >
            <KeyMarks keys={maskPreview ?? track.mask.keys ?? []} frames={frames} sel={parseKeySel(maskKeys)} track={maskTrackId(track.id)} full={anim.MASK_CHANNELS} onKey={onKey} menu={menu} />
          </div>
        </div>
      )}
      {details && (
        <div className={`tl-row tl-sub tl-label-row ${active ? 'active' : ''}`} data-testid="timeline-label-area" data-track-id={track.id}>
          <div className="tl-name" style={{ paddingLeft: 4 + row.depth * 12 + 34 }}>
            <span className="tl-prop-name">Track label</span>
          </div>
          <LabelLane track={track.id} labels={trackLabels} frames={frames} selected={selectedLabels} onLabel={onLabel} />
        </div>
      )}
    </>
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
  track: AudioLayer;
  depth: number;
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

/** An audio layer's track: its clips with their waveforms, and volume keyframes. */
const SoundRow = memo(function SoundRow({ track, depth, files, frames, fps, active, selected, selectedKeys, preview, onGrip, onKey }: SoundRowProps) {
  const clips = preview?.clips ?? track.clips;
  const keys = (preview?.keys ?? track.keys.frames) as Keyframe[];
  const starts = new Set(selected ? selected.split(',').map(Number) : []);
  const keySel = parseKeySel(selectedKeys);
  const lane = useRef<HTMLDivElement>(null);
  const frameAt = (clientX: number) => Math.floor((clientX - (lane.current?.getBoundingClientRect().left ?? 0)) / CELL) + 1;
  const menu = (e: React.MouseEvent, f: number) => {
    e.preventDefault();
    sound.selectSoundTrack(track.id, f);
    showMenu({ x: e.clientX, y: e.clientY }, [...clipItems(), { separator: true }, { label: 'Delete audio layer', onClick: () => sound.deleteSoundTrack(track.id) }]);
  };
  return (
    <div className={`tl-row tl-sound ${active ? 'active' : ''}`} data-testid="timeline-audio" data-track={track.name} data-track-id={track.id}>
      <div className="tl-name" style={{ paddingLeft: 4 + depth * 12 }}>
        <span className="tl-twisty" />
        <button className={`eye ${track.visible ? 'on' : ''}`} aria-label={track.visible ? 'Mute track' : 'Unmute track'} onClick={() => sound.setSoundTrack(track.id, { visible: !track.visible }, track.visible ? 'Mute audio layer' : 'Unmute audio layer')}>
          <Icon name="eye" size={14} />
        </button>
        <span className="tl-track-icon">
          <Icon name="audio" size={14} />
        </span>
        <button className="tl-track-name" title={track.name} onClick={() => sound.selectSoundTrack(track.id)}>
          {track.name}
          <span className="tl-prop"> : Volume</span>
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
        <KeyMarks keys={keys} frames={frames} sel={keySel} track={track.id} full={VOLUME} onKey={onKey} menu={menu} />
      </div>
    </div>
  );
});

const VOLUME: Channel[] = ['volume'];

/** Selects a frame of a track (an animation folder's: the cel shown there). */
const selectAt = (track: Id, frame: number) => anim.selectTrackFrame(track, frame);

const NO_FILES: SoundFile[] = [];
const NO_LABELS: TrackLabel[] = [];

/** The current version of a track (rows may hold an older one in a menu). */
const findTrack = (id: Id) => timelineTracks(getState().doc.layers).find((r) => r.layer.id === id)?.layer ?? null;

export function TimelinePalette() {
  const timeline = useStore((s) => s.doc.timeline);
  // The timeline list: names, and which one is edited.
  const timelineNames = useStore(useShallow((s) => timelineList(s.doc).map((t, i) => timelineName(t, i))));
  const timelineIdx = useStore((s) => timelineIndex(s.doc));
  const layers = useStore((s) => s.doc.layers);
  const { frame, playing, loop, onionSkin, clipSelection, celSelection, labelSelection, height } = useStore(
    useShallow((s) => ({
      frame: s.frame,
      playing: s.playing,
      loop: s.loop,
      onionSkin: s.onionSkin,
      clipSelection: s.clipSelection,
      celSelection: s.celSelection,
      labelSelection: s.labelSelection,
      height: s.timelineHeight,
    })),
  );
  const activeId = useStore((s) => anim.currentTrackId(s));
  const maskKeyed = useStore((s) => anim.maskKeyed(s)?.id ?? null);
  const files = useStore((s) => s.doc.sound?.files ?? NO_FILES);
  const hasCels = useStore((s) => anim.activeTrack(s) !== null);
  const { keySelection, editKeyed, keyDetails, transformDetails, graph, snapX, snapY, dragZoom } = useStore(
    useShallow((s) => ({
      keySelection: s.keySelection,
      editKeyed: s.editKeyed,
      keyDetails: s.keyDetails,
      transformDetails: s.transformDetails,
      graph: s.graphEditor,
      snapX: s.graphSnapX,
      snapY: s.graphSnapY,
      dragZoom: s.graphDragZoom,
    })),
  );
  const graphTrack = useGraphTrackName();
  const graphPicked = useStore((s) => s.graphSelection.length > 0);
  const keyOn = useStore((s) => {
    if (sound.activeSoundTrack(s)) return true;
    const t = anim.currentTrack(s);
    return Boolean(t && keysOn(t));
  });
  // The interpolation shown: the selected keyframe's (on a property row: that property's), else the one for new keyframes.
  const shownInterp = useStore((s) => {
    const point = s.graphEditor ? s.graphSelection[0] : undefined;
    if (point) {
      const k = anim.trackKeys(point.track, s).find((x) => x.frame === point.frame);
      return k ? curveInterp(k, point.ch) : s.keyInterp;
    }
    const ref = s.keySelection[0];
    const k = ref ? anim.trackKeys(ref.track, s).find((x) => x.frame === ref.frame) : undefined;
    if (!k) return s.keyInterp;
    return ref.group ? groupInterp(k, GROUPS[ref.group].channels) : k.interp;
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
  // Frames as numbers or as time; division lines.
  const display = timeline?.display ?? 'frame1';
  const timeLike = display === 'secframe' || display === 'timecode';
  const division = timeline?.division ?? 0;
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
      else if (d.kind === 'cels') anim.moveSelectedCels(d.delta, d.copy);
      else if (d.kind === 'labels') labels.moveSelectedLabels(d.delta, d.copy);
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
  const onKey = (e: React.PointerEvent<HTMLDivElement>, track: Id, frame: number, group?: ChannelGroup) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const add = e.ctrlKey || e.metaKey;
    if (add || !getState().keySelection.some((k) => k.track === track && k.frame === frame && k.group === group)) anim.selectKeyframe(track, frame, add, group);
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

  // Assigned cels: pointer down selects (Ctrl/⌘ or Shift: several); dragging moves them (Alt: duplicates).
  const onCel = (e: React.PointerEvent<HTMLDivElement>, track: Id, frame: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const add = e.ctrlKey || e.metaKey || e.shiftKey;
    if (add || !getState().celSelection.some((c) => c.track === track && c.frame === frame)) anim.selectAssignedCel(track, frame, add);
    else anim.selectTrackFrame(track, frame);
    if (add) return;
    const x0 = e.clientX;
    setDragBoth({ kind: 'cels', x0, delta: 0, copy: e.altKey });
    follow((ev, cur) => {
      if (cur.kind !== 'cels') return null;
      const delta = Math.round((ev.clientX - x0) / CELL);
      return delta === cur.delta && ev.altKey === cur.copy ? cur : { ...cur, delta, copy: ev.altKey };
    });
  };

  // Track labels: pointer down selects (Shift, Ctrl/⌘: several); dragging moves the selected ones (Alt: duplicates).
  const onLabel = (e: React.PointerEvent<HTMLDivElement>, track: Id, frame: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (add || !getState().labelSelection.some((r) => r.track === track && r.frame === frame)) labels.selectLabel(track, frame, add);
    if (add) return;
    anim.selectTrackFrame(track, frame);
    const x0 = e.clientX;
    setDragBoth({ kind: 'labels', x0, delta: 0, copy: e.altKey });
    follow((ev, cur) => {
      if (cur.kind !== 'labels') return null;
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
  const celRef = useRef(onCel);
  celRef.current = onCel;
  const stableCel = useCallback<RowProps['onCel']>((...args) => celRef.current(...args), []);
  const labelRef = useRef(onLabel);
  labelRef.current = onLabel;
  const stableLabel = useCallback<RowProps['onLabel']>((...args) => labelRef.current(...args), []);

  // Each track's labels (while dragging them: where they would land), one list per track so rows keep their props.
  const docLabels = timeline?.trackLabels;
  const labelDrag = drag?.kind === 'labels' ? drag : null;
  const [ldDelta, ldCopy] = [labelDrag?.delta ?? 0, labelDrag?.copy ?? false];
  const labelsByTrack = useMemo(() => {
    const moved = ldDelta ? labels.movedLabels(ldDelta, ldCopy) : null;
    const out = new Map<Id, TrackLabel[]>();
    for (const l of moved ?? docLabels ?? []) out.set(l.track, [...(out.get(l.track) ?? []), l]);
    return out;
  }, [docLabels, ldDelta, ldCopy]);
  const labelsOf = (id: Id) =>
    labelSelection
      .filter((r: LabelRef) => r.track === id)
      .map((r) => r.frame + (drag?.kind === 'labels' ? labels.labelDelta(drag.delta) : 0))
      .join(',');

  // What dragged tracks look like before the drop.

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
    const ids = [...rows.map((r) => r.layer.id), ...rows.filter((r) => r.layer.mask).map((r) => maskTrackId(r.layer.id))];
    if (drag.kind === 'cels') {
      if (!drag.delta) return out;
      for (const id of ids) {
        const cels = celSelection.some((c) => c.track === id) ? anim.movedCels(id, drag.delta, drag.copy, s) : null;
        const t = cels ? anim.trackContentOf(id, s) : null;
        if (t && cels) out.set(id, { ...t, cels });
      }
      return out;
    }
    if (drag.kind === 'keys') {
      if (!drag.delta) return out;
      for (const id of ids) {
        if (!keySelection.some((k) => k.track === id)) continue;
        const keys = anim.movedKeys(id, drag.delta, drag.copy, s);
        const t = anim.trackContentOf(id, s) ?? { clips: [] };
        if (keys) out.set(id, { ...t, keys });
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
  }, [drag, rows, fps, timeline, clipSelection, keySelection, celSelection]);

  const celsOf = (id: Id) =>
    celSelection
      .filter((c) => c.track === id)
      .map((c) => c.frame + (drag?.kind === 'cels' ? anim.celMoveDelta(drag.delta) : 0))
      .join(',');

  const keysOf = (id: Id) =>
    keySelection
      .filter((k: KeyRef) => k.track === id)
      .map((k) => `${k.group ?? '*'}:${Math.max(1, k.frame + (drag?.kind === 'keys' ? drag.delta : 0))}`)
      .join(',');

  const selectedOf = (id: Id) =>
    clipSelection
      .filter((c: ClipRef) => c.track === id)
      .map((c) => c.start + (drag?.kind === 'move' ? anim.clipMoveDelta(drag.delta) : 0))
      .join(',');

  // Start and end frame: the blue marks on the frame ruler.
  const rangeStart = timeline ? startOf(timeline) : 1;
  const rangeEnd = timeline ? endOf(timeline) : 1;
  const dragRange = (e: React.PointerEvent<HTMLDivElement>, which: 'start' | 'end') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const ruler = e.currentTarget.parentElement!;
    const move = (ev: PointerEvent) => {
      const t = getState().doc.timeline;
      if (!t) return;
      const x = ev.clientX - ruler.getBoundingClientRect().left;
      if (which === 'start') {
        const start = Math.max(1, Math.min(endOf(t), Math.round(x / CELL) + 1));
        if (start !== startOf(t)) anim.setTimeline({ start }, 'Start frame', 'timeline-start');
      } else {
        const end = Math.max(startOf(t), Math.min(t.frames, Math.round(x / CELL)));
        if (end !== endOf(t)) anim.setTimeline({ end }, 'End frame', 'timeline-end');
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Dragging around keyframes selects them (Shift: adds, Ctrl/⌘: takes out).
  const rowsRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const swallowClick = useRef(false);
  const onRowsDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const rowsEl = rowsRef.current;
    if (e.button !== 0 || !rowsEl || !target.closest('.tl-lane') || target.closest('.tl-key, .tl-clip-grip, [data-assigned], .tl-tracklabel, .tl-label-input')) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const mode = e.shiftKey ? 'add' : e.ctrlKey || e.metaKey ? 'remove' : 'set';
    let moved = false;
    const rect = (ev: PointerEvent) => ({ left: Math.min(x0, ev.clientX), top: Math.min(y0, ev.clientY), right: Math.max(x0, ev.clientX), bottom: Math.max(y0, ev.clientY) });
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      moved = true;
      const r = rect(ev);
      const box = rowsEl.getBoundingClientRect();
      setMarquee({ x: r.left - box.left, y: r.top - box.top, w: r.right - r.left, h: r.bottom - r.top });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      setMarquee(null);
      if (!moved) return;
      // The click that ends the drag does not select a frame.
      swallowClick.current = true;
      setTimeout(() => (swallowClick.current = false), 0);
      const r = rect(ev);
      const refs: KeyRef[] = [];
      rowsEl.querySelectorAll<HTMLElement>('.tl-key').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.right < r.left || b.left > r.right || b.bottom < r.top || b.top > r.bottom) return;
        const group = el.dataset.group as ChannelGroup | '';
        refs.push({ track: el.dataset.keyTrack!, frame: Number(el.dataset.frame), ...(group ? { group } : {}) });
      });
      anim.selectKeyframes(refs, mode);
      // Track labels inside the rectangle are selected with the keyframes.
      const picked: LabelRef[] = [];
      rowsEl.querySelectorAll<HTMLElement>('.tl-tracklabel').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.right < r.left || b.left > r.right || b.bottom < r.top || b.top > r.bottom) return;
        picked.push({ track: el.dataset.labelTrack!, frame: Number(el.dataset.frame) });
      });
      labels.selectLabels(picked, mode);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  // Dragging the top edge makes the palette taller or lower.
  const resize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = getState().timelineHeight;
    const max = Math.max(160, window.innerHeight - 260);
    const move = (ev: PointerEvent) => setState({ timelineHeight: Math.round(Math.min(max, Math.max(110, h0 + y0 - ev.clientY))) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section className="timeline-palette" data-testid="timeline" aria-label="Timeline" style={{ height }}>
      <div className="tl-resize" role="separator" aria-orientation="horizontal" aria-label="Resize the Timeline palette" onPointerDown={resize} />
      <div className="timeline-bar">
        <span className="palette-title">Timeline</span>
        {timeline && (
          <select className="tl-timelines" aria-label="Timeline list" title="Timeline list: the timeline being edited" value={timelineIdx} onChange={(e) => anim.switchToTimeline(Number(e.target.value))}>
            {timelineNames.map((n, i) => (
              <option key={i} value={i}>
                {n}
              </option>
            ))}
          </select>
        )}
        <Button icon="newTimeline" label="New timeline" onClick={() => openDialog('newTimeline')} />
        <Button icon="graph" label="Graph Editor" on={graph} disabled={!timeline} onClick={anim.toggleGraphEditor} />
        {graph && <Button icon="dragZoom" label="Drag to zoom" on={dragZoom} onClick={() => setState({ graphDragZoom: !dragZoom })} />}
        <span className="sep" />
        <Button icon="frameFirst" label="Go to start" disabled={!enabled} onClick={anim.firstFrame} />
        <Button icon="framePrev" label="Go to previous frame" disabled={!enabled} onClick={anim.previousFrame} />
        <Button icon={playing ? 'stop' : 'play'} label={playing ? 'Stop' : 'Play'} disabled={!enabled} onClick={anim.togglePlay} />
        <Button icon="frameNext" label="Go to next frame" disabled={!enabled} onClick={anim.nextFrame} />
        <Button icon="frameLast" label="Go to end" disabled={!enabled} onClick={anim.lastFrame} />
        <Button icon="loop" label="Loop play" on={loop} onClick={anim.toggleLoop} />
        <span className="sep" />
        {graph ? (
          <>
            <Button icon="snapX" label="Snap to X axis" on={snapX} onClick={() => setState({ graphSnapX: !snapX })} />
            <Button icon="snapY" label="Snap to Y axis" on={snapY} onClick={() => setState({ graphSnapY: !snapY })} />
          </>
        ) : (
          <>
            <Button icon="newAnimFolder" label="New animation folder" onClick={() => void anim.newAnimationFolder()} />
            <Button icon="newCel" label="New animation cel" disabled={!enabled} onClick={() => void anim.newAnimationCel()} />
            <Button icon="newLayer" label="Assign cel to frame" disabled={!enabled || !hasCels} onClick={openAssignMenu} />
            <Button icon="removeCel" label="Delete assigned cel" disabled={!enabled || !hasCels} onClick={() => anim.removeAssignedCel()} />
            <span className="sep" />
            <Button icon="onion" label="Enable onion skin" on={onionSkin} disabled={!enabled} onClick={anim.toggleOnionSkin} />
          </>
        )}
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
        {graph ? (
          <Button icon="unpair" label="Unpair handles" disabled={!enabled || !graphPicked} onClick={anim.toggleUnpairHandles} />
        ) : (
          <>
            <Button icon="keyEnable" label="Enable keyframes on this layer" on={keyOn} disabled={!enabled || !activeId} onClick={anim.toggleKeyframes} />
            <Button icon="keyEdit" label="Edit layers with active keyframes" on={editKeyed} disabled={!enabled || !keyOn} onClick={anim.toggleEditKeyed} />
          </>
        )}
        <span className="spacer" />
        {timeline && (
          <button className="tl-info" title="Current frame / start frame / end frame (Animation > Timeline > Change settings)" onClick={() => openDialog('timelineSettings')}>
            <span data-testid="timeline-frame">{frameLabel(frame, fps, display)}</span> / {frameLabel(startOf(timeline), fps, display)} / {frameLabel(endOf(timeline), fps, display)} · {timeline.fps} fps{enabled ? '' : ' · off'}
          </button>
        )}
      </div>
      {!timeline ? (
        <div className="timeline-empty">This canvas has no timeline. New animation folder makes one (with a track); Animation &gt; Timeline &gt; New timeline sets its frame rate and length.</div>
      ) : (
        <div
          className={`timeline-body ${enabled ? '' : 'disabled'} ${drag ? 'dragging' : ''} ${division ? 'divided' : ''}`}
          style={{ ['--cell' as string]: `${CELL}px`, ['--frames' as string]: frames, ['--division' as string]: division || 1 }}
        >
          <div
            ref={rowsRef}
            className="tl-rows"
            onPointerDown={onRowsDown}
            onClickCapture={(e) => {
              if (!swallowClick.current) return;
              swallowClick.current = false;
              e.stopPropagation();
            }}
          >
            <div className="tl-row tl-head">
              <div className="tl-name" title={graph ? graphTrack : undefined}>{graph ? graphTrack || 'Graph Editor' : 'Frame'}</div>
              <div
                className="tl-cells tl-ruler"
                data-testid="timeline-ruler"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  scrub.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  anim.setFrame(frameFromEvent(e));
                }}
                onPointerMove={(e) => {
                  if (scrub.current) anim.setFrame(frameFromEvent(e));
                }}
                onPointerUp={() => (scrub.current = false)}
                onDoubleClick={(e) => {
                  if ((e.target as HTMLElement).closest('.tl-range')) return;
                  anim.setFrame(Math.max(1, Math.min(frames, Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / CELL) + 1)));
                  openDialog('timelineLabel');
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const f = Math.max(1, Math.min(frames, Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / CELL) + 1));
                  anim.setFrame(f);
                  showMenu({ x: e.clientX, y: e.clientY }, rulerMenu(f));
                }}
              >
                {Array.from({ length: frames }, (_, i) => {
                  const f = i + 1;
                  // As time, the ruler numbers the frames of each second and marks where a second starts.
                  const second = timeLike && startsSecond(f, fps);
                  return (
                    <div
                      key={i}
                      className={`tl-cell ${f === frame ? 'current' : ''} ${f < rangeStart || f > rangeEnd ? 'outside' : ''} ${division && f % division === 0 ? 'div' : ''} ${second ? 'second' : ''}`}
                      title={timelineLabelAt(timeline.labels, f) ? `${frameLabel(f, fps, display)}: ${timelineLabelAt(timeline.labels, f)!.text} (double-click to rename)` : `${frameLabel(f, fps, display)} (double-click: timeline label)`}
                    >
                      {timeLike ? ((f - 1) % Math.max(1, Math.round(fps))) + (display === 'secframe' ? 1 : 0) : frameLabel(f, fps, display)}
                    </div>
                  );
                })}
                {/* Timeline labels (the frames under them stay clickable; double-click a frame to name it). */}
                {(timeline.labels ?? [])
                  .filter((l) => l.frame <= frames)
                  .map((l) => (
                    <div key={l.frame} className="tl-tlabel" data-testid="timeline-label" data-frame={l.frame} style={{ left: (l.frame - 1) * CELL }}>
                      {l.text}
                    </div>
                  ))}
                {/* Start and end frame: drag the blue marks. */}
                <div className="tl-range start" data-testid="timeline-start" title={`Start frame ${rangeStart}: drag to change`} style={{ left: (rangeStart - 1) * CELL }} onPointerDown={(e) => dragRange(e, 'start')} />
                <div className="tl-range end" data-testid="timeline-end" title={`End frame ${rangeEnd}: drag to change`} style={{ left: rangeEnd * CELL }} onPointerDown={(e) => dragRange(e, 'end')} />
              </div>
            </div>
            {graph && <GraphEditor frames={frames} cell={CELL} />}
            {!graph &&
              rows.map((r) =>
                r.layer.kind === 'audio' ? (
                  <SoundRow
                    key={r.layer.id}
                    track={r.layer}
                    depth={r.depth}
                    files={files}
                    frames={frames}
                    fps={fps}
                    active={r.layer.id === activeId}
                    selected={selectedOf(r.layer.id)}
                    selectedKeys={keysOf(r.layer.id)}
                    preview={previews.get(r.layer.id) ?? null}
                    onGrip={stableGrip}
                    onKey={stableKey}
                  />
                ) : (
                  <TrackRow
                    key={r.layer.id}
                    row={r}
                    frames={frames}
                    active={r.layer.id === activeId}
                    selected={selectedOf(r.layer.id)}
                    selectedKeys={keysOf(r.layer.id)}
                    preview={previews.get(r.layer.id) ?? null}
                    details={keyDetails.includes(r.layer.id)}
                    transformOpen={transformDetails.includes(r.layer.id)}
                    maskKeys={r.layer.mask ? keysOf(maskTrackId(r.layer.id)) : ''}
                    maskPreview={(previews.get(maskTrackId(r.layer.id))?.keys as Keyframe[] | undefined) ?? null}
                    maskActive={maskKeyed === r.layer.id}
                    selectedCels={celsOf(r.layer.id)}
                    onGrip={stableGrip}
                    onKey={stableKey}
                    onCel={stableCel}
                    trackLabels={labelsByTrack.get(r.layer.id) ?? NO_LABELS}
                    selectedLabels={labelsOf(r.layer.id)}
                    onLabel={stableLabel}
                  />
                ),
              )}
            <div className="tl-now" style={{ left: `calc(var(--name-w) + ${(frame - 1) * CELL}px)` }} aria-hidden="true" />
            {marquee && <div className="tl-marquee" data-testid="timeline-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} aria-hidden="true" />}
          </div>
        </div>
      )}
    </section>
  );
}
