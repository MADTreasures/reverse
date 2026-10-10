/**
 * Standard MIDI files (SMF): export of the song or a pattern (FL Studio: File › Export › MIDI file) and
 * import (File › Import › MIDI file). Export writes format 1 at 96 ticks per quarter: a conductor
 * track with tempo, time signatures and markers, then one track per channel. Import reads format 0
 * and 1 files, splits notes by track and MIDI channel and converts their timing to 96 PPQ.
 */
import { signatureMap, sortedMarkers } from './markers';
import { PPQ } from './timing';
import type { Project } from './types';

// ---------------------------------------------------------------------------------------------
// Writing

class ByteWriter {
  private bytes: number[] = [];

  u8(v: number): void {
    this.bytes.push(v & 0xff);
  }

  u16(v: number): void {
    this.u8(v >> 8);
    this.u8(v);
  }

  u32(v: number): void {
    this.u16(Math.floor(v / 65536));
    this.u16(v % 65536);
  }

  varLen(v: number): void {
    const groups = [v & 0x7f];
    v = Math.floor(v / 128);
    while (v > 0) {
      groups.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    for (const g of groups) this.u8(g);
  }

  text(s: string): void {
    for (const b of new TextEncoder().encode(s)) this.u8(b);
  }

  append(other: Uint8Array): void {
    for (const b of other) this.bytes.push(b);
  }

  get length(): number {
    return this.bytes.length;
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

interface TrackEvent {
  tick: number;
  /** Sort order for equal ticks: meta first, note-offs before note-ons. */
  order: number;
  data: number[];
}

function trackChunk(events: TrackEvent[]): Uint8Array {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const w = new ByteWriter();
  let last = 0;
  for (const e of events) {
    w.varLen(Math.max(0, Math.round(e.tick) - last));
    last = Math.max(last, Math.round(e.tick));
    for (const b of e.data) w.u8(b);
  }
  w.varLen(0);
  w.u8(0xff);
  w.u8(0x2f);
  w.u8(0);
  const chunk = new ByteWriter();
  chunk.text('MTrk');
  chunk.u32(w.length);
  chunk.append(w.toBytes());
  return chunk.toBytes();
}

function metaText(type: number, text: string): number[] {
  const bytes = [...new TextEncoder().encode(text)];
  const len = new ByteWriter();
  len.varLen(bytes.length);
  return [0xff, type, ...len.toBytes(), ...bytes];
}

export interface MidiExportNote {
  channelId: string;
  tick: number;
  length: number;
  key: number;
  velocity: number;
}

/** A format 1 MIDI file of the given notes (one track per channel, in the project's channel order). */
export function writeMidiFile(project: Project, notes: readonly MidiExportNote[], opts: { song: boolean }): Uint8Array {
  const conductor: TrackEvent[] = [{ tick: 0, order: 0, data: metaText(0x03, project.name) }];
  const usPerQuarter = Math.round(60_000_000 / project.bpm);
  conductor.push({ tick: 0, order: 1, data: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff] });
  const signatures = opts.song ? signatureMap(project) : [{ tick: 0, numerator: project.beatsPerBar, denominator: 4 }];
  for (const sig of signatures) {
    conductor.push({ tick: sig.tick, order: 2, data: [0xff, 0x58, 0x04, sig.numerator, Math.round(Math.log2(sig.denominator)), 24, 8] });
  }
  // Time signature markers are already the time signature events above.
  if (opts.song) for (const m of sortedMarkers(project)) if (m.action !== 'timeSignature') conductor.push({ tick: m.tick, order: 3, data: metaText(0x06, m.name) });

  const chunks = [trackChunk(conductor)];
  for (const ch of project.channels) {
    const own = notes.filter((n) => n.channelId === ch.id);
    if (own.length === 0) continue;
    const events: TrackEvent[] = [{ tick: 0, order: 0, data: metaText(0x03, ch.name) }];
    for (const n of own) {
      const key = Math.max(0, Math.min(127, Math.round(n.key)));
      const velocity = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
      events.push({ tick: n.tick, order: 2, data: [0x90, key, velocity] });
      events.push({ tick: n.tick + Math.max(1, n.length), order: 1, data: [0x80, key, 0x40] });
    }
    chunks.push(trackChunk(events));
  }

  const out = new ByteWriter();
  out.text('MThd');
  out.u32(6);
  out.u16(1);
  out.u16(chunks.length);
  out.u16(PPQ);
  for (const c of chunks) out.append(c);
  return out.toBytes();
}

// ---------------------------------------------------------------------------------------------
// Reading

export interface MidiImportTrack {
  name: string;
  /** MIDI channel 0..15 of the notes. */
  channel: number;
  notes: { tick: number; length: number; key: number; velocity: number }[];
}

export interface MidiImport {
  /** Ticks per quarter of the file (the notes are converted to 96). */
  division: number;
  bpm: number | null;
  signature: { numerator: number; denominator: number } | null;
  tracks: MidiImportTrack[];
  markers: { tick: number; name: string }[];
}

class ByteReader {
  pos = 0;
  constructor(private readonly data: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.data.length;
  }

  u8(): number {
    if (this.pos >= this.data.length) throw new Error('Unexpected end of the MIDI file.');
    return this.data[this.pos++];
  }

  u16(): number {
    return this.u8() * 256 + this.u8();
  }

  u32(): number {
    return this.u16() * 65536 + this.u16();
  }

  varLen(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error('Invalid variable-length number in the MIDI file.');
  }

  text(n: number): string {
    const bytes = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return new TextDecoder('utf-8').decode(bytes);
  }

  sub(n: number): ByteReader {
    const r = new ByteReader(this.data.subarray(this.pos, this.pos + n));
    this.pos += n;
    return r;
  }
}

/** Parses a format 0 or 1 MIDI file (format 2 and SMPTE timing are refused). */
export function readMidiFile(data: Uint8Array): MidiImport {
  const r = new ByteReader(data);
  if (r.text(4) !== 'MThd') throw new Error('Not a MIDI file.');
  const headerLength = r.u32();
  const header = r.sub(headerLength);
  const format = header.u16();
  const trackCount = header.u16();
  const division = header.u16();
  if (format > 1) throw new Error('MIDI format 2 files are not supported.');
  if (division & 0x8000) throw new Error('MIDI files with SMPTE timing are not supported.');
  const scale = PPQ / division;
  const result: MidiImport = { division, bpm: null, signature: null, tracks: [], markers: [] };

  for (let t = 0; t < trackCount && !r.done; t++) {
    const id = r.text(4);
    const length = r.u32();
    const tr = r.sub(length);
    if (id !== 'MTrk') continue;
    let tick = 0;
    let status = 0;
    let name = '';
    const open = new Map<number, { tick: number; velocity: number }[]>(); // channel * 128 + key
    const byChannel = new Map<number, MidiImportTrack['notes']>();
    const finish = (channel: number, key: number, at: number) => {
      const stack = open.get(channel * 128 + key);
      const on = stack?.shift();
      if (!on) return;
      let list = byChannel.get(channel);
      if (!list) byChannel.set(channel, (list = []));
      list.push({ tick: Math.round(on.tick * scale), length: Math.max(1, Math.round((at - on.tick) * scale)), key, velocity: on.velocity });
    };
    while (!tr.done) {
      tick += tr.varLen();
      let b = tr.u8();
      if (b === 0xff) {
        const type = tr.u8();
        const len = tr.varLen();
        if (type === 0x2f) break;
        const body = tr.sub(len);
        if (type === 0x03 && !name) name = body.text(len).trim();
        else if (type === 0x51 && len === 3 && result.bpm === null) result.bpm = Math.round((60_000_000 / (body.u8() * 65536 + body.u8() * 256 + body.u8())) * 100) / 100;
        else if (type === 0x58 && len >= 2 && result.signature === null) result.signature = { numerator: body.u8(), denominator: 2 ** body.u8() };
        else if (type === 0x06) result.markers.push({ tick: Math.round(tick * scale), name: body.text(len).trim() });
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        tr.sub(tr.varLen());
        continue;
      }
      let first: number;
      if (b & 0x80) {
        status = b;
        first = tr.u8();
      } else {
        if (!status) throw new Error('MIDI running status without a status byte.');
        first = b;
        b = status;
      }
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      const second = kind === 0xc0 || kind === 0xd0 ? 0 : tr.u8();
      if (kind === 0x90 && second > 0) {
        const k = channel * 128 + first;
        const stack = open.get(k) ?? [];
        stack.push({ tick, velocity: second / 127 });
        open.set(k, stack);
      } else if (kind === 0x80 || (kind === 0x90 && second === 0)) {
        finish(channel, first, tick);
      }
    }
    // Notes without a note-off end with the track.
    for (const k of [...open.keys()]) while (open.get(k)?.length) finish(Math.floor(k / 128), k % 128, tick);
    for (const [channel, notes] of [...byChannel.entries()].sort((a, b) => a[0] - b[0])) {
      notes.sort((a, b) => a.tick - b.tick || a.key - b.key);
      const label = name || `Track ${t + 1}`;
      result.tracks.push({ name: byChannel.size > 1 ? `${label} (ch ${channel + 1})` : label, channel, notes });
    }
  }
  return result;
}
