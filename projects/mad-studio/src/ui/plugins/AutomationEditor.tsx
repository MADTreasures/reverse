import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { describeTarget, fromNorm } from '../../model/automationTargets';
import { PPQ, formatPosition, snapRound, snapTicks, ticksPerBar } from '../../model/timing';
import type { AutomationChannel } from '../../model/types';
import { endCoalesce, gestureKey } from '../../store/actions';
import {
  addAutomationPoint,
  flipAutomation,
  moveAutomationPoint,
  resetAutomation,
  setAutomationTarget,
  setPointTension,
} from '../../store/automationActions';
import { useStore } from '../../store/store';
import { prepareCanvas, useElementSize, useFrame } from '../animation';
import { drawCurve, hitTestCurve, tensionFromDrag, xToTick, yToValue, type CurveView } from '../automation/curve';
import { pointMenu } from '../automation/pointMenu';
import { setHint } from '../hint';
import { showMenu } from '../overlays';

type Drag = { kind: 'point'; index: number; key: string } | { kind: 'tension'; index: number; key: string; startY: number; startTension: number };

/** FL Studio's automation clip settings: the envelope editor plus its target link. */
export function AutomationEditor({ channel }: { channel: AutomationChannel }) {
  const project = useStore((s) => s.project);
  const lastTweaked = useStore((s) => s.ui.lastTweaked);
  const data = channel.automation;
  const info = data.target ? describeTarget(project, data.target) : null;
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [focus, setFocus] = useState<{ point: number | null; handle: number | null }>({ point: null, handle: null });
  const clips = project.clips.filter((c) => c.kind === 'automation' && c.channelId === channel.id);
  const bar = ticksPerBar(project.beatsPerBar);
  const lengthTicks = Math.max(bar, Math.ceil(data.length / bar) * bar);

  const view = (): CurveView => {
    const w = Math.max(10, size.width - 16);
    return { x: 8, y: 18, w, h: Math.max(20, size.height - 26), tick0: 0, pxPerTick: w / lengthTicks, visibleTicks: lengthTicks };
  };

  const scene = useRef({ data, focus, size, lengthTicks, bar });
  scene.current = { data, focus, size, lengthTicks, bar };

  useFrame(() => {
    const canvas = canvasRef.current;
    const sc = scene.current;
    if (!canvas || sc.size.width <= 0) return;
    const ctx = prepareCanvas(canvas, sc.size.width, sc.size.height);
    if (!ctx) return;
    const v = view();
    ctx.fillStyle = '#27353e';
    ctx.fillRect(0, 0, sc.size.width, sc.size.height);
    // Grid: bars and beats.
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    for (let t = 0; t <= sc.lengthTicks; t += PPQ) {
      const x = Math.round(v.x + t * v.pxPerTick) + 0.5;
      const isBar = t % sc.bar === 0;
      ctx.strokeStyle = isBar ? '#ffffff22' : '#ffffff0a';
      ctx.beginPath();
      ctx.moveTo(x, v.y);
      ctx.lineTo(x, v.y + v.h);
      ctx.stroke();
      if (isBar) {
        ctx.fillStyle = '#9aa7b3';
        ctx.fillText(String(t / sc.bar + 1), x + 3, 9);
      }
    }
    for (const frac of [0.25, 0.5, 0.75]) {
      const y = Math.round(v.y + (1 - frac) * v.h) + 0.5;
      ctx.strokeStyle = '#ffffff0a';
      ctx.beginPath();
      ctx.moveTo(v.x, y);
      ctx.lineTo(v.x + v.w, y);
      ctx.stroke();
    }
    // Area after the data end is dimmed.
    const endX = v.x + sc.data.length * v.pxPerTick;
    if (endX < v.x + v.w) {
      ctx.fillStyle = '#00000033';
      ctx.fillRect(endX, v.y, v.x + v.w - endX, v.h);
    }
    drawCurve(ctx, v, sc.data, {
      color: '#ff9b8f',
      fill: 'rgba(255, 155, 143, 0.12)',
      lineWidth: 1.6,
      showPoints: true,
      showHandles: true,
      activePoint: sc.focus.point,
      activeHandle: sc.focus.handle,
    });
  });

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const grid = (e: { altKey: boolean }) => (e.altKey ? 1 : snapTicks('step', project.beatsPerBar));
  const fmt = (n: number) => (info ? info.format(fromNorm(info, n)) : `${Math.round(n * 100)}%`);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { x, y } = local(e);
    const v = view();
    const hit = hitTestCurve(v, data, x, y);
    if (!hit) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const key = gestureKey('automation-editor');
    if (e.button === 2) {
      if (hit.kind === 'point') showMenu(e, pointMenu(channel.id, data, hit.index));
      else if (hit.kind === 'tension') setPointTension(channel.id, hit.index, 0);
      else {
        const index = addAutomationPoint(channel.id, snapRound(xToTick(v, x), grid(e)), yToValue(v, y), { coalesce: key });
        if (index >= 0) {
          drag.current = { kind: 'point', index, key };
          setFocus({ point: index, handle: null });
        }
      }
      return;
    }
    if (hit.kind === 'point') drag.current = { kind: 'point', index: hit.index, key };
    else if (hit.kind === 'tension') drag.current = { kind: 'tension', index: hit.index, key, startY: e.clientY, startTension: data.points[hit.index].tension };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { x, y } = local(e);
    const v = view();
    const d = drag.current;
    if (d?.kind === 'point') {
      moveAutomationPoint(channel.id, d.index, Math.max(0, snapRound(xToTick(v, x), grid(e))), yToValue(v, y), { coalesce: d.key });
      const p = useStore.getState().project.channels.find((c) => c.id === channel.id);
      const pt = p?.kind === 'automation' ? p.automation.points[d.index] : undefined;
      if (pt) setHint(`${formatPosition(pt.tick, project.beatsPerBar)}  ${fmt(pt.value)}`);
      return;
    }
    if (d?.kind === 'tension') {
      const t = tensionFromDrag(data.points, d.index, d.startTension, d.startY - e.clientY);
      setPointTension(channel.id, d.index, t, { coalesce: d.key });
      setHint(`Tension ${Math.round(t * 100)}%`);
      return;
    }
    const hit = hitTestCurve(v, data, x, y);
    if (hit?.kind === 'point') {
      setFocus({ point: hit.index, handle: null });
      setHint(`Point ${hit.index + 1}/${data.points.length}  ${fmt(data.points[hit.index].value)} – drag: move, right-click: options`);
      e.currentTarget.style.cursor = 'grab';
    } else if (hit?.kind === 'tension') {
      setFocus({ point: null, handle: hit.index });
      setHint(`Tension ${Math.round(data.points[hit.index].tension * 100)}% – drag: bend, right-click: reset`);
      e.currentTarget.style.cursor = 'ns-resize';
    } else {
      setFocus({ point: null, handle: null });
      setHint(`${formatPosition(Math.max(0, xToTick(v, x)), project.beatsPerBar)}  ${fmt(yToValue(v, y))} – right-click: add point`);
      e.currentTarget.style.cursor = 'crosshair';
    }
  };

  const onPointerUp = () => {
    drag.current = null;
    endCoalesce();
  };

  return (
    <div className="automation-editor">
      <div className="plugin-header automation-target">
        <span className="label">Target</span>
        <strong className={info ? '' : 'faint'}>{info ? info.label : '(unlinked)'}</strong>
        <button
          className="btn"
          disabled={!lastTweaked || lastTweaked === data.target || !describeTarget(project, lastTweaked)}
          data-hint="Link this clip to the control you moved last (FL: Last tweaked)"
          onClick={() => lastTweaked && setAutomationTarget(channel.id, lastTweaked)}
        >
          Link to last tweaked
        </button>
        <span className="spacer" />
        <button className="btn" onClick={() => flipAutomation(channel.id)}>
          Flip vertically
        </button>
        <button className="btn" onClick={() => resetAutomation(channel.id)}>
          Reset
        </button>
      </div>
      <div className="automation-canvas" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setFocus({ point: null, handle: null })}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
      <div className="automation-footer faint">
        {data.points.length} points · {formatPosition(data.length, project.beatsPerBar)} long · used by {clips.length} clip{clips.length === 1 ? '' : 's'} in the
        playlist · right-click adds points, drag the small circles to bend a segment
      </div>
    </div>
  );
}
