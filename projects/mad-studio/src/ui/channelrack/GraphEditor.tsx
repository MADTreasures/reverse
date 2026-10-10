import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { NOTE_PROPS, noteColor, notePropSpec, noteValue, setNoteValue } from '../../model/notes';
import { stepIndex, stepKey, stepNotes } from '../../model/patterns';
import { TICKS_PER_STEP, noteName } from '../../model/timing';
import type { Channel, Note } from '../../model/types';
import { endCoalesce, gestureKey, setUi, updateNotes } from '../../store/actions';
import { useStore, type GraphLane } from '../../store/store';
import { prepareCanvas } from '../animation';
import { setHint } from '../hint';

const PITCH_RANGE = 24;
const HEIGHT = 92;

export const GRAPH_LANES: { id: GraphLane; label: string }[] = [
  { id: 'pitch', label: 'Note pitch' },
  ...NOTE_PROPS.map((p) => ({ id: p.key as GraphLane, label: p.label === 'Pan' ? 'Panning' : p.label })),
  { id: 'shift', label: 'Shift' },
];

interface LaneSpec {
  min: number;
  max: number;
  def: number;
  bipolar: boolean;
  get: (n: Note, base: number) => number;
  set: (n: Note, v: number, base: number) => void;
  format: (v: number, base: number) => string;
}

function laneSpec(lane: GraphLane): LaneSpec {
  if (lane === 'pitch') {
    return {
      min: -PITCH_RANGE,
      max: PITCH_RANGE,
      def: 0,
      bipolar: true,
      get: (n, base) => n.key - base,
      set: (n, v, base) => void (n.key = Math.min(127, Math.max(0, base + Math.round(v)))),
      format: (v, base) => `${noteName(base + Math.round(v))} (${v > 0 ? '+' : ''}${Math.round(v)})`,
    };
  }
  if (lane === 'shift') {
    return {
      min: 0,
      max: TICKS_PER_STEP - 1,
      def: 0,
      bipolar: false,
      get: (n) => n.start - stepIndex(n) * TICKS_PER_STEP,
      set: (n, v) => void (n.start = stepIndex(n) * TICKS_PER_STEP + Math.round(v)),
      format: (v) => `${Math.round(v)} ticks later`,
    };
  }
  const spec = notePropSpec(lane);
  return {
    min: spec.min,
    max: spec.max,
    def: spec.def,
    bipolar: spec.bipolar,
    get: (n) => noteValue(n, lane),
    set: (n, v) => setNoteValue(n, lane, lane === 'velocity' ? Math.max(1 / 128, v) : v),
    format: (v) => spec.format(v),
  };
}

/**
 * FL Studio's graph editor under the channel rack: one bar per step of the selected channel for the
 * chosen note property. Drag to draw values, right-drag to reset them.
 */
export function GraphEditor({
  channel,
  patternId,
  notes,
  stepCount,
  stepX,
  stepWidth,
  width,
}: {
  channel: Channel;
  patternId: string;
  notes: Note[] | undefined;
  stepCount: number;
  stepX: (i: number) => number;
  stepWidth: number;
  width: number;
}) {
  const lane = useStore((s) => s.ui.graphLane);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ key: string; reset: boolean } | null>(null);
  const spec = laneSpec(lane);
  const base = stepKey(channel);
  const cells = stepNotes(notes, stepCount);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = prepareCanvas(canvas, width, HEIGHT);
    if (!ctx) return;
    ctx.clearRect(0, 0, width, HEIGHT);
    ctx.fillStyle = '#222d34';
    ctx.fillRect(0, 0, width, HEIGHT);
    const yOf = (v: number) => HEIGHT - 4 - ((v - spec.min) / (spec.max - spec.min)) * (HEIGHT - 8);
    const zero = spec.bipolar ? yOf(spec.def) : HEIGHT - 4;
    if (spec.bipolar) {
      ctx.fillStyle = '#ffffff22';
      ctx.fillRect(0, Math.round(zero), width, 1);
    }
    for (let i = 0; i < stepCount; i++) {
      const x = stepX(i);
      ctx.fillStyle = Math.floor(i / 4) % 2 === 0 ? '#ffffff08' : '#00000014';
      ctx.fillRect(x, 0, stepWidth, HEIGHT);
      const n = cells[i];
      if (!n) continue;
      const y = yOf(spec.get(n, base));
      ctx.fillStyle = noteColor(n.color, channel.color);
      ctx.globalAlpha = n.muted ? 0.35 : 0.9;
      ctx.fillRect(x + 3, Math.min(y, zero), stepWidth - 6, Math.max(2, Math.abs(zero - y)));
      ctx.globalAlpha = 1;
    }
  }, [cells, spec, base, width, stepCount, stepX, stepWidth, channel.color]);

  const valueAt = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let step = -1;
    for (let i = 0; i < stepCount; i++) if (x >= stepX(i) - 1 && x < stepX(i) + stepWidth + 2) step = i;
    const frac = Math.min(1, Math.max(0, (HEIGHT - 4 - y) / (HEIGHT - 8)));
    return { step, value: spec.min + frac * (spec.max - spec.min) };
  };

  const apply = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const { step, value } = valueAt(e);
    if (step < 0 || !cells[step]) return;
    const v = d.reset ? spec.def : value;
    updateNotes(
      patternId,
      channel.id,
      (list) => {
        for (const n of list) if (stepIndex(n) === step && n.length <= TICKS_PER_STEP) spec.set(n, v, base);
      },
      { coalesce: d.key, label: 'graph editor' },
    );
    setHint(`Step ${step + 1}: ${spec.format(v, base)}`);
  };

  return (
    <div className="graph-editor">
      <div className="graph-lanes" role="tablist" aria-label="Graph editor lane">
        {GRAPH_LANES.map((l) => (
          <button key={l.id} role="tab" aria-selected={lane === l.id} className={lane === l.id ? 'active' : ''} onClick={() => setUi((u) => void (u.graphLane = l.id))}>
            {l.label}
          </button>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        data-hint="Graph editor: drag to set the values of the steps, right-drag to reset them"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { key: gestureKey('graph'), reset: e.button === 2 };
          apply(e);
        }}
        onPointerMove={(e) => {
          if (drag.current) apply(e);
          else {
            const { step } = valueAt(e);
            const n = step >= 0 ? cells[step] : null;
            if (n) setHint(`Step ${step + 1}: ${spec.format(spec.get(n, base), base)}`);
          }
        }}
        onPointerUp={() => {
          drag.current = null;
          endCoalesce();
        }}
        onPointerCancel={() => {
          drag.current = null;
          endCoalesce();
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
