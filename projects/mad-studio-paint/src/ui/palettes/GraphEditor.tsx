/**
 * Graph Editor (Timeline palette; Animation > Animation curve > Graph Editor): the current track's
 * settings as curves over time, X red, Y green and the others (rotation, opacity, volume) orange,
 * on one value axis (scale ratio, opacity and volume in %).
 *
 * Click a keyframe to select it (Ctrl/⌘: in or out of the selection); drag to move the selected
 * ones (Shift: along the direction first dragged; Ctrl/⌘+Shift: stretch them, in time from the
 * leftmost one or in value about 0); drag a slope handle to bend the curve (paired handles turn
 * together unless Unpair handles is on); drag a curve elsewhere to move all of it; Alt+click a
 * curve adds a keyframe on that curve only, Alt+click a keyframe removes it; drag the background
 * to select keyframes inside (Shift adds). The wheel zooms the values, the right button drags them;
 * with Drag to zoom on, dragging right zooms in and dragging left out.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { keysOn, maskOwner } from '../../model/animation';
import {
  addCurvePoint,
  curveHandles,
  curveInterp,
  GROUPS,
  keysOf,
  moveCurvePoints,
  removeChannels,
  scaleCurvePoints,
  segmentHandles,
  setHandle,
  TRANSFORM_GROUPS,
  type Channel,
  type ChannelGroup,
  type CurvePoint,
  type Keyframe,
} from '../../paint/keyframes';
import * as anim from '../../store/animationActions';
import { getState, setState, useStore, type CurveRef } from '../../store/store';
import { Icon } from '../controls/Icons';

type Axis = 'x' | 'y' | 'other';
export const AXIS_COLORS: Record<Axis, string> = { x: '#e5484d', y: '#3fb950', other: '#f0883e' };
const AXIS: Record<Channel, Axis> = { x: 'x', y: 'y', scaleX: 'x', scaleY: 'y', rotation: 'other', pivotX: 'x', pivotY: 'y', opacity: 'other', volume: 'other' };
/** Display units: scale ratio, opacity and volume in %. */
const UNIT: Record<Channel, number> = { x: 1, y: 1, scaleX: 100, scaleY: 100, rotation: 1, pivotX: 1, pivotY: 1, opacity: 100, volume: 100 };
const NAMES: Record<Channel, string> = {
  x: 'Position X',
  y: 'Position Y',
  scaleX: 'Scale ratio W',
  scaleY: 'Scale ratio H',
  rotation: 'Rotate',
  pivotX: 'Center of rotation X',
  pivotY: 'Center of rotation Y',
  opacity: 'Opacity',
  volume: 'Volume',
};
const LAYER_GROUPS: ChannelGroup[] = [...TRANSFORM_GROUPS, 'opacity'];
const SOUND_GROUPS: ChannelGroup[] = ['volume'];
const NONE: Keyframe[] = [];
/** Space above and below the curves (px). */
const PAD = 12;

interface Range {
  lo: number;
  hi: number;
}

/** A step for the value grid: 1, 2 or 5 × 10ⁿ, about five lines over the view. */
export function niceStep(span: number): number {
  const raw = Math.max(1e-9, span / 5);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/** The values the curves and their handles reach, with some room. */
function fitRange(keys: Keyframe[], channels: Channel[]): Range {
  const vals: number[] = [];
  for (const c of channels) {
    for (const k of keysOf(keys, c)) {
      const v = k.values[c]!;
      vals.push(v * UNIT[c]);
      const h = curveHandles(keys, k.frame, c);
      if (h.in) vals.push((v + h.in[1]) * UNIT[c]);
      if (h.out) vals.push((v + h.out[1]) * UNIT[c]);
    }
  }
  if (vals.length === 0) return { lo: 0, hi: 100 };
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < 1e-6) {
    lo -= 10;
    hi += 10;
  }
  const pad = (hi - lo) * 0.12;
  return { lo: lo - pad, hi: hi + pad };
}

