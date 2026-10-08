import { useEffect, useRef } from 'react';
import { beatsToMs, formatLatency, formatMs, formatOffsetMs, msToBeats, msToSamples, samplesToMs, wheelStepMs } from '../../model/latency';
import { usePlugins } from '../../plugins/pluginStore';
import { resetTrackLatencies, setMixerTrackProps, setPdc } from '../../store/actions';
import { useStore } from '../../store/store';
import { IconClock } from '../controls/Icons';
import { promptDialog, showMenu, type MenuItem } from '../overlays';

/**
 * Plugin delay compensation in the mixer, modelled on FL Studio: Mixer menu › Plugin delay compensation,
 * and a delay panel on every track (orange when the track has latency, blue with a manual offset; click
 * for Reset / Set in ms / samples / beats / Set from, mouse wheel ±10 ms, Ctrl ±1 ms, Ctrl+Alt ±1 sample).
 * The native engine compensates; its `latency` events show what it does.
 */

/** Sample rate offsets are shown in: the engine's (48 kHz until it reported). */
function currentRate(): number {
  const p = usePlugins.getState();
  return p.latency?.sampleRate || p.device?.sampleRate || 48000;
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

async function askNumber(title: string, initial: number): Promise<number | null> {
  const text = await promptDialog(title, String(initial));
  if (text === null) return null;
  const v = Number(text.trim().replace(',', '.').replace('−', '-'));
  return text.trim() !== '' && Number.isFinite(v) ? v : null;
}

/** Mixer menu › Plugin delay compensation. */
export function pdcMenu(): MenuItem[] {
  const p = useStore.getState().project;
  const native = usePlugins.getState().nativeEngine;
  return [
    ...(native ? [] : [{ label: 'Applies in the desktop app (native engine)', header: true }]),
    { label: 'Automatic', checked: p.pdc, onClick: () => setPdc({ pdc: !p.pdc }) },
    { label: 'Compensate automations', checked: p.pdc && p.pdcAutomation, disabled: !p.pdc, onClick: () => setPdc({ pdcAutomation: !p.pdcAutomation }) },
    { separator: true },
    { label: 'Reset manual latency on all tracks', disabled: !p.mixer.some((t) => t.latencyOffset !== 0), onClick: () => resetTrackLatencies() },
  ];
}

/** The delay panel's drop-down (FL Studio: Reset, Set in ms / samples / beats, Set from). */
export function trackLatencyMenu(index: number): MenuItem[] {
  const { project } = useStore.getState();
  const track = project.mixer[index];
  if (!track) return [];
  const rate = currentRate();
  const report = usePlugins.getState().latency;
  const info = report?.tracks[index];
  const set = (ms: number) => setMixerTrackProps(index, { latencyOffset: ms });
  const items: MenuItem[] = [{ label: `Delay compensation – ${track.name}`, header: true }];
  if (info) {
    items.push({ label: `${index === 0 ? 'Output latency' : 'Detected latency'}: ${formatLatency(info.latency, rate)}`, disabled: true });
    if (info.delay > 0) items.push({ label: `Delayed by ${formatLatency(info.delay, rate)} to stay in time`, disabled: true });
  }
  if (index === 0) {
    items.push({ label: 'The master hears every track in time; offsets are set on the insert tracks.', disabled: true });
    return items;
  }
  const others = (report?.tracks ?? []).map((t, i) => ({ i, latency: t.latency })).filter((t) => t.i > 0 && t.i !== index && t.latency > 0 && project.mixer[t.i]);
  items.push(
    { label: `Manual offset: ${formatOffsetMs(track.latencyOffset)}`, disabled: true },
    { separator: true },
    { label: 'Reset', disabled: track.latencyOffset === 0, onClick: () => set(0) },
    {
      label: 'Set in ms…',
      onClick: async () => {
        const v = await askNumber('Latency offset in ms (positive delays this track, negative all others)', round(track.latencyOffset, 3));
        if (v !== null) set(v);
      },
    },
    {
      label: 'Set in samples…',
      onClick: async () => {
        const v = await askNumber(`Latency offset in samples at ${rate} Hz`, msToSamples(track.latencyOffset, rate));
        if (v !== null) set(samplesToMs(Math.round(v), rate));
      },
    },
    {
      label: 'Set in beats…',
      onClick: async () => {
        const v = await askNumber(`Latency offset in beats at ${project.bpm} BPM`, round(msToBeats(track.latencyOffset, project.bpm), 4));
        if (v !== null) set(beatsToMs(v, useStore.getState().project.bpm));
      },
    },
    {
      label: 'Set from',
      disabled: others.length === 0,
      submenu: others.map((o) => ({
        label: `${o.i} · ${project.mixer[o.i].name} (${formatMs(samplesToMs(o.latency, rate))})`,
        onClick: () => set(samplesToMs(o.latency, rate)),
      })),
    },
  );
  return items;
}

/** FL Studio's delay panel: on each mixer strip (compact) and in the track inspector. */
export function LatencyPanel({ index, variant }: { index: number; variant: 'strip' | 'inspector' }) {
  const offset = useStore((s) => s.project.mixer[index]?.latencyOffset ?? 0);
  const name = useStore((s) => s.project.mixer[index]?.name ?? '');
  const latency = usePlugins((s) => s.latency?.tracks[index]?.latency ?? 0);
  const delay = usePlugins((s) => s.latency?.tracks[index]?.delay ?? 0);
  const rate = usePlugins((s) => s.latency?.sampleRate || s.device?.sampleRate || 48000);
  const ref = useRef<HTMLButtonElement>(null);

  // A native listener: React's wheel listeners are passive, and Ctrl+wheel must not zoom the page.
  useEffect(() => {
    const el = ref.current;
    if (!el || index === 0) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const current = useStore.getState().project.mixer[index]?.latencyOffset ?? 0;
      setMixerTrackProps(index, { latencyOffset: current + wheelStepMs(e, currentRate()) }, { coalesce: `wheel:pdc:${index}` });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [index]);

  const latent = latency > 0;
  const manual = offset !== 0;
  const parts = [latent ? `${index === 0 ? 'output latency' : 'latency'} ${formatLatency(latency, rate)}` : 'no plugin latency'];
  if (delay > 0) parts.push(`delayed ${formatMs(samplesToMs(delay, rate))} to stay in time`);
  if (manual) parts.push(`manual offset ${formatOffsetMs(offset)}`);
  const hint =
    `${name} delay compensation: ${parts.join(' · ')}` +
    (index === 0 ? '' : ' – click for options, wheel ±10 ms (Ctrl ±1 ms, Ctrl+Alt ±1 sample)');
  const short = manual ? formatOffsetMs(offset) : latent ? formatMs(samplesToMs(latency, rate)) : '';

  return (
    <button
      ref={ref}
      className={`pdc ${variant === 'strip' ? 'compact' : 'wide'} ${latent ? 'latent' : ''} ${manual ? 'manual' : ''}`}
      data-hint={hint}
      aria-label={hint}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        showMenu({ x: r.left, y: r.bottom + 2 }, trackLatencyMenu(index));
      }}
    >
      <IconClock size={variant === 'strip' ? 11 : 13} />
      {variant === 'inspector' ? (
        <span className="io-label">{latent || manual ? parts.join(' · ') : 'No plugin latency'}</span>
      ) : (
        short && <span className="pdc-value">{short.replace(' ms', '')}</span>
      )}
    </button>
  );
}
