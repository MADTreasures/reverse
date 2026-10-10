import { beforeEach, describe, expect, it } from 'vitest';
import { importMidiData, undo } from '../store/actions';
import { resetStore, useStore } from '../store/store';
import { createEmptyProject } from './defaults';
import { createMarker } from './markers';
import { readMidiFile, writeMidiFile, type MidiExportNote } from './midiFile';

const state = () => useStore.getState();

/** A hand-made MIDI file: header plus raw track bodies (the end-of-track event is appended). */
function smf(format: number, division: number, tracks: number[][]): Uint8Array {
  const out: number[] = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format, 0, tracks.length, division >> 8, division & 0xff];
  for (const body of tracks) {
    const data = [...body, 0x00, 0xff, 0x2f, 0x00];
    out.push(0x4d, 0x54, 0x72, 0x6b, (data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff, ...data);
  }
  return Uint8Array.from(out);
}

describe('MIDI files', () => {
  it('round-trips notes, tempo, time signatures and markers', () => {
    const project = createEmptyProject();
    project.bpm = 128;
    project.name = 'Song';
    project.markers = [createMarker(768, 'Drop'), createMarker(1536, '3/4', 'timeSignature', { numerator: 3, denominator: 4 })];
    const [kick, clap] = project.channels;
    const notes: MidiExportNote[] = [
      { channelId: kick.id, tick: 0, length: 24, key: 36, velocity: 1 },
      { channelId: kick.id, tick: 96, length: 24, key: 36, velocity: 0.5 },
      { channelId: clap.id, tick: 96, length: 48, key: 39, velocity: 0.8 },
      { channelId: clap.id, tick: 96, length: 12, key: 40, velocity: 0.8 },
    ];
    const data = writeMidiFile(project, notes, { song: true });
    const midi = readMidiFile(data);
    expect(midi.division).toBe(96);
    expect(midi.bpm).toBe(128);
    expect(midi.signature).toEqual({ numerator: 4, denominator: 4 });
    expect(midi.markers).toEqual([{ tick: 768, name: 'Drop' }]); // the 3/4 marker is a time signature event
    expect(midi.tracks.map((t) => t.name)).toEqual([kick.name, clap.name]);
    expect(midi.tracks[0].notes).toEqual([
      { tick: 0, length: 24, key: 36, velocity: 1 },
      { tick: 96, length: 24, key: 36, velocity: 64 / 127 },
    ]);
    expect(midi.tracks[1].notes.map((n) => [n.tick, n.length, n.key])).toEqual([
      [96, 48, 39],
      [96, 12, 40],
    ]);
  });

  it('writes the time signature changes of the song', () => {
    const project = createEmptyProject();
    project.markers = [createMarker(1536, '6/8', 'timeSignature', { numerator: 6, denominator: 8 })];
    const data = writeMidiFile(project, [{ channelId: project.channels[0].id, tick: 0, length: 10, key: 60, velocity: 1 }], { song: true });
    // FF 58 04 06 03 18 08 at tick 1536 (delta encoded as 0x8C 0x00).
    const bytes = [...data].join(',');
    expect(bytes).toContain([0x8c, 0x00, 0xff, 0x58, 0x04, 6, 3, 24, 8].join(','));
    // A pattern export uses the project's beats per bar only.
    expect([...writeMidiFile(project, [], { song: false })].join(',')).not.toContain([0xff, 0x58, 0x04, 6].join(','));
  });

  it('reads running status, note-on with velocity 0 and other resolutions', () => {
    // 480 ticks per quarter: C4 for a quarter at 0, E4 for an eighth at 960 (running status, note-on 0 = off).
    const data = smf(0, 480, [[0x00, 0x90, 60, 100, 0x83, 0x60, 60, 0, 0x83, 0x60, 64, 90, 0x81, 0x70, 64, 0]]);
    const midi = readMidiFile(data);
    expect(midi.tracks).toHaveLength(1);
    expect(midi.tracks[0].name).toBe('Track 1');
    expect(midi.tracks[0].notes).toEqual([
      { tick: 0, length: 96, key: 60, velocity: 100 / 127 },
      { tick: 192, length: 48, key: 64, velocity: 90 / 127 },
    ]);
  });

  it('splits a track by MIDI channel and ends hanging notes with the track', () => {
    const name = [...new TextEncoder().encode('Drums')];
    const data = smf(1, 96, [
      [0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20], // 120 BPM
      [0x00, 0xff, 0x03, name.length, ...name, 0x00, 0x99, 36, 127, 0x00, 0x90, 48, 64, 0x60, 0x89, 36, 0, 0x60, 0xc0, 5],
    ]);
    const midi = readMidiFile(data);
    expect(midi.bpm).toBe(120);
    expect(midi.tracks.map((t) => [t.name, t.channel])).toEqual([
      ['Drums (ch 1)', 0],
      ['Drums (ch 10)', 9],
    ]);
    expect(midi.tracks[0].notes).toEqual([{ tick: 0, length: 192, key: 48, velocity: 64 / 127 }]); // no note-off
    expect(midi.tracks[1].notes[0]).toMatchObject({ tick: 0, length: 96, key: 36 });
  });

  it('refuses what it cannot read', () => {
    expect(() => readMidiFile(new TextEncoder().encode('RIFF....WAVE'))).toThrow('Not a MIDI file.');
    expect(() => readMidiFile(smf(2, 96, [[]]))).toThrow('format 2');
    expect(() => readMidiFile(smf(1, 0xe728, [[]]))).toThrow('SMPTE');
    expect(() => readMidiFile(smf(0, 96, [[0x00, 60, 100]]))).toThrow('running status');
  });
});