const label = (v: number, step: number) => (step >= 1 ? String(Math.round(v)) : v.toFixed(Math.min(4, Math.ceil(-Math.log10(step)))));

type Drag =
  | { kind: 'points'; points: CurvePoint[]; x0: number; y0: number; grab: CurvePoint; v0: number; stretch: boolean; axis: 'x' | 'y' | null; select: boolean }
  | { kind: 'handle'; point: CurvePoint; side: 'in' | 'out'; h0: [number, number]; other?: [number, number]; x0: number; y0: number }
  | { kind: 'pan'; y0: number; range: Range }
  | { kind: 'zoom'; x0: number; v: number; range: Range }
  | { kind: 'marquee'; x0: number; y0: number; add: boolean };

/** The Graph Editor's track: the current track (or, its mask selected, the mask). */
function graphTrack(s: ReturnType<typeof getState>) {
  const id = anim.keyTrackId(s);
  const mask = id ? maskOwner(id) !== null : false;
  const layer = id ? anim.currentTrack(s) : null;
  return { name: layer ? `${layer.name}${mask ? ' : Mask' : ''}` : '', sound: layer?.kind === 'audio', mask, keyed: Boolean(layer && keysOn(layer)) };
}

export function GraphEditor({ frames, cell }: { frames: number; cell: number }) {
  const trackId = useStore((s) => anim.keyTrackId(s));
  const info = useStore(useShallow(graphTrack));
  const keys = useStore((s) => (trackId ? anim.trackKeys(trackId, s) : NONE));
  const { selection, axes, hidden, setting, snapX, snapY, dragZoom } = useStore(
    useShallow((s) => ({ selection: s.graphSelection, axes: s.graphAxes, hidden: s.graphHidden, setting: s.graphSetting, snapX: s.graphSnapX, snapY: s.graphSnapY, dragZoom: s.graphDragZoom })),
  );
  const groups = info.sound ? SOUND_GROUPS : info.mask ? TRANSFORM_GROUPS : LAYER_GROUPS;
  const [preview, setPreview] = useState<Keyframe[] | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const shown = preview ?? keys;
  const channels = groups
    .filter((g) => !hidden.includes(g))
    .flatMap((g) => GROUPS[g].channels)
    .filter((c) => axes[AXIS[c]] && keysOf(shown, c).length > 0);
  const selected = (frame: number, ch: Channel) => selection.some((r) => r.track === trackId && r.frame === frame && r.ch === ch);

  // The plot fills the palette below the frame ruler.
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<SVGSVGElement>(null);
  const [height, setHeight] = useState(160);
  useLayoutEffect(() => {
    const body = box.current?.closest('.timeline-body');
    if (!body) return;
    const measure = () => setHeight(Math.max(80, body.clientHeight - 21));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    return () => ro.disconnect();
  }, []);

  // The view fits the curves when another track or other curves are shown.
  const [range, setRange] = useState<Range>({ lo: 0, hi: 100 });
  const fitKey = `${trackId}|${channels.join(',')}`;
  useEffect(() => setRange(fitRange(trackId ? anim.trackKeys(trackId) : NONE, channels)), [fitKey]);
  // Points of another track are not selected.
  useEffect(() => {
    const s = getState();
    if (s.graphSelection.some((r) => r.track !== trackId)) setState({ graphSelection: s.graphSelection.filter((r) => r.track === trackId) });
  }, [trackId]);

  const span = range.hi - range.lo || 1;
  const ppu = (height - 2 * PAD) / span;
  const toY = (v: number) => PAD + (range.hi - v) * ppu;
  const fromY = (y: number) => range.hi - (y - PAD) / ppu;
  const toX = (f: number) => (f - 0.5) * cell;
  const width = frames * cell;
  const step = niceStep(span);
  const grid: number[] = [];
  for (let v = Math.ceil(range.lo / step) * step; v <= range.hi + 1e-9 && grid.length < 50; v += step) grid.push(v);

  // Wheel: zoom the values about the pointer (Shift+wheel scrolls the timeline sideways).
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const heightRef = useRef(height);
  heightRef.current = height;
  useEffect(() => {
    const el = plot.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (e.shiftKey) return;
      e.preventDefault();
      const r = rangeRef.current;
      const y = e.clientY - el.getBoundingClientRect().top;
      const v = r.hi - ((y - PAD) / (heightRef.current - 2 * PAD)) * (r.hi - r.lo);
      const f = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      setRange({ lo: v - (v - r.lo) * f, hi: v + (r.hi - v) * f });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [info.keyed]);

  const svgPoint = (e: { clientX: number; clientY: number }) => {
    const b = plot.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };

  /** What a drag does to the keyframes (null: nothing yet), and where the dragged points end up. */
  const dragged = (d: Drag, ev: PointerEvent): { keys: Keyframe[]; frame: (f: number) => number } | null => {
    const base = trackId ? anim.trackKeys(trackId) : NONE;
    if (d.kind === 'handle') {
      const dv = -(ev.clientY - d.y0) / ppu / UNIT[d.point.ch];
      const h: [number, number] = [d.h0[0] + (ev.clientX - d.x0) / cell, d.h0[1] + dv];
      h[0] = d.side === 'in' ? Math.min(-0.01, h[0]) : Math.max(0.01, h[0]);
      return { keys: setHandle(base, d.point.frame, d.point.ch, d.side, h, d.other), frame: (f) => f };
    }
    if (d.kind !== 'points') return null;
    let dx = ev.clientX - d.x0;
    let dy = ev.clientY - d.y0;
    if ((ev.shiftKey || d.stretch) && !d.axis && Math.hypot(dx, dy) > 4) d.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    if (ev.shiftKey || d.stretch) {
      if (d.axis !== 'x') dx = 0;
      if (d.axis !== 'y') dy = 0;
    }
    const df = Math.round(dx / cell);
    let dv = -dy / ppu;
    // Snap to Y axis: the grabbed keyframe lands on the value grid (half steps).
    if (snapY && dy) dv = Math.round((d.v0 + dv) / (step / 2)) * (step / 2) - d.v0;
    if (d.stretch) {
      const left = Math.min(...d.points.map((p) => p.frame));
      const reach = d.grab.frame - left;
      const sx = d.axis === 'x' && reach > 0 ? Math.max(0, (reach + df) / reach) : 1;
      const sy = d.axis === 'y' && d.v0 ? (d.v0 + dv) / d.v0 : 1;
      return { keys: scaleCurvePoints(base, d.points, sx, sy), frame: (f) => Math.max(1, Math.round(left + (f - left) * sx)) };
    }
    if (!df && !dv) return null;
    return { keys: moveCurvePoints(base, d.points, df, (ch) => dv / UNIT[ch]), frame: (f) => Math.max(1, f + df) };
  };

  /** Follows the pointer until it is released; previews the keyframes, then commits them. */
  const follow = (d: Drag, pointerId: number) => {
    plot.current?.setPointerCapture?.(pointerId);
    const move = (ev: PointerEvent) => {
      if (d.kind === 'pan') {
        const dv = (ev.clientY - d.y0) / ppu;
        setRange({ lo: d.range.lo + dv, hi: d.range.hi + dv });
        return;
      }
      if (d.kind === 'zoom') {
        const f = Math.exp(-(ev.clientX - d.x0) * 0.01);
        setRange({ lo: d.v - (d.v - d.range.lo) * f, hi: d.v + (d.range.hi - d.v) * f });
        return;
      }
      if (d.kind === 'marquee') {
        const a = svgPoint({ clientX: d.x0, clientY: d.y0 });
        const b = svgPoint(ev);
        setMarquee({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
        return;
      }
      setPreview(dragged(d, ev)?.keys ?? null);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPreview(null);
      if (d.kind === 'marquee') {
        setMarquee(null);
        const a = svgPoint({ clientX: d.x0, clientY: d.y0 });
        const b = svgPoint(ev);
        if (Math.hypot(a.x - b.x, a.y - b.y) < 4 || !trackId) return;
        const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
        const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
        const refs: CurveRef[] = [];
        for (const c of channels)
          for (const k of keysOf(keys, c)) {
            const x = toX(k.frame);
            const y = toY(k.values[c]! * UNIT[c]);
            if (x >= x0 && x <= x1 && y >= y0 && y <= y1) refs.push({ track: trackId, frame: k.frame, ch: c });
          }
        anim.selectCurvePoints(refs, d.add ? 'add' : 'set');
        return;
      }
      if (d.kind === 'pan' || d.kind === 'zoom' || !trackId) return;
      const result = dragged(d, ev);
      if (!result) return;
      const label = d.kind === 'handle' ? 'Adjust animation curve' : d.stretch ? 'Stretch keyframes' : 'Move keyframe';
      anim.editTrackKeys(trackId, () => result.keys, label);
      if (d.kind === 'points' && d.select) anim.selectCurvePoints(d.points.map((p) => ({ track: trackId, frame: result.frame(p.frame), ch: p.ch })));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const keyDown = (e: React.PointerEvent, frame: number, ch: Channel, value: number) => {
    if (e.button !== 0 || !trackId) return;
    e.stopPropagation();
    e.preventDefault();
    const ref: CurveRef = { track: trackId, frame, ch };
    if (e.altKey) {
      anim.editTrackKeys(trackId, (list) => removeChannels(list, frame, [ch]), 'Delete keyframe');
      anim.selectCurvePoints([ref], 'remove');
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey) {
      anim.selectCurvePoints([ref], 'toggle');
      return;
    }
    if (!selected(frame, ch)) anim.selectCurvePoints([ref], e.shiftKey ? 'add' : 'set');
    const points = getState().graphSelection.filter((r) => r.track === trackId).map((r) => ({ frame: r.frame, ch: r.ch }));
    follow({ kind: 'points', points, x0: e.clientX, y0: e.clientY, grab: { frame, ch }, v0: value * UNIT[ch], stretch: mod && e.shiftKey && points.length > 1, axis: null, select: true }, e.pointerId);
  };

  const handleDown = (e: React.PointerEvent, frame: number, ch: Channel, side: 'in' | 'out', h0: [number, number], other?: [number, number]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    follow({ kind: 'handle', point: { frame, ch }, side, h0, other, x0: e.clientX, y0: e.clientY }, e.pointerId);
  };

  const curveDown = (e: React.PointerEvent, ch: Channel) => {
    if (e.button !== 0 || !trackId) return;
    e.stopPropagation();
    e.preventDefault();
    const frame = Math.max(1, Math.round(svgPoint(e).x / cell + 0.5));
    if (e.altKey) {
      // A keyframe on this curve only, where it runs.
      anim.editTrackKeys(trackId, (list) => addCurvePoint(list, ch, frame, getState().keyInterp), 'Add keyframe');
      anim.selectCurvePoints([{ track: trackId, frame, ch }]);
      return;
    }
    // The whole curve moves.
    const points = keysOf(keys, ch).map((k) => ({ frame: k.frame, ch }));
    anim.selectCurvePoints(points.map((p) => ({ track: trackId, ...p })));
    follow({ kind: 'points', points, x0: e.clientX, y0: e.clientY, grab: points[0], v0: fromY(svgPoint(e).y), stretch: false, axis: null, select: true }, e.pointerId);
  };

  const backgroundDown = (e: React.PointerEvent) => {
    if (e.button === 2 || e.button === 1) {
      e.preventDefault();
      follow({ kind: 'pan', y0: e.clientY, range }, e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    if (dragZoom) {
      follow({ kind: 'zoom', x0: e.clientX, v: fromY(svgPoint(e).y), range }, e.pointerId);
      return;
    }
    if (!e.shiftKey) anim.selectCurvePoints([]);
    follow({ kind: 'marquee', x0: e.clientX, y0: e.clientY, add: e.shiftKey }, e.pointerId);
  };

  const toggleAxis = (a: Axis) => setState((s) => ({ graphAxes: { ...s.graphAxes, [a]: !s.graphAxes[a] } }));
  const toggleHidden = (g: ChannelGroup) => setState((s) => ({ graphHidden: s.graphHidden.includes(g) ? s.graphHidden.filter((x) => x !== g) : [...s.graphHidden, g] }));

  /** A curve as a path: straight while held, else the Bézier of each stretch. */
  const curvePath = (c: Channel): { line: string; ext: string } => {
    const list = keysOf(shown, c);
    const y = (k: Keyframe, dv = 0) => toY((k.values[c]! + dv) * UNIT[c]);
    let line = `M${toX(list[0].frame)} ${y(list[0])}`;
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (curveInterp(a, c) === 'hold') {
        line += `H${toX(b.frame)}V${y(b)}`;
        continue;
      }
      const h = segmentHandles(a, b, c);
      line += `C${toX(a.frame + h.out[0])} ${y(a, h.out[1])} ${toX(b.frame + h.in[0])} ${y(b, h.in[1])} ${toX(b.frame)} ${y(b)}`;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const ext = `M0 ${y(first)}H${toX(first.frame)}M${toX(last.frame)} ${y(last)}H${width}`;
    return { line, ext };
  };

  const curves = channels.map((c) => {
    const group = groups.find((g) => GROUPS[g].channels.includes(c));
    return { c, ...curvePath(c), color: AXIS_COLORS[AXIS[c]], focus: setting === null || setting === group };
  });
  const points = curves.flatMap(({ c, color }) =>
    keysOf(shown, c).map((k) => {
      const v = k.values[c]!;
      return { k, c, v, cx: toX(k.frame), cy: toY(v * UNIT[c]), color, sel: selected(k.frame, c) };
    }),
  );

  return (
    <div className="tl-graph" ref={box} style={{ height }} data-testid="graph-editor">
      <div className="tl-graph-side">
        <div className="tl-graph-lists">
          <div className="tl-graph-view">
            <span>View</span>
            {(['x', 'y', 'other'] as Axis[]).map((a) => (
              <button
                key={a}
                className={`tl-axis ${axes[a] ? 'on' : ''}`}
                style={{ color: AXIS_COLORS[a] }}
                aria-pressed={axes[a]}
                aria-label={a === 'x' ? 'X graph' : a === 'y' ? 'Y graph' : 'Other'}
                title={a === 'x' ? 'X graph' : a === 'y' ? 'Y graph' : 'Other: graphs X and Y do not cover (rotation, opacity, volume)'}
                onClick={() => toggleAxis(a)}
              >
                {a === 'x' ? 'X' : a === 'y' ? 'Y' : 'V'}
              </button>
            ))}
          </div>
          {groups.map((g) => (
            <div key={g} className={`tl-graph-setting ${setting === g ? 'on' : ''}`} data-testid="graph-setting" data-group={g}>
              <button className={`eye ${hidden.includes(g) ? '' : 'on'}`} aria-label={hidden.includes(g) ? `Show ${GROUPS[g].label}` : `Hide ${GROUPS[g].label}`} onClick={() => toggleHidden(g)}>
                <Icon name="eye" size={13} />
              </button>
              <button className="tl-graph-name" onClick={() => setState({ graphSetting: setting === g ? null : g })}>
                {GROUPS[g].label}
              </button>
            </div>
          ))}
        </div>
        <div className="tl-graph-values" aria-hidden="true">
          {grid.map((v) => (
            <span key={v} style={{ top: toY(v) }}>
              {label(v, step)}
            </span>
          ))}
        </div>
      </div>
      {!info.keyed ? (
        <div className="tl-graph-empty" style={{ width }}>
          {trackId ? `${info.name}: turn on Enable keyframes on this layer to edit its animation curves.` : 'Select a track to edit its animation curves.'}
        </div>
      ) : (
        <svg ref={plot} className={`tl-graph-plot ${dragZoom ? 'zoom' : ''}`} width={width} height={height} data-testid="graph-plot" onPointerDown={backgroundDown} onContextMenu={(e) => e.preventDefault()}>
          {grid.map((v) => (
            <line key={v} className="tl-graph-grid" x1={0} x2={width} y1={toY(v)} y2={toY(v)} />
          ))}
          {snapY &&
            grid.map((v) => <line key={`h${v}`} className="tl-graph-grid minor" x1={0} x2={width} y1={toY(v + step / 2)} y2={toY(v + step / 2)} />)}
          {snapX && Array.from({ length: frames + 1 }, (_, i) => <line key={`f${i}`} className="tl-graph-frame" x1={i * cell} x2={i * cell} y1={0} y2={height} />)}
          {/* Lines first, then what the pointer grabs: curves, handles, keyframes on top. */}
          {curves.map(({ c, line, ext, color, focus }) => (
            <g key={c} className={`tl-curve ${focus ? '' : 'dim'}`} data-testid="graph-curve" data-ch={c}>
              <path className="tl-curve-ext" d={ext} stroke={color} />
              <path className="tl-curve-line" d={line} stroke={color} />
            </g>
          ))}
          {curves.map(({ c, line, ext }) => (
            <path key={c} className="tl-curve-hit" data-testid="graph-curve-hit" data-ch={c} d={`${line}${ext}`} onPointerDown={(e) => curveDown(e, c)}>
              <title>{`${NAMES[c]}: drag to move the curve, Alt+click to add a keyframe on it`}</title>
            </path>
          ))}
          {points
            .filter((p) => p.sel)
            .flatMap(({ k, c, v, cx, cy, color }) => {
              const h = curveHandles(shown, k.frame, c);
              return (['in', 'out'] as const).map((side) => {
                const d = h[side];
                if (!d) return null;
                const hx = toX(k.frame + d[0]);
                const hy = toY((v + d[1]) * UNIT[c]);
                return (
                  <g key={`${c}${k.frame}${side}`}>
                    <line className="tl-handle-line" x1={cx} y1={cy} x2={hx} y2={hy} stroke={color} />
                    <circle className="tl-handle" data-testid="graph-handle" data-side={side} data-frame={k.frame} data-ch={c} cx={hx} cy={hy} r={3.5} fill={color} onPointerDown={(e) => handleDown(e, k.frame, c, side, d, side === 'in' ? h.out : h.in)} />
                  </g>
                );
              });
            })}
          {points.map(({ k, c, v, cx, cy, color, sel }) => {
            const common = {
              className: `tl-graph-key ${sel ? 'selected' : ''}`,
              'data-testid': 'graph-key',
              'data-frame': k.frame,
              'data-ch': c,
              stroke: color,
              fill: sel ? '#ffffff' : color,
              onPointerDown: (e: React.PointerEvent) => keyDown(e, k.frame, c, v),
            };
            const r = sel ? 5 : 4;
            const tip = <title>{`${NAMES[c]} ${label(v * UNIT[c], 0.01)} on frame ${k.frame}`}</title>;
            // Unpaired handles: a square.
            return k.curves?.[c]?.broken ? (
              <rect key={`${c}${k.frame}`} {...common} x={cx - r} y={cy - r} width={r * 2} height={r * 2}>
                {tip}
              </rect>
            ) : (
              <circle key={`${c}${k.frame}`} {...common} cx={cx} cy={cy} r={r}>
                {tip}
              </circle>
            );
          })}
          {marquee && <rect className="tl-graph-marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} />}
        </svg>
      )}
    </div>
  );
}

/** The track name shown over the Graph Editor's settings list. */
export function useGraphTrackName(): string {
  return useStore((s) => graphTrack(s).name);
}
