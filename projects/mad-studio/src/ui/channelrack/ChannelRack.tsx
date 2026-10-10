import { memo, useEffect, useMemo, useRef, type DragEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { engine } from '../../audio/engine';
import { findPattern, isStepNote, patternLength, patternSteps, stepIndex, stepView } from '../../model/patterns';
import { evaluateAutomation } from '../../model/automation';
import { channelTarget } from '../../model/automationTargets';
import { TICKS_PER_STEP, formatPan, formatPosition } from '../../model/timing';
import type { AutomationChannel, Channel, Note } from '../../model/types';
import { addSamplerChannelFor, assignSampleToChannel, importAudioFiles } from '../../project/projectIO';
import {
  addSynthChannel,
  applySynthPreset,
  cloneChannel,
  deleteChannel,
  endCoalesce,
  firstFreeInsert,
  moveChannel,
  rotateSteps,
  gestureKey,
  selectChannel,
  setChannelProps,
  setPatternBars,
  setStep,
  setSwing,
  setUi,
  soloChannel,
  toggleChannelMute,
  updateNotes,
} from '../../store/actions';
import { useStore, type RackFilter } from '../../store/store';
import { prepareCanvas, useFrame } from '../animation';
import { DragNumber } from '../controls/DragNumber';
import { IconCurve, IconGraph, IconPlug, IconPlus, IconRack } from '../controls/Icons';
import { GraphEditor } from './GraphEditor';
import { Knob } from '../controls/Knob';
import { audioFilesFromDrop, getDragItem, hasDragItem, hasFiles, sampleInfoFor } from '../dnd';
import { setHint } from '../hint';
import { addChannelMenu, channelContextMenu } from '../menus/channelMenus';
import { registerWindowKeys } from '../keyboard';
import { showMenu, toast } from '../overlays';
import { WindowFrame } from '../workspace/WindowFrame';
import { openChannelEditor, openPianoRoll, toggleChannelEditor } from '../workspace/windows';

const STEP_W = 20;
const STEP_GAP = 2;
const GROUP_GAP = 5;

function stepX(i: number): number {
  return i * (STEP_W + STEP_GAP) + Math.floor(i / 4) * (GROUP_GAP - STEP_GAP);
}

function stepsWidth(count: number): number {
  return stepX(count - 1) + STEP_W;
}

/** Shared registry so one animation loop can light activity LEDs and step markers. */
const activityLeds = new Map<string, HTMLElement>();

const FILTERS: { id: RackFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'instruments', label: 'Instruments' },
  { id: 'audio', label: 'Audio clips' },
  { id: 'automation', label: 'Automation' },
];

function matchesFilter(c: Channel, f: RackFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'instruments':
      return c.kind === 'synth' || c.kind === 'plugin' || (c.kind === 'sampler' && !c.audioClip);
    case 'audio':
      return c.kind === 'sampler' && !!c.audioClip;
    case 'automation':
      return c.kind === 'automation';
  }
}

