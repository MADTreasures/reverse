import type { DragEvent as ReactDragEvent } from 'react';
import { factorySampleInfo, findFactorySample } from '../model/factory';
import type { SampleInfo } from '../model/types';
import { isAudioFileName, type OpenedFile } from '../platform/platform';
import { useStore } from '../store/store';

/** Drag & drop payloads between the browser panel and the editors. */
export const DND_MIME = 'application/x-mad-studio';

export type DragItem =
  | { type: 'sample'; sampleId: string; name: string; factoryKey?: string }
  | { type: 'preset'; presetId: string; name: string };

export function setDragItem(e: ReactDragEvent, item: DragItem): void {
  e.dataTransfer.setData(DND_MIME, JSON.stringify(item));
  e.dataTransfer.setData('text/plain', item.name);
  e.dataTransfer.effectAllowed = 'copy';
}

export function hasDragItem(e: ReactDragEvent | DragEvent): boolean {
  return [...(e.dataTransfer?.types ?? [])].includes(DND_MIME);
}

export function getDragItem(e: ReactDragEvent | DragEvent): DragItem | null {
  const raw = e.dataTransfer?.getData(DND_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragItem;
  } catch {
    return null;
  }
}

export function hasFiles(e: ReactDragEvent | DragEvent): boolean {
  return [...(e.dataTransfer?.types ?? [])].includes('Files');
}

export async function audioFilesFromDrop(e: ReactDragEvent | DragEvent): Promise<OpenedFile[]> {
  const files = [...(e.dataTransfer?.files ?? [])].filter((f) => isAudioFileName(f.name));
  return Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
}

/** Resolves a dragged sample to its SampleInfo and natural root key. */
export function sampleInfoFor(item: Extract<DragItem, { type: 'sample' }>): { info: SampleInfo; rootKey: number } {
  if (item.factoryKey) {
    return { info: factorySampleInfo(item.factoryKey), rootKey: findFactorySample(item.factoryKey)?.rootKey ?? 60 };
  }
  const info = useStore.getState().project.samples[item.sampleId] ?? { id: item.sampleId, name: item.name, source: 'user' as const };
  return { info, rootKey: 60 };
}
