import { paletteColor } from './colors';
import {
  createFactoryChannel,
  createMixer,
  createPattern,
  createSynthChannel,
  createTracks,
} from './defaults';
import { defaultEffectParams } from './effects';
import { factorySampleId, factorySampleInfo } from './factory';
import { makeId } from './ids';
import { findPreset } from './presets';
import { TICKS_PER_STEP, ticksPerBar } from './timing';
import type { Channel, EffectType, MixerTrack, Note, Pattern, Project } from './types';

const S = TICKS_PER_STEP;

function n(step: number, key: number, steps = 1, velocity = 0.8): Omit<Note, 'id'> {
  return { key, start: step * S, length: steps * S, velocity };
}

function withIds(notes: Omit<Note, 'id'>[]): Note[] {
  return notes.map((x) => ({ ...x, id: makeId('n') }));
}

function steps(key: number, list: number[], velocity: number | ((step: number) => number) = 0.8): Omit<Note, 'id'>[] {
  return list.map((st) => n(st, key, 1, typeof velocity === 'function' ? velocity(st) : velocity));
}

function fx(track: MixerTrack, type: EffectType, params: Record<string, number> = {}): void {
  track.effects.push({ id: makeId('fx'), type, enabled: true, params: { ...defaultEffectParams(type), ...params } });
}

