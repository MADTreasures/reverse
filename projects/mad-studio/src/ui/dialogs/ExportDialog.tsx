import { useState } from 'react';
import { engine } from '../../audio/engine';
import { MP3_BITRATES, MP3_SAMPLE_RATES } from '../../audio/mp3';
import { findPattern, patternLength, songLength } from '../../model/patterns';
import { formatClock, ticksToSeconds } from '../../model/timing';
import { stemTracks } from '../../model/stems';
import { EXPORT_FORMATS, exportAudio, type ExportFormat } from '../../project/exportAudio';
import { useStore } from '../../store/store';
import { closeDialog, toast } from '../overlays';

const OGG_BITRATES = [96, 128, 160, 192, 256, 320] as const;

/** FL Studio's export dialog: WAV, FLAC, MP3, OGG; song or pattern; optionally split mixer tracks. */
export function ExportDialog() {
  const project = useStore((s) => s.project);
  const patternId = useStore((s) => s.ui.selectedPatternId);
  const defaultMode = useStore((s) => (s.project.clips.length > 0 ? 'song' : 'pattern'));
  const [mode, setMode] = useState<'song' | 'pattern'>(defaultMode);
  const [format, setFormat] = useState<ExportFormat>('wav');
  const [sampleRate, setSampleRate] = useState(44100);
  const [bitDepth, setBitDepth] = useState<16 | 24 | 32>(16);
  const [kbps, setKbps] = useState(320);
  const [tail, setTail] = useState(2);
  const [loops, setLoops] = useState(4);
  const [stems, setStems] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const pattern = findPattern(project, patternId);
  const ticks = mode === 'song' ? songLength(project) : (pattern ? patternLength(pattern, project.beatsPerBar) : 0) * loops;
  const seconds = ticksToSeconds(ticks, project.bpm) + tail;
  const oggAvailable = engine.canEncode;
  const rates = format === 'mp3' ? MP3_SAMPLE_RATES : ([44100, 48000, 96000] as const);
  const rate = (rates as readonly number[]).includes(sampleRate) ? sampleRate : 44100;
  const depth = format === 'flac' && bitDepth === 32 ? 24 : bitDepth;
  const bitrate = format === 'mp3' ? ((MP3_BITRATES as readonly number[]).includes(kbps) ? kbps : 320) : (OGG_BITRATES as readonly number[]).includes(kbps) ? kbps : 192;
  const stemCount = stemTracks(project).length + 1;

  const run = async () => {
    setBusy('Rendering…');
    try {
      const ok = await exportAudio({ mode, format, sampleRate: rate, bitDepth: depth, kbps: bitrate, tail, loops, stems }, setBusy);
      if (ok) closeDialog();
    } catch (err) {
      toast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal" role="dialog" aria-label="Export">
      <h2>Export</h2>
      <div className="form-grid">
        <label>Source</label>
        <div className="seg">
          <button className={mode === 'song' ? 'active' : ''} onClick={() => setMode('song')}>
            Song (playlist)
          </button>
          <button className={mode === 'pattern' ? 'active' : ''} onClick={() => setMode('pattern')}>
            Pattern “{pattern?.name}”
          </button>
        </div>
        {mode === 'pattern' && (
          <>
            <label htmlFor="export-repeats">Repeats</label>
            <select id="export-repeats" value={loops} onChange={(e) => setLoops(Number(e.target.value))}>
              {[1, 2, 4, 8, 16].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </>
        )}
        <label htmlFor="export-format">Format</label>
        <select id="export-format" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
          {EXPORT_FORMATS.map((f) => (
            <option key={f.id} value={f.id} disabled={f.id === 'ogg' && !oggAvailable}>
              {f.label}
              {f.id === 'ogg' && !oggAvailable ? ' – desktop app' : ''}
            </option>
          ))}
        </select>
        <label htmlFor="export-rate">Sample rate</label>
        <select id="export-rate" value={rate} onChange={(e) => setSampleRate(Number(e.target.value))}>
          {rates.map((r) => (
            <option key={r} value={r}>
              {r / 1000} kHz
            </option>
          ))}
        </select>
        {(format === 'wav' || format === 'flac') && (
          <>
            <label htmlFor="export-depth">Depth</label>
            <select id="export-depth" value={depth} onChange={(e) => setBitDepth(Number(e.target.value) as 16 | 24 | 32)}>
              <option value={16}>16-bit PCM (dithered)</option>
              <option value={24}>24-bit PCM</option>
              {format === 'wav' && <option value={32}>32-bit float</option>}
            </select>
          </>
        )}
        {(format === 'mp3' || format === 'ogg') && (
          <>
            <label htmlFor="export-bitrate">Bit rate</label>
            <select id="export-bitrate" value={bitrate} onChange={(e) => setKbps(Number(e.target.value))}>
              {(format === 'mp3' ? MP3_BITRATES : OGG_BITRATES).map((b) => (
                <option key={b} value={b}>
                  {b} kbps
                </option>
              ))}
            </select>
          </>
        )}
        <label htmlFor="export-tail">Tail</label>
        <select id="export-tail" value={tail} onChange={(e) => setTail(Number(e.target.value))}>
          {[0, 1, 2, 4, 8].map((n) => (
            <option key={n} value={n}>
              {n} s
            </option>
          ))}
        </select>
        <label>Split mixer tracks</label>
        <label className="cs-check" data-hint="One file per mixer track that carries audio (soloed, through the tracks it is routed to), plus the master, in a ZIP">
          <input type="checkbox" checked={stems} onChange={(e) => setStems(e.target.checked)} aria-label="Split mixer tracks" />
          {stems ? `${stemCount} files in a ZIP` : 'Off'}
        </label>
        <label>Length</label>
        <div className="dim mono">{formatClock(seconds)}</div>
      </div>
      {mode === 'song' && project.clips.length === 0 && <p className="warn">The playlist is empty – place some patterns first or export the pattern.</p>}
      <div className="modal-actions">
        <button className="btn" onClick={closeDialog} disabled={busy !== null}>
          Cancel
        </button>
        <button className="btn primary" onClick={run} disabled={busy !== null}>
          {busy ?? 'Render & save'}
        </button>
      </div>
    </div>
  );
}
