import { engine } from '../audio/engine';
import { decodeAudioFile, samplePool } from '../audio/samplePool';
import { paletteColor } from '../model/colors';
import { createEmptyProject, createSamplerChannel } from '../model/defaults';
import { createDemoProject } from '../model/demo';
import { makeId } from '../model/ids';
import { PROJECT_EXTENSION, packProject, unpackProject, type SampleFile } from '../model/serialization';
import { TICKS_PER_STEP, secondsToTicks } from '../model/timing';
import type { Id, Project, SampleInfo } from '../model/types';
import { AUDIO_EXTENSIONS, native, openFiles, saveFile, type OpenedFile, type SavedFile } from '../platform/platform';
import {
  addChannel,
  addClip,
  loadProject,
  markSaved,
  registerSample,
  setChannelSample,
} from '../store/actions';
import { useStore } from '../store/store';
import { confirmDialog, toast } from '../ui/overlays';
import { idbDelete, idbGet, idbSet } from './idb';

const PROJECT_FILTERS = [{ name: 'MAD Studio Project', extensions: [PROJECT_EXTENSION, 'json'] }];
const AUTOSAVE_KEY = 'autosave';

let currentFile: SavedFile | null = null;

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/** Asks before discarding unsaved changes. */
export async function confirmDiscard(): Promise<boolean> {
  if (!useStore.getState().dirty) return true;
  return confirmDialog('Unsaved changes', 'The current project has unsaved changes. Discard them?', 'Discard', true);
}

function replaceProject(project: Project, fileName: string | null, file: SavedFile | null): void {
  engine.stop();
  loadProject(project, fileName);
  currentFile = file;
}

export async function newProject(): Promise<void> {
  if (!(await confirmDiscard())) return;
  samplePool.clearUserSamples();
  replaceProject(createEmptyProject(), null, null);
}

export async function openDemo(): Promise<void> {
  if (!(await confirmDiscard())) return;
  samplePool.clearUserSamples();
  replaceProject(createDemoProject(), null, null);
}

/** Decodes the user samples of a bundle into the sample pool. Returns names that failed. */
async function loadSamples(project: Project, files: SampleFile[]): Promise<string[]> {
  samplePool.clearUserSamples();
  const failed: string[] = [];
  await Promise.all(
    files.map(async (f) => {
      try {
        const buffer = await decodeAudioFile(f.bytes, engine.sampleRate);
        samplePool.add({ id: f.id, name: project.samples[f.id]?.name ?? f.fileName, buffer, source: 'user', bytes: f.bytes, fileName: f.fileName });
      } catch {
        failed.push(f.fileName);
      }
    }),
  );
  return failed;
}

export async function openProjectBytes(file: OpenedFile): Promise<boolean> {
  try {
    const { project, samples } = unpackProject(file.data);
    const failed = await loadSamples(project, samples);
    replaceProject(project, file.name, file.path ? { name: file.name, path: file.path } : null);
    if (project.name === 'Untitled') useStore.setState((s) => ({ project: { ...s.project, name: baseName(file.name) } }));
    if (failed.length) toast(`Could not decode: ${failed.join(', ')}`, 'error');
    else toast(`Opened ${file.name}`);
    return true;
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not open the project.', 'error');
    return false;
  }
}

export async function openProjectDialog(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const files = await openFiles(PROJECT_FILTERS);
  if (files?.[0]) await openProjectBytes(files[0]);
}

/** Bundles the project with every user sample it references. */
export function buildProjectBundle(project: Project = useStore.getState().project): Uint8Array {
  const samples: SampleFile[] = [];
  for (const entry of samplePool.userEntries()) {
    if (project.samples[entry.id] && entry.bytes) {
      samples.push({ id: entry.id, fileName: entry.fileName ?? `${entry.id}.wav`, bytes: entry.bytes });
    }
  }
  return packProject(project, samples);
}

