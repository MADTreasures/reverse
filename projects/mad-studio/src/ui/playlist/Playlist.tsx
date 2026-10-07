import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { engine } from '../../audio/engine';
import { songLength } from '../../model/patterns';
import { SNAP_OPTIONS, snapFloor, snapRound, snapTicks, ticksPerBar, type SnapId } from '../../model/timing';
import { makeId } from '../../model/ids';
import type { Clip } from '../../model/types';
import { createAudioClip, importAudioFiles } from '../../project/projectIO';
import {
  addTracks,
  deleteClips,
  endCoalesce,
  gestureKey,
  placePatternClip,
  renameTrack,
  selectPattern,
  setTransport,
  setUi,
  toggleTrackMute,
  updateClips,
} from '../../store/actions';
import { useStore, type ToolId } from '../../store/store';
import { prepareCanvas, useElementSize, useFrame } from '../animation';
import { IconEraser, IconPencil, IconPlaylist, IconSelect, IconBrush } from '../controls/Icons';
import { audioFilesFromDrop, getDragItem, hasDragItem, hasFiles, sampleInfoFor } from '../dnd';
import { setHint } from '../hint';
import { registerWindowKeys } from '../keyboard';
import { promptDialog, showMenu } from '../overlays';
import { WindowFrame } from '../workspace/WindowFrame';
import { focusWindow, openChannelEditor, openWindow } from '../workspace/windows';
import { RULER_H, TRACK_W, drawPlaylist, tickAtX, trackAtY, xOfTick, type PlaylistViewport } from './draw';

const EDGE = 7;

type Drag =
  | { kind: 'move'; key: string; originTick: number; originTrack: number; orig: Map<string, Clip>; anchor: string }
  | { kind: 'resize'; key: string; side: 'left' | 'right'; originTick: number; orig: Map<string, Clip>; anchor: string }
  | { kind: 'delete'; key: string }
  | { kind: 'rubber'; t0: number; r0: number; t1: number; r1: number; base: Set<string> }
  | { kind: 'paint'; key: string; track: number; last: number }
  | { kind: 'seek' }
  | { kind: 'pan'; x: number; y: number; scrollTick: number; scrollY: number };

let clipboard: Clip[] = [];