describe('MIDI import', () => {
  beforeEach(() => resetStore());

  it('creates a channel per track and one pattern placed at the start, in one undo step', () => {
    const channels = state().project.channels.length;
    const midi = readMidiFile(
      smf(1, 96, [
        [0x00, 0xff, 0x51, 0x03, 0x09, 0x27, 0xc0, 0x00, 0xff, 0x58, 0x04, 3, 2, 24, 8], // 100 BPM, 3/4
        [0x00, 0x90, 60, 100, 0x60, 0x80, 60, 0],
        [0x00, 0x90, 64, 80, 0x81, 0x40, 0x80, 64, 0],
      ]),
    );
    const r = importMidiData(midi, 'Song');
    expect(r).toMatchObject({ channels: 2, notes: 2 });
    const p = state().project;
    expect(p.channels).toHaveLength(channels + 2);
    expect(p.bpm).toBe(100);
    expect(p.beatsPerBar).toBe(3);
    const pattern = p.patterns.find((x) => x.id === r.patternId)!;
    expect(pattern.name).toBe('Song');
    expect(pattern.minLength).toBe(288); // one 3/4 bar
    const added = p.channels.slice(-2);
    expect(added.map((c) => c.kind)).toEqual(['synth', 'synth']);
    expect(new Set(added.map((c) => c.mixerTrack)).size).toBe(2);
    expect(pattern.notes[added[1].id][0]).toMatchObject({ key: 64, start: 0, length: 192 });
    expect(p.clips).toEqual([expect.objectContaining({ kind: 'pattern', patternId: r.patternId, start: 0, length: 288 })]);
    expect(state().ui.selectedPatternId).toBe(r.patternId);
    undo();
    expect(state().project.channels).toHaveLength(channels);
    expect(state().project.patterns.some((x) => x.id === r.patternId)).toBe(false);
  });

  it('keeps the tempo of a project that has music already', () => {
    importMidiData(readMidiFile(smf(0, 96, [[0x00, 0x90, 60, 100, 0x60, 0x80, 60, 0]])), 'First');
    const bpm = state().project.bpm;
    importMidiData(readMidiFile(smf(0, 96, [[0x00, 0xff, 0x51, 0x03, 0x03, 0xd0, 0x90, 0x00, 0x90, 62, 100, 0x60, 0x80, 62, 0]])), 'First');
    expect(state().project.bpm).toBe(bpm);
    expect(state().project.patterns.map((x) => x.name)).toContain('First 2');
    expect(new Set(state().project.clips.map((c) => c.trackId)).size).toBe(2);
  });
});
