export type WavBitDepth = 16 | 24 | 32;

/**
 * Encodes PCM channels as a RIFF/WAVE file. 16 and 24 bit are integer PCM
 * (16 bit with TPDF dither), 32 bit is IEEE float.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number, bitDepth: WavBitDepth = 16): Uint8Array {
  const numChannels = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  let seed = 22222;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const x = channels[c][i];
      const s = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
      if (bitDepth === 16) {
        const dither = (rand() - rand()) / 32768;
        const v = Math.round(Math.max(-1, Math.min(1, s + dither)) * 32767);
        view.setInt16(offset, v, true);
      } else if (bitDepth === 24) {
        const v = Math.round(s * 8388607);
        view.setUint8(offset, v & 0xff);
        view.setUint8(offset + 1, (v >> 8) & 0xff);
        view.setUint8(offset + 2, (v >> 16) & 0xff);
      } else {
        view.setFloat32(offset, s, true);
      }
      offset += bytesPerSample;
    }
  }
  return new Uint8Array(buffer);
}

export interface SignalStats {
  peak: number;
  rms: number;
  nonFinite: number;
}

export function signalStats(channels: Float32Array[]): SignalStats {
  let peak = 0;
  let sum = 0;
  let count = 0;
  let nonFinite = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      if (!Number.isFinite(v)) {
        nonFinite++;
        continue;
      }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
      count++;
    }
  }
  return { peak, rms: count ? Math.sqrt(sum / count) : 0, nonFinite };
}
