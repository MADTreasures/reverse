/** File access and native integration, implemented by Electron (preload bridge) or the browser. */

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenedFile {
  name: string;
  data: Uint8Array;
  /** Native path (Electron) for later "Save" without a dialog. */
  path?: string;
}

export interface SavedFile {
  name: string;
  path?: string;
  handle?: FileSystemFileHandleLike;
}

/** Minimal shape of the File System Access API handle (Chromium browsers). */
export interface FileSystemFileHandleLike {
  name: string;
  createWritable(): Promise<{ write(data: Blob | BufferSource): Promise<void>; close(): Promise<void> }>;
}

/** Messages from the native engine process (see engine/PROTOCOL.md), plus the main process' own events. */
export interface EngineMessage {
  type: string;
  [key: string]: unknown;
}

/** Bridge to the native audio engine process (relayed by the Electron main process). */
export interface NativeEngineBridge {
  /** True when an engine binary is bundled / built. */
  available: boolean;
  /** Folder where audio recordings are written (FL: "Recorded"). */
  recordFolder: string;
  send(message: EngineMessage): void;
  onMessage(cb: (message: EngineMessage) => void): () => void;
  /** Sends PCM to the engine (written to a temporary raw file by the main process). */
  loadSample(id: string, sampleRate: number, channels: Float32Array[]): Promise<void>;
  /** Reads a file the engine produced (recording or render). */
  readFile(path: string): Promise<Uint8Array>;
  /** Path for a temporary render target. */
  tempPath(name: string): Promise<string>;
  restart(): void;
}

/** API exposed by electron/preload.cjs as window.madNative. */
export interface NativeBridge {
  engine?: NativeEngineBridge;
  platform: string;
  saveFile(opts: { suggestedName: string; data: Uint8Array; filters: FileFilter[]; path?: string }): Promise<{ path: string; name: string } | null>;
  openFile(opts: { filters: FileFilter[]; multiple?: boolean }): Promise<OpenedFile[] | null>;
  chooseFolder(title?: string): Promise<string | null>;
  onMenu(cb: (action: string) => void): () => void;
  onOpenFile(cb: (file: OpenedFile) => void): () => void;
  setDocumentEdited(edited: boolean): void;
  setTitle(title: string): void;
  ready(): void;
}

declare global {
  interface Window {
    madNative?: NativeBridge;
    showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandleLike>;
  }
}

export const native: NativeBridge | null = typeof window !== 'undefined' ? window.madNative ?? null : null;
export const isElectron = native !== null;
export const isMac =
  native?.platform === 'darwin' || (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));

/** Saves bytes; `target` re-uses a previous location ("Save" instead of "Save as"). */
export async function saveFile(
  data: Uint8Array,
  suggestedName: string,
  filters: FileFilter[],
  target?: SavedFile | null,
  mime = 'application/octet-stream',
): Promise<SavedFile | null> {
  if (native) {
    const res = await native.saveFile({ suggestedName, data, filters, path: target?.path });
    return res ? { name: res.name, path: res.path } : null;
  }
  const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: mime });
  if (target?.handle) {
    const w = await target.handle.createWritable();
    await w.write(blob);
    await w.close();
    return target;
  }
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: filters.map((f) => ({ description: f.name, accept: { [mime]: f.extensions.map((e) => `.${e}`) } })),
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return { name: handle.name, handle };
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
      // Fall through to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { name: suggestedName };
}

export async function openFiles(filters: FileFilter[], multiple = false): Promise<OpenedFile[] | null> {
  if (native) return native.openFile({ filters, multiple });
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
    input.style.display = 'none';
    let settled = false;
    input.onchange = async () => {
      settled = true;
      const files = [...(input.files ?? [])];
      input.remove();
      if (files.length === 0) return resolve(null);
      resolve(await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))));
    };
    input.addEventListener('cancel', () => {
      if (!settled) resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export const AUDIO_EXTENSIONS = ['wav', 'wave', 'aif', 'aiff', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'caf'];

export function isAudioFileName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTENSIONS.includes(ext);
}
