import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { engine } from '../../audio/engine';
import { segmentMidValue } from '../../model/automation';
import { describeTarget, fromNorm } from '../../model/automationTargets';
import { findPattern, songLength } from '../../model/patterns';
import { PALETTE, PALETTE_NAMES } from '../../model/colors';
import { SNAP_OPTIONS, formatPosition, gridLineTicks, snapFloor, snapLabel, snapRound, snapTicks, ticksPerBar, type SnapId } from '../../model/timing';
import { makeId } from '../../model/ids';
import type { AutomationChannel, Clip, Id, Project } from '../../model/types';
import { createAudioClip, importAudioFiles } from '../../project/projectIO';
import {
  addClip,
  addTracks,
  cloneTrack,
  deleteClips,
  deleteTrack,
  endCoalesce,
  gestureKey,
  insertTrack,
  makeClipUnique,
  moveTrack,
  placePatternClip,
  renamePattern,
  renameTrack,
  selectChannel,
  selectPattern,
  setChannelProps,
  setClipPattern,
  setClipsMuted,
  setPatternColor,
  setTrackClipsMuted,
  setTransport,
  setUi,
  toggleTrackMute,
  updateClips,
} from '../../store/actions';
import { addAutomationPoint, moveAutomationPoint, placeAutomationClip, setPointTension } from '../../store/automationActions';
import { useStore, type PlaylistPick, type ToolId } from '../../store/store';
import { prepareCanvas, useElementSize, useFrame } from '../animation';
import { hitTestCurve, tensionFromDrag, xToTick, yToValue, type CurveView } from '../automation/curve';
import { pointMenu } from '../automation/pointMenu';
import { IconEraser, IconMute, IconPencil, IconPlaylist, IconSelect, IconBrush } from '../controls/Icons';
import { audioFilesFromDrop, getDragItem, hasDragItem, hasFiles, sampleInfoFor } from '../dnd';
import { setHint } from '../hint';
import { registerWindowKeys } from '../keyboard';
import { promptDialog, showMenu, type MenuItem } from '../overlays';
import { WindowFrame } from '../workspace/WindowFrame';
import { focusWindow, openChannelEditor, openPianoRoll, openWindow } from '../workspace/windows';
import { CLIP_ICON_W, RULER_H, TRACK_LED_W, TRACK_W, automationClipView, drawPlaylist, tickAtX, trackAtY, xOfTick, yOfTrack, type PlaylistViewport } from './draw';
import { PlaylistPicker, usePick } from './PlaylistPicker';

const EDGE = 7;

type Drag =
  | { kind: 'move'; key: string; originTick: number; originTrack: number; orig: Map<string, Clip>; anchor: string }
  | { kind: 'resize'; key: string; side: 'left' | 'right'; originTick: number; orig: Map<string, Clip>; anchor: string }
  | { kind: 'delete'; key: string }
  | { kind: 'mute'; key: string; muted: boolean | null; done: Set<string> }
  | { kind: 'rubber'; t0: number; r0: number; t1: number; r1: number; base: Set<string> }
  | { kind: 'paint'; key: string; track: number; last: number }
  | { kind: 'seek' }
  | { kind: 'pan'; x: number; y: number; scrollTick: number; scrollY: number }
  | { kind: 'autoPoint'; key: string; channelId: Id; clipId: Id; index: number; view: CurveView }
  | { kind: 'autoTension'; key: string; channelId: Id; index: number; startY: number; startTension: number };

let clipboard: Clip[] = [];

/** Places the picker's current item (pattern, audio clip or automation clip) – FL's draw tool. */
function placePick(project: Project, pick: PlaylistPick, trackId: Id, start: number, key: string): Id | null {
  if (pick.kind === 'pattern') return placePatternClip(pick.id, trackId, start, { coalesce: key });
  if (pick.kind === 'automation') return placeAutomationClip(pick.id, trackId, start, { coalesce: key });
  const existing = project.clips.find((c) => c.kind === 'audio' && c.channelId === pick.id);
  if (!existing) return null;
  return addClip({ kind: 'audio', channelId: pick.id, trackId, start, length: existing.length + existing.offset, offset: 0 }, { coalesce: key });
}

function pickName(project: Project, pick: PlaylistPick): string {
  if (pick.kind === 'pattern') return project.patterns.find((p) => p.id === pick.id)?.name ?? '';
  return project.channels.find((c) => c.id === pick.id)?.name ?? '';
}

function clipName(project: Project, clip: Clip): string {
  if (clip.kind === 'pattern') return findPattern(project, clip.patternId)?.name ?? 'Pattern';
  return project.channels.find((c) => c.id === clip.channelId)?.name ?? 'Clip';
}

function randomColor(current: string | undefined): string {
  const choices = PALETTE.filter((c) => c !== current);
  return choices[Math.floor(Math.random() * choices.length)] ?? PALETTE[0];
}

