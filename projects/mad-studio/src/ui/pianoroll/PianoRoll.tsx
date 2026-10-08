import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { engine } from '../../audio/engine';
import { findPattern, patternLength } from '../../model/patterns';
import { PPQ, SNAP_OPTIONS, noteName, snapFloor, snapRound, snapTicks, type SnapId } from '../../model/timing';
import type { Note } from '../../model/types';
import {
  addNotes,
  deleteNotes,
  endCoalesce,
  gestureKey,
  selectChannel,
  setUi,
  updateNotes,
} from '../../store/actions';
import { useStore, type ToolId } from '../../store/store';
import { prepareCanvas, useElementSize, useFrame } from '../animation';
import { IconBrush, IconEraser, IconGhost, IconPencil, IconPiano, IconSelect } from '../controls/Icons';
import { setHint } from '../hint';
import { registerWindowKeys } from '../keyboard';
import { WindowFrame } from '../workspace/WindowFrame';
import { KEYS_W, RULER_H, VEL_H, drawRoll, gridBottom, keyAtY, maxScrollY, tickAtX, xOfTick, type RollView } from './draw';

const EMPTY: Note[] = [];
const RESIZE_ZONE = 6;

type Drag =
  | { kind: 'move'; key: string; anchor: string; originTick: number; originKey: number; orig: Map<string, Note>; lastKey: number }
  | { kind: 'resize'; key: string; anchor: string; originTick: number; orig: Map<string, Note> }
  | { kind: 'delete'; key: string }
  | { kind: 'rubber'; t0: number; k0: number; t1: number; k1: number; base: Set<string> }
  | { kind: 'paint'; key: string; row: number; last: number }
  | { kind: 'keys'; handle: number; note: number }
  | { kind: 'velocity'; key: string }
  | { kind: 'pan'; x: number; y: number; scrollTick: number; scrollY: number };

let clipboard: Omit<Note, 'id'>[] = [];

