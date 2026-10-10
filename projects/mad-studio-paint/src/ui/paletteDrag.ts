/**
 * Dragging palettes like the reference: a tab dragged out of its title bar shows where it would go
 * (a red line or frame) – stacked with the palettes of another title bar, above or below a palette,
 * a new dock column at a dock's edge, or floating anywhere else. Floating palettes are moved by
 * their title bar (and docked when let go over a dock), resized from their corner; the edges
 * between docked palettes change their heights, a dock's inner edge its width.
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';
import type { DockColumn, DropTarget } from '../model/paletteLayout';
import type { PaletteId } from '../model/palettes';
import { changeFloating, currentLayout, dropPalette, resizeColumn, resizeStack } from '../store/paletteLayoutStore';

/** The red line or frame showing where a dragged palette goes (window px). */
export interface Indicator {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DragState {
  id: PaletteId;
  label: string;
  x: number;
  y: number;
  /** Floating palettes move themselves: no outline follows the pointer. */
  floating: boolean;
  target: DropTarget | null;
  indicator: Indicator | null;
  /** The palette a dragged one would be stacked with (shown red all over). */
  frame?: Indicator;
}

export const usePaletteDrag = create<{ drag: DragState | null }>(() => ({ drag: null }));

/** A tab let go after a drag is not clicked. */
let suppressUntil = 0;
export const clickSuppressed = () => performance.now() < suppressUntil;

const EDGE = 14;
const LINE = 3;

/** Where a palette dragged to a point of the window would go. */
export function dropTargetAt(x: number, y: number, size: { w: number; h: number }): { target: DropTarget; indicator: Indicator | null; frame?: Indicator } {
  // Floating where it is let go, kept inside the window.
  const w = Math.max(160, Math.min(size.w, 520));
  const h = Math.max(120, Math.min(size.h, 360));
  const fx = Math.max(0, Math.min(window.innerWidth - w, x - 40));
  const fy = Math.max(0, Math.min(window.innerHeight - h, y - 10));
  const float = { target: { kind: 'float', x: fx, y: fy, w, h } as DropTarget, indicator: null };
  if (currentLayout().lockPosition) return float;
  const els = document.elementsFromPoint(x, y).filter((el): el is HTMLElement => el instanceof HTMLElement);
  const columnEl = els.find((el) => el.dataset.dockColumn);
  const cr = columnEl?.getBoundingClientRect();
  // A dock's left or right edge (also beside a title bar): a new dock column there.
  if (columnEl && cr && (x < cr.left + EDGE || x > cr.right - EDGE)) {
    const after = x > cr.right - EDGE;
    return { target: { kind: 'column', column: columnEl.dataset.dockColumn!, after }, indicator: { x: (after ? cr.right : cr.left) - 1, y: cr.top, w: LINE, h: cr.height } };
  }
  // A title bar: stacked with its palettes (the whole palette shows red), before the tab under the pointer's left half.
  const header = els.find((el) => el.dataset.stackTabs);
  if (header) {
    const tabs = [...header.querySelectorAll<HTMLElement>('[data-palette-tab]')];
    const index = tabs.filter((t) => {
      const r = t.getBoundingClientRect();
      return r.left + r.width / 2 < x;
    }).length;
    const hr = header.getBoundingClientRect();
    const at = index < tabs.length ? tabs[index].getBoundingClientRect().left : tabs.length ? tabs[tabs.length - 1].getBoundingClientRect().right : hr.left;
    const sr = (header.closest('[data-dock-stack]') ?? header).getBoundingClientRect();
    return {
      target: { kind: 'tab', stack: header.dataset.stackTabs!, index },
      indicator: { x: at - 1, y: hr.top, w: LINE, h: hr.height },
      frame: { x: sr.left, y: sr.top, w: sr.width, h: sr.height },
    };
  }
  if (columnEl && cr) {
    const column = columnEl.dataset.dockColumn!;
    // Above or below a palette.
    const stacks = [...columnEl.querySelectorAll<HTMLElement>('[data-dock-stack]')];
    for (let i = 0; i < stacks.length; i++) {
      const r = stacks[i].getBoundingClientRect();
      if (y < r.top || y > r.bottom) continue;
      const below = y > r.top + r.height / 2;
      return { target: { kind: 'stack', column, index: below ? i + 1 : i }, indicator: { x: cr.left, y: (below ? r.bottom : r.top) - 1, w: cr.width, h: LINE } };
    }
    const last = stacks[stacks.length - 1]?.getBoundingClientRect();
    return { target: { kind: 'stack', column, index: stacks.length }, indicator: { x: cr.left, y: (last ? last.bottom : cr.top) - 1, w: cr.width, h: LINE } };
  }
  return float;
}

/** Calls `move` while the pointer moves and `up` when it is let go. */
function track(move: (e: PointerEvent) => void, up: (e: PointerEvent) => void): void {
  const m = (e: PointerEvent) => move(e);
  const u = (e: PointerEvent) => {
    window.removeEventListener('pointermove', m);
    window.removeEventListener('pointerup', u);
    window.removeEventListener('pointercancel', u);
    up(e);
  };
  window.addEventListener('pointermove', m);
  window.addEventListener('pointerup', u);
  window.addEventListener('pointercancel', u);
}

/** A docked palette's tab pressed: dragged a little, the palette moves. */
export function beginTabDrag(e: ReactPointerEvent, id: PaletteId, label: string, size: { w: number; h: number }): void {
  if (e.button !== 0 || currentLayout().lockPosition) return;
  const sx = e.clientX;
  const sy = e.clientY;
  let started = false;
  track(
    (ev) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      started = true;
      const t = dropTargetAt(ev.clientX, ev.clientY, size);
      usePaletteDrag.setState({ drag: { id, label, x: ev.clientX, y: ev.clientY, floating: false, ...t } });
    },
    () => {
      const d = usePaletteDrag.getState().drag;
      usePaletteDrag.setState({ drag: null });
      if (!started || !d?.target) return;
      suppressUntil = performance.now() + 300;
      dropPalette(id, d.target);
    },
  );
}