/** The channel whose notes a pattern clip opens in the piano roll: the selected one if it has notes there. */
function pianoRollChannelFor(project: Project, patternId: Id, selectedChannelId: Id | null): Id | null {
  const pattern = findPattern(project, patternId);
  const playable = project.channels.filter((c) => c.kind !== 'automation');
  const hasNotes = (id: Id) => (pattern?.notes[id]?.length ?? 0) > 0;
  if (selectedChannelId && hasNotes(selectedChannelId)) return selectedChannelId;
  return playable.find((c) => hasNotes(c.id))?.id ?? selectedChannelId ?? playable[0]?.id ?? null;
}

/** FL Studio's clip menu (click the icon at the left of a clip's title). */
function clipMenu(project: Project, clip: Clip, select: (ids: Set<string>) => void): MenuItem[] {
  const muted: MenuItem = { label: 'Muted', checked: clip.muted === true, onClick: () => setClipsMuted([clip.id]) };
  const remove: MenuItem = { label: 'Delete', danger: true, onClick: () => deleteClips([clip.id]) };
  if (clip.kind === 'pattern') {
    const pattern = findPattern(project, clip.patternId);
    const similar = project.clips.filter((c) => c.kind === 'pattern' && c.patternId === clip.patternId);
    return [
      { label: 'Pattern clip', header: true },
      muted,
      { separator: true },
      { label: 'Rename…', onClick: () => void promptDialog('Rename pattern', pattern?.name ?? '').then((n) => n && renamePattern(clip.patternId, n)) },
      { label: 'Change color', submenu: PALETTE.map((c, i) => ({ label: PALETTE_NAMES[i], swatch: c, onClick: () => setPatternColor(clip.patternId, c) })) },
      { label: 'Random color', onClick: () => setPatternColor(clip.patternId, randomColor(pattern?.color)) },
      { separator: true },
      {
        label: 'Select source pattern',
        submenu: project.patterns.map((p) => ({ label: p.name, swatch: p.color, radio: true, checked: p.id === clip.patternId, onClick: () => setClipPattern(clip.id, p.id) })),
      },
      {
        label: 'Edit pattern',
        onClick: () => {
          selectPattern(clip.patternId);
          openWindow('channelRack');
          focusWindow('channelRack');
        },
      },
      { label: 'Make unique', disabled: similar.length < 2, onClick: () => makeClipUnique(clip.id) },
      { label: 'Select all similar clips', onClick: () => select(new Set(similar.map((c) => c.id))) },
      remove,
    ];
  }
  const channel = project.channels.find((c) => c.id === clip.channelId);
  const similar = project.clips.filter((c) => c.kind === clip.kind && c.channelId === clip.channelId);
  return [
    { label: clip.kind === 'audio' ? 'Audio clip' : 'Automation clip', header: true },
    muted,
    { separator: true },
    { label: 'Rename…', disabled: !channel, onClick: () => void promptDialog('Rename', channel?.name ?? '').then((n) => n && setChannelProps(clip.channelId, { name: n })) },
    { label: 'Change color', submenu: PALETTE.map((c, i) => ({ label: PALETTE_NAMES[i], swatch: c, onClick: () => setChannelProps(clip.channelId, { color: c }) })) },
    { label: 'Random color', onClick: () => setChannelProps(clip.channelId, { color: randomColor(channel?.color) }) },
    { separator: true },
    { label: clip.kind === 'audio' ? 'Channel settings…' : 'Edit automation…', onClick: () => openChannelEditor(clip.channelId) },
    { label: 'Select all similar clips', onClick: () => select(new Set(similar.map((c) => c.id))) },
    remove,
  ];
}

/** FL Studio's playlist track menu (right-click a track header). */
function trackMenu(project: Project, index: number): MenuItem[] {
  const t = project.tracks[index];
  const clips = project.clips.filter((c) => c.trackId === t.id).sort((a, b) => a.start - b.start);
  return [
    { label: 'Rename…', onClick: () => void promptDialog('Rename track', t.name).then((n) => n && renameTrack(t.id, n)) },
    { label: 'Auto name', disabled: clips.length === 0, onClick: () => renameTrack(t.id, clipName(project, clips[0])) },
    { label: 'Reset', onClick: () => renameTrack(t.id, `Track ${index + 1}`) },
    { separator: true },
    { label: t.muted ? 'Unmute track' : 'Mute track', onClick: () => toggleTrackMute(t.id) },
    { label: 'Mute all clips', disabled: clips.length === 0, onClick: () => setTrackClipsMuted(t.id, true) },
    { label: 'Unmute all clips', disabled: !clips.some((c) => c.muted), onClick: () => setTrackClipsMuted(t.id, false) },
    { separator: true },
    { label: 'Insert one', onClick: () => insertTrack(index) },
    { label: 'Clone', onClick: () => cloneTrack(t.id) },
    { label: 'Delete', danger: true, disabled: project.tracks.length <= 1, onClick: () => deleteTrack(t.id) },
    { separator: true },
    { label: 'Move up', disabled: index === 0, onClick: () => moveTrack(t.id, -1) },
    { label: 'Move down', disabled: index === project.tracks.length - 1, onClick: () => moveTrack(t.id, 1) },
    { separator: true },
    { label: 'Add 8 tracks', onClick: () => addTracks(8) },
  ];
}

