/**
 * Intermediate Color and Approximate Color palettes, like the reference's: a grid of colour tiles
 * (click picks the drawing colour; hovering shows the tile's values at the bottom left, a click
 * there switches between RGB and HSV/HLS, as the Color Wheel is set). Intermediate Color mixes the
 * four corner colours (click a corner to give it the drawing colour); Approximate Color shows the
 * colours around the drawing colour along two properties chosen at the ends of its sliders. The
 * palette menu sets grid divisions (10/20/30) or a tile width (7/10/15 pt) and grid lines.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { hexToRgb, rgbToHex, rgbToHls, rgbToHsv, type RGB } from '../../model/color';
import { APPROX_AXES, approximateColor, intermediateColor, middleTile, tilesAcross, type ApproxAxis, type ApproxSlider, type TileGrid } from '../../paint/colorGrids';
import * as actions from '../../store/actions';
import { drawingColor, getState, setState, useStore } from '../../store/store';
import { showMenu, type MenuItem } from '../overlays';

/** The size of an element, followed as it changes. */
function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

interface TilesProps {
  cols: number;
  rows: number;
  /** Tile size in CSS px. */
  tile: number;
  color: (col: number, row: number) => RGB;
  showGrid: boolean;
  /** The tile drawn with a red frame (the drawing colour). */
  marked?: { col: number; row: number };
  onHover: (c: RGB | null) => void;
  testId: string;
}

/** The tiles, drawn on a canvas; click picks one as the drawing colour. */
function Tiles({ cols, rows, tile, color, showGrid, marked, onHover, testId }: TilesProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = Math.max(1, Math.round(cols * tile));
  const h = Math.max(1, Math.round(rows * tile));
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        g.fillStyle = rgbToHex(color(col, row));
        g.fillRect(col * tile, row * tile, tile + 0.5, tile + 0.5);
      }
    if (showGrid) {
      g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      g.lineWidth = 1;
      g.beginPath();
      for (let col = 1; col < cols; col++) {
        const x = Math.round(col * tile) + 0.5;
        g.moveTo(x, 0);
        g.lineTo(x, h);
      }
      for (let row = 1; row < rows; row++) {
        const y = Math.round(row * tile) + 0.5;
        g.moveTo(0, y);
        g.lineTo(w, y);
      }
      g.stroke();
    }
    if (marked) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 3;
      g.strokeRect(marked.col * tile + 1, marked.row * tile + 1, tile - 2, tile - 2);
      g.strokeStyle = '#e5484d';
      g.lineWidth = 1.5;
      g.strokeRect(marked.col * tile + 1, marked.row * tile + 1, tile - 2, tile - 2);
    }
  }, [w, h, cols, rows, tile, color, showGrid, marked]);
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const col = Math.min(cols - 1, Math.max(0, Math.floor(((e.clientX - b.left) / b.width) * cols)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(((e.clientY - b.top) / b.height) * rows)));
    return color(col, row);
  };
  return (
    <canvas
      ref={ref}
      className="tile-grid"
      data-testid={testId}
      data-cols={cols}
      data-rows={rows}
      style={{ width: w, height: h }}
      onPointerMove={(e) => onHover(at(e))}
      onPointerLeave={() => onHover(null)}
      onPointerDown={(e) => {
        if (e.button === 0) actions.setDrawingColor(rgbToHex(at(e)));
      }}
    />
  );
}

/** The values of a colour at the bottom left: RGB, or (clicked) HSV / HLS as the Color Wheel is set. */
function Readout({ rgb }: { rgb: RGB }) {
  const space = useStore((s) => s.colorSpace);
  const [mode, setMode] = useState<'rgb' | 'space'>('rgb');
  const text =
    mode === 'rgb'
      ? null
      : space === 'hsv'
        ? (() => {
            const v = rgbToHsv(rgb);
            return `H ${Math.round(v.h)} S ${Math.round(v.s * 100)} V ${Math.round(v.v * 100)}`;
          })()
        : (() => {
            const v = rgbToHls(rgb);
            return `H ${Math.round(v.h)} L ${Math.round(v.l * 100)} S ${Math.round(v.s * 100)}`;
          })();
  return (
    <button className="rgb-readout tile-readout" data-testid="tile-readout" title="Click to switch between RGB and HSV/HLS values" onClick={() => setMode((m) => (m === 'rgb' ? 'space' : 'rgb'))}>
      {text ?? (
        <>
          <i style={{ background: '#d33' }} />
          {rgb.r} <i style={{ background: '#3a3' }} />
          {rgb.g} <i style={{ background: '#36d' }} />
          {rgb.b}
        </>
      )}
    </button>
  );
}

/** The palette menu items both palettes share (Grid divisions, Tile width, Show grid). */
function gridMenu(grid: TileGrid, set: (g: TileGrid) => void): MenuItem[] {
  return [
    ...([10, 20, 30] as const).map((n) => ({ label: `Grid divisions into ${n} parts`, checked: grid.mode === 'divisions' && grid.divisions === n, onClick: () => set({ ...grid, mode: 'divisions', divisions: n }) })),
    { separator: true },
    ...(
      [
        [7, 'Small'],
        [10, 'Medium'],
        [15, 'Large'],
      ] as const
    ).map(([pt, name]) => ({ label: `Tile width ${name} (${pt}pt)`, checked: grid.mode === 'width' && grid.tileWidth === pt, onClick: () => set({ ...grid, mode: 'width', tileWidth: pt }) })),
    { separator: true },
    { label: 'Show grid', checked: grid.showGrid, onClick: () => set({ ...grid, showGrid: !grid.showGrid }) },
  ];
}

const rgbOf = (hex: string): RGB => hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };

// ------------------------------------------------------------------ Intermediate Color

