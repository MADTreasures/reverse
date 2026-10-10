/**
 * MIDI file import and export (FL Studio: File › Import / Export › MIDI file).
 */
import { readMidiFile, writeMidiFile, type MidiExportNote } from '../model/midiFile';
import { patternTimeline, songTimeline } from '../model/timeline';
import { openFiles, saveFile } from '../platform/platform';
import { importMidiData } from '../store/actions';
import { useStore } from '../store/store';
import { toast } from '../ui/overlays';

const MIDI_FILTER = [{ name: 'MIDI files', extensions: ['mid', 'midi'] }];

/** Imports MIDI file bytes; returns the number of notes. */
export function importMidiBytes(data: Uint8Array, fileName: string): number {
  const midi = readMidiFile(data);
  if (midi.tracks.length === 0) {
    toast(`${fileName} contains no notes.`, 'error');
    return 0;
  }
  const name = fileName.replace(/\.(mid|midi)$/i, '') || 'MIDI';
  const r = importMidiData(midi, name);
  toast(`Imported ${r.notes} note${r.notes === 1 ? '' : 's'} on ${r.channels} channel${r.channels === 1 ? '' : 's'} into pattern “${name}”.`);
  return r.notes;
}

export async function importMidiDialog(): Promise<void> {
  const files = await openFiles(MIDI_FILTER, true);
  for (const f of files ?? []) {
    try {
      importMidiBytes(f.data, f.name);
    } catch (err) {
      toast(`${f.name}: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }
}

/** The notes of the song (or the selected pattern) as MIDI export notes; audio clips are left out. */
export function midiExportNotes(mode: 'song' | 'pattern'): MidiExportNote[] {
  const s = useStore.getState();
  const tl = mode === 'song' ? songTimeline(s.project) : patternTimeline(s.project, s.ui.selectedPatternId);
  return tl.events.filter((e) => !e.audioClip).map((e) => ({ channelId: e.channelId, tick: e.tick, length: e.length, key: e.key, velocity: e.velocity }));
}

export async function exportMidiDialog(): Promise<void> {
  const s = useStore.getState();
  const mode = s.transport.mode === 'song' && s.project.clips.length > 0 ? 'song' : 'pattern';
  const notes = midiExportNotes(mode);
  if (notes.length === 0) {
    toast('There are no notes to export.', 'error');
    return;
  }
  const data = writeMidiFile(s.project, notes, { song: mode === 'song' });
  const base = s.project.name.replace(/[\\/:*?"<>|]/g, '_') || 'Untitled';
  const saved = await saveFile(data, `${base}.mid`, MIDI_FILTER, null, 'audio/midi');
  if (saved) toast(`Exported ${mode === 'song' ? 'the song' : 'the pattern'} to ${saved.name}`);
}
