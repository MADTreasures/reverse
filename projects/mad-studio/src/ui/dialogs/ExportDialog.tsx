import { useState } from 'react';
import { findPattern, patternLength, songLength } from '../../model/patterns';
import { formatClock, ticksToSeconds } from '../../model/timing';
import { exportWav } from '../../project/projectIO';
import { useStore } from '../../store/store';
import { closeDialog, toast } from '../overlays';

export function ExportDialog() {
  const project = useStore((s) => s.project);
  const patternId = useStore((s) => s.ui.selectedPatternId);
  const defaultMode = useStore((s) => (s.project.clips.length > 0 ? 'song' : 'pattern'));
  const [mode, setMode] = useState<'song' | 'pattern'>(defaultMode);
  const [sampleRate, setSampleRate] = useState(44100);
  const [bitDepth, setBitDepth] = useState<16 | 24 | 32>(16);
  const [tail, setTail] = useState(2);
  const [loops, setLoops] = useState(4);
  const [busy, setBusy] = useState(false);

  const pattern = findPattern(project, patternId);
  const ticks = mode === 'song' ? songLength(project) : (pattern ? patternLength(pattern, project.beatsPerBar) : 0) * loops;
  const seconds = ticksToSeconds(ticks, project.bpm) + tail;

  const run = async () => {
    setBusy(true);
    try {
      const ok = await exportWav({ mode, sampleRate, bitDepth, tail, loops });
      if (ok) closeDialog();
    } catch (err) {
      toast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal" role="dialog" aria-label="Export WAV">
      <h2>Export WAV</h2>
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
            <label>Repeats</label>
            <select value={loops} onChange={(e) => setLoops(Number(e.target.value))}>
              {[1, 2, 4, 8, 16].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </>
        )}
        <label>Sample rate</label>
        <select value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value))}>
          <option value={44100}>44.1 kHz</option>
          <option value={48000}>48 kHz</option>
          <option value={96000}>96 kHz</option>
        </select>
        <label>Format</label>
        <select value={bitDepth} onChange={(e) => setBitDepth(Number(e.target.value) as 16 | 24 | 32)}>
          <option value={16}>16-bit PCM (dithered)</option>
          <option value={24}>24-bit PCM</option>
          <option value={32}>32-bit float</option>
        </select>
        <label>Tail</label>
        <select value={tail} onChange={(e) => setTail(Number(e.target.value))}>
          {[0, 1, 2, 4, 8].map((n) => (
            <option key={n} value={n}>
              {n} s
            </option>
          ))}
        </select>
        <label>Length</label>
        <div className="dim mono">{formatClock(seconds)}</div>
      </div>
      {mode === 'song' && project.clips.length === 0 && <p className="warn">The playlist is empty – place some patterns first or export the pattern.</p>}
      <div className="modal-actions">
        <button className="btn" onClick={closeDialog} disabled={busy}>
          Cancel
        </button>
        <button className="btn primary" onClick={run} disabled={busy}>
          {busy ? 'Rendering…' : 'Render & save'}
        </button>
      </div>
    </div>
  );
}
