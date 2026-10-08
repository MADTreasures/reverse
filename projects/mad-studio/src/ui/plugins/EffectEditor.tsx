import { effectTarget } from '../../model/automationTargets';
import { EFFECT_SPECS, effectParam, formatParamValue } from '../../model/effects';
import { instanceKeyForSlot } from '../../plugins/pluginStore';
import { removeEffect, setEffectParam, toggleEffect } from '../../store/actions';
import { useStore } from '../../store/store';
import { IconMixer } from '../controls/Icons';
import { WindowFrame } from '../workspace/WindowFrame';
import { closeWindow } from '../workspace/windows';
import { KnobCell } from './common';
import { PluginWrapper } from './PluginWrapper';

/** Generic editor for one insert effect; knobs are generated from the parameter specs. */
export function EffectEditor({ windowId }: { windowId: string }) {
  const [, idx, slotId] = windowId.split(':');
  const trackIndex = Number(idx);
  const track = useStore((s) => s.project.mixer[trackIndex]);
  const slot = track?.effects.find((e) => e.id === slotId);
  if (!track || !slot) return null;

  const toolbar = (
    <>
      <label className="check" data-hint="Enable / bypass">
        <input type="checkbox" checked={slot.enabled} onChange={() => toggleEffect(trackIndex, slot.id)} />
        On
      </label>
      <button
        className="btn danger"
        onClick={() => {
          closeWindow(windowId);
          removeEffect(trackIndex, slot.id);
        }}
      >
        Remove
      </button>
    </>
  );

  if (slot.type === 'plugin') {
    const plugin = slot.plugin;
    return (
      <WindowFrame id={windowId} title={`${plugin?.name ?? 'Plugin'} – ${track.name}`} icon={<IconMixer />} toolbar={toolbar} accent={track.color}>
        <div className="plugin">{plugin && <PluginWrapper instanceKey={instanceKeyForSlot(slot.id)} plugin={plugin} title={`${track.name} – ${plugin.name}`} />}</div>
      </WindowFrame>
    );
  }
  const type = slot.type;
  const spec = EFFECT_SPECS[type];

  return (
    <WindowFrame id={windowId} title={`${spec.name} – ${track.name}`} icon={<IconMixer />} toolbar={toolbar} accent={track.color}>
      <div className="plugin">
        <div className="plugin-section">
          <div className="knob-row">
            {spec.params.map((p) =>
              p.options ? (
                <div key={p.key} className="knob-cell" style={{ minWidth: 90 }}>
                  <select
                    className="tb-select"
                    value={Math.round(effectParam(type, slot.params, p.key))}
                    onChange={(e) => setEffectParam(trackIndex, slot.id, p.key, Number(e.target.value))}
                  >
                    {p.options.map((o, i) => (
                      <option key={o} value={i}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <span className="cell-label">{p.label}</span>
                </div>
              ) : (
                <KnobCell
                  key={p.key}
                  caption={p.label}
                  target={effectTarget(slot.id, p.key)}
                  value={effectParam(type, slot.params, p.key)}
                  min={p.min}
                  max={p.max}
                  defaultValue={p.default}
                  curve={p.curve}
                  bipolar={p.min < 0 && p.max > 0}
                  format={(v) => formatParamValue(p, v)}
                  onChange={(v, g) => setEffectParam(trackIndex, slot.id, p.key, v, { coalesce: g })}
                />
              ),
            )}
          </div>
        </div>
      </div>
    </WindowFrame>
  );
}