export function Playlist() {
  const project = useStore((s) => s.project);
  const view = useStore((s) => s.ui.playlist);
  const songStart = useStore((s) => s.transport.songStart);
  const selectedPatternId = useStore((s) => s.ui.selectedPatternId);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const dropHint = useRef<{ tick: number; track: number } | null>(null);
  const lastClick = useRef<{ tick: number; track: number } | null>(null);
  const dirty = useRef(true);
  const lastPlayhead = useRef<number | null>(null);
  const [renaming, setRenaming] = useState<{ index: number; y: number } | null>(null);

  const grid = snapTicks(view.snap, project.beatsPerBar);
  const vp: PlaylistViewport = useMemo(
    () => ({ width: size.width, height: size.height, pxPerTick: view.pxPerTick, trackHeight: view.trackHeight, scrollTick: view.scrollTick, scrollY: view.scrollY }),
    [size.width, size.height, view.pxPerTick, view.trackHeight, view.scrollTick, view.scrollY],
  );
  const songEnd = useMemo(() => songLength(project), [project]);

  const scene = useRef({ vp, project, selected, songStart, songEnd });
  scene.current = { vp, project, selected, songStart, songEnd };
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
      if (x < 26) toggleTrackMute(track.id);
      else if (e.button === 2) {
        showMenu(e, [
          { label: 'Rename track…', onClick: () => void promptDialog('Rename track', track.name).then((n) => n && renameTrack(track.id, n)) },
          { label: track.muted ? 'Unmute track' : 'Mute track', onClick: () => toggleTrackMute(track.id) },
          { label: 'Add 8 tracks', onClick: () => addTracks(8) },
        ]);
      }
      return;
    }
    if (!track) return;
    const tick = tickAtX(vp, x);
    const g = e.altKey ? 1 : grid;
    lastClick.current = { tick: snapFloor(Math.max(0, tick), g), track: ti };
    const hit = clipAt(x, y);
    const tool: ToolId = e.button === 2 ? 'delete' : view.tool;

    if (tool === 'delete') {
      const key = gestureKey('erase-clips');
      drag.current = { kind: 'delete', key };
      if (hit) deleteClips([hit.clip.id], { coalesce: key });
      return;
    }
    if ((e.metaKey || e.ctrlKey || tool === 'select') && !hit) {
      const base = e.shiftKey ? new Set(selected) : new Set<string>();
      drag.current = { kind: 'rubber', t0: tick, r0: ti, t1: tick, r1: ti, base };
      setSelected(base);
      return;
    }
    if (hit) {
      if (hit.clip.kind === 'pattern') selectPattern(hit.clip.patternId);
      let sel = selected;
      if (e.metaKey || e.ctrlKey) {
        sel = new Set(selected);
        if (sel.has(hit.clip.id)) sel.delete(hit.clip.id);
        else sel.add(hit.clip.id);
      } else if (!selected.has(hit.clip.id)) sel = new Set([hit.clip.id]);
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
    // Empty space: place the current pattern and keep dragging it.
    const key = gestureKey('place');
    const start = snapFloor(Math.max(0, tick), g);
    const id = placePatternClip(selectedPatternId, track.id, start, { coalesce: key });
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
        return;
      }
      const hit = clipAt(x, y);
      e.currentTarget.style.cursor = hit?.edge ? 'ew-resize' : hit ? 'move' : view.tool === 'delete' ? 'not-allowed' : 'copy';
      if (hit) {
        const label = hit.clip.kind === 'pattern' ? project.patterns.find((p) => p.id === (hit.clip as Extract<Clip, { kind: 'pattern' }>).patternId)?.name : 'Audio clip';
        setHint(`${label} – drag: move, edges: resize, Shift+drag: duplicate, right-click: delete`);
      } else setHint(`Click to place “${project.patterns.find((p) => p.id === selectedPatternId)?.name ?? ''}”`);
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
          placePatternClip(selectedPatternId, track.id, start, { coalesce: d.key });
        }
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
    if (x < TRACK_W && x >= 26 && y > RULER_H) {
      const ti = trackAtY(vp, y);
      if (project.tracks[ti]) setRenaming({ index: ti, y: RULER_H + ti * view.trackHeight - view.scrollY });
      return;
    }
    const hit = clipAt(x, y);
    if (!hit) return;
    if (hit.clip.kind === 'pattern') {
      selectPattern(hit.clip.patternId);
      openWindow('channelRack');
      focusWindow('channelRack');
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
        if ((e.key === 'Delete' || e.key === 'Backspace') && chosen.length) {
          deleteClips(chosen.map((c) => c.id));
          setSelected(new Set());
          return true;
        }
        if (mod && e.code === 'KeyA') {
          setSelected(new Set(p.clips.map((c) => c.id)));
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
        if (mod && (e.code === 'KeyB' || e.code === 'KeyD') && chosen.length) {
          const min = Math.min(...chosen.map((c) => c.start));
          const max = Math.max(...chosen.map((c) => c.start + c.length));
          const copies = chosen.map((c) => ({ ...c, id: makeId('clip'), start: c.start + (max - min) }));
          updateClips((list) => {
            for (const c of copies) list.push(c);
          });
          setSelected(new Set(copies.map((c) => c.id)));
          return true;
        }
        if (e.key === 'Escape') {
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
        {toolButton('draw', <IconPencil size={12} />, 'Draw: click to place the current pattern, drag to move')}
        {toolButton('paint', <IconBrush size={12} />, 'Paint: drag to place several clips')}
        {toolButton('delete', <IconEraser size={12} />, 'Delete (right mouse button works in every tool)')}
        {toolButton('select', <IconSelect size={12} />, 'Select: drag a rectangle')}
      </div>
      <select className="tb-select" value={view.snap} data-hint="Snap to grid" onChange={(e) => setView({ snap: e.target.value as SnapId })}>
        {SNAP_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s === 'none' ? 'No snap' : `Snap: ${s}`}
          </option>
        ))}
      </select>
      <span className="faint">Drag samples from the browser to create audio clips</span>
    </>
  );

  return (
    <WindowFrame id="playlist" title="Playlist" icon={<IconPlaylist />} toolbar={toolbar}>
      <div className="editor" onDragOver={onDragOver} onDragLeave={() => (dropHint.current = null)} onDrop={onDrop}>
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
              style={{ left: 24, top: renaming.y + 8, width: TRACK_W - 30 }}
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
