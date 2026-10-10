/**
 * Audio export (FL Studio: File › Export): WAV, FLAC, MP3 and Ogg Vorbis (desktop app), the song or a
 * pattern, optionally split into one file per mixer track ("Split mixer tracks", packed into a ZIP).
 */
import { zipSync } from 'fflate';
import { engine } from '../audio/engine';
import { encodeFlac } from '../audio/flac';
import { encodeMp3 } from '../audio/mp3';
import { bufferChannels } from '../audio/render';
import { stemProject, stemTracks } from '../model/stems';
import type { Project } from '../model/types';
import { saveFile } from '../platform/platform';
import { useStore } from '../store/store';
import { toast } from '../ui/overlays';

export type ExportFormat = 'wav' | 'flac' | 'mp3' | 'ogg';

export const EXPORT_FORMATS: { id: ExportFormat; label: string; ext: string; mime: string; desc: string }[] = [
  { id: 'wav', label: 'WAV', ext: 'wav', mime: 'audio/wav', desc: 'WAV audio' },
  { id: 'flac', label: 'FLAC', ext: 'flac', mime: 'audio/flac', desc: 'FLAC audio' },
  { id: 'mp3', label: 'MP3', ext: 'mp3', mime: 'audio/mpeg', desc: 'MP3 audio' },
  { id: 'ogg', label: 'OGG (Vorbis)', ext: 'ogg', mime: 'audio/ogg', desc: 'Ogg Vorbis audio' },
];

export interface ExportOptions {
  mode: 'song' | 'pattern';
  format: ExportFormat;
  sampleRate: number;
  /** WAV 16/24/32, FLAC 16/24. */
  bitDepth: 16 | 24 | 32;
  /** MP3 and Ogg Vorbis bit rate. */
  kbps: number;
  tail: number;
  loops: number;
  /** One file per mixer track (ZIP). */
  stems: boolean;
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Untitled';

/** Renders and encodes one file. */
async function renderOne(project: Project, opts: ExportOptions): Promise<Uint8Array> {
  const s = useStore.getState();
  const base = { mode: opts.mode, patternId: s.ui.selectedPatternId, sampleRate: opts.sampleRate, tail: opts.tail, loops: opts.loops, project };
  const intDepth = opts.bitDepth === 16 ? 16 : 24;
  if ((opts.format === 'ogg' || opts.format === 'flac') && engine.canEncode) {
    return engine.renderEncoded({ ...base, format: opts.format, bitDepth: intDepth, kbps: opts.kbps });
  }
  if (opts.format === 'ogg') throw new Error('Ogg Vorbis export needs the desktop app (native engine).');
  const { buffer, wav } = await engine.renderWav({ ...base, bitDepth: opts.format === 'wav' ? opts.bitDepth : 32 });
  if (opts.format === 'wav') return wav;
  const channels = bufferChannels(buffer);
  if (opts.format === 'flac') return encodeFlac(channels, buffer.sampleRate, intDepth);
  return encodeMp3(channels, buffer.sampleRate, opts.kbps);
}

/** Runs the export and asks where to save it; false when cancelled. */
export async function exportAudio(opts: ExportOptions, onProgress?: (text: string) => void): Promise<boolean> {
  const project = useStore.getState().project;
  const format = EXPORT_FORMATS.find((f) => f.id === opts.format)!;
  const base = safeName(project.name);
  if (!opts.stems) {
    onProgress?.('Rendering…');
    const data = await renderOne(project, opts);
    const saved = await saveFile(data, `${base}.${format.ext}`, [{ name: format.desc, extensions: [format.ext] }], null, format.mime);
    if (saved) toast(`Exported ${saved.name}`);
    return saved !== null;
  }
  const tracks = stemTracks(project);
  const files: Record<string, Uint8Array> = {};
  onProgress?.(`Rendering the master (1/${tracks.length + 1})…`);
  files[`00 - Master.${format.ext}`] = await renderOne(project, opts);
  for (const [n, i] of tracks.entries()) {
    onProgress?.(`Rendering ${project.mixer[i].name} (${n + 2}/${tracks.length + 1})…`);
    files[`${String(i).padStart(2, '0')} - ${safeName(project.mixer[i].name)}.${format.ext}`] = await renderOne(stemProject(project, i), opts);
  }
  // Compressed formats gain nothing from deflate; WAV a little.
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: opts.format === 'wav' ? 1 : 0 }]])));
  const saved = await saveFile(zip, `${base} (stems).zip`, [{ name: 'ZIP archive', extensions: ['zip'] }], null, 'application/zip');
  if (saved) toast(`Exported ${tracks.length + 1} stems to ${saved.name}`);
  return saved !== null;
}