/** "MAD Groove": a 16-bar house sketch in A minor that shows off every part of the app. */
export function createDemoProject(): Project {
  const bar = ticksPerBar(4);
  const mixer = createMixer();
  const channels: Channel[] = [];
  const add = (ch: Channel, insert: number) => {
    ch.mixerTrack = insert;
    mixer[insert].name = ch.name;
    mixer[insert].color = ch.color;
    channels.push(ch);
    return ch;
  };

  const kick = add(createFactoryChannel('kick_punch', { color: paletteColor(0) }), 1);
  kick.name = 'Kick';
  mixer[1].name = 'Kick';
  const clap = add(createFactoryChannel('clap', { color: paletteColor(1) }), 2);
  const hat = add(createFactoryChannel('hat_closed', { color: paletteColor(8) }), 3);
  const openHat = add(createFactoryChannel('hat_open', { color: paletteColor(9) }), 4);
  const rim = add(createFactoryChannel('rim', { color: paletteColor(10) }), 5);
  const bass = add(createSynthChannel({ name: 'Bass', params: findPreset('saw-bass')!.params, color: paletteColor(4) }), 6);
  const chords = add(createSynthChannel({ name: 'Chords', params: findPreset('warm-pad')!.params, color: paletteColor(3) }), 7);
  const lead = add(createSynthChannel({ name: 'Lead', params: findPreset('pluck')!.params, color: paletteColor(6) }), 8);
  const riser = add(createFactoryChannel('fx_riser', { color: paletteColor(11) }), 9);
  const crash = add(createFactoryChannel('crash', { color: paletteColor(2) }), 10);

  // Levels balanced against solo renders of each channel.
  kick.volume = 0.62;
  hat.volume = 0.8;
  openHat.volume = 0.72;
  openHat.pan = 0.15;
  rim.volume = 0.66;
  rim.pan = -0.25;
  bass.volume = 0.7;
  chords.volume = 0.72;
  lead.volume = 0.92;
  if (lead.kind === 'synth') lead.synth.gain = 0.6;
  riser.volume = 0.66;
  crash.volume = 0.6;

  const pattern = (name: string, colorIndex: number, notes: Record<string, Omit<Note, 'id'>[]>, bars = 1): Pattern => {
    const p = createPattern(name, paletteColor(colorIndex));
    p.minLength = bars * bar;
    for (const [id, list] of Object.entries(notes)) p.notes[id] = withIds(list);
    return p;
  };

  const kickPat = pattern('Kick', 0, { [kick.id]: steps(60, [0, 4, 8, 12], 0.9) });
  const clapPat = pattern('Clap', 1, { [clap.id]: steps(60, [4, 12], 0.85) });
  const hatsPat = pattern('Hats', 8, {
    [hat.id]: steps(60, [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15], (st) => (st % 2 === 0 ? 0.7 : 0.45)),
    [openHat.id]: steps(60, [2, 6, 10, 14], 0.75),
    [rim.id]: steps(60, [7, 15], 0.6),
  });

  // Am – F – C – G, one chord per bar.
  const roots = [45, 41, 48, 43];
  const bassNotes: Omit<Note, 'id'>[] = [];
  roots.forEach((root, b) => {
    for (const st of [2, 6, 10]) bassNotes.push(n(b * 16 + st, root, 2, 0.85));
    bassNotes.push(n(b * 16 + 14, root + 12, 2, 0.8));
  });
  const bassPat = pattern('Bass', 4, { [bass.id]: bassNotes }, 4);

  const voicings = [
    [57, 60, 64],
    [57, 60, 65],
    [55, 60, 64],
    [55, 59, 62],
  ];
  const chordNotes: Omit<Note, 'id'>[] = [];
  voicings.forEach((chord, b) => {
    for (const key of chord) chordNotes.push({ key, start: b * bar, length: bar - S / 2, velocity: 0.7 });
  });
  const chordPat = pattern('Chords', 3, { [chords.id]: chordNotes }, 4);

  const melody: [number, number, number][] = [
    // bar 1 (Am)
    [0, 76, 2], [3, 72, 1], [4, 74, 2], [6, 76, 2], [10, 79, 1], [11, 76, 1], [12, 74, 2], [14, 72, 2],
    // bar 2 (F)
    [16, 72, 2], [19, 69, 1], [20, 72, 2], [22, 74, 3], [26, 72, 1], [27, 69, 1], [28, 72, 4],
    // bar 3 (C)
    [32, 76, 2], [35, 79, 1], [36, 81, 2], [38, 79, 2], [42, 76, 1], [43, 74, 1], [44, 76, 4],
    // bar 4 (G)
    [48, 74, 2], [51, 71, 1], [52, 74, 2], [54, 79, 3], [58, 74, 1], [59, 71, 1], [60, 67, 4],
  ];
  const leadPat = pattern('Lead', 6, { [lead.id]: melody.map(([st, key, len]) => n(st, key, len, 0.78)) }, 4);
  const riserPat = pattern('Riser', 11, { [riser.id]: steps(60, [8], 0.9) });
  const crashPat = pattern('Crash', 2, { [crash.id]: steps(60, [0], 0.85) });

  const patterns = [kickPat, clapPat, hatsPat, bassPat, chordPat, leadPat, riserPat, crashPat];

  const tracks = createTracks();
  const names = ['Kick', 'Clap', 'Hats', 'Bass', 'Chords', 'Lead', 'FX'];
  names.forEach((name, i) => (tracks[i].name = name));
  const clip = (track: number, p: Pattern, startBar: number, bars: number) => ({
    id: makeId('clip'),
    kind: 'pattern' as const,
    trackId: tracks[track].id,
    patternId: p.id,
    start: startBar * bar,
    length: bars * bar,
    offset: 0,
  });
  const clips = [
    clip(0, kickPat, 4, 12),
    clip(1, clapPat, 8, 8),
    clip(2, hatsPat, 0, 16),
    clip(3, bassPat, 4, 12),
    clip(4, chordPat, 0, 16),
    clip(5, leadPat, 8, 8),
    clip(6, riserPat, 6, 1),
    clip(6, crashPat, 8, 1),
    clip(6, crashPat, 12, 1),
  ];

  // Mixer: a little space on clap, chords and lead; glue on the master.
  fx(mixer[2], 'reverb', { decay: 1.2, mix: 0.18 });
  fx(mixer[3], 'eq', { lowGain: -6, lowFreq: 300 });
  fx(mixer[6], 'compressor', { threshold: -20, ratio: 3, makeup: 2 });
  fx(mixer[7], 'chorus', { mix: 0.3 });
  fx(mixer[7], 'reverb', { decay: 3.2, mix: 0.3 });
  fx(mixer[8], 'delay', { time: 5, feedback: 0.35, mix: 0.22 });
  fx(mixer[8], 'reverb', { decay: 2.2, mix: 0.18 });
  fx(mixer[9], 'reverb', { decay: 2.5, mix: 0.3 });
  fx(mixer[0], 'limiter', { gain: 0, ceiling: -0.5 });

  const usedFactory = ['kick_punch', 'clap', 'hat_closed', 'hat_open', 'rim', 'fx_riser', 'crash'];
  return {
    format: 'mad-studio',
    version: 2,
    name: 'MAD Groove (Demo)',
    bpm: 124,
    beatsPerBar: 4,
    swing: 0.12,
    channels,
    patterns,
    tracks,
    clips,
    mixer,
    samples: Object.fromEntries(usedFactory.map((k) => [factorySampleId(k), factorySampleInfo(k)])),
    pdc: true,
    pdcAutomation: true,
  };
}