export function ChannelRack() {
  const allChannels = useStore((s) => s.project.channels);
  const filter = useStore((s) => s.ui.rackFilter);
  const channels = useMemo(() => allChannels.filter((c) => matchesFilter(c, filter)), [allChannels, filter]);
  const patternId = useStore((s) => s.ui.selectedPatternId);
  const pattern = useStore((s) => findPattern(s.project, s.ui.selectedPatternId));
  const beatsPerBar = useStore((s) => s.project.beatsPerBar);
  const swing = useStore((s) => s.project.swing);
  const stepCount = pattern ? patternSteps(pattern, beatsPerBar) : 16;
  const bars = pattern ? patternLength(pattern, beatsPerBar) / (beatsPerBar * 96) : 1;
  const markerRef = useRef<HTMLDivElement>(null);
  const ledRowRef = useRef<HTMLDivElement>(null);
  const graphOpen = useStore((s) => s.ui.graphEditor);
  const selectedId = useStore((s) => s.ui.selectedChannelId);
  const graphChannel = graphOpen ? channels.find((c) => c.id === selectedId && c.kind !== 'automation') : undefined;
  const graphNotes = useStore((s) => (graphChannel ? findPattern(s.project, s.ui.selectedPatternId)?.notes[graphChannel.id] : undefined));

  // FL Studio channel rack keys: Up/Down select, Alt+Up/Down move, Alt+C clone, Alt+Del delete,
  // Ctrl+L route to a free mixer track, Shift+Ctrl+Left/Right rotate the steps.
  useEffect(
    () =>
      registerWindowKeys('channelRack', (e) => {
        const st = useStore.getState();
        const list = st.project.channels.filter((c) => matchesFilter(c, st.ui.rackFilter));
        const sel = st.ui.selectedChannelId;
        const i = list.findIndex((c) => c.id === sel);
        const mod = e.metaKey || e.ctrlKey;
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !mod) {
          if (!sel) return false;
          if (e.altKey) moveChannel(sel, e.key === 'ArrowUp' ? -1 : 1);
          else {
            const next = list[Math.min(list.length - 1, Math.max(0, i + (e.key === 'ArrowUp' ? -1 : 1)))];
            if (next) selectChannel(next.id);
          }
          return true;
        }
        if (e.altKey && e.code === 'KeyC' && sel) {
          cloneChannel(sel);
          return true;
        }
        if (e.altKey && (e.key === 'Delete' || e.key === 'Backspace') && sel) {
          deleteChannel(sel);
          return true;
        }
        if (mod && e.code === 'KeyL' && sel) {
          const free = firstFreeInsert(st.project);
          if (free > 0) setChannelProps(sel, { mixerTrack: free });
          return true;
        }
        if (mod && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && sel) {
          rotateSteps(st.ui.selectedPatternId, sel, e.key === 'ArrowLeft' ? -1 : 1);
          return true;
        }
        return false;
      }),
    [],
  );

  useFrame(() => {
    const tick = engine.patternTick();
    const step = tick === null ? -1 : Math.floor(tick / TICKS_PER_STEP);
    const marker = markerRef.current;
    if (marker) {
      marker.style.display = step >= 0 && step < stepCount ? 'block' : 'none';
      if (step >= 0) marker.style.transform = `translateX(${stepX(step)}px)`;
    }
    const leds = ledRowRef.current?.children;
    if (leds) for (let i = 0; i < leds.length; i++) leds[i].classList.toggle('on', i === step);
    for (const [id, el] of activityLeds) el.classList.toggle('on', engine.channelActivityAge(id) < 0.09);
  });

  const onDragOver = (e: DragEvent) => {
    if (hasDragItem(e) || hasFiles(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = async (e: DragEvent) => {
    if ((e.target as HTMLElement).closest('.rack-row')) return; // rows handle their own drops
    if (!hasDragItem(e) && !hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation(); // the app-level drop handler would import the files a second time
    const item = getDragItem(e);
    if (item?.type === 'sample') {
      const { info, rootKey } = sampleInfoFor(item);
      addSamplerChannelFor(info, rootKey);
    } else if (item?.type === 'preset') {
      addSynthChannel(item.presetId);
    } else if (hasFiles(e)) {
      const imported = await importAudioFiles(await audioFilesFromDrop(e));
      for (const s of imported) addSamplerChannelFor(s.info);
    }
  };

  const toolbar = (
    <>
      <select
        className="tb-select rack-filter"
        value={filter}
        data-hint="Channel filter (FL Studio: channel groups)"
        onChange={(e) => setUi((u) => void (u.rackFilter = e.target.value as RackFilter))}
      >
        {FILTERS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <div className="tb-group" data-hint="Swing: delays every second 16th step">
        <Knob
          size={20}
          label="Main swing"
          value={swing}
          min={0}
          max={1}
          defaultValue={0}
          format={(v) => `${Math.round(v * 100)}%`}
          target="proj:swing"
          onChange={(v, g) => setSwing(v, { coalesce: g })}
        />
        <span className="label">Swing</span>
      </div>
      <button
        className={`icon-btn ${graphOpen ? 'active' : ''}`}
        aria-label="Graph editor"
        data-hint="Graph editor: pitch, velocity, release, fine pitch, panning, Mod X/Y and shift of the selected channel's steps"
        onClick={() => setUi((u) => void (u.graphEditor = !u.graphEditor))}
      >
        <IconGraph size={13} />
      </button>
      <div className="tb-group" data-hint="Minimum pattern length in bars">
        <span className="label">Bars</span>
        <DragNumber
          className="tb-number"
          value={bars}
          min={1}
          max={64}
          step={0.1}
          hint="Pattern length"
          format={(v) => String(Math.round(v))}
          onChange={(v) => setPatternBars(patternId, v)}
        />
      </div>
    </>
  );

  return (
    <WindowFrame id="channelRack" title={`Channel rack${pattern ? ` – ${pattern.name}` : ''}`} icon={<IconRack />} toolbar={toolbar} accent={pattern?.color}>
      <div className="rack" onDragOver={onDragOver} onDrop={onDrop} data-hint="Drop samples or presets here to add channels">
        <div className="rack-header">
          <div className="rack-left-spacer" />
          <div className="rack-steps-area" style={{ width: stepsWidth(stepCount) }}>
            <div className="rack-led-row" ref={ledRowRef}>
              {Array.from({ length: stepCount }, (_, i) => (
                <span key={i} className={`step-led ${i % 4 === 0 ? 'beat' : ''}`} style={{ left: stepX(i) }} />
              ))}
            </div>
          </div>
        </div>
        <div className="rack-rows">
          <div className="rack-marker-lane" style={{ width: stepsWidth(stepCount) }}>
            <div className="rack-marker" ref={markerRef} />
          </div>
          {channels.map((ch, i) => (
            <ChannelRow key={ch.id} channel={ch} index={i} patternId={patternId} stepCount={stepCount} />
          ))}
        </div>
        {graphOpen &&
          (graphChannel ? (
            <GraphEditor channel={graphChannel} patternId={patternId} notes={graphNotes} stepCount={stepCount} stepX={stepX} stepWidth={STEP_W} width={stepsWidth(stepCount)} />
          ) : (
            <div className="graph-editor empty faint">Select an instrument channel to edit its steps in the graph editor.</div>
          ))}
        <div className="rack-footer">
          <button className="btn" data-hint="Add a channel (synth, drum sound, sampler)" onClick={(e) => showMenu(e, addChannelMenu())}>
            <IconPlus size={12} /> Add channel
          </button>
          <span className="faint">
            {channels.length}
            {filter === 'all' ? '' : ` of ${allChannels.length}`} channels · {stepCount} steps · {formatPosition(pattern ? patternLength(pattern, beatsPerBar) : 0, beatsPerBar)}
          </span>
        </div>
      </div>
    </WindowFrame>
  );
}

interface RowProps {
  channel: Channel;
  index: number;
  patternId: string;
  stepCount: number;
}

const ChannelRow = memo(function ChannelRow({ channel, patternId, stepCount }: RowProps) {
  const notes = useStore((s) => findPattern(s.project, patternId)?.notes[channel.id]);
  const selected = useStore((s) => s.ui.selectedChannelId === channel.id);
  const mixerCount = useStore((s) => s.project.mixer.length);
  const mixerName = useStore((s) => s.project.mixer[channel.mixerTrack]?.name ?? '');
  const ledRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ledRef.current;
    if (!el) return;
    activityLeds.set(channel.id, el);
    return () => {
      activityLeds.delete(channel.id);
    };
  }, [channel.id]);

  const onDrop = async (e: DragEvent) => {
    const item = getDragItem(e);
    if (!item && !hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (item?.type === 'sample') {
      if (channel.kind === 'sampler') {
        const { info, rootKey } = sampleInfoFor(item);
        assignSampleToChannel(channel.id, info, rootKey);
      } else toast('Drop samples on a sampler channel (or the empty rack area).');
    } else if (item?.type === 'preset') {
      if (channel.kind === 'synth') applySynthPreset(channel.id, item.presetId);
      else toast('Presets can be dropped on synth channels.');
    } else if (channel.kind === 'sampler') {
      const [first] = await importAudioFiles(await audioFilesFromDrop(e));
      if (first) assignSampleToChannel(channel.id, first.info);
    }
  };

  return (
    <div
      className={`rack-row ${selected ? 'selected' : ''} ${channel.muted ? 'muted' : ''}`}
      onDragOver={(e) => {
        if (hasDragItem(e) || hasFiles(e)) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      <div className="rack-left">
        <button
          className={`mute-led ${channel.muted ? '' : 'on'}`}
          data-hint="Mute (Ctrl/Cmd+click: solo, right-click: options)"
          onClick={(e) => (e.metaKey || e.ctrlKey ? soloChannel(channel.id) : toggleChannelMute(channel.id))}
          onContextMenu={(e) => {
            // FL Studio: right-clicking a channel's mute switch opens its menu (Solo …).
            e.preventDefault();
            const soloed = !channel.muted && useStore.getState().project.channels.every((c) => c.id === channel.id || c.muted);
            showMenu(e, [
              { label: channel.name, header: true },
              { label: 'Solo', checked: soloed, onClick: () => soloChannel(channel.id) },
              { label: 'Mute', checked: channel.muted, onClick: () => toggleChannelMute(channel.id) },
            ]);
          }}
        />
        <Knob
          size={20}
          label={`${channel.name} pan`}
          value={channel.pan}
          min={-1}
          max={1}
          defaultValue={0}
          bipolar
          format={formatPan}
          target={channel.kind === 'automation' ? undefined : channelTarget(channel.id, 'pan')}
          onChange={(v, g) => setChannelProps(channel.id, { pan: v }, { coalesce: g })}
        />
        <Knob
          size={20}
          label={`${channel.name} volume`}
          value={channel.volume}
          min={0}
          max={1}
          defaultValue={0.8}
          format={(v) => `${Math.round(v * 100)}%`}
          target={channel.kind === 'automation' ? undefined : channelTarget(channel.id, 'volume')}
          onChange={(v, g) => setChannelProps(channel.id, { volume: v }, { coalesce: g })}
        />
        {channel.kind === 'automation' ? (
          <span className="mixer-num automation-icon" data-hint="Automation clip">
            <IconCurve size={13} />
          </span>
        ) : (
          <DragNumber
            className="mixer-num"
            value={channel.mixerTrack}
            min={0}
            max={mixerCount - 1}
            step={0.15}
            hint={`Mixer track (${mixerName})`}
            format={(v) => (v === 0 ? 'M' : String(v))}
            onChange={(v, g) => setChannelProps(channel.id, { mixerTrack: v }, { coalesce: g })}
          />
        )}
        <button
          className={`channel-name kind-${channel.kind}`}
          style={{ ['--ch' as string]: channel.color }}
          data-hint={`${channel.name} – click: show/hide the channel window, right-click: options`}
          onClick={() => {
            selectChannel(channel.id);
            toggleChannelEditor(channel.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            selectChannel(channel.id);
            showMenu(e, channelContextMenu(channel));
          }}
        >
          <span className="activity-led" ref={ledRef} />
          {channel.kind === 'plugin' && <IconPlug size={11} />}
          <span className="channel-name-text">{channel.name}</span>
        </button>
        <button className={`select-ind ${selected ? 'on' : ''}`} data-hint="Select channel (target of piano roll and keyboard)" onClick={() => selectChannel(channel.id)} />
      </div>
      {channel.kind === 'automation' ? (
        <AutomationPreview channel={channel} stepCount={stepCount} />
      ) : (
        <StepArea channel={channel} patternId={patternId} notes={notes} stepCount={stepCount} />
      )}
    </div>
  );
});

/** Automation channels show their curve where other channels have steps. */
function AutomationPreview({ channel, stepCount }: { channel: AutomationChannel; stepCount: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = stepsWidth(stepCount);
  const height = 24;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = prepareCanvas(canvas, width, height);
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#2a3740';
    ctx.fillRect(0, 0, width, height);
    const data = channel.automation;
    const len = Math.max(1, data.length);
    ctx.beginPath();
    for (let x = 0; x <= width; x++) {
      const v = evaluateAutomation(data, (x / width) * len);
      const y = height - 3 - v * (height - 6);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = channel.color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }, [channel.automation, channel.color, width]);
  return (
    <div className="rack-steps-area miniroll" style={{ width }} data-hint="Automation clip – click to edit" onClick={() => openChannelEditor(channel.id)}>
      <canvas ref={ref} />
    </div>
  );
}

interface StepAreaProps {
  channel: Channel;
  patternId: string;
  notes: Note[] | undefined;
  stepCount: number;
}

function StepArea({ channel, patternId, notes, stepCount }: StepAreaProps) {
  const view = useMemo(() => stepView(notes, channel, stepCount), [notes, channel, stepCount]);
  const paint = useRef<{ on: boolean; key: string; last: number } | null>(null);

  if (!view.representable) {
    return <MiniRoll channel={channel} notes={notes ?? []} stepCount={stepCount} />;
  }

  const stepFromEvent = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    for (let i = 0; i < stepCount; i++) if (x >= stepX(i) - 1 && x < stepX(i) + STEP_W + 2) return i;
    return -1;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const i = stepFromEvent(e);
    if (i < 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    selectChannel(channel.id);
    const on = e.button === 2 ? false : !(view.steps[i] > 0);
    const key = gestureKey('steps');
    paint.current = { on, key, last: i };
    setStep(patternId, channel.id, i, on, { coalesce: key });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = paint.current;
    if (!p) return;
    const i = stepFromEvent(e);
    if (i >= 0 && i !== p.last) {
      p.last = i;
      setStep(patternId, channel.id, i, p.on, { coalesce: p.key });
    }
  };
  const onPointerUp = () => {
    paint.current = null;
    endCoalesce();
  };
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    // The plain wheel scrolls the rack, as in FL Studio; Alt+wheel changes a step's velocity
    // (like Alt+wheel over a note in the piano roll).
    if (!e.altKey) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = Array.from({ length: stepCount }, (_, k) => k).find((k) => x >= stepX(k) && x < stepX(k) + STEP_W);
    if (i === undefined || !(view.steps[i] > 0)) return;
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    let vel = 0;
    updateNotes(
      patternId,
      channel.id,
      (list) => {
        for (const n of list) {
          if (isStepNote(n) && stepIndex(n) === i) {
            n.velocity = Math.min(1, Math.max(0.05, n.velocity + delta));
            vel = n.velocity;
          }
        }
      },
      { coalesce: `vel:${channel.id}:${i}`, label: 'channel rack step velocity' },
    );
    setHint(`Step ${i + 1} velocity: ${Math.round(vel * 127)}`);
  };

  return (
    <div
      className="rack-steps-area steps"
      style={{ width: stepsWidth(stepCount) }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={onWheel}
      data-hint="Steps: click/drag to paint, right-drag to erase, Alt+wheel over a step: velocity"
    >
      {view.steps.map((v, i) => (
        <span
          key={i}
          className={`step ${Math.floor(i / 4) % 2 === 0 ? 'ga' : 'gb'} ${v > 0 ? 'on' : ''}`}
          style={{ left: stepX(i), ['--vel' as string]: String(0.35 + v * 0.65), ['--ch' as string]: channel.color }}
        />
      ))}
    </div>
  );
}

function MiniRoll({ channel, notes, stepCount }: { channel: Channel; notes: Note[]; stepCount: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = stepsWidth(stepCount);
  const height = 24;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = prepareCanvas(canvas, width, height);
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#2a3740';
    ctx.fillRect(0, 0, width, height);
    if (notes.length === 0) return;
    let lo = 127;
    let hi = 0;
    for (const n of notes) {
      lo = Math.min(lo, n.key);
      hi = Math.max(hi, n.key);
    }
    const span = Math.max(12, hi - lo + 1);
    const pxPerTick = width / (stepCount * TICKS_PER_STEP);
    ctx.fillStyle = channel.color;
    for (const n of notes) {
      const y = height - 3 - ((n.key - lo + (span - (hi - lo + 1)) / 2) / span) * (height - 6);
      ctx.globalAlpha = n.muted ? 0.2 : 0.45 + n.velocity * 0.55;
      ctx.fillRect(n.start * pxPerTick, y - 1.5, Math.max(2, n.length * pxPerTick - 1), 3);
    }
    ctx.globalAlpha = 1;
  }, [notes, channel.color, width, stepCount]);
  return (
    <div className="rack-steps-area miniroll" style={{ width }} data-hint="Piano roll content – click to edit" onClick={() => openPianoRoll(channel.id)}>
      <canvas ref={ref} />
    </div>
  );
}
