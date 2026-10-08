/**
 * File > Export animation > Movie: encodes the frames (WebCodecs) and the sound mix and writes an
 * MP4 or QuickTime movie (see mp4.ts). H.264 and AAC where the system can encode them; otherwise
 * MP4 falls back to VP9 and Opus, and MOV to Photo-JPEG and 16-bit PCM, which QuickTime plays.
 */
import { interleave16 } from '../paint/sound';
import { muxMovie, type AudioCodec, type AudioTrack, type Sample, type VideoCodec, type VideoTrack } from './mp4';

export type MovieFormat = 'mp4' | 'mov';

export interface MovieCodecs {
  video: VideoCodec;
  /** WebCodecs codec string ('' for Photo-JPEG). */
  videoCodec: string;
  audio: AudioCodec | null;
  audioCodec: string;
  /** Opus always runs at 48 kHz. */
  sampleRate: number;
}

export const evenSize = (v: number) => Math.max(2, Math.floor(v / 2) * 2);

const LABELS: Record<string, string> = { avc1: 'H.264', vp09: 'VP9', jpeg: 'Photo-JPEG', mp4a: 'AAC', Opus: 'Opus', sowt: '16-bit PCM' };
export const codecLabel = (c: MovieCodecs) => `${LABELS[c.video]}${c.audio ? ` + ${LABELS[c.audio]}` : ''}`;

/** H.264 levels by size and rate (macroblocks per frame and per second). */
function avcLevel(w: number, h: number, fps: number): string {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
  const rate = mbs * fps;
  if (mbs <= 3600 && rate <= 108000) return '1f';
  if (mbs <= 8192 && rate <= 245760) return '28';
  if (mbs <= 22080 && rate <= 589824) return '32';
  if (mbs <= 36864 && rate <= 983040) return '33';
  return '34';
}

/** VP9 levels by picture size. */
function vp9Level(w: number, h: number): number {
  const n = w * h;
  return n <= 983040 ? 31 : n <= 2228224 ? 40 : n <= 8912896 ? 50 : 60;
}

async function videoSupported(codec: string, w: number, h: number, fps: number): Promise<boolean> {
  try {
    if (typeof VideoEncoder === 'undefined') return false;
    const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, framerate: fps, bitrate: 4e6, ...(codec.startsWith('avc1') ? { avc: { format: 'avc' as const } } : {}) });
    return Boolean(r.supported);
  } catch {
    return false;
  }
}

async function audioSupported(codec: string, sampleRate: number, channels: number): Promise<boolean> {
  try {
    if (typeof AudioEncoder === 'undefined') return false;
    const r = await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels: channels, bitrate: 128000 });
    return Boolean(r.supported);
  } catch {
    return false;
  }
}

/** The codecs a movie gets on this system (null: MP4 cannot be written here). */
export async function chooseCodecs(format: MovieFormat, w: number, h: number, fps: number, sampleRate: number, channels: number, sound: boolean): Promise<MovieCodecs | null> {
  // Constrained Baseline first: no reordered frames.
  const level = avcLevel(w, h, fps);
  let video: VideoCodec | null = null;
  let videoCodec = '';
  for (const c of [`avc1.42e0${level}`, `avc1.4d40${level}`, `avc1.6400${level}`]) {
    if (await videoSupported(c, w, h, fps)) {
      video = 'avc1';
      videoCodec = c;
      break;
    }
  }
  if (!video && format === 'mp4') {
    const c = `vp09.00.${vp9Level(w, h)}.08`;
    if (await videoSupported(c, w, h, fps)) {
      video = 'vp09';
      videoCodec = c;
    }
  }
  if (!video && format === 'mov') video = 'jpeg';
  if (!video) return null;
  let audio: AudioCodec | null = null;
  let audioCodec = '';
  let rate = sampleRate;
  if (sound) {
    if (await audioSupported('mp4a.40.2', sampleRate, channels)) {
      audio = 'mp4a';
      audioCodec = 'mp4a.40.2';
    } else if (format === 'mp4' && (await audioSupported('opus', 48000, channels))) {
      audio = 'Opus';
      audioCodec = 'opus';
      rate = 48000;
    } else if (format === 'mov') audio = 'sowt';
  }
  return { video, videoCodec, audio, audioCodec, sampleRate: rate };
}

export interface MovieJob {
  format: MovieFormat;
  codecs: MovieCodecs;
  width: number;
  height: number;
  fps: number;
  /** The timeline frame of each movie frame. */
  frames: number[];
  channels: number;
  /** A movie frame's picture (any size; drawn to fit). */
  render: (timelineFrame: number) => HTMLCanvasElement;
  /** The sound mix (null: none). */
  mix: () => Promise<AudioBuffer | null>;
  progress?: (done: number, total: number) => void;
}

const pause = () => new Promise((r) => setTimeout(r, 0));

