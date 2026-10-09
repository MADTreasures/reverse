/**
 * File > Export animation > Image sequence: the picture types and the file names (prefix,
 * separator, zero-padded sequence number, suffix, like the reference's). Pure.
 */

export type SequenceType = 'bmp' | 'jpeg' | 'png' | 'webp' | 'tiff' | 'tga';

export const SEQUENCE_EXT: Record<SequenceType, string> = { bmp: 'bmp', jpeg: 'jpg', png: 'png', webp: 'webp', tiff: 'tif', tga: 'tga' };

/** File names like the reference's: prefix, separator, sequence number (zero-padded), suffix. */
export function sequenceNames(count: number, opts: { prefix: string; suffix: string; separator: string; start: number; ext: string }): string[] {
  const digits = Math.max(4, String(opts.start + count - 1).length);
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '');
  return Array.from({ length: count }, (_, i) => {
    const parts = [clean(opts.prefix), String(opts.start + i).padStart(digits, '0'), clean(opts.suffix)].filter(Boolean);
    return `${parts.join(opts.separator)}.${opts.ext}`;
  });
}
