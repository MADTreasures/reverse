/**
 * WAV files (File > Export animation > Audio): PCM samples of one or two channels, 16 or 24 bits,
 * little endian, interleaved. Pure, unit tested.
 */

export function encodeWav(channels: Float32Array[], sampleRate: number, bits: 16 | 24 = 16): Uint8Array {
  const n = channels.length;
  const length = channels[0]?.length ?? 0;
  const bytes = bits / 8;
  const dataSize = length * n * bytes;
  const out = new Uint8Array(44 + dataSize);
  const v = new DataView(out.buffer);
  const text = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  // PCM, channels, rate, bytes per second, block size, bits.
  v.setUint16(20, 1, true);
  v.setUint16(22, n, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * n * bytes, true);
  v.setUint16(32, n * bytes, true);
  v.setUint16(34, bits, true);
  text(36, 'data');
  v.setUint32(40, dataSize, true);
  const max = bits === 16 ? 32767 : 8388607;
  for (let i = 0, o = 44; i < length; i++) {
    for (let c = 0; c < n; c++, o += bytes) {
      const s = Math.round(Math.max(-1, Math.min(1, channels[c][i])) * max);
      if (bits === 16) v.setInt16(o, s, true);
      else {
        out[o] = s & 255;
        out[o + 1] = (s >> 8) & 255;
        out[o + 2] = (s >> 16) & 255;
      }
    }
  }
  return out;
}
