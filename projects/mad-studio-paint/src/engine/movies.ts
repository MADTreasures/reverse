/**
 * Movies at run time (File > Import > Movie): the bytes of the document's movie files, a hidden
 * video element per movie that seeks to the times the timeline shows, and a small cache of the
 * decoded pictures. The display asks for pictures without waiting (it shows the nearest one it has
 * until the exact one is decoded); exports wait for each picture (prepareMovieFrame).
 */
import { createCanvas, ctx2d } from './canvas';

interface Movie {
  bytes: Uint8Array;
  type: string;
  url: string;
  video: HTMLVideoElement;
  ready: Promise<boolean>;
  /** Seeks run one after another. */
  queue: Promise<void>;
  pending: Set<number>;
}

const movies = new Map<string, Movie>();
/** Decoded pictures by movie and time (ms), oldest first. */
const frames = new Map<string, HTMLCanvasElement>();
const MAX_FRAMES = 90;
/** Longest side of a cached picture. */
const MAX_SIDE = 1920;
const listeners = new Set<() => void>();

export const onMovieFrame = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const key = (id: string, ms: number) => `${id}@${ms}`;
const toMs = (time: number) => Math.max(0, Math.round(time * 1000));

function loadVideo(url: string): { video: HTMLVideoElement; ready: Promise<boolean> } {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  const ready = new Promise<boolean>((resolve) => {
    video.onloadeddata = () => resolve(true);
    video.onerror = () => resolve(false);
  });
  video.src = url;
  return { video, ready };
}

export function setMovieBytes(id: string, bytes: Uint8Array, type: string): void {
  forgetMovie(id);
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type }));
  const { video, ready } = loadVideo(url);
  movies.set(id, { bytes, type, url, video, ready, queue: Promise.resolve(), pending: new Set() });
}

export const movieBytes = (id: string): { bytes: Uint8Array; type: string } | null => {
  const m = movies.get(id);
  return m ? { bytes: m.bytes, type: m.type } : null;
};

function forgetMovie(id: string): void {
  const m = movies.get(id);
  if (!m) return;
  URL.revokeObjectURL(m.url);
  m.video.removeAttribute('src');
  movies.delete(id);
  for (const k of [...frames.keys()]) if (k.startsWith(`${id}@`)) frames.delete(k);
}

/** Forgets every movie (a document is opened). */
export function clearMovies(): void {
  for (const id of [...movies.keys()]) forgetMovie(id);
}

/** Size and length of a movie the system can play, or null. */
export async function probeMovie(bytes: Uint8Array, type: string): Promise<{ width: number; height: number; duration: number } | null> {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type }));
  try {
    const { video, ready } = loadVideo(url);
    const ok = await Promise.race([ready, new Promise<boolean>((r) => setTimeout(() => r(false), 15000))]);
    if (!ok || !video.videoWidth || !Number.isFinite(video.duration)) return null;
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}

let probe: CanvasRenderingContext2D | null = null;

/** Whether the video has a picture to draw (videos are opaque: a transparent probe means nothing came yet). */
function drawable(v: HTMLVideoElement): boolean {
  probe ??= ctx2d(createCanvas(4, 4), true);
  probe.clearRect(0, 0, 4, 4);
  probe.drawImage(v, 0, 0, 4, 4);
  const d = probe.getImageData(0, 0, 4, 4).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  return false;
}

function remember(k: string, c: HTMLCanvasElement): void {
  frames.delete(k);
  frames.set(k, c);
  while (frames.size > MAX_FRAMES) frames.delete(frames.keys().next().value!);
}

/** Seeks and copies the picture at `ms` (queued behind other seeks of the movie). */
function decode(id: string, ms: number): Promise<void> {
  const m = movies.get(id);
  if (!m) return Promise.resolve();
  if (frames.has(key(id, ms))) return Promise.resolve();
  if (m.pending.has(ms)) return m.queue;
  m.pending.add(ms);
  m.queue = m.queue.then(async () => {
    try {
      if (!(await m.ready) || frames.has(key(id, ms))) return;
      const v = m.video;
      const t = Math.min(Math.max(0, ms / 1000), Math.max(0, v.duration - 0.001));
      const there = () => Math.abs(v.currentTime - t) < 0.002 && !v.seeking && v.readyState >= 2;
      if (!there()) {
        await new Promise<void>((resolve) => {
          // A late 'seeked' of an earlier seek must not count: only the one that reaches `t`.
          const check = () => {
            if (!there()) return;
            finish();
          };
          const finish = () => {
            v.removeEventListener('seeked', check);
            clearTimeout(timer);
            resolve();
          };
          v.addEventListener('seeked', check);
          // A seek that never ends must not block the others.
          const timer = setTimeout(finish, 5000);
          v.currentTime = t;
        });
        // Not there after all (the picture is asked for again later).
        if (!there()) return;
      }
      const k = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
      const c = createCanvas(Math.max(1, Math.round(v.videoWidth * k)), Math.max(1, Math.round(v.videoHeight * k)));
      // Right after loading, the picture may not be ready to draw yet: try again for a moment.
      for (let attempt = 0; !drawable(v); attempt++) {
        if (attempt >= 40) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      ctx2d(c).drawImage(v, 0, 0, c.width, c.height);
      remember(key(id, ms), c);
      for (const l of listeners) l();
    } finally {
      m.pending.delete(ms);
    }
  });
  return m.queue;
}

/** The picture of a movie at a time for the display: the exact one if decoded, else the nearest one so far (and it is decoded). */
export function movieFrame(id: string, time: number, ahead: number[] = []): HTMLCanvasElement | null {
  const ms = toMs(time);
  const exact = frames.get(key(id, ms));
  if (exact) return exact;
  void decode(id, ms);
  // Playback: the next pictures are decoded early.
  for (const t of ahead) void decode(id, toMs(t));
  let best: HTMLCanvasElement | null = null;
  let dist = Infinity;
  for (const [k, c] of frames) {
    if (!k.startsWith(`${id}@`)) continue;
    const d = Math.abs(Number(k.slice(id.length + 1)) - ms);
    if (d < dist) {
      dist = d;
      best = c;
    }
  }
  return best;
}

/** Waits until the picture at a time is decoded (exports). */
export const prepareMovieFrame = (id: string, time: number): Promise<void> => decode(id, toMs(time));

/** Whether the exact picture is decoded. */
export const hasMovieFrame = (id: string, time: number): boolean => frames.has(key(id, toMs(time)));
