/**
 * Writes MP4 (ISO base media) and QuickTime (MOV) movie files from encoded samples: a video track
 * (H.264, VP9 or Photo-JPEG) and an audio track (AAC, Opus or 16-bit PCM). The movie header comes
 * first (fast start), then the samples. Pure, unit tested.
 */

export type VideoCodec = 'avc1' | 'vp09' | 'jpeg';
export type AudioCodec = 'mp4a' | 'Opus' | 'sowt';

export interface Sample {
  data: Uint8Array;
  /** In the track's timescale. */
  duration: number;
  /** Key frame (video); audio samples always are. */
  sync: boolean;
  /** Shown this much later than decoded (reordered video frames), in the track's timescale. */
  offset?: number;
}

export interface VideoTrack {
  kind: 'video';
  codec: VideoCodec;
  width: number;
  height: number;
  timescale: number;
  /** avcC record (H.264); VP9 gets its vpcC from `vp9`. */
  description?: Uint8Array;
  vp9?: { profile: number; level: number; bitDepth: number };
  samples: Sample[];
}

export interface AudioTrack {
  kind: 'audio';
  codec: AudioCodec;
  sampleRate: number;
  channels: number;
  /** AudioSpecificConfig (AAC); Opus: pre-skip comes from `preSkip`. */
  description?: Uint8Array;
  preSkip?: number;
  /** Average bit rate (AAC, for the decoder config). */
  bitrate?: number;
  /** AAC / Opus: one encoded packet per sample (duration in samples). PCM: `pcm` instead. */
  samples: Sample[];
  /** 16-bit little-endian interleaved PCM (sowt). */
  pcm?: Uint8Array;
}

export type MovieTrack = VideoTrack | AudioTrack;

// ------------------------------------------------------------------ bytes

class Writer {
  private chunks: Uint8Array[] = [];
  length = 0;