/** A floating palette's title bar dragged: it moves; let go over a dock, it is docked there. */
export function beginFloatingMove(e: ReactPointerEvent, id: PaletteId, label: string, rect: { x: number; y: number; w: number; h: number }): void {
  if (e.button !== 0) return;
  const sx = e.clientX;
  const sy = e.clientY;
  track(
    (ev) => {
      changeFloating(id, { x: Math.round(rect.x + ev.clientX - sx), y: Math.max(0, Math.round(rect.y + ev.clientY - sy)) });
      const t = dropTargetAt(ev.clientX, ev.clientY, rect);
      const docking = t.target.kind !== 'float';
      usePaletteDrag.setState({ drag: { id, label, x: ev.clientX, y: ev.clientY, floating: true, target: docking ? t.target : null, indicator: docking ? t.indicator : null, frame: docking ? t.frame : undefined } });
    },
    () => {
      const d = usePaletteDrag.getState().drag;
      usePaletteDrag.setState({ drag: null });
      if (d?.target) dropPalette(id, d.target);
    },
  );
}

/** A floating palette's corner dragged: its size. */
export function beginFloatingResize(e: ReactPointerEvent, id: PaletteId, rect: { w: number; h: number }): void {
  if (e.button !== 0) return;
  e.stopPropagation();
  const sx = e.clientX;
  const sy = e.clientY;
  track(
    (ev) => changeFloating(id, { w: Math.max(160, Math.round(rect.w + ev.clientX - sx)), h: Math.max(80, Math.round(rect.h + ev.clientY - sy)) }),
    () => {},
  );
}

/**
 * The edge under a docked palette dragged: its height (the palette taking the height left in the
 * column gives the change to the one below instead).
 */
export function beginStackResize(e: ReactPointerEvent, column: DockColumn, index: number): void {
  if (e.button !== 0 || currentLayout().lockHeight) return;
  e.preventDefault();
  const els = [...document.querySelectorAll<HTMLElement>(`[data-dock-column="${column.id}"] [data-dock-stack]`)];
  const a = column.stacks[index];
  const b = column.stacks[index + 1];
  if (!a || !b || !els[index] || !els[index + 1]) return;
  const ha = els[index].getBoundingClientRect().height;
  const hb = els[index + 1].getBoundingClientRect().height;
  const sy = e.clientY;
  track(
    (ev) => {
      const dy = ev.clientY - sy;
      if (!a.grow) resizeStack(a.id, ha + dy);
      else resizeStack(b.id, hb - dy);
    },
    () => {},
  );
}

/** A dock's edge next to the canvas dragged: its width. */
export function beginColumnResize(e: ReactPointerEvent, column: DockColumn): void {
  if (e.button !== 0 || currentLayout().fixWidth) return;
  e.preventDefault();
  const sx = e.clientX;
  const w0 = column.width;
  track(
    (ev) => resizeColumn(column.id, w0 + (column.side === 'left' ? ev.clientX - sx : sx - ev.clientX)),
    () => {},
  );
}
