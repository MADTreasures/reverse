import { useEffect, useMemo, useState } from 'react';
import { engine } from '../../audio/engine';
import type { PluginDescription } from '../../model/types';
import { native } from '../../platform/platform';
import { scanPaths, setExtraPaths, usePlugins } from '../../plugins/pluginStore';
import { addPluginChannel, addPluginEffect } from '../../store/actions';
import { useStore } from '../../store/store';
import { VstLogo } from '../brand/SteinbergLogos';
import { pluginInstanceFrom } from '../menus/pluginMenus';
import { closeDialog, toast } from '../overlays';
import { openChannelEditor, openEffectEditor } from '../workspace/windows';

type Tab = 'instruments' | 'effects' | 'failed';

/** FL Studio's plugin manager / picker: search paths, scanning, and the list of installed plugins. */
export function PluginManagerDialog() {
  const native_ = usePlugins((s) => s.nativeEngine);
  const plugins = usePlugins((s) => s.plugins);
  const failed = usePlugins((s) => s.failed);
  const scanning = usePlugins((s) => s.scanning);
  const paths = usePlugins((s) => s.paths);
  const extra = usePlugins((s) => s.extraPaths);
  const formats = usePlugins((s) => s.formats);
  const [tab, setTab] = useState<Tab>('instruments');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (native_) engine.getAudioDevices();
  }, [native_]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = plugins.filter((p) => (tab === 'instruments' ? p.isInstrument : !p.isInstrument));
    return (q ? list.filter((p) => `${p.name} ${p.vendor} ${p.category}`.toLowerCase().includes(q)) : list).sort((a, b) => a.name.localeCompare(b.name));
  }, [plugins, tab, query]);

  const add = (p: PluginDescription) => {
    const data = pluginInstanceFrom(p);
    if (p.isInstrument) {
      const id = addPluginChannel(data);
      closeDialog();
      openChannelEditor(id);
    } else {
      const track = useStore.getState().ui.selectedMixerTrack;
      const slot = addPluginEffect(track, data);
      if (!slot) {
        toast('All 10 effect slots of the selected mixer track are in use.', 'error');
        return;
      }
      closeDialog();
      openEffectEditor(track, slot);
    }
  };

  const addFolder = async (format: string) => {
    const dir = await native?.chooseFolder(`Add a ${format} plugin folder`);
    if (!dir) return;
    setExtraPaths({ ...extra, [format]: [...new Set([...(extra[format] ?? []), dir])] });
  };

  if (!native_) {
    return (
      <div className="modal" role="dialog" aria-label="Plugin manager">
        <h2>Plugin manager</h2>
        <p>
          VST®3 and Audio Unit plugins are hosted by the native audio engine of the MAD Studio desktop app (macOS, Windows, Linux). The
          browser version can open projects that contain plugins, but cannot run them.
        </p>
        <div className="brand-logos">
          <VstLogo />
        </div>
        <div className="modal-actions">
          <button className="btn primary" onClick={closeDialog}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const fmtList = formats.length ? formats : Object.keys(paths);
  return (
    <div className="modal wide plugin-manager" role="dialog" aria-label="Plugin manager">
      <h2>Plugin manager</h2>
      <div className="pm-paths">
        {fmtList.map((fmt) => (
          <div key={fmt} className="pm-format">
            <div className="pm-format-head">
              <strong>{fmt === 'AudioUnit' ? 'Audio Units' : fmt === 'VST3' ? 'VST®3' : fmt}</strong>
              {fmt !== 'AudioUnit' && (
                <button className="btn" onClick={() => void addFolder(fmt)}>
                  + Add folder
                </button>
              )}
            </div>
            <ul>
              {fmt === 'AudioUnit' && <li className="faint">Installed system-wide (scanned through macOS)</li>}
              {(paths[fmt] ?? []).map((p) => (
                <li key={p}>{p}</li>
              ))}
              {(extra[fmt] ?? []).map((p) => (
                <li key={p}>
                  {p}{' '}
                  <button className="link" onClick={() => setExtraPaths({ ...extra, [fmt]: (extra[fmt] ?? []).filter((x) => x !== p) })}>
                    remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="pm-actions">
        <button className="btn primary" disabled={!!scanning} onClick={() => engine.scanPlugins({ paths: scanPaths() })}>
          Find installed plugins
        </button>
        <button className="btn" disabled={!!scanning} onClick={() => engine.scanPlugins({ paths: scanPaths(), rescanAll: true })} data-hint="Re-checks every plugin, also ones that failed before">
          Rescan all
        </button>
        {scanning && (
          <div className="pm-progress">
            <div className="pm-bar" style={{ width: `${scanning.total ? (scanning.index / scanning.total) * 100 : 5}%` }} />
            <span>
              {scanning.total ? `${scanning.index}/${scanning.total} ` : ''}
              {scanning.name}
            </span>
          </div>
        )}
        <span className="faint">Each plugin is checked in its own process – a crashing plugin cannot take MAD Studio down.</span>
      </div>
      <div className="pm-tabs">
        <div className="seg">
          <button className={tab === 'instruments' ? 'active' : ''} onClick={() => setTab('instruments')}>
            Instruments ({plugins.filter((p) => p.isInstrument).length})
          </button>
          <button className={tab === 'effects' ? 'active' : ''} onClick={() => setTab('effects')}>
            Effects ({plugins.filter((p) => !p.isInstrument).length})
          </button>
          <button className={tab === 'failed' ? 'active' : ''} onClick={() => setTab('failed')}>
            Errors ({failed.length})
          </button>
        </div>
        <input type="search" placeholder="Search plugins…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div className="pm-list">
        {tab === 'failed' ? (
          failed.length ? (
            <table>
              <tbody>
                {failed.map((f) => (
                  <tr key={`${f.format}:${f.fileOrIdentifier}`}>
                    <td>{f.fileOrIdentifier}</td>
                    <td>{f.format}</td>
                    <td className="error">{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="faint">No plugin failed to load.</p>
          )
        ) : shown.length ? (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Vendor</th>
                <th>Category</th>
                <th>Format</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.uid} onDoubleClick={() => add(p)}>
                  <td>{p.name}</td>
                  <td>{p.vendor}</td>
                  <td>{p.category}</td>
                  <td>{p.format === 'AudioUnit' ? 'AU' : p.format}</td>
                  <td>
                    <button className="btn" onClick={() => add(p)}>
                      {p.isInstrument ? 'Add channel' : 'Add to mixer track'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="faint">{plugins.length ? 'No plugin matches.' : 'No plugins known yet – click “Find installed plugins”.'}</p>
        )}
      </div>
      <div className="brand-logos">
        <VstLogo />
      </div>
      <div className="modal-actions">
        <button className="btn primary" onClick={closeDialog}>
          Close
        </button>
      </div>
    </div>
  );
}