  bytes(b: Uint8Array | number[]): this {
    const a = b instanceof Uint8Array ? b : Uint8Array.from(b);
    this.chunks.push(a);
    this.length += a.length;
    return this;
  }
  u8(v: number): this {
    return this.bytes([v & 0xff]);
  }
  u16(v: number): this {
    return this.bytes([(v >>> 8) & 0xff, v & 0xff]);
  }
  u24(v: number): this {
    return this.bytes([(v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
  }
  u32(v: number): this {
    return this.bytes([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
  }
  u64(v: number): this {
    return this.u32(Math.floor(v / 2 ** 32)).u32(v >>> 0);
  }
  text(s: string): this {
    return this.bytes([...s].map((c) => c.charCodeAt(0) & 0xff));
  }
  zeros(n: number): this {
    return this.bytes(new Uint8Array(n));
  }
  done(): Uint8Array {
    const out = new Uint8Array(this.length);
    let p = 0;
    for (const c of this.chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }
}

/** A box: size, type, contents. */
function box(type: string, ...parts: (Uint8Array | null | undefined)[]): Uint8Array {
  const body = parts.filter((p): p is Uint8Array => Boolean(p));
  const size = 8 + body.reduce((n, p) => n + p.length, 0);
  const w = new Writer().u32(size).text(type);
  for (const p of body) w.bytes(p);
  return w.done();
}

/** A full box: version and flags first. */
const fullBox = (type: string, version: number, flags: number, ...parts: (Uint8Array | null | undefined)[]) => box(type, new Writer().u8(version).u24(flags).done(), ...parts);

const UNITY = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
const matrix = () => {
  const w = new Writer();
  for (const v of UNITY) w.u32(v);
  return w.done();
};

// ------------------------------------------------------------------ sample entries

function visualEntry(t: VideoTrack): Uint8Array {
  const name = t.codec === 'avc1' ? 'H.264' : t.codec === 'vp09' ? 'VP9' : 'Photo - JPEG';
  const compressor = new Uint8Array(32);
  compressor[0] = name.length;
  compressor.set([...name].map((c) => c.charCodeAt(0)), 1);
  const head = new Writer()
    .zeros(6)
    .u16(1) // data reference index
    .u16(0) // version
    .u16(0) // revision
    .u32(0) // vendor
    .u32(0) // temporal quality
    .u32(t.codec === 'jpeg' ? 512 : 0) // spatial quality (QuickTime's normal quality; MP4: reserved)
    .u16(t.width)
    .u16(t.height)
    .u32(0x00480000)
    .u32(0x00480000)
    .u32(0)
    .u16(1) // frames per sample
    .bytes(compressor)
    .u16(0x18)
    .u16(0xffff)
    .done();
  if (t.codec === 'avc1') return box('avc1', head, box('avcC', t.description ?? new Uint8Array()));
  if (t.codec === 'vp09') {
    const v = t.vp9 ?? { profile: 0, level: 40, bitDepth: 8 };
    // 4:2:0 colocated with luma (1), BT.709 colours, limited range.
    const vpcC = fullBox('vpcC', 1, 0, new Writer().u8(v.profile).u8(v.level).u8((v.bitDepth << 4) | (1 << 1) | 0).u8(1).u8(1).u8(1).u16(0).done());
    return box('vp09', head, vpcC);
  }
  return box('jpeg', head);
}

/** Descriptor of an MPEG-4 ES descriptor (tag, length, contents). */
function descriptor(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const body = new Writer();
  for (const p of parts) body.bytes(p);
  const b = body.done();
  const len = b.length;
  // Four-byte length form, as most writers use.
  return new Writer()
    .u8(tag)
    .bytes([0x80 | ((len >>> 21) & 0x7f), 0x80 | ((len >>> 14) & 0x7f), 0x80 | ((len >>> 7) & 0x7f), len & 0x7f])
    .bytes(b)
    .done();
}

function audioEntry(t: AudioTrack): Uint8Array {
  const head = new Writer()
    .zeros(6)
    .u16(1) // data reference index
    .u16(0) // version (QuickTime: sound description version 0)
    .u16(0)
    .u32(0)
    .u16(t.channels)
    .u16(16)
    .u16(0)
    .u16(0)
    .u32((t.codec === 'Opus' ? 48000 : t.sampleRate) * 0x10000)
    .done();
  if (t.codec === 'mp4a') {
    const asc = t.description ?? new Uint8Array();
    const dcd = descriptor(4, new Writer().u8(0x40).u8(0x15).u24(0).u32(t.bitrate ?? 0).u32(t.bitrate ?? 0).done(), descriptor(5, asc));
    const es = descriptor(3, new Writer().u16(0).u8(0).done(), dcd, descriptor(6, Uint8Array.of(2)));
    return box('mp4a', head, fullBox('esds', 0, 0, es));
  }
  if (t.codec === 'Opus') {
    // dOps: big-endian, unlike the Ogg OpusHead.
    const dOps = box('dOps', new Writer().u8(0).u8(t.channels).u16(t.preSkip ?? 312).u32(t.sampleRate).u16(0).u8(0).done());
    return box('Opus', head, dOps);
  }
  return box('sowt', head);
}

// ------------------------------------------------------------------ tables

/** Run-length time-to-sample table. */
function stts(durations: number[]): Uint8Array {
  const runs: [number, number][] = [];
  for (const d of durations) {
    const last = runs[runs.length - 1];
    if (last && last[1] === d) last[0]++;
    else runs.push([1, d]);
  }
  const w = new Writer().u32(runs.length);
  for (const [n, d] of runs) w.u32(n).u32(d);
  return fullBox('stts', 0, 0, w.done());
}

/** Sample-to-chunk table from the number of samples in each chunk. */
function stsc(perChunk: number[]): Uint8Array {
  const runs: [number, number][] = [];
  perChunk.forEach((n, i) => {
    if (runs.length === 0 || runs[runs.length - 1][1] !== n) runs.push([i + 1, n]);
  });
  const w = new Writer().u32(runs.length);
  for (const [first, n] of runs) w.u32(first).u32(n).u32(1);
  return fullBox('stsc', 0, 0, w.done());
}

function stsz(sizes: number[] | { size: number; count: number }): Uint8Array {
  if (!Array.isArray(sizes)) return fullBox('stsz', 0, 0, new Writer().u32(sizes.size).u32(sizes.count).done());
  const same = sizes.length > 0 && sizes.every((s) => s === sizes[0]);
  const w = new Writer().u32(same ? sizes[0] : 0).u32(sizes.length);
  if (!same) for (const s of sizes) w.u32(s);
  return fullBox('stsz', 0, 0, w.done());
}

function chunkOffsets(offsets: number[]): Uint8Array {
  const big = offsets.some((o) => o > 0xffffffff);
  const w = new Writer().u32(offsets.length);
  for (const o of offsets) (big ? w.u64(o) : w.u32(o));
  return fullBox(big ? 'co64' : 'stco', 0, 0, w.done());
}

// ------------------------------------------------------------------ the movie

interface Laid {
  track: MovieTrack;
  /** Bytes of each chunk, in mdat order. */
  chunks: Uint8Array[];
  perChunk: number[];
  timescale: number;
  duration: number;
}

/** Splits a track into chunks: a sample each (video, packets), about a second each (PCM). */
function layOut(t: MovieTrack): Laid {
  if (t.kind === 'audio' && t.codec === 'sowt') {
    const pcm = t.pcm ?? new Uint8Array();
    const frameBytes = 2 * t.channels;
    const frames = Math.floor(pcm.length / frameBytes);
    const chunks: Uint8Array[] = [];
    const perChunk: number[] = [];
    for (let f = 0; f < frames; f += t.sampleRate) {
      const n = Math.min(t.sampleRate, frames - f);
      chunks.push(pcm.subarray(f * frameBytes, (f + n) * frameBytes));
      perChunk.push(n);
    }
    return { track: t, chunks, perChunk, timescale: t.sampleRate, duration: frames };
  }
  const timescale = t.kind === 'video' ? t.timescale : t.codec === 'Opus' ? 48000 : t.sampleRate;
  return { track: t, chunks: t.samples.map((s) => s.data), perChunk: t.samples.map(() => 1), timescale, duration: t.samples.reduce((n, s) => n + s.duration, 0) };
}

function trak(l: Laid, id: number, offsets: number[], movieScale: number, qt: boolean): Uint8Array {
  const t = l.track;
  const video = t.kind === 'video';
  const movieDuration = Math.round((l.duration * movieScale) / l.timescale);
  const tkhd = fullBox(
    'tkhd',
    0,
    qt ? 0xf : 3,
    new Writer()
      .u32(0)
      .u32(0)
      .u32(id)
      .u32(0)
      .u32(movieDuration)
      .zeros(8)
      .u16(0)
      .u16(0)
      .u16(video ? 0 : 0x0100)
      .u16(0)
      .bytes(matrix())
      .u32(video ? t.width * 0x10000 : 0)
      .u32(video ? t.height * 0x10000 : 0)
      .done(),
  );
  const mdhd = fullBox('mdhd', 0, 0, new Writer().u32(0).u32(0).u32(l.timescale).u32(l.duration).u16(qt ? 0 : 0x55c4).u16(0).done());
  const handler = video ? 'vide' : 'soun';
  const name = video ? 'VideoHandler' : 'SoundHandler';
  // QuickTime: media handler with a counted name; ISO: a handler type and a terminated name.
  const hdlr = qt
    ? fullBox('hdlr', 0, 0, new Writer().text('mhlr').text(handler).zeros(12).u8(name.length).text(name).done())
    : fullBox('hdlr', 0, 0, new Writer().u32(0).text(handler).zeros(12).text(name).u8(0).done());
  const mediaHeader = video ? fullBox('vmhd', 0, 1, new Writer().zeros(8).done()) : fullBox('smhd', 0, 0, new Writer().zeros(4).done());
  const dataHandler = qt ? fullBox('hdlr', 0, 0, new Writer().text('dhlr').text('url ').zeros(12).u8(0).done()) : null;
  const dinf = box('dinf', fullBox('dref', 0, 0, new Writer().u32(1).done(), fullBox('url ', 0, 1)));
  const stsd = fullBox('stsd', 0, 0, new Writer().u32(1).done(), video ? visualEntry(t) : audioEntry(t));
  const pcm = t.kind === 'audio' && t.codec === 'sowt';
  const samples = t.kind === 'audio' && pcm ? [] : t.samples;
  const sync = samples.map((s, i) => (s.sync ? i + 1 : 0)).filter((i) => i > 0);
  const stbl = box(
    'stbl',
    stsd,
    // PCM: a sample is one frame of all channels (QuickTime's sample size 1).
    pcm ? fullBox('stts', 0, 0, new Writer().u32(1).u32(l.duration).u32(1).done()) : stts(samples.map((s) => s.duration)),
    video && sync.length < samples.length ? fullBox('stss', 0, 0, (() => {
      const w = new Writer().u32(sync.length);
      for (const i of sync) w.u32(i);
      return w.done();
    })()) : null,
    // Composition offsets, signed (version 1), only when frames are reordered.
    samples.some((x) => x.offset) ? fullBox('ctts', 1, 0, (() => {
      const w = new Writer().u32(samples.length);
      for (const x of samples) w.u32(1).u32((x.offset ?? 0) >>> 0);
      return w.done();
    })()) : null,
    stsc(l.perChunk),
    pcm ? stsz({ size: 1, count: l.duration }) : stsz(samples.map((s) => s.data.length)),
    chunkOffsets(offsets),
  );
  const minf = box('minf', mediaHeader, dataHandler, dinf, stbl);
  return box('trak', tkhd, box('mdia', mdhd, hdlr, minf));
}

/** The movie file: `qt` writes QuickTime (.mov), else MP4. */
export function muxMovie(tracks: MovieTrack[], opts: { qt: boolean }): Uint8Array {
  const laid = tracks.map(layOut);
  const movieScale = 1000;
  const ftyp = opts.qt
    ? box('ftyp', new Writer().text('qt  ').u32(0x20050300).text('qt  ').done())
    : box('ftyp', new Writer().text('isom').u32(0x200).text('isom').text('iso2').text(tracks.some((t) => t.kind === 'video' && t.codec === 'avc1') ? 'avc1' : 'iso6').text('mp41').done());
  const moovFor = (offsets: number[][]) => {
    const duration = Math.max(0, ...laid.map((l) => Math.round((l.duration * movieScale) / l.timescale)));
    const mvhd = fullBox(
      'mvhd',
      0,
      0,
      new Writer()
        .u32(0)
        .u32(0)
        .u32(movieScale)
        .u32(duration)
        .u32(0x00010000)
        .u16(0x0100)
        .zeros(10)
        .bytes(matrix())
        .zeros(24)
        .u32(laid.length + 1)
        .done(),
    );
    return box('moov', mvhd, ...laid.map((l, i) => trak(l, i + 1, offsets[i], movieScale, opts.qt)));
  };
  const sizes = laid.map((l) => l.chunks.map((c) => c.length));
  const offsetsAt = (start: number) => {
    let p = start;
    return sizes.map((list) =>
      list.map((n) => {
        const o = p;
        p += n;
        return o;
      }),
    );
  };
  const dataBytes = sizes.flat().reduce((n, s) => n + s, 0);
  const large = dataBytes + 16 > 0xffffffff;
  const mdatHeader = large ? 16 : 8;
  // The header's size depends on the offsets only through 32 or 64 bits: lay out until it stays.
  let moov = moovFor(offsetsAt(ftyp.length + mdatHeader));
  for (let pass = 0; pass < 3; pass++) {
    const next = moovFor(offsetsAt(ftyp.length + moov.length + mdatHeader));
    const same = next.length === moov.length;
    moov = next;
    if (same) break;
  }
  const head = new Writer().bytes(ftyp).bytes(moov);
  if (large) head.u32(1).text('mdat').u64(dataBytes + 16);
  else head.u32(dataBytes + 8).text('mdat');
  const out = new Writer().bytes(head.done());
  for (const l of laid) for (const c of l.chunks) out.bytes(c);
  return out.done();
}

// ------------------------------------------------------------------ reading (tests, checks)

export interface BoxInfo {
  type: string;
  start: number;
  size: number;
  children?: BoxInfo[];
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts']);

/** The box tree of a movie file (containers opened). */
export function readBoxes(data: Uint8Array, start = 0, end = data.length): BoxInfo[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: BoxInfo[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = view.getUint32(p);
    const type = String.fromCharCode(data[p + 4], data[p + 5], data[p + 6], data[p + 7]);
    let header = 8;
    if (size === 1) {
      size = view.getUint32(p + 8) * 2 ** 32 + view.getUint32(p + 12);
      header = 16;
    }
    if (size < header || p + size > end) break;
    const b: BoxInfo = { type, start: p, size };
    if (CONTAINERS.has(type)) b.children = readBoxes(data, p + header, p + size);
    out.push(b);
    p += size;
  }
  return out;
}

/** The first box of a path such as ['moov', 'trak', 'mdia']. */
export function findBox(boxes: BoxInfo[], path: string[]): BoxInfo | null {
  let list = boxes;
  let found: BoxInfo | null = null;
  for (const type of path) {
    found = list.find((b) => b.type === type) ?? null;
    if (!found) return null;
    list = found.children ?? [];
  }
  return found;
}
