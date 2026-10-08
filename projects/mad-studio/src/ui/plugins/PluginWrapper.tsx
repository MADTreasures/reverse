import { useEffect } from 'react';
import { engine } from '../../audio/engine';
import { pluginTarget } from '../../model/automationTargets';
import type { PluginInstanceData } from '../../model/types';
import { usePlugins } from '../../plugins/pluginStore';
import { createAutomationClip } from '../../store/automationActions';
import { useStore } from '../../store/store';
import { Knob } from '../controls/Knob';
import { toast } from '../overlays';

/**
 * Wrapper around a third-party plugin, like FL Studio's plugin wrapper: plugin info, a button that
 * opens the plugin's own editor (a native window of the engine process) and every parameter as a
 * knob, so it can be automated (right-click › Create automation clip).
 */
export function PluginWrapper({ instanceKey, plugin, title }: { instanceKey: string; plugin: PluginInstanceData; title: string }) {
  const native = usePlugins((s) => s.nativeEngine);
  const status = usePlugins((s) => s.instances[instanceKey]);
  const params = usePlugins((s) => s.params[instanceKey]);
  const lastTweaked = useStore((s) => s.ui.lastTweaked);

  useEffect(() => {
    if (native && status?.state === 'ready' && !params) engine.requestPluginParams(instanceKey);
  }, [native, status?.state, params, instanceKey]);

  if (!native) {
    return (
      <div className="plugin-wrapper">
        <div className="plugin-info">
          <strong>{plugin.name}</strong> <span className="faint">{plugin.vendor} · {plugin.format}</span>
        </div>
        <p className="notice">
          Third-party plugins (VST3/AU) run in the native audio engine of the MAD Studio desktop app. In the browser version this
          {plugin.isInstrument ? ' channel stays silent' : ' effect passes the audio through unchanged'}; the plugin and its settings are kept
          in the project.
        </p>
      </div>
    );
  }

  const tweakedHere = lastTweaked?.startsWith(`plug:${instanceKey}:`) ? lastTweaked : null;

  return (
    <div className="plugin-wrapper">
      <div className="plugin-info">
        <strong>{plugin.name}</strong>
        <span className="faint">
          {plugin.vendor} · {plugin.format}
          {status?.latency ? ` · latency ${status.latency} samples` : ''}
        </span>
        <span className={`plugin-status ${status?.state ?? 'loading'}`}>
          {status?.state === 'error' ? `Error: ${status.message ?? 'could not load'}` : status?.state === 'ready' ? 'Loaded' : 'Loading…'}
        </span>
      </div>
      <div className="plugin-actions">
        <button className="btn primary" disabled={status?.state !== 'ready'} onClick={() => engine.openPluginEditor(instanceKey, title)}>
          {status?.editorOpen ? 'Bring plugin window to front' : 'Show plugin editor'}
        </button>
        <button className="btn" disabled={status?.state !== 'ready'} onClick={() => engine.requestPluginParams(instanceKey)}>
          Refresh parameters
        </button>
        <button
          className="btn"
          disabled={!tweakedHere}
          data-hint="FL Studio: Tools › Last tweaked › Create automation clip"
          onClick={() => {
            if (tweakedHere && createAutomationClip(tweakedHere)) toast('Automation clip created for the last tweaked parameter.');
          }}
        >
          Automate last tweaked
        </button>
      </div>
      {params && params.length > 0 && (
        <div className="plugin-params">
          {params
            .filter((p) => p.automatable)
            .slice(0, 256)
            .map((p) => (
              <div key={p.index} className="knob-cell" title={p.name}>
                <Knob
                  size={28}
                  label={p.name}
                  value={p.value}
                  min={0}
                  max={1}
                  defaultValue={p.value}
                  format={() => p.text || `${Math.round(p.value * 100)}%`}
                  target={pluginTarget(instanceKey, p.index)}
                  onChange={(v) => engine.setPluginParam(instanceKey, p.index, v)}
                />
                <span className="cell-label">{p.name}</span>
                <span className="cell-value">{p.text}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