async function encodeVideo(job: MovieJob): Promise<VideoTrack> {
  const { width: w, height: h, fps } = job;
  const timescale = fps * 100;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const draw = (f: number) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(job.render(f), 0, 0, w, h);
  };
  const samples: Sample[] = [];
  if (job.codecs.video === 'jpeg') {
    for (let i = 0; i < job.frames.length; i++) {
      draw(job.frames[i]);
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('JPEG encoding failed'))), 'image/jpeg', 0.92));
      samples.push({ data: new Uint8Array(await blob.arrayBuffer()), duration: 100, sync: true });
      job.progress?.(i + 1, job.frames.length);
    }
    return { kind: 'video', codec: 'jpeg', width: w, height: h, timescale, samples };
  }
  let description: Uint8Array | undefined;
  let failure: Error | null = null;
  const chunks: { data: Uint8Array; time: number; key: boolean }[] = [];
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ data, time: chunk.timestamp, key: chunk.type === 'key' });
      const d = meta?.decoderConfig?.description;
      if (d && !description) description = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array((d as ArrayBufferView).buffer.slice(0));
    },
    error: (e) => (failure = e as Error),
  });
  // About 0.15 bits per pixel and frame: clean pictures for drawn animation.
  const bitrate = Math.min(40e6, Math.max(1e6, Math.round(w * h * fps * 0.15)));
  encoder.configure({ codec: job.codecs.videoCodec, width: w, height: h, framerate: fps, bitrate, latencyMode: 'quality', ...(job.codecs.video === 'avc1' ? { avc: { format: 'avc' as const } } : {}) });
  const frameUs = 1e6 / fps;
  for (let i = 0; i < job.frames.length; i++) {
    if (failure) throw failure;
    draw(job.frames[i]);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
    // A key frame every two seconds.
    encoder.encode(frame, { keyFrame: i % Math.max(1, fps * 2) === 0 });
    frame.close();
    job.progress?.(i + 1, job.frames.length);
    while (encoder.encodeQueueSize > 4) await pause();
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  // Decode order; frames shown later than decoded keep that as an offset.
  chunks.forEach((c, i) => {
    const offset = Math.round(((c.time - i * frameUs) / 1e6) * timescale);
    samples.push({ data: c.data, duration: 100, sync: c.key, ...(offset ? { offset } : {}) });
  });
  return { kind: 'video', codec: job.codecs.video, width: w, height: h, timescale, description, vp9: { profile: 0, level: Number(job.codecs.videoCodec.split('.')[2] ?? 40), bitDepth: 8 }, samples };
}

async function encodeAudio(job: MovieJob, mix: AudioBuffer): Promise<AudioTrack> {
  const { codecs, channels } = job;
  const sampleRate = mix.sampleRate;
  const planes = Array.from({ length: channels }, (_, c) => mix.getChannelData(Math.min(c, mix.numberOfChannels - 1)));
  if (codecs.audio === 'sowt') return { kind: 'audio', codec: 'sowt', sampleRate, channels, samples: [], pcm: interleave16(planes) };
  let description: Uint8Array | undefined;
  let failure: Error | null = null;
  const samples: Sample[] = [];
  const timescale = codecs.audio === 'Opus' ? 48000 : sampleRate;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const duration = chunk.duration ? Math.round((chunk.duration / 1e6) * timescale) : codecs.audio === 'mp4a' ? 1024 : 960;
      samples.push({ data, duration, sync: true });
      const d = meta?.decoderConfig?.description;
      if (d && !description) description = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array((d as ArrayBufferView).buffer.slice(0));
    },
    error: (e) => (failure = e as Error),
  });
  const bitrate = codecs.audio === 'mp4a' ? 192000 : 128000;
  encoder.configure({ codec: codecs.audioCodec, sampleRate, numberOfChannels: channels, bitrate });
  const block = 4096;
  for (let i = 0; i < mix.length; i += block) {
    if (failure) throw failure;
    const n = Math.min(block, mix.length - i);
    const data = new Float32Array(n * channels);
    planes.forEach((p, c) => data.set(p.subarray(i, i + n), c * n));
    const ad = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((i / sampleRate) * 1e6), data });
    encoder.encode(ad);
    ad.close();
    while (encoder.encodeQueueSize > 8) await pause();
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  // Opus: the decoder skips the encoder's look-ahead (OpusHead's pre-skip, little-endian).
  const preSkip = codecs.audio === 'Opus' && description && description.length >= 12 ? description[10] | (description[11] << 8) : undefined;
  return { kind: 'audio', codec: codecs.audio!, sampleRate, channels, description: codecs.audio === 'mp4a' ? description : undefined, preSkip, bitrate, samples };
}

/** Encodes and writes the movie. */
export async function encodeMovie(job: MovieJob): Promise<Uint8Array> {
  const video = await encodeVideo(job);
  const mix = job.codecs.audio ? await job.mix() : null;
  const audio = mix ? await encodeAudio(job, mix) : null;
  return muxMovie(audio ? [video, audio] : [video], { qt: job.format === 'mov' });
}