export function intermediateMenu(): MenuItem[] {
  const s = getState().intermediate;
  return gridMenu(s.grid, (grid) => setState((st) => ({ intermediate: { ...st.intermediate, grid } })));
}

export function IntermediateColor() {
  const { corners, grid } = useStore((s) => s.intermediate);
  const current = useStore((s) => drawingColor(s.colors));
  const [hover, setHover] = useState<RGB | null>(null);
  const [box, size] = useSize<HTMLDivElement>();
  // The corner swatches overlap the corners of the grid: room for them around it.
  const room = Math.max(0, Math.min(size.w, size.h) - 16);
  const across = Math.max(2, tilesAcross(grid, room));
  const tile = across ? room / across : 0;
  // One function per grid, so hovering does not redraw the tiles.
  const key = corners.join();
  const color = useCallback((col: number, row: number) => intermediateColor(key.split(',').map(rgbOf), col, row, across, across), [key, across]);
  const setCorner = (i: number) => setState((s) => ({ intermediate: { ...s.intermediate, corners: s.intermediate.corners.map((c, k) => (k === i ? current : c)) as typeof corners } }));
  const names = ['top left', 'top right', 'bottom left', 'bottom right'];
  return (
    <div className="tile-palette" data-testid="intermediate-color">
      <div ref={box} className="tile-box">
        {tile > 0 && (
          <div className="tile-frame">
            <Tiles cols={across} rows={across} tile={tile} color={color} showGrid={grid.showGrid} onHover={setHover} testId="intermediate-tiles" />
            {corners.map((c, i) => (
              <button
                key={i}
                className={`tile-corner c${i}`}
                style={{ background: c }}
                title={`${names[i]} colour ${c}: click to set it to the drawing colour`}
                aria-label={`Set the ${names[i]} colour`}
                onClick={() => setCorner(i)}
              />
            ))}
          </div>
        )}
      </div>
      <div className="tile-footer">
        <Readout rgb={hover ?? rgbOf(current)} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Approximate Color

export function approximateMenu(): MenuItem[] {
  const s = getState().approximate;
  return gridMenu(s.grid, (grid) => setState((st) => ({ approximate: { ...st.approximate, grid } })));
}

/** A slider of the Approximate Color palette: drag to set its range; the letters at its end choose the property. */
function RangeSlider({ which, value, vertical }: { which: 'x' | 'y'; value: ApproxSlider; vertical?: boolean }) {
  const set = (patch: Partial<ApproxSlider>) => setState((s) => ({ approximate: { ...s.approximate, [which]: { ...s.approximate[which], ...patch } } }));
  const letter = APPROX_AXES.find(([id]) => id === value.axis)?.[2] ?? '';
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const track = e.currentTarget;
    track.setPointerCapture(e.pointerId);
    const at = (ev: { clientX: number; clientY: number }) => {
      const b = track.getBoundingClientRect();
      const t = vertical ? (b.bottom - ev.clientY) / b.height : (ev.clientX - b.left) / b.width;
      set({ range: Math.round(Math.min(1, Math.max(0, t)) * 100) / 100 });
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
  };
  const pct = Math.round(value.range * 100);
  return (
    <div className={`approx-slider ${vertical ? 'vertical' : ''}`}>
      <div
        className="approx-track"
        role="slider"
        aria-label={`${which === 'x' ? 'Horizontal' : 'Vertical'} range`}
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        tabIndex={0}
        onPointerDown={drag}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.01 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.01 : 0;
          if (step) {
            e.preventDefault();
            set({ range: Math.round(Math.min(1, Math.max(0, value.range + step)) * 100) / 100 });
          }
        }}
      >
        <span className="approx-knob" style={vertical ? { bottom: `${pct}%` } : { left: `${pct}%` }} />
      </div>
      <button
        className="approx-axis"
        title="Choose the property this slider changes"
        aria-label={`${which === 'x' ? 'Horizontal' : 'Vertical'} property`}
        onClick={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          showMenu(
            { x: b.left, y: b.bottom + 2 },
            APPROX_AXES.map(([id, name]) => ({ label: name, checked: id === value.axis, onClick: () => set({ axis: id as ApproxAxis }) })),
          );
        }}
      >
        {letter} {pct} %
      </button>
    </div>
  );
}

export function ApproximateColor() {
  const settings = useStore((s) => s.approximate);
  const current = useStore((s) => drawingColor(s.colors));
  const [hover, setHover] = useState<RGB | null>(null);
  const [box, size] = useSize<HTMLDivElement>();
  const base = rgbOf(current);
  const cols = Math.max(3, tilesAcross(settings.grid, size.w));
  const tile = cols ? size.w / cols : 0;
  const rows = tile > 0 ? Math.max(3, Math.floor(size.h / tile)) : 0;
  const { col: midCol, row: midRow } = middleTile(cols, rows);
  const mid = useMemo(() => ({ col: midCol, row: midRow }), [midCol, midRow]);
  // One function per grid, so hovering does not redraw the tiles.
  const color = useCallback((col: number, row: number) => approximateColor(rgbOf(current), settings, col, row, cols, rows), [current, settings, cols, rows]);
  return (
    <div className="tile-palette" data-testid="approximate-color">
      <RangeSlider which="x" value={settings.x} />
      <div className="approx-body">
        <RangeSlider which="y" value={settings.y} vertical />
        <div ref={box} className="tile-box">
          {tile > 0 && rows > 0 && <Tiles cols={cols} rows={rows} tile={tile} color={color} showGrid={settings.grid.showGrid} marked={mid} onHover={setHover} testId="approximate-tiles" />}
        </div>
      </div>
      <div className="tile-footer">
        <Readout rgb={hover ?? base} />
      </div>
    </div>
  );
}
