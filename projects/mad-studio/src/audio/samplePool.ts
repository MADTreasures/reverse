import { factorySampleId } from '../model/factory';
import { factorySampleKeys, generateFactorySample } from './factorySamples';

export interface SampleEntry {
  id: string;
  name: string;
  buffer: AudioBuffer;
  /** 'derived': an audio clip's variant (clipVariants.ts), recomputed instead of saved. */
  source: 'factory' | 'user' | 'derived';
  /** Original encoded file for user samples, written into saved projects. */
  bytes?: Uint8Array;
  fileName?: string;
  /** Derived samples: the source buffer they were computed from. */
  derivedFrom?: AudioBuffer;
}

/** Decoded audio for factory and user samples, shared by live playback and offline rendering. */
export class SamplePool {
  private entries = new Map<string, SampleEntry>();
  private reversed = new Map<string, AudioBuffer>();
  private peakCache = new Map<string, Float32Array>();
  private listeners = new Set<() => void>();
  private factoryRate = 0;

  get(id: string | null | undefined): SampleEntry | undefined {
    return id ? this.entries.get(id) : undefined;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  add(entry: SampleEntry): void {
    this.entries.set(entry.id, entry);
    this.invalidate(entry.id);
    this.emit();
  }

  remove(id: string): void {
    if (this.entries.delete(id)) {
      this.invalidate(id);
      this.emit();
    }
  }

  userEntries(): SampleEntry[] {
    return [...this.entries.values()].filter((e) => e.source === 'user');
  }

  derivedEntries(): SampleEntry[] {
    return [...this.entries.values()].filter((e) => e.source === 'derived');
  }

  clearUserSamples(): void {
    for (const e of this.userEntries()) {
      this.entries.delete(e.id);
      this.invalidate(e.id);
    }
    this.emit();
  }

  /** Playable buffer, optionally reversed (cached). */
  buffer(id: string | null | undefined, reversed = false): AudioBuffer | null {
    const entry = this.get(id);
    if (!entry) return null;
    if (!reversed) return entry.buffer;
    let rev = this.reversed.get(entry.id);
    if (!rev) {
      const src = entry.buffer;
      rev = new AudioBuffer({ length: src.length, numberOfChannels: src.numberOfChannels, sampleRate: src.sampleRate });
      for (let c = 0; c < src.numberOfChannels; c++) {
        const data = src.getChannelData(c).slice().reverse();
        rev.copyToChannel(data, c);
      }
      this.reversed.set(entry.id, rev);
    }
    return rev;
  }

  /** Min/max pairs per bucket (mono mix) for waveform drawing. */
  peaks(id: string, buckets: number): Float32Array | null {
    const entry = this.get(id);
    if (!entry || buckets <= 0) return null;
    const cacheKey = `${id}:${buckets}`;
    const cached = this.peakCache.get(cacheKey);
    if (cached) return cached;
    const buf = entry.buffer;
    const out = new Float32Array(buckets * 2);
    const per = buf.length / buckets;
    const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
    for (let b = 0; b < buckets; b++) {
      let lo = 0;
      let hi = 0;
      const from = Math.floor(b * per);
      const to = Math.min(buf.length, Math.max(from + 1, Math.floor((b + 1) * per)));
      for (let i = from; i < to; i++) {
        let v = 0;
        for (const ch of chans) v += ch[i];
        v /= chans.length;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      out[b * 2] = lo;
      out[b * 2 + 1] = hi;
    }
    this.peakCache.set(cacheKey, out);
    return out;
  }

  hasFactorySamples(): boolean {
    return this.factoryRate > 0;
  }

  /** Synthesises the built-in sounds at the given rate (once per rate). */
  ensureFactorySamples(sampleRate: number): void {
    if (this.factoryRate === sampleRate) return;
    for (const key of factorySampleKeys()) {
      const data = generateFactorySample(key, sampleRate);
      const buffer = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate });
      buffer.copyToChannel(data, 0);
      const id = factorySampleId(key);
      this.entries.set(id, { id, name: key, buffer, source: 'factory' });
      this.invalidate(id);
    }
    this.factoryRate = sampleRate;
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private invalidate(id: string): void {
    this.reversed.delete(id);
    for (const key of [...this.peakCache.keys()]) if (key.startsWith(`${id}:`)) this.peakCache.delete(key);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

export const samplePool = new SamplePool();

/** Decodes an audio file (WAV, AIFF, MP3, …) with the browser's decoder. */
export async function decodeAudioFile(bytes: Uint8Array, sampleRate = 44100): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  const copy = bytes.slice().buffer;
  return ctx.decodeAudioData(copy);
}
