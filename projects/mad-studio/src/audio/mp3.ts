/**
 * MP3 export with LAME's JavaScript port (@breezystack/lamejs, LGPL-3.0), loaded only when an MP3 is
 * exported. Constant bit rate, 44.1 or 48 kHz, 16-bit input with the WAV export's TPDF dither.
 */
import { quantize } from './flac';

export const MP3_BITRATES = [128, 192, 256, 320] as const;
export const MP3_SAMPLE_RATES = [44100, 48000] as const;

export async function encodeMp3(channels: Float32Array[], sampleRate: number, kbps: number): Promise<Uint8Array> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const stereo = channels.length > 1;
  const encoder = new Mp3Encoder(stereo ? 2 : 1, sampleRate, kbps);
  const ints = quantize(channels.slice(0, 2), 16).map((c) => Int16Array.from(c));
  const chunks: Uint8Array[] = [];
  const frame = 1152;
  for (let i = 0; i < ints[0].length; i += frame) {
    const out = stereo ? encoder.encodeBuffer(ints[0].subarray(i, i + frame), ints[1].subarray(i, i + frame)) : encoder.encodeBuffer(ints[0].subarray(i, i + frame));
    if (out.length) chunks.push(new Uint8Array(out));
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(new Uint8Array(tail));
  const result = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}
