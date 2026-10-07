import type { Draft } from 'immer';
import { SYNTH_PRESETS } from '../../model/presets';
import type { FilterType, LfoTarget, SynthChannel, SynthParams, WaveType } from '../../model/types';
import { applySynthPreset, updateSynth } from '../../store/actions';
import { EnvelopeGraph, KnobCell, fmtHz, fmtPercent, fmtSeconds, fmtSigned } from './common';

const WAVES: { id: WaveType; path: string }[] = [
  { id: 'sine', path: 'M1 8 C4 1, 7 1, 8 8 S12 15, 15 8' },
  { id: 'triangle', path: 'M1 8 L4.5 2 L11.5 14 L15 8' },
  { id: 'sawtooth', path: 'M1 12 L8 3 L8 12 L15 3 L15 12' },
  { id: 'square', path: 'M1 12 L1 4 L8 4 L8 12 L15 12 L15 4' },
  { id: 'noise', path: 'M1 9 L2.5 4 L4 11 L5.5 6 L7 13 L8.5 3 L10 10 L11.5 5 L13 12 L15 7' },
];

function WaveIcon({ path }: { path: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

export function SynthEditor({ channel }: { channel: SynthChannel }) {
  const p = channel.synth;
  const set = (recipe: (d: Draft<SynthParams>) => void, g?: string) => updateSynth(channel.id, recipe, g ? { coalesce: g } : undefined);

  return (
    <>
      <div className="plugin-section">
        <div className="section-title">
          Oscillators
          <select
            className="tb-select"
            value=""
            onChange={(e) => e.target.value && applySynthPreset(channel.id, e.target.value)}
            data-hint="Load a preset (replaces all synth settings)"
          >
            <option value="">Load preset…</option>
            {SYNTH_PRESETS.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.category}: {pr.name}
              </option>
            ))}
          </select>
        </div>
        {p.osc.map((o, i) => (
          <div key={i} className="osc-row">
            <span className="osc-index">{i + 1}</span>
            <div className="seg wave-picker">
              {WAVES.map((w) => (
                <button
                  key={w.id}
                  className={o.wave === w.id ? 'active' : ''}
                  data-hint={`Waveform: ${w.id}`}
                  onClick={() =>
                    set((d) => {
                      d.osc[i].wave = w.id;
                    })
                  }
                >
                  <WaveIcon path={w.path} />
                </button>
              ))}
            </div>
            <KnobCell caption="Level" value={o.level} min={0} max={1} defaultValue={i === 0 ? 0.7 : 0} format={fmtPercent} onChange={(v, g) => set((d) => void (d.osc[i].level = v), g)} />
            <KnobCell caption="Coarse" value={o.coarse} min={-36} max={36} defaultValue={0} integer bipolar format={(v) => `${v > 0 ? '+' : ''}${v} st`} onChange={(v, g) => set((d) => void (d.osc[i].coarse = v), g)} />
            <KnobCell caption="Fine" value={o.fine} min={-100} max={100} defaultValue={0} bipolar format={(v) => `${Math.round(v)} ct`} onChange={(v, g) => set((d) => void (d.osc[i].fine = v), g)} />
            <KnobCell caption="Unison" value={o.unison} min={1} max={7} defaultValue={1} integer format={(v) => `${v}×`} onChange={(v, g) => set((d) => void (d.osc[i].unison = v), g)} />
            <KnobCell caption="Detune" value={o.detune} min={0} max={100} defaultValue={0} format={(v) => `${Math.round(v)} ct`} onChange={(v, g) => set((d) => void (d.osc[i].detune = v), g)} />
            <KnobCell caption="Pan" value={o.pan} min={-1} max={1} defaultValue={0} bipolar format={fmtSigned} onChange={(v, g) => set((d) => void (d.osc[i].pan = v), g)} />
          </div>
        ))}
      </div>

      <div className="plugin-sections">
        <div className="plugin-section grow">
          <div className="section-title">
            <label className="check">
              <input type="checkbox" checked={p.filter.enabled} onChange={(e) => set((d) => void (d.filter.enabled = e.target.checked))} />
              Filter
            </label>
            <select className="tb-select" value={p.filter.type} onChange={(e) => set((d) => void (d.filter.type = e.target.value as FilterType))}>
              <option value="lowpass">Low pass</option>
              <option value="highpass">High pass</option>
              <option value="bandpass">Band pass</option>
              <option value="notch">Notch</option>
            </select>
          </div>
          <div className="knob-row">
            <KnobCell caption="Cutoff" value={p.filter.cutoff} min={20} max={20000} curve="log" defaultValue={3200} format={fmtHz} onChange={(v, g) => set((d) => void (d.filter.cutoff = v), g)} />
            <KnobCell caption="Reso" value={p.filter.resonance} min={0.1} max={20} curve="log" defaultValue={1} format={(v) => v.toFixed(1)} onChange={(v, g) => set((d) => void (d.filter.resonance = v), g)} />
            <KnobCell caption="Env amt" value={p.filter.envAmount} min={-1} max={1} defaultValue={0.25} bipolar format={fmtSigned} onChange={(v, g) => set((d) => void (d.filter.envAmount = v), g)} />
            <KnobCell caption="Key trk" value={p.filter.keyTrack} min={0} max={1} defaultValue={0.3} format={fmtPercent} onChange={(v, g) => set((d) => void (d.filter.keyTrack = v), g)} />
          </div>
        </div>
        <div className="plugin-section">
          <div className="section-title">LFO</div>
          <div className="knob-row">
            <div className="knob-cell" style={{ minWidth: 80 }}>
              <select className="tb-select" value={p.lfo.target} onChange={(e) => set((d) => void (d.lfo.target = e.target.value as LfoTarget))}>
                <option value="off">Off</option>
                <option value="pitch">Pitch</option>
                <option value="filter">Filter</option>
                <option value="amp">Volume</option>
              </select>
              <span className="cell-label">Target</span>
            </div>
            <KnobCell caption="Rate" value={p.lfo.rate} min={0.05} max={20} curve="log" defaultValue={5} format={(v) => `${v.toFixed(2)} Hz`} onChange={(v, g) => set((d) => void (d.lfo.rate = v), g)} />
            <KnobCell caption="Depth" value={p.lfo.depth} min={0} max={1} defaultValue={0.2} format={fmtPercent} onChange={(v, g) => set((d) => void (d.lfo.depth = v), g)} />
          </div>
        </div>
      </div>

      <div className="plugin-sections">
        {(['ampEnv', 'filterEnv'] as const).map((key) => (
          <div key={key} className="plugin-section grow">
            <div className="section-title">{key === 'ampEnv' ? 'Volume envelope' : 'Filter envelope'}</div>
            <div className="knob-row" style={{ alignItems: 'center' }}>
              <KnobCell caption="Attack" value={Math.max(0.001, p[key].attack)} min={0.001} max={5} curve="log" defaultValue={0.005} format={fmtSeconds} onChange={(v, g) => set((d) => void (d[key].attack = v), g)} />
              <KnobCell caption="Decay" value={Math.max(0.005, p[key].decay)} min={0.005} max={8} curve="log" defaultValue={0.3} format={fmtSeconds} onChange={(v, g) => set((d) => void (d[key].decay = v), g)} />
              <KnobCell caption="Sustain" value={p[key].sustain} min={0} max={1} defaultValue={0.7} format={fmtPercent} onChange={(v, g) => set((d) => void (d[key].sustain = v), g)} />
              <KnobCell caption="Release" value={Math.max(0.005, p[key].release)} min={0.005} max={8} curve="log" defaultValue={0.25} format={fmtSeconds} onChange={(v, g) => set((d) => void (d[key].release = v), g)} />
              <EnvelopeGraph env={p[key]} color={key === 'ampEnv' ? '#ff9b3d' : '#5cb4ff'} />
            </div>
          </div>
        ))}
        <div className="plugin-section">
          <div className="section-title">Output</div>
          <KnobCell caption="Gain" value={p.gain} min={0} max={1} defaultValue={0.5} format={fmtPercent} onChange={(v, g) => set((d) => void (d.gain = v), g)} />
        </div>
      </div>
    </>
  );
}
