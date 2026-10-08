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

/** API exposed by electron/preload.cjs as window.madPaint. */
export interface NativeBridge {
  platform: string;
  saveFile(opts: { suggestedName: string; data: Uint8Array; filters: FileFilter[]; path?: string }): Promise<{ path: string; name: string } | null>;
  openFile(opts: { filters: FileFilter[]; multiple?: boolean }): Promise<OpenedFile[] | null>;
  onMenu(cb: (action: string) => void): () => void;
  onOpenFile(cb: (file: OpenedFile) => void): () => void;
  setDocumentEdited(edited: boolean): void;
  setTitle(title: string): void;
  /** Replaces the native menu (see ui/nativeMenu.ts). */
  setMenu(template: unknown): void;
  ready(): void;
}

declare global {
  interface Window {
    madPaint?: NativeBridge;
    showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandleLike>;
  }
}

export const native: NativeBridge | null = typeof window !== 'undefined' ? window.madPaint ?? null : null;
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