export function Playlist() {
  const project = useStore((s) => s.project);
  const view = useStore((s) => s.ui.playlist);
  const songStart = useStore((s) => s.transport.songStart);
  const pick = usePick();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const autoFocus = useRef<{ clipId: string; point: number | null; handle: number | null } | null>(null);
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const dropHint = useRef<{ tick: number; track: number } | null>(null);
  const lastClick = useRef<{ tick: number; track: number } | null>(null);
  const dirty = useRef(true);
  const lastPlayhead = useRef<number | null>(null);
  const [renaming, setRenaming] = useState<{ index: number; y: number } | null>(null);

  const mainSnap = useStore((s) => s.ui.mainSnap);
  const lineTicks = gridLineTicks(view.pxPerTick, project.beatsPerBar);
  const grid = snapTicks(view.snap, project.beatsPerBar, lineTicks, mainSnap);
  const vp: PlaylistViewport = useMemo(
    () => ({ width: size.width, height: size.height, pxPerTick: view.pxPerTick, trackHeight: view.trackHeight, scrollTick: view.scrollTick, scrollY: view.scrollY }),
    [size.width, size.height, view.pxPerTick, view.trackHeight, view.scrollTick, view.scrollY],
  );
  const songEnd = useMemo(() => songLength(project), [project]);

  const scene = useRef({ vp, project, selected, songStart, songEnd, lineTicks });
  scene.current = { vp, project, selected, songStart, songEnd, lineTicks };
  dirty.current = true;

  useFrame(() => {
    const canvas = canvasRef.current;
    const sc = scene.current;
    if (!canvas || sc.vp.width <= 0) return;
    const st = useStore.getState();
    const playhead = st.transport.playing && st.transport.mode === 'song' ? engine.playheadTick() : null;
    if (!dirty.current && playhead === lastPlayhead.current) return;
    lastPlayhead.current = playhead;
    dirty.current = false;
    const ctx = prepareCanvas(canvas, sc.vp.width, sc.vp.height);
    if (!ctx) return;
    const d = drag.current;
    drawPlaylist(ctx, sc.vp, {
      project: sc.project,
      selected: sc.selected,
      playhead,
      songStart: sc.songStart,
      songEnd: sc.songEnd,
      rubber: d?.kind === 'rubber' ? { t0: d.t0, t1: d.t1, r0: d.r0, r1: d.r1 } : null,
      dropHint: dropHint.current,
      autoFocus: autoFocus.current,
      lineTicks: sc.lineTicks,
    });
  });

  const setView = (patch: Partial<typeof view>) =>
    setUi((d) => {
      Object.assign(d.playlist, patch);
      d.playlist.scrollTick = Math.max(0, d.playlist.scrollTick);
      const maxY = Math.max(0, project.tracks.length * d.playlist.trackHeight - (size.height - RULER_H) + 20);
      d.playlist.scrollY = Math.max(0, Math.min(maxY, d.playlist.scrollY));
    });

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const clipAt = (x: number, y: number): { clip: Clip; edge: 'left' | 'right' | null } | null => {
    const ti = trackAtY(vp, y);
    const track = project.tracks[ti];
    if (!track) return null;
    const tick = tickAtX(vp, x);
    for (let i = project.clips.length - 1; i >= 0; i--) {
      const c = project.clips[i];
      if (c.trackId !== track.id || tick < c.start || tick >= c.start + c.length) continue;
      const left = xOfTick(vp, c.start);
      const right = xOfTick(vp, c.start + c.length);
      const wide = right - left > EDGE * 3;
      return { clip: c, edge: wide && right - x <= EDGE ? 'right' : wide && x - left <= EDGE ? 'left' : null };
    }
    return null;
  };

  /** True when (x, y) is on the menu icon at the left of the clip's title bar. */
  const onClipIcon = (clip: Clip, x: number, y: number) => {
    const ti = project.tracks.findIndex((t) => t.id === clip.trackId);
    const left = Math.max(xOfTick(vp, clip.start), TRACK_W);
    const top = yOfTrack(vp, ti) + 1;
    return x >= left && x < left + CLIP_ICON_W + 2 && y >= top && y < top + 15 && clip.length * vp.pxPerTick > CLIP_ICON_W * 2;
  };

  /** Curve hit-test inside an automation clip's body (below its title). */
  const automationAt = (clip: Clip, x: number, y: number) => {
    if (clip.kind !== 'automation') return null;
    const ch = project.channels.find((c): c is AutomationChannel => c.id === clip.channelId && c.kind === 'automation');
    const ti = project.tracks.findIndex((t) => t.id === clip.trackId);
    if (!ch || ti < 0) return null;
    const cy = yOfTrack(vp, ti) + 1;
    if (y < cy + 15 || view.trackHeight < 24) return null;
    const cv = automationClipView(vp, clip, xOfTick(vp, clip.start), cy, view.trackHeight - 3);
    const hit = hitTestCurve(cv, ch.automation, x, y, vp.pxPerTick * clip.length > 60);
    return hit ? { ch, cv, hit } : null;
  };

  const setAutoFocus = (next: { clipId: string; point: number | null; handle: number | null } | null) => {
    const cur = autoFocus.current;
    if (cur?.clipId === next?.clipId && cur?.point === next?.point && cur?.handle === next?.handle) return;
    autoFocus.current = next;
    dirty.current = true;
  };

  const seekTo = (x: number) => {
    const tick = Math.max(0, snapFloor(tickAtX(vp, x), snapTicks('beat', project.beatsPerBar)));
    if (useStore.getState().transport.mode !== 'song') setTransport({ mode: 'song' });
    engine.seek(tick);
  };

  // ------------------------------------------------------------ pointer input

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { x, y } = local(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (e.button === 1) {
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, scrollTick: view.scrollTick, scrollY: view.scrollY };
      return;
    }
    if (y < RULER_H) {
      if (x > TRACK_W) {
        drag.current = { kind: 'seek' };
        seekTo(x);
      }
      return;
    }
    const ti = trackAtY(vp, y);
    const track = project.tracks[ti];
    if (x < TRACK_W) {
      if (!track) return;
      if (e.button === 2) showMenu(e, trackMenu(project, ti));
      else if (e.button === 0 && x >= TRACK_W - TRACK_LED_W) toggleTrackMute(track.id);
      return;
    }
    if (!track) return;
    const tick = tickAtX(vp, x);
    const g = e.altKey ? 1 : grid;
    lastClick.current = { tick: snapFloor(Math.max(0, tick), g), track: ti };
    const hit = clipAt(x, y);
    if (hit && e.button === 0 && view.tool !== 'delete' && view.tool !== 'mute' && onClipIcon(hit.clip, x, y)) {
      drag.current = null;
      showMenu(e, clipMenu(project, hit.clip, (ids) => setSelected(ids)));
      return;
    }
    const auto = hit && !hit.edge ? automationAt(hit.clip, x, y) : null;
    if (auto && hit && view.tool !== 'delete' && view.tool !== 'mute') {
      const { ch, cv } = auto;
      const key = gestureKey('automation');
      const pts = ch.automation.points;
      if (e.button === 2) {
        // FL Studio: right-click on a point opens its menu, on a handle resets the tension,
        // anywhere else in the clip adds a point (and keeps dragging it).
        if (auto.hit.kind === 'point') {
          showMenu(e, pointMenu(ch.id, ch.automation, auto.hit.index));
          return;
        }
        if (auto.hit.kind === 'tension') {
          setPointTension(ch.id, auto.hit.index, 0);
          return;
        }
        const t = snapRound(xToTick(cv, x), g);
        const index = addAutomationPoint(ch.id, t, yToValue(cv, y), { coalesce: key });
        if (index >= 0) {
          drag.current = { kind: 'autoPoint', key, channelId: ch.id, clipId: hit.clip.id, index, view: cv };
          setAutoFocus({ clipId: hit.clip.id, point: index, handle: null });
        }
        return;
      }
      if (auto.hit.kind === 'point') {
        selectChannel(ch.id);
        setUi((u) => void (u.playlistPick = { kind: 'automation', id: ch.id }));
        drag.current = { kind: 'autoPoint', key, channelId: ch.id, clipId: hit.clip.id, index: auto.hit.index, view: cv };
        return;
      }
      if (auto.hit.kind === 'tension') {
        drag.current = { kind: 'autoTension', key, channelId: ch.id, index: auto.hit.index, startY: e.clientY, startTension: pts[auto.hit.index].tension };
        return;
      }
    }
    const tool: ToolId = e.button === 2 ? 'delete' : view.tool;

    if (tool === 'delete') {
      const key = gestureKey('erase-clips');
      drag.current = { kind: 'delete', key };
      if (hit) deleteClips([hit.clip.id], { coalesce: key });
      return;
    }
    if (tool === 'mute') {
      // FL Studio's mute tool: click toggles a clip, dragging gives the same state to every clip it touches.
      const key = gestureKey('mute-clips');
      const muted = hit ? !hit.clip.muted : null;
      drag.current = { kind: 'mute', key, muted, done: new Set(hit ? [hit.clip.id] : []) };
      if (hit) setClipsMuted([hit.clip.id], muted ?? undefined, { coalesce: key });
      return;
    }
    if ((e.metaKey || e.ctrlKey || tool === 'select') && !hit) {
      const base = e.shiftKey ? new Set(selected) : new Set<string>();
      drag.current = { kind: 'rubber', t0: tick, r0: ti, t1: tick, r1: ti, base };
      setSelected(base);
      return;
    }
    if (hit) {
      if (hit.clip.kind === 'pattern') {
        selectPattern(hit.clip.patternId);
        setUi((u) => void (u.playlistPick = null));
      } else {
        const channelId = hit.clip.channelId;
        const kind = hit.clip.kind;
        setUi((u) => void (u.playlistPick = { kind, id: channelId }));
        if (kind === 'automation') selectChannel(channelId);
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey) {
        // FL Studio: Ctrl+Shift+click adds a clip to (or removes it from) the selection.
        const next = new Set(selected);
        if (next.has(hit.clip.id)) next.delete(hit.clip.id);
        else next.add(hit.clip.id);
        setSelected(next);
        return;
      }
      // Ctrl+click selects only this clip; a click on a selected clip drags the whole selection.
      let sel = mod || !selected.has(hit.clip.id) ? new Set([hit.clip.id]) : selected;
      const ids = sel.has(hit.clip.id) ? sel : new Set([hit.clip.id]);
      const key = gestureKey('clips');
      let orig = new Map(project.clips.filter((c) => ids.has(c.id)).map((c) => [c.id, { ...c }]));
      let anchor = hit.clip.id;
      if (hit.edge) {
        setSelected(sel);
        drag.current = { kind: 'resize', key, side: hit.edge, originTick: tick, orig, anchor };
        return;
      }
      if (e.shiftKey) {
        // Shift+drag duplicates the selection and drags the copies.
        const copyIds = new Map([...orig.keys()].map((id) => [id, makeId('clip')]));
        const copies = [...orig.values()].map((c) => ({ ...c, id: copyIds.get(c.id)! }));
        updateClips((list) => {
          for (const c of copies) list.push({ ...c });
        }, { coalesce: key });
        orig = new Map(copies.map((c) => [c.id, c]));
        anchor = copyIds.get(hit.clip.id)!;
        sel = new Set(copies.map((c) => c.id));
      }
      setSelected(sel);
      drag.current = { kind: 'move', key, originTick: tick, originTrack: ti, orig, anchor };
      return;
    }
    // Empty space: place the picker's current item and keep dragging it.
    const key = gestureKey('place');
    const start = snapFloor(Math.max(0, tick), g);
    const id = placePick(project, pick, track.id, start, key);
    if (!id) return;
    if (tool === 'paint') {
      drag.current = { kind: 'paint', key, track: ti, last: start };
      return;
    }
    const clip = useStore.getState().project.clips.find((c) => c.id === id)!;
    setSelected(new Set([id]));
    drag.current = { kind: 'move', key, originTick: tick, originTrack: ti, orig: new Map([[id, { ...clip }]]), anchor: id };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const { x, y } = local(e);
    if (!d) {
      if (y < RULER_H) {
        e.currentTarget.style.cursor = 'text';
        setHint('Click to set the song position');
        return;
      }
      if (x < TRACK_W) {
        e.currentTarget.style.cursor = 'default';
        if (y > RULER_H && project.tracks[trackAtY(vp, y)]) setHint(x >= TRACK_W - TRACK_LED_W ? 'Mute track' : 'Right-click: track options, double-click: rename');
        return;
      }
      const hit = clipAt(x, y);
      if (hit && onClipIcon(hit.clip, x, y)) {
        e.currentTarget.style.cursor = 'pointer';
        setHint(`${clipName(project, hit.clip)} – clip menu`);
        return;
      }
      const auto = hit && !hit.edge ? automationAt(hit.clip, x, y) : null;
      if (auto && hit) {
        const { ch, cv } = auto;
        const pts = ch.automation.points;
        const info = ch.automation.target ? describeTarget(project, ch.automation.target) : null;
        const fmt = (n: number) => (info ? info.format(fromNorm(info, n)) : `${Math.round(n * 100)}%`);
        if (auto.hit.kind === 'point') {
          const p = pts[auto.hit.index];
          e.currentTarget.style.cursor = 'grab';
          setHint(`Point ${auto.hit.index + 1}/${pts.length}  ${fmt(p.value)} – drag: move, right-click: options`);
          setAutoFocus({ clipId: hit.clip.id, point: auto.hit.index, handle: null });
        } else if (auto.hit.kind === 'tension') {
          const p = pts[auto.hit.index];
          e.currentTarget.style.cursor = 'ns-resize';
          setHint(`Point ${auto.hit.index} to ${auto.hit.index + 1} tension ${Math.round(p.tension * 100)}% – drag: bend, right-click: reset`);
          setAutoFocus({ clipId: hit.clip.id, point: null, handle: auto.hit.index });
        } else {
          e.currentTarget.style.cursor = 'crosshair';
          const t = xToTick(cv, x);
          setHint(`${formatPosition(hit.clip.start - hit.clip.offset + t, project.beatsPerBar)}  ${fmt(yToValue(cv, y))} – right-click: add point, drag title: move clip`);
          setAutoFocus({ clipId: hit.clip.id, point: null, handle: null });
        }
        return;
      }
      setAutoFocus(hit?.clip.kind === 'automation' ? { clipId: hit.clip.id, point: null, handle: null } : null);
      e.currentTarget.style.cursor = hit?.edge ? 'ew-resize' : hit ? (view.tool === 'mute' ? 'pointer' : 'move') : view.tool === 'delete' ? 'not-allowed' : 'copy';
      if (hit) {
        const label =
          hit.clip.kind === 'pattern'
            ? project.patterns.find((p) => p.id === (hit.clip as Extract<Clip, { kind: 'pattern' }>).patternId)?.name
            : (project.channels.find((c) => c.id === (hit.clip as Extract<Clip, { kind: 'audio' | 'automation' }>).channelId)?.name ?? 'Clip');
        setHint(
          view.tool === 'mute'
            ? `${label} – click: mute/unmute`
            : `${label}${hit.clip.muted ? ' (muted)' : ''} – drag: move, edges: resize, Shift+drag: duplicate, double-click: edit, right-click: delete`,
        );
      } else setHint(`Click to place “${pickName(project, pick)}”`);
      return;
    }
    const g = e.altKey ? 1 : grid;
    const tick = tickAtX(vp, x);
    const ti = trackAtY(vp, y);
    switch (d.kind) {
      case 'pan':
        setView({ scrollTick: d.scrollTick - (e.clientX - d.x) / view.pxPerTick, scrollY: d.scrollY - (e.clientY - d.y) });
        break;
      case 'seek':
        seekTo(x);
        break;
      case 'delete': {
        const hit = clipAt(x, y);
        if (hit) deleteClips([hit.clip.id], { coalesce: d.key });
        break;
      }
      case 'mute': {
        const hit = clipAt(x, y);
        if (hit && !d.done.has(hit.clip.id)) {
          d.done.add(hit.clip.id);
          if (d.muted === null) d.muted = !hit.clip.muted;
          setClipsMuted([hit.clip.id], d.muted, { coalesce: d.key });
        }
        break;
      }
      case 'rubber': {
        d.t1 = tick;
        d.r1 = ti;
        const t0 = Math.min(d.t0, d.t1);
        const t1 = Math.max(d.t0, d.t1);
        const r0 = Math.min(d.r0, d.r1);
        const r1 = Math.max(d.r0, d.r1);
        const ids = new Set(project.tracks.slice(Math.max(0, r0), r1 + 1).map((t) => t.id));
        const next = new Set(d.base);
        for (const c of project.clips) if (ids.has(c.trackId) && c.start < t1 && c.start + c.length > t0) next.add(c.id);
        setSelected(next);
        dirty.current = true;
        break;
      }
      case 'paint': {
        const track = project.tracks[d.track];
        const start = snapFloor(Math.max(0, tick), g);
        const covered = project.clips.some((c) => c.trackId === track?.id && start >= c.start && start < c.start + c.length);
        if (track && start > d.last && !covered) {
          d.last = start;
          placePick(project, pick, track.id, start, d.key);
        }
        break;
      }
      case 'autoPoint': {
        const t = Math.max(0, snapRound(xToTick(d.view, x), g));
        moveAutomationPoint(d.channelId, d.index, t, yToValue(d.view, y), { coalesce: d.key });
        // Dragging the last point past the clip end stretches the clip (FL Studio).
        const clip = useStore.getState().project.clips.find((c) => c.id === d.clipId);
        const ch = useStore.getState().project.channels.find((c) => c.id === d.channelId);
        if (clip && ch?.kind === 'automation' && d.index === ch.automation.points.length - 1 && t > clip.offset + clip.length) {
          updateClips(
            (list) => {
              const c = list.find((x) => x.id === d.clipId);
              if (c) c.length = t - c.offset;
            },
            { coalesce: d.key },
          );
        }
        setAutoFocus({ clipId: d.clipId, point: d.index, handle: null });
        break;
      }
      case 'autoTension': {
        const ch = project.channels.find((c) => c.id === d.channelId);
        if (ch?.kind !== 'automation') break;
        const tension = tensionFromDrag(ch.automation.points, d.index, d.startTension, d.startY - e.clientY);
        setPointTension(d.channelId, d.index, tension, { coalesce: d.key });
        setHint(`Tension ${Math.round(tension * 100)}% · mid value ${Math.round(segmentMidValue(ch.automation.points, d.index) * 100)}%`);
        break;
      }
      case 'move': {
        const anchor = d.orig.get(d.anchor);
        if (!anchor) break;
        const minStart = Math.min(...[...d.orig.values()].map((c) => c.start));
        const dt = Math.max(-minStart, snapRound(anchor.start + tick - d.originTick, g) - anchor.start);
        const indices = [...d.orig.values()].map((c) => project.tracks.findIndex((t) => t.id === c.trackId));
        const dr = Math.max(-Math.min(...indices), Math.min(project.tracks.length - 1 - Math.max(...indices), ti - d.originTrack));
        updateClips(
          (list) => {
            for (const c of list) {
              const o = d.orig.get(c.id);
              if (!o) continue;
              c.start = o.start + dt;
              const oi = project.tracks.findIndex((t) => t.id === o.trackId);
              c.trackId = project.tracks[oi + dr]?.id ?? o.trackId;
            }
          },
          { coalesce: d.key },
        );
        break;
      }
      case 'resize': {
        const anchor = d.orig.get(d.anchor);
        if (!anchor) break;
        const delta = tick - d.originTick;
        updateClips(
          (list) => {
            for (const c of list) {
              const o = d.orig.get(c.id);
              if (!o) continue;
              if (d.side === 'right') {
                const end = snapRound(o.start + o.length + delta, g);
                c.length = Math.max(g, end - o.start);
              } else {
                const start = Math.max(0, Math.min(o.start + o.length - g, snapRound(o.start + delta, g)));
                const shift = Math.max(start - o.start, -o.offset);
                c.start = o.start + shift;
                c.length = o.length - shift;
                c.offset = o.offset + shift;
              }
            }
          },
          { coalesce: d.key },
        );
        break;
      }
    }
  };

  const onPointerUp = () => {
    drag.current = null;
    endCoalesce();
    dirty.current = true;
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const { x, y } = local(e);
    if (x < TRACK_W - TRACK_LED_W && y > RULER_H) {
      const ti = trackAtY(vp, y);
      if (project.tracks[ti]) setRenaming({ index: ti, y: RULER_H + ti * view.trackHeight - view.scrollY });
      return;
    }
    const hit = clipAt(x, y);
    if (!hit) return;
    if (hit.clip.kind === 'pattern') {
      // FL Studio opens the pattern in the piano roll.
      selectPattern(hit.clip.patternId);
      const channelId = pianoRollChannelFor(project, hit.clip.patternId, useStore.getState().ui.selectedChannelId);
      if (channelId) {
        openPianoRoll(channelId);
        focusWindow('pianoRoll');
      } else {
        openWindow('channelRack');
        focusWindow('channelRack');
      }
    } else openChannelEditor(hit.clip.channelId);
  };

  const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
    const { x } = local(e);
    if (e.ctrlKey || e.metaKey) {
      const px = Math.min(3, Math.max(0.01, view.pxPerTick * Math.exp(-e.deltaY * 0.0025)));
      const anchor = tickAtX(vp, x);
      setView({ pxPerTick: px, scrollTick: anchor - (x - TRACK_W) / px });
    } else if (e.altKey) {
      setView({ trackHeight: Math.min(120, Math.max(24, view.trackHeight + (e.deltaY < 0 ? 4 : -4))) });
    } else if (e.shiftKey) {
      setView({ scrollTick: view.scrollTick + (e.deltaY + e.deltaX) / view.pxPerTick });
    } else {
      setView({ scrollTick: view.scrollTick + e.deltaX / view.pxPerTick, scrollY: view.scrollY + e.deltaY });
    }
  };

  // ------------------------------------------------------------ drag & drop from browser / Finder

  const dropPosition = (e: DragEvent) => {
    const { x, y } = local(e);
    return { tick: Math.max(0, snapFloor(tickAtX(vp, x), grid)), track: trackAtY(vp, y) };
  };
  const onDragOver = (e: DragEvent) => {
    if (!hasDragItem(e) && !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dropHint.current = dropPosition(e);
    dirty.current = true;
  };
  const onDrop = async (e: DragEvent) => {
    const pos = dropPosition(e);
    dropHint.current = null;
    dirty.current = true;
    const track = project.tracks[pos.track];
    if (!track) return;
    const item = getDragItem(e);
    if (item?.type === 'sample') {
      e.preventDefault();
      e.stopPropagation();
      createAudioClip(sampleInfoFor(item).info, track.id, pos.tick);
    } else if (item?.type === 'pick') {
      e.preventDefault();
      e.stopPropagation();
      placePick(project, { kind: item.kind, id: item.id }, track.id, pos.tick, gestureKey('drop'));
    } else if (hasFiles(e)) {
      e.preventDefault();
      e.stopPropagation();
      const imported = await importAudioFiles(await audioFilesFromDrop(e));
      let t = pos.tick;
      for (const s of imported) {
        createAudioClip(s.info, track.id, t);
        t += ticksPerBar(project.beatsPerBar);
      }
    }
  };

  // ------------------------------------------------------------ keyboard

  const keyState = useRef({ project, selected });
  keyState.current = { project, selected };
  useEffect(
    () =>
      registerWindowKeys('playlist', (e) => {
        const { project: p, selected: sel } = keyState.current;
        const mod = e.metaKey || e.ctrlKey;
        const chosen = p.clips.filter((c) => sel.has(c.id));
        // FL Studio tool keys: P draw, B paint, D delete, T mute, E select.
        if (!mod && !e.altKey && !e.shiftKey) {
          const tool = ({ KeyP: 'draw', KeyB: 'paint', KeyD: 'delete', KeyT: 'mute', KeyE: 'select' } as const)[e.code as 'KeyP'];
          if (tool) {
            setUi((d) => void (d.playlist.tool = tool));
            return true;
          }
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && chosen.length) {
          deleteClips(chosen.map((c) => c.id));
          setSelected(new Set());
          return true;
        }
        if (mod && e.code === 'KeyA') {
          setSelected(new Set(p.clips.map((c) => c.id)));
          return true;
        }
        if (mod && e.code === 'KeyD') {
          // FL Studio: Ctrl+D deselects.
          setSelected(new Set());
          return true;
        }
        if (mod && e.code === 'KeyC' && chosen.length) {
          clipboard = chosen.map((c) => ({ ...c }));
          return true;
        }
        if (mod && e.code === 'KeyV' && clipboard.length) {
          const at = lastClick.current?.tick ?? 0;
          const min = Math.min(...clipboard.map((c) => c.start));
          const copies = clipboard.map((c) => ({ ...c, id: makeId('clip'), start: c.start - min + at }));
          updateClips((list) => {
            for (const c of copies) list.push(c);
          });
          setSelected(new Set(copies.map((c) => c.id)));
          return true;
        }
        if (mod && e.code === 'KeyB' && chosen.length) {
          const min = Math.min(...chosen.map((c) => c.start));
          const max = Math.max(...chosen.map((c) => c.start + c.length));
          const copies = chosen.map((c) => ({ ...c, id: makeId('clip'), start: c.start + (max - min) }));
          updateClips((list) => {
            for (const c of copies) list.push(c);
          });
          setSelected(new Set(copies.map((c) => c.id)));
          return true;
        }
        if (e.key === 'Escape' && sel.size) {
          setSelected(new Set());
          return true;
        }
        return false;
      }),
    [],
  );

  // ------------------------------------------------------------ render

  const toolButton = (tool: ToolId, icon: React.ReactNode, hint: string) => (
    <button className={view.tool === tool ? 'active' : ''} data-hint={hint} onClick={() => setView({ tool })}>
      {icon}
    </button>
  );

  const toolbar = (
    <>
      <div className="seg">
        {toolButton('draw', <IconPencil size={12} />, 'Draw (P): click to place the picked pattern or clip, drag to move')}
        {toolButton('paint', <IconBrush size={12} />, 'Paint (B): drag to place several clips')}
        {toolButton('delete', <IconEraser size={12} />, 'Delete (D) – the right mouse button deletes in every tool')}
        {toolButton('mute', <IconMute size={12} />, 'Mute (T): click clips to mute or unmute them')}
        {toolButton('select', <IconSelect size={12} />, 'Select (E): drag a rectangle')}
      </div>
      <select className="tb-select" value={view.snap} data-hint="Snap (Main follows the main snap in the toolbar; Alt while dragging: no snap)" onChange={(e) => setView({ snap: e.target.value as SnapId })}>
        {SNAP_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {`Snap: ${snapLabel(s)}`}
          </option>
        ))}
      </select>
      <span className="faint">Right-click in an automation clip to add points</span>
    </>
  );

  return (
    <WindowFrame id="playlist" title={`Playlist - Arrangement › ${pickName(project, pick)}`} icon={<IconPlaylist />} toolbar={toolbar}>
      <div className="editor with-picker" onDragOver={onDragOver} onDragLeave={() => (dropHint.current = null)} onDrop={onDrop}>
        <PlaylistPicker />
        <div className="editor-canvas-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
          />
          {renaming && (
            <input
              className="track-name-input"
              autoFocus
              style={{ left: 6, top: renaming.y + 8, width: TRACK_W - TRACK_LED_W - 10 }}
              defaultValue={project.tracks[renaming.index]?.name}
              onBlur={(e) => {
                const t = project.tracks[renaming.index];
                if (t && e.target.value.trim()) renameTrack(t.id, e.target.value);
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          )}
          {project.clips.length === 0 && (
            <div className="editor-empty">
              Click in the playlist to place the current pattern.
              <br />
              Switch to SONG mode (L) to play the arrangement.
            </div>
          )}
        </div>
      </div>
    </WindowFrame>
  );
}