export function PianoRoll() {
  const channelId = useStore((s) => s.ui.pianoRollChannelId);
  const channels = useStore((s) => s.project.channels);
  const channel = channels.find((c) => c.id === channelId) ?? null;
  const patternId = useStore((s) => s.ui.selectedPatternId);
  const pattern = useStore((s) => findPattern(s.project, s.ui.selectedPatternId));
  const beatsPerBar = useStore((s) => s.project.beatsPerBar);
  const view = useStore((s) => s.ui.pianoRoll);
  const notes = (pattern && channel ? pattern.notes[channel.id] : undefined) ?? EMPTY;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const preview = useRef<number | null>(null);
  const lastClick = useRef<number | null>(null);
  const dirty = useRef(true);
  const lastPlayhead = useRef<number | null>(null);

  const grid = snapTicks(view.snap, beatsPerBar);
  const patLen = pattern ? patternLength(pattern, beatsPerBar) : PPQ * beatsPerBar;

  const rollView: RollView = useMemo(
    () => ({ width: size.width, height: size.height, pxPerTick: view.pxPerTick, rowHeight: view.rowHeight, scrollTick: view.scrollTick, scrollY: view.scrollY }),
    [size.width, size.height, view.pxPerTick, view.rowHeight, view.scrollTick, view.scrollY],
  );

  const ghosts = useMemo(() => {
    if (!view.ghostNotes || !pattern) return [];
    return channels
      .filter((c) => c.id !== channel?.id && pattern.notes[c.id]?.length)
      .map((c) => ({ notes: pattern.notes[c.id], color: c.color }));
  }, [view.ghostNotes, pattern, channels, channel?.id]);

  // Everything the canvas needs, read by the animation loop.
  const scene = useRef({ rollView, notes, selected, ghosts, color: channel?.color ?? '#888', patLen, beatsPerBar, pressed: null as number | null });
  scene.current = { ...scene.current, rollView, notes, selected, ghosts, color: channel?.color ?? '#888', patLen, beatsPerBar };
  dirty.current = true;

  useEffect(() => setSelected(new Set()), [channelId, patternId]);

  useFrame(() => {
    const canvas = canvasRef.current;
    const sc = scene.current;
    if (!canvas || sc.rollView.width <= 0) return;
    const playing = useStore.getState().transport.playing;
    const playhead = playing ? engine.patternTick() : null;
    if (!dirty.current && playhead === lastPlayhead.current) return;
    lastPlayhead.current = playhead;
    dirty.current = false;
    const ctx = prepareCanvas(canvas, sc.rollView.width, sc.rollView.height);
    if (!ctx) return;
    const d = drag.current;
    drawRoll(ctx, sc.rollView, {
      notes: sc.notes,
      ghosts: sc.ghosts,
      selected: sc.selected,
      color: sc.color,
      beatsPerBar: sc.beatsPerBar,
      patternLength: sc.patLen,
      playhead,
      rubber: d?.kind === 'rubber' ? { t0: d.t0, t1: d.t1, k0: d.k0, k1: d.k1 } : null,
      pressedKey: sc.pressed,
    });
  });

  const setView = (patch: Partial<typeof view>) =>
    setUi((d) => {
      Object.assign(d.pianoRoll, patch);
      d.pianoRoll.scrollTick = Math.max(0, d.pianoRoll.scrollTick);
      const v = { ...rollView, rowHeight: d.pianoRoll.rowHeight };
      d.pianoRoll.scrollY = Math.max(0, Math.min(maxScrollY(v), d.pianoRoll.scrollY));
    });

  // ------------------------------------------------------------ helpers

  const startPreview = (key: number, velocity = 0.78) => {
    stopPreview();
    if (channel) preview.current = engine.noteOn(channel.id, key, velocity);
  };
  const stopPreview = () => {
    if (preview.current !== null) engine.noteOff(preview.current);
    preview.current = null;
  };

  const noteAt = (x: number, y: number): { note: Note; edge: boolean } | null => {
    const key = keyAtY(rollView, y);
    const tick = tickAtX(rollView, x);
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.key !== key) continue;
      if (tick >= n.start && tick < n.start + n.length) {
        const right = xOfTick(rollView, n.start + n.length);
        return { note: n, edge: right - x <= RESIZE_ZONE && n.length * rollView.pxPerTick > RESIZE_ZONE * 2 };
      }
    }
    return null;
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const setVelocityAt = (x: number, y: number, key: string) => {
    const laneTop = gridBottom(rollView) + 8;
    const laneH = VEL_H - 14;
    const vel = Math.min(1, Math.max(0.02, (laneTop + laneH - y) / laneH));
    const tol = Math.max(3 / rollView.pxPerTick, 2);
    const tick = tickAtX(rollView, x);
    if (!channel) return;
    updateNotes(
      patternId,
      channel.id,
      (list) => {
        for (const n of list) {
          if (selected.size > 0 && !selected.has(n.id)) continue;
          if (Math.abs(n.start - tick) <= tol) n.velocity = vel;
        }
      },
      { coalesce: key },
    );
    setHint(`Velocity: ${Math.round(vel * 127)}`);
  };

  // ------------------------------------------------------------ pointer input

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!channel || !pattern) return;
    const { x, y } = local(e);
    const bottom = gridBottom(rollView);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();

    if (e.button === 1) {
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, scrollTick: view.scrollTick, scrollY: view.scrollY };
      return;
    }
    if (y > bottom) {
      const key = gestureKey('velocity');
      drag.current = { kind: 'velocity', key };
      setVelocityAt(x, y, key);
      return;
    }
    if (y < RULER_H) return;
    if (x < KEYS_W) {
      const key = keyAtY(rollView, y);
      scene.current.pressed = key;
      drag.current = { kind: 'keys', handle: engine.noteOn(channel.id, key, 0.8), note: key };
      return;
    }

    const tick = tickAtX(rollView, x);
    const key = keyAtY(rollView, y);
    const g = e.altKey ? 1 : grid;
    lastClick.current = snapFloor(Math.max(0, tick), g);
    const hit = noteAt(x, y);
    const tool: ToolId = e.button === 2 ? 'delete' : view.tool;

    if (tool === 'delete') {
      const gk = gestureKey('erase');
      drag.current = { kind: 'delete', key: gk };
      if (hit) deleteNotes(patternId, channel.id, [hit.note.id], { coalesce: gk });
      return;
    }
    if ((e.metaKey || e.ctrlKey || tool === 'select') && !hit) {
      const base = e.shiftKey ? new Set(selected) : new Set<string>();
      drag.current = { kind: 'rubber', t0: tick, k0: key, t1: tick, k1: key, base };
      setSelected(base);
      return;
    }
    if (hit) {
      let sel = selected;
      if (e.shiftKey) {
        sel = new Set(selected);
        if (sel.has(hit.note.id)) sel.delete(hit.note.id);
        else sel.add(hit.note.id);
      } else if (!selected.has(hit.note.id)) sel = new Set([hit.note.id]);
      setSelected(sel);
      const ids = sel.has(hit.note.id) ? sel : new Set([hit.note.id]);
      const orig = new Map(notes.filter((n) => ids.has(n.id)).map((n) => [n.id, { ...n }]));
      if (hit.edge) {
        drag.current = { kind: 'resize', key: gestureKey('resize'), anchor: hit.note.id, originTick: tick, orig };
      } else {
        startPreview(hit.note.key, hit.note.velocity);
        drag.current = { kind: 'move', key: gestureKey('move'), anchor: hit.note.id, originTick: tick, originKey: key, orig, lastKey: hit.note.key };
      }
      return;
    }
    if (tool === 'paint') {
      const gk = gestureKey('paint');
      const start = snapFloor(Math.max(0, tick), g);
      addNotes(patternId, channel.id, [{ key, start, length: view.noteLength, velocity: 0.78 }], { coalesce: gk });
      startPreview(key);
      drag.current = { kind: 'paint', key: gk, row: key, last: start };
      return;
    }
    // Draw: create a note and keep dragging it.
    const gk = gestureKey('draw');
    const start = snapFloor(Math.max(0, tick), g);
    const [id] = addNotes(patternId, channel.id, [{ key, start, length: view.noteLength, velocity: 0.78 }], { coalesce: gk });
    setSelected(new Set([id]));
    startPreview(key);
    drag.current = {
      kind: 'move',
      key: gk,
      anchor: id,
      originTick: tick,
      originKey: key,
      orig: new Map([[id, { id, key, start, length: view.noteLength, velocity: 0.78 }]]),
      lastKey: key,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const { x, y } = local(e);
    if (!d) {
      if (x > KEYS_W && y > RULER_H && y < gridBottom(rollView)) {
        const hit = noteAt(x, y);
        e.currentTarget.style.cursor = hit?.edge ? 'ew-resize' : hit ? 'move' : view.tool === 'delete' ? 'not-allowed' : 'crosshair';
        setHint(hit ? `${noteName(hit.note.key)} · velocity ${Math.round(hit.note.velocity * 127)}` : `${noteName(keyAtY(rollView, y))}`);
      } else e.currentTarget.style.cursor = 'default';
      return;
    }
    if (!channel) return;
    const g = e.altKey ? 1 : grid;
    const tick = tickAtX(rollView, x);
    const key = keyAtY(rollView, y);
    switch (d.kind) {
      case 'pan':
        setView({ scrollTick: d.scrollTick - (e.clientX - d.x) / view.pxPerTick, scrollY: d.scrollY - (e.clientY - d.y) });
        break;
      case 'velocity':
        setVelocityAt(x, y, d.key);
        break;
      case 'keys':
        if (key !== d.note && y > RULER_H && y < gridBottom(rollView)) {
          engine.noteOff(d.handle);
          d.handle = engine.noteOn(channel.id, key, 0.8);
          d.note = key;
          scene.current.pressed = key;
        }
        break;
      case 'delete': {
        const hit = noteAt(x, y);
        if (hit) deleteNotes(patternId, channel.id, [hit.note.id], { coalesce: d.key });
        break;
      }
      case 'rubber': {
        d.t1 = tick;
        d.k1 = key;
        const t0 = Math.min(d.t0, d.t1);
        const t1 = Math.max(d.t0, d.t1);
        const k0 = Math.min(d.k0, d.k1);
        const k1 = Math.max(d.k0, d.k1);
        const next = new Set(d.base);
        for (const n of notes) if (n.key >= k0 && n.key <= k1 && n.start < t1 && n.start + n.length > t0) next.add(n.id);
        setSelected(next);
        break;
      }
      case 'paint': {
        const start = snapFloor(Math.max(0, tick), g);
        if (start !== d.last && !notes.some((n) => n.key === d.row && n.start === start)) {
          d.last = start;
          addNotes(patternId, channel.id, [{ key: d.row, start, length: view.noteLength, velocity: 0.78 }], { coalesce: d.key });
        }
        break;
      }
      case 'move': {
        const anchor = d.orig.get(d.anchor);
        if (!anchor) break;
        const rawStart = anchor.start + (tick - d.originTick);
        const dt = Math.max(-Math.min(...[...d.orig.values()].map((n) => n.start)), snapRound(rawStart, g) - anchor.start);
        let dk = key - d.originKey;
        const keys = [...d.orig.values()].map((n) => n.key);
        dk = Math.max(-Math.min(...keys), Math.min(127 - Math.max(...keys), dk));
        updateNotes(
          patternId,
          channel.id,
          (list) => {
            for (const n of list) {
              const o = d.orig.get(n.id);
              if (!o) continue;
              n.start = o.start + dt;
              n.key = o.key + dk;
            }
          },
          { coalesce: d.key },
        );
        const newKey = anchor.key + dk;
        if (newKey !== d.lastKey) {
          d.lastKey = newKey;
          startPreview(newKey, anchor.velocity);
        }
        setHint(`${noteName(newKey)} @ ${((anchor.start + dt) / PPQ / beatsPerBar + 1).toFixed(2)}`);
        break;
      }
      case 'resize': {
        const anchor = d.orig.get(d.anchor);
        if (!anchor) break;
        const end = snapRound(anchor.start + anchor.length + (tick - d.originTick), g);
        const delta = Math.max(g, end - anchor.start) - anchor.length;
        updateNotes(
          patternId,
          channel.id,
          (list) => {
            for (const n of list) {
              const o = d.orig.get(n.id);
              if (o) n.length = Math.max(Math.min(g, o.length), o.length + delta);
            }
          },
          { coalesce: d.key },
        );
        break;
      }
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    stopPreview();
    if (d?.kind === 'keys') {
      engine.noteOff(d.handle);
      scene.current.pressed = null;
    }
    if (d?.kind === 'resize' || d?.kind === 'move') {
      const n = useStore.getState().project.patterns.find((p) => p.id === patternId)?.notes[channelId ?? '']?.find((x) => x.id === d.anchor);
      if (n && d.kind === 'resize') setView({ noteLength: n.length });
    }
    endCoalesce();
    dirty.current = true;
  };

  const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
    const { x } = local(e);
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.0025);
      const px = Math.min(10, Math.max(0.04, view.pxPerTick * factor));
      const anchorTick = tickAtX(rollView, x);
      setView({ pxPerTick: px, scrollTick: anchorTick - (x - KEYS_W) / px });
    } else if (e.altKey) {
      const rh = Math.min(30, Math.max(6, Math.round(view.rowHeight + (e.deltaY < 0 ? 1 : -1))));
      setView({ rowHeight: rh, scrollY: (view.scrollY / view.rowHeight) * rh });
    } else if (e.shiftKey) {
      setView({ scrollTick: view.scrollTick + (e.deltaY + e.deltaX) / view.pxPerTick });
    } else {
      setView({ scrollTick: view.scrollTick + e.deltaX / view.pxPerTick, scrollY: view.scrollY + e.deltaY });
    }
  };

  // ------------------------------------------------------------ keyboard

  const keyState = useRef({ notes, selected, channel, patternId, grid, beatsPerBar });
  keyState.current = { notes, selected, channel, patternId, grid, beatsPerBar };
  useEffect(
    () =>
      registerWindowKeys('pianoRoll', (e) => {
        const { notes: list, selected: sel, channel: ch, patternId: pid, grid: g } = keyState.current;
        if (!ch) return false;
        const mod = e.metaKey || e.ctrlKey;
        const chosen = list.filter((n) => sel.has(n.id));
        if ((e.key === 'Delete' || e.key === 'Backspace') && chosen.length) {
          deleteNotes(pid, ch.id, chosen.map((n) => n.id));
          setSelected(new Set());
          return true;
        }
        if (mod && e.code === 'KeyA') {
          setSelected(new Set(list.map((n) => n.id)));
          return true;
        }
        if (mod && (e.code === 'KeyC' || e.code === 'KeyX') && chosen.length) {
          const min = Math.min(...chosen.map((n) => n.start));
          clipboard = chosen.map(({ id: _id, ...n }) => ({ ...n, start: n.start - min }));
          if (e.code === 'KeyX') {
            deleteNotes(pid, ch.id, chosen.map((n) => n.id));
            setSelected(new Set());
          }
          lastClick.current = lastClick.current ?? min;
          return true;
        }
        if (mod && e.code === 'KeyV' && clipboard.length) {
          const at = lastClick.current ?? 0;
          const ids = addNotes(pid, ch.id, clipboard.map((n) => ({ ...n, start: n.start + at })));
          setSelected(new Set(ids));
          return true;
        }
        if (mod && (e.code === 'KeyB' || e.code === 'KeyD') && chosen.length) {
          const min = Math.min(...chosen.map((n) => n.start));
          const max = Math.max(...chosen.map((n) => n.start + n.length));
          const shift = Math.max(PPQ, Math.ceil((max - min) / PPQ) * PPQ);
          const ids = addNotes(pid, ch.id, chosen.map(({ id: _id, ...n }) => ({ ...n, start: n.start + shift })));
          setSelected(new Set(ids));
          return true;
        }
        // FL Studio tool keys: P draw, B paint, D delete, E select.
        if (!mod && !e.altKey && !e.shiftKey) {
          const tool = ({ KeyP: 'draw', KeyB: 'paint', KeyD: 'delete', KeyE: 'select' } as const)[e.code as 'KeyP'];
          if (tool) {
            setUi((d) => void (d.pianoRoll.tool = tool));
            return true;
          }
        }
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && chosen.length) {
          // Ctrl/Cmd+Up/Down transposes by an octave (FL), Shift as well.
          const dk = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey || mod ? 12 : 1);
          updateNotes(pid, ch.id, (l) => {
            for (const n of l) if (sel.has(n.id)) n.key += dk;
          });
          return true;
        }
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && chosen.length && !mod) {
          const dt = (e.key === 'ArrowRight' ? 1 : -1) * g;
          updateNotes(pid, ch.id, (l) => {
            for (const n of l) if (sel.has(n.id)) n.start = Math.max(0, n.start + dt);
          });
          return true;
        }
        if (e.code === 'KeyQ' && !mod) {
          // Q and FL Studio's Alt+Q both quantize.
          quantize(pid, ch.id, sel, g);
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
      <select
        className="tb-select"
        value={channel?.id ?? ''}
        data-hint="Channel being edited"
        onChange={(e) => {
          setUi((d) => {
            d.pianoRollChannelId = e.target.value;
          });
          selectChannel(e.target.value);
        }}
      >
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <div className="seg">
        {toolButton('draw', <IconPencil size={12} />, 'Draw tool: click to add, drag to move')}
        {toolButton('paint', <IconBrush size={12} />, 'Paint tool: drag to paint notes')}
        {toolButton('delete', <IconEraser size={12} />, 'Delete tool (right mouse button works in every tool)')}
        {toolButton('select', <IconSelect size={12} />, 'Select tool: drag a rectangle')}
      </div>
      <select className="tb-select" value={view.snap} data-hint="Snap to grid" onChange={(e) => setView({ snap: e.target.value as SnapId })}>
        {SNAP_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s === 'none' ? 'No snap' : `Snap: ${s}`}
          </option>
        ))}
      </select>
      <button className={`icon-btn ${view.ghostNotes ? 'active' : ''}`} data-hint="Ghost notes of other channels" onClick={() => setView({ ghostNotes: !view.ghostNotes })}>
        <IconGhost size={13} />
      </button>
      <button className="btn" data-hint="Quantize selected notes (or all) to the snap grid (Q)" onClick={() => channel && quantize(patternId, channel.id, selected, grid)}>
        Quantize
      </button>
    </>
  );

  return (
    <WindowFrame id="pianoRoll" title={`Piano roll${channel ? ` – ${channel.name}` : ''}`} icon={<IconPiano />} toolbar={toolbar} accent={channel?.color}>
      <div className="editor">
        <div className="editor-canvas-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
          />
          {!channel && <div className="editor-empty">Add a channel in the channel rack to start writing notes.</div>}
        </div>
      </div>
    </WindowFrame>
  );
}

function quantize(patternId: string, channelId: string, selected: Set<string>, grid: number): void {
  updateNotes(patternId, channelId, (list) => {
    for (const n of list) if (selected.size === 0 || selected.has(n.id)) n.start = snapRound(n.start, grid);
  });
}

