/**
 * Animated WebP (File > Export animation > Animated WebP): still WebP pictures (as the browser
 * encodes them: lossless VP8L, or lossy VP8 with an ALPH alpha chunk) joined into one animated
 * file — a VP8X header with the animation flag, an ANIM chunk (loop count) and one ANMF chunk per
 * frame. Every frame covers the whole picture and replaces the one before. Pure, unit tested.
 */

export interface WebpFrame {
  /** A complete still WebP file. */
  data: Uint8Array;
  /** Milliseconds the frame shows. */
  duration: number;
}

const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u16 = (v: number) => [v & 255, (v >> 8) & 255];
const u24 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255];
const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];

/** A RIFF chunk: fourcc, little-endian size, data, padded to an even size. */
function chunk(fourcc: string, data: ArrayLike<number>): number[] {
  const out = [...text(fourcc), ...u32(data.length), ...Array.from(data)];
  if (data.length % 2) out.push(0);
  return out;
}

/** The image chunks of a still WebP (ALPH, VP8, VP8L), as they are; its VP8X header is left out. */
export function imageChunks(webp: Uint8Array): { fourcc: string; data: Uint8Array }[] {
  const s = (o: number, n: number) => String.fromCharCode(...webp.subarray(o, o + n));
  if (webp.length < 12 || s(0, 4) !== 'RIFF' || s(8, 4) !== 'WEBP') throw new Error('Not a WebP picture');
  const out: { fourcc: string; data: Uint8Array }[] = [];
  let p = 12;
  while (p + 8 <= webp.length) {
    const fourcc = s(p, 4);
    const size = webp[p + 4] | (webp[p + 5] << 8) | (webp[p + 6] << 16) | (webp[p + 7] << 24);
    const data = webp.subarray(p + 8, p + 8 + size);
    if (fourcc === 'ALPH' || fourcc === 'VP8 ' || fourcc === 'VP8L') out.push({ fourcc, data });
    p += 8 + size + (size % 2);
  }
  if (!out.some((c) => c.fourcc === 'VP8 ' || c.fourcc === 'VP8L')) throw new Error('The WebP picture has no image data');
  return out;
}

/** The animated file. `loops`: times it plays (0: endlessly); `alpha`: frames keep their transparency. */
export function muxAnimatedWebp(frames: WebpFrame[], width: number, height: number, loops: number, alpha: boolean): Uint8Array {
  if (frames.length === 0) throw new Error('No frames');
  // VP8X: animation (bit 1) and alpha (bit 4); canvas size minus one, 24 bits each.
  const flags = 0x02 | (alpha ? 0x10 : 0);
  const body: number[] = [...chunk('VP8X', [flags, 0, 0, 0, ...u24(width - 1), ...u24(height - 1)])];
  // ANIM: background colour (BGRA, transparent white) and loop count.
  body.push(...chunk('ANIM', [255, 255, 255, 0, ...u16(Math.max(0, Math.min(65535, loops)))]));
  for (const f of frames) {
    const parts = imageChunks(f.data).flatMap((c) => chunk(c.fourcc, c.data));
    // Offset 0, 0; full size; duration; flags: no blending (bit 1), no disposal.
    const header = [...u24(0), ...u24(0), ...u24(width - 1), ...u24(height - 1), ...u24(Math.max(1, Math.min(0xffffff, Math.round(f.duration)))), 0x02];
    body.push(...chunk('ANMF', [...header, ...parts]));
  }
  return new Uint8Array([...text('RIFF'), ...u32(body.length + 4), ...text('WEBP'), ...body]);
}