export async function saveProject(saveAs = false): Promise<boolean> {
  const { project } = useStore.getState();
  const suggested = `${project.name.replace(/[\\/:*?"<>|]/g, '_') || 'Untitled'}.${PROJECT_EXTENSION}`;
  try {
    const saved = await saveFile(buildProjectBundle(project), suggested, PROJECT_FILTERS, saveAs ? null : currentFile);
    if (!saved) return false;
    currentFile = saved;
    markSaved(saved.name);
    toast(`Saved ${saved.name}`);
    void idbDelete(AUTOSAVE_KEY);
    return true;
  } catch (err) {
    toast(`Saving failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Samples

export interface ImportedSample {
  info: SampleInfo;
  duration: number;
}

/** Decodes audio files and registers them as user samples. */
export async function importAudioFiles(files: OpenedFile[]): Promise<ImportedSample[]> {
  const out: ImportedSample[] = [];
  for (const f of files) {
    try {
      const buffer = await decodeAudioFile(f.data, engine.sampleRate);
      const id = makeId('smp');
      const info: SampleInfo = { id, name: baseName(f.name), source: 'user', fileName: f.name };
      samplePool.add({ id, name: info.name, buffer, source: 'user', bytes: f.data, fileName: f.name });
      registerSample(info);
      out.push({ info, duration: buffer.duration });
    } catch {
      toast(`Unsupported or damaged audio file: ${f.name}`, 'error');
    }
  }
  return out;
}

export async function importSamplesDialog(): Promise<ImportedSample[]> {
  const files = await openFiles([{ name: 'Audio', extensions: AUDIO_EXTENSIONS }], true);
  if (!files) return [];
  const imported = await importAudioFiles(files);
  if (imported.length) toast(`Imported ${imported.length} sample${imported.length > 1 ? 's' : ''}`);
  return imported;
}

/** New sampler channel playing the given sample. */
export function addSamplerChannelFor(info: SampleInfo, rootKey = 60): Id {
  const project = useStore.getState().project;
  return addChannel(
    createSamplerChannel({
      name: info.name,
      sampleId: info.id,
      color: paletteColor(project.channels.length),
      params: { rootKey },
    }),
    { samples: [info] },
  );
}

export function assignSampleToChannel(channelId: Id, info: SampleInfo, rootKey?: number): void {
  setChannelSample(channelId, info, rootKey);
}

/** Places a sample on the playlist as an audio clip with its own channel. */
export function createAudioClip(info: SampleInfo, trackId: Id, tick: number): Id | null {
  const entry = samplePool.get(info.id);
  if (!entry) return null;
  const project = useStore.getState().project;
  const channelId = addChannel(
    createSamplerChannel({
      name: info.name,
      sampleId: info.id,
      color: paletteColor(project.channels.length + 2),
      params: { oneShot: true },
      audioClip: true,
    }),
    { samples: [info], select: false },
  );
  const ticks = secondsToTicks(entry.buffer.duration, project.bpm);
  const length = Math.max(TICKS_PER_STEP, Math.ceil(ticks / TICKS_PER_STEP) * TICKS_PER_STEP);
  return addClip({ kind: 'audio', channelId, trackId, start: Math.max(0, Math.round(tick)), length, offset: 0 });
}

// ---------------------------------------------------------------------------
// Export

export async function exportWav(opts: {
  mode: 'song' | 'pattern';
  sampleRate: number;
  bitDepth: 16 | 24 | 32;
  tail: number;
  loops: number;
}): Promise<boolean> {
  const s = useStore.getState();
  const { wav } = await engine.renderWav({
    mode: opts.mode,
    patternId: s.ui.selectedPatternId,
    sampleRate: opts.sampleRate,
    tail: opts.tail,
    loops: opts.loops,
    bitDepth: opts.bitDepth,
  });
  const base = s.project.name.replace(/[\\/:*?"<>|]/g, '_') || 'Untitled';
  const saved = await saveFile(wav, `${base}.wav`, [{ name: 'WAV audio', extensions: ['wav'] }], null, 'audio/wav');
  if (saved) toast(`Exported ${saved.name}`);
  return saved !== null;
}

// ---------------------------------------------------------------------------
// Autosave & start-up

let autosaveTimer: ReturnType<typeof setInterval> | null = null;
let lastAutosaved: Project | null = null;

export function startAutosave(): void {
  if (autosaveTimer) return;
  autosaveTimer = setInterval(() => {
    const s = useStore.getState();
    if (!s.dirty || s.project === lastAutosaved) return;
    lastAutosaved = s.project;
    void idbSet(AUTOSAVE_KEY, { bundle: buildProjectBundle(s.project), fileName: s.fileName, savedAt: Date.now() });
  }, 4000);
}

/** Restores the last autosave, or loads the demo song on first start. */
export async function restoreSession(): Promise<'autosave' | 'demo'> {
  const saved = await idbGet<{ bundle: Uint8Array; fileName: string | null }>(AUTOSAVE_KEY);
  if (saved?.bundle) {
    try {
      const { project, samples } = unpackProject(saved.bundle);
      await loadSamples(project, samples);
      loadProject(project, saved.fileName);
      useStore.setState({ dirty: true });
      return 'autosave';
    } catch {
      void idbDelete(AUTOSAVE_KEY);
    }
  }
  loadProject(createDemoProject(), null);
  return 'demo';
}

/** Electron: files opened via Finder (double-click on a .madstudio file). */
export function listenForNativeOpen(): void {
  native?.onOpenFile(async (file) => {
    if (await confirmDiscard()) await openProjectBytes(file);
  });
}
