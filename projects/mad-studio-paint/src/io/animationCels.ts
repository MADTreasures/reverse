/**
 * File > Export animation > Export animation cels and Exposure sheet: the cels' file names (cel
 * name, sequence number, animation folder name + cel name or + number, with prefix, suffix and
 * separator, like the reference's) and the exposure sheet as CSV. Pure, unit tested.
 */
import { entryAt, type AnimationTrack } from '../paint/animation';
import type { Id } from '../model/types';

export type CelNameFormat = 'cel' | 'number' | 'folderCel' | 'folderNumber';

export const CEL_NAME_FORMATS: [CelNameFormat, string][] = [
  ['cel', 'Cel name'],
  ['number', 'Sequence number'],
  ['folderCel', 'Animation folder name + cel name'],
  ['folderNumber', 'Animation folder name + number'],
];

const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim();

/**
 * A cel's file name (without extension): prefix, the name in the chosen format and suffix, joined
 * by the separator (an empty one joins them directly). `index`: the cel's place in its folder, from 1.
 */
export function celFileName(o: { format: CelNameFormat; prefix: string; suffix: string; separator: string }, folder: string, cel: string, index: number): string {
  const number = String(index).padStart(4, '0');
  const core = o.format === 'cel' ? [cel] : o.format === 'number' ? [number] : o.format === 'folderCel' ? [folder, cel] : [folder, number];
  const sep = clean(o.separator);
  return [clean(o.prefix), ...core.map(clean), clean(o.suffix)].filter(Boolean).join(sep) || number;
}

/** Names unique within a folder: repeats get " (2)", " (3)" … */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const count = (seen.get(k) ?? 0) + 1;
    seen.set(k, count);
    return count === 1 ? n : `${n} (${count})`;
  });
}

export interface SheetColumn {
  /** The animation folder's parents ("Folder/Sub"), empty at the top level. */
  parent: string;
  name: string;
  track: AnimationTrack;
  /** Cel names by id. */
  cels: Map<Id, string>;
}

const csvCell = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * Exposure sheet (CSV): the first line has the animation folders' parents, the second their names,
 * then one line per frame (numbered from 1) with the cel assigned there in each column (an empty
 * assignment: ×; a cel that holds: nothing).
 */
export function exposureSheetCsv(columns: SheetColumn[], frames: number): string {
  const lines: string[][] = [
    ['', ...columns.map((c) => c.parent)],
    ['Frame', ...columns.map((c) => c.name)],
  ];
  for (let f = 1; f <= frames; f++) {
    lines.push([
      String(f),
      ...columns.map((c) => {
        const e = entryAt(c.track, f);
        return !e ? '' : e.cel === null ? '×' : (c.cels.get(e.cel) ?? '');
      }),
    ]);
  }
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
