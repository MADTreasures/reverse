import { useEffect } from 'react';
import { engine } from '../../audio/engine';
import { native } from '../../platform/platform';
import { usePlugins } from '../../plugins/pluginStore';
import { setTransport } from '../../store/actions';
import { useStore } from '../../store/store';
import { AsioLogo } from '../brand/SteinbergLogos';
import { closeDialog } from '../overlays';

const ms = (samples: number, rate: number) => (rate > 0 ? `${((samples / rate) * 1000).toFixed(1)} ms` : '–');

/** FL Studio's Options › Audio settings: device, sample rate, buffer and recording options. */
export function AudioSettingsDialog() {
  const nativeEngine = usePlugins((s) => s.nativeEngine);
  const engineError = usePlugins((s) => s.engineError);
  const device = usePlugins((s) => s.device);
  const types = usePlugins((s) => s.deviceTypes);
  const rates = usePlugins((s) => s.sampleRates);
  const buffers = usePlugins((s) => s.bufferSizes);
  const t = useStore((s) => s.transport);

  useEffect(() => {
    if (nativeEngine) engine.getAudioDevices();
  }, [nativeEngine]);

  const type = types.find((x) => x.name === device?.type) ?? types[0];
  // ASIO drivers are one device for inputs and outputs (FL Studio shows a single device list).
  const sharedDevice = type?.separateInputs === false;
  // Steinberg's ASIO usage guidelines: the logo in every dialog that enables or configures ASIO.
  const asioAvailable = types.some((x) => x.name === 'ASIO');

  return (
    <div className="modal wide audio-settings" role="dialog" aria-label="Audio settings">
      <h2>Audio settings</h2>
      {nativeEngine ? (
        <div className="settings-grid">
          <label>Driver</label>
          <select value={device?.type ?? ''} onChange={(e) => engine.setAudioDevice({ type: e.target.value })}>
            {types.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name === 'ASIO' ? 'ASIO®' : x.name}
              </option>
            ))}
          </select>
          <label>{sharedDevice ? 'Device' : 'Output'}</label>
          <select value={device?.output ?? ''} onChange={(e) => engine.setAudioDevice({ output: e.target.value })}>
            {(type?.outputs ?? []).map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          <label>Input</label>
          {sharedDevice ? (
            <select value={device?.input ? 'device' : ''} onChange={(e) => engine.setAudioDevice({ input: e.target.value ? (device?.output ?? '') : 'none' })}>
              <option value="">(none)</option>
              <option value="device">Inputs of the device</option>
            </select>
          ) : (
            <select value={device?.input ?? ''} onChange={(e) => engine.setAudioDevice({ input: e.target.value || 'none' })}>
              <option value="">(none)</option>
              {(type?.inputs ?? []).map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          )}
          {device?.hasControlPanel && (
            <>
              <label>Driver settings</label>
              <span>
                <button className="btn" onClick={() => engine.showAudioControlPanel()}>
                  Show {device.type === 'ASIO' ? 'ASIO' : 'driver'} panel
                </button>
              </span>
            </>
          )}
          <label>Sample rate</label>
          <select value={device?.sampleRate ?? ''} onChange={(e) => engine.setAudioDevice({ sampleRate: Number(e.target.value) })}>
            {rates.map((r) => (
              <option key={r} value={r}>
                {r} Hz
              </option>
            ))}
          </select>
          <label>Buffer length</label>
          <select value={device?.bufferSize ?? ''} onChange={(e) => engine.setAudioDevice({ bufferSize: Number(e.target.value) })}>
            {buffers.map((b) => (
              <option key={b} value={b}>
                {b} samples ({ms(b, device?.sampleRate ?? 0)})
              </option>
            ))}
          </select>
          <label>Latency</label>
          <span>
            {device
              ? `input ${ms(device.inputLatency, device.sampleRate)} · output ${ms(device.outputLatency, device.sampleRate)} · inputs: ${device.inputChannels.join(', ') || 'none'}`
              : 'Waiting for the engine…'}
          </span>
          {asioAvailable && (
            <div className="brand-logos span2">
              <AsioLogo />
            </div>
          )}
          {device?.null && (
            <p className="notice span2">
              No audio device could be opened – the engine runs silently (timing and meters still work). Connect a device or pick another
              driver.
            </p>
          )}
        </div>
      ) : (
        <div className="settings-grid">
          <label>Engine</label>
          <span>Browser audio engine (Web Audio){native?.engine?.available ? '' : ''}</span>
          {engineError && <p className="notice span2">Native engine unavailable: {engineError}</p>}
          <label>Output</label>
          <span>System default output · sample rate {engine.sampleRate} Hz</span>
          <label>Input</label>
          <span>System default input (choose it in your operating system's sound settings)</span>
        </div>
      )}

      <h3>Recording</h3>
      <div className="settings-grid">
        <label>Monitor input</label>
        <select value={t.monitoring} onChange={(e) => setTransport({ monitoring: e.target.value as typeof t.monitoring })}>
          <option value="off">Off</option>
          <option value="armed">When armed</option>
          <option value="on">On</option>
        </select>
        <label>Options</label>
        <div className="checks">
          <label className="check">
            <input type="checkbox" checked={t.latencyCompensation} onChange={() => setTransport({ latencyCompensation: !t.latencyCompensation })} />
            Latency compensation
          </label>
          <label className="check">
            <input type="checkbox" checked={t.precount} onChange={() => setTransport({ precount: !t.precount })} />
            Precount (one bar)
          </label>
          <label className="check">
            <input type="checkbox" checked={t.autoUnarm} onChange={() => setTransport({ autoUnarm: !t.autoUnarm })} />
            Auto-unarm after recording
          </label>
        </div>
        <label>Saved to</label>
        <span>{nativeEngine && native?.engine?.recordFolder ? native.engine.recordFolder : 'Inside the project file'}</span>
      </div>
      <div className="modal-actions">
        <button className="btn primary" onClick={closeDialog}>
          Close
        </button>
      </div>
    </div>
  );
}
