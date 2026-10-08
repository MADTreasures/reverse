import type { Draft } from 'immer';
import { useEffect, useRef, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { samplePool } from '../../audio/samplePool';
import { noteName } from '../../model/timing';
import type { SamplerChannel, SamplerParams } from '../../model/types';
import { assignSampleToChannel, importAudioFiles, importSamplesDialog } from '../../project/projectIO';
import { endCoalesce, gestureKey, updateSampler } from '../../store/actions';
import { useStore } from '../../store/store';
import { prepareCanvas, useElementSize } from '../animation';
import { DragNumber } from '../controls/DragNumber';
import { audioFilesFromDrop, getDragItem, hasDragItem, hasFiles, sampleInfoFor } from '../dnd';
import { EnvelopeGraph, KnobCell, fmtPercent, fmtSeconds } from './common';

export function SamplerEditor({ channel }: { channel: SamplerChannel }) {
  const p = channel.sampler;
  const sampleInfo = useStore((s) => (p.sampleId ? s.project.samples[p.sampleId] : undefined));
  useStore((s) => s.sampleRevision);
  const entry = samplePool.get(p.sampleId);
  const set = (recipe: (d: Draft<SamplerParams>) => void, g?: string) => updateSampler(channel.id, recipe, g ? { coalesce: g } : undefined);

  const onDrop = async (e: DragEvent) => {
    const item = getDragItem(e);
    if (!item && !hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (item?.type === 'sample') {
      const { info, rootKey } = sampleInfoFor(item);
      assignSampleToChannel(channel.id, info, rootKey);
    } else {
      const [first] = await importAudioFiles(await audioFilesFromDrop(e));
      if (first) assignSampleToChannel(channel.id, first.info);
    }
  };

  return (
    <>
      <div className="plugin-section" onDragOver={(e) => (hasDragItem(e) || hasFiles(e)) && e.preventDefault()} onDrop={onDrop}>
        <div className="section-title">
          Sample
          <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}>
            {sampleInfo?.name ?? 'none'}
            {entry ? ` · ${entry.buffer.duration.toFixed(2)} s · ${entry.buffer.numberOfChannels === 2 ? 'stereo' : 'mono'}` : ''}
          </span>
          <button
            className="btn"
            onClick={async () => {
              const [first] = await importSamplesDialog();
              if (first) assignSampleToChannel(channel.id, first.info);
            }}
          >
            Load…
          </button>
        </div>
        <SampleView channel={channel} />
      </div>
      <div className="plugin-sections">
        <div className="plugin-section grow">
          <div className="section-title">Playback</div>
          <div className="knob-row" style={{ alignItems: 'center' }}>
            <div className="knob-cell">
              <DragNumber
                className="tb-number"
                value={p.rootKey}
                min={0}
                max={127}
                step={0.2}
                hint="Root key (plays the sample unpitched)"
                format={(v) => noteName(v)}
                onChange={(v, g) => set((d) => void (d.rootKey = v), g)}
              />
              <span className="cell-label">Root key</span>
            </div>
            <KnobCell target={`ch:${channel.id}:sampler.fine`} caption="Fine" value={p.fine} min={-100} max={100} defaultValue={0} bipolar format={(v) => `${Math.round(v)} ct`} onChange={(v, g) => set((d) => void (d.fine = v), g)} />
            <KnobCell target={`ch:${channel.id}:sampler.gain`} caption="Gain" value={p.gain} min={0} max={1} defaultValue={0.8} format={fmtPercent} onChange={(v, g) => set((d) => void (d.gain = v), g)} />
            <div className="knob-cell">
              <DragNumber
                className="tb-number"
                value={p.chokeGroup}
                min={0}
                max={8}
                step={0.1}
                hint="Choke group: channels in the same group cut each other (0 = off)"
                format={(v) => (v === 0 ? 'off' : String(v))}
                onChange={(v, g) => set((d) => void (d.chokeGroup = v), g)}
              />
              <span className="cell-label">Choke</span>
            </div>
          </div>
          <div className="knob-row" style={{ marginTop: 10 }}>
            {(
              [
                ['keyTrack', 'Key tracking'],
                ['oneShot', 'One-shot'],
                ['reverse', 'Reverse'],
                ['loop', 'Loop'],
                ['cutSelf', 'Cut itself'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="check">
                <input type="checkbox" checked={p[key]} onChange={(e) => set((d) => void (d[key] = e.target.checked))} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="plugin-section grow">
          <div className="section-title">Envelope {p.oneShot && !p.loop ? <span className="faint">(one-shot: attack only)</span> : null}</div>
          <div className="knob-row" style={{ alignItems: 'center' }}>
            <KnobCell target={`ch:${channel.id}:sampler.ampEnv.attack`} caption="Attack" value={Math.max(0.001, p.ampEnv.attack)} min={0.001} max={5} curve="log" defaultValue={0.001} format={fmtSeconds} onChange={(v, g) => set((d) => void (d.ampEnv.attack = v), g)} />
            <KnobCell target={`ch:${channel.id}:sampler.ampEnv.decay`} caption="Decay" value={Math.max(0.005, p.ampEnv.decay)} min={0.005} max={8} curve="log" defaultValue={0.3} format={fmtSeconds} onChange={(v, g) => set((d) => void (d.ampEnv.decay = v), g)} />
            <KnobCell target={`ch:${channel.id}:sampler.ampEnv.sustain`} caption="Sustain" value={p.ampEnv.sustain} min={0} max={1} defaultValue={1} format={fmtPercent} onChange={(v, g) => set((d) => void (d.ampEnv.sustain = v), g)} />
            <KnobCell target={`ch:${channel.id}:sampler.ampEnv.release`} caption="Release" value={Math.max(0.005, p.ampEnv.release)} min={0.005} max={8} curve="log" defaultValue={0.08} format={fmtSeconds} onChange={(v, g) => set((d) => void (d.ampEnv.release = v), g)} />
            <EnvelopeGraph env={p.ampEnv} />
          </div>
        </div>
      </div>
    </>
  );
}

/** Waveform with a draggable start marker. */
function SampleView({ channel }: { channel: SamplerChannel }) {
  const p = channel.sampler;
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const revision = useStore((s) => s.sampleRevision);
  const drag = useRef<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0) return;
    const ctx = prepareCanvas(canvas, size.width, size.height);
    if (!ctx) return;
    const { width, height } = size;
    ctx.clearRect(0, 0, width, height);
    const entry = samplePool.get(p.sampleId);
    if (!entry) return;
    const peaks = samplePool.peaks(entry.id, Math.max(1, Math.floor(width)));
    if (!peaks) return;
    const mid = height / 2;
    ctx.fillStyle = channel.color;
    for (let x = 0; x < width; x++) {
      const i = p.reverse ? width - 1 - x : x;
      const lo = peaks[i * 2];
      const hi = peaks[i * 2 + 1];
      ctx.fillRect(x, mid - hi * (mid - 4), 1, Math.max(1, (hi - lo) * (mid - 4)));
    }
    ctx.fillStyle = '#0008';
    ctx.fillRect(0, 0, p.start * width, height);
    ctx.fillStyle = '#ff9b3d';
    ctx.fillRect(Math.round(p.start * width), 0, 2, height);
  }, [size, p.sampleId, p.start, p.reverse, channel.color, revision]);

  const setStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const start = Math.min(0.99, Math.max(0, (e.clientX - r.left) / r.width));
    updateSampler(channel.id, (d) => void (d.start = start), { coalesce: drag.current ?? undefined });
  };

  return (
    <div
      className="sample-view"
      ref={wrapRef}
      data-hint="Drag to set the sample start · drop a sample here to replace it"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = gestureKey('sample-start');
        setStart(e);
      }}
      onPointerMove={(e) => drag.current && setStart(e)}
      onPointerUp={() => {
        drag.current = null;
        endCoalesce();
      }}
    >
      <canvas ref={canvasRef} />
      {!p.sampleId && <div className="sample-drop-hint">Drop an audio file or a browser sample here</div>}
    </div>
  );
}
