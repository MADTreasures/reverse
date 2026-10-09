import { describe, expect, it } from 'vitest';
import { encodeWav, interleave16, newSoundTrack, peaks, sanitizeSound, soundPlays, volumeAt, volumeSteps, type SoundFile, type SoundTrack } from './sound';

const file: SoundFile = { id: 'snd1', name: 'Beat', type: 'audio/wav', duration: 2 };
const track = (patch: Partial<SoundTrack> = {}): SoundTrack => ({ ...newSoundTrack('Audio'), clips: [{ start: 5, end: 20, offset: 0, sound: 'snd1' }], ...patch });

describe('sound', () => {
  it('works out what plays when', () => {
    // 10 fps: the clip starts at frame 5 (0.4 s after frame 1) and lasts 1.6 s.
    expect(soundPlays([track()], [file], 1, 30, 10)).toEqual([{ track: expect.any(String), sound: 'snd1', when: 0.4, offset: 0, duration: 1.6, from: 5, to: 20 }]);
    // Started in the middle of the clip: further into the sound.
    const mid = soundPlays([track()], [file], 10, 30, 10)[0];
    expect(mid.when).toBe(0);
    expect(mid.offset).toBeCloseTo(0.5);
    expect(mid.duration).toBeCloseTo(1.1);
    // A clip longer than its sound stops with it; an offset before the sound starts later.
    expect(soundPlays([track({ clips: [{ start: 1, end: 50, offset: 1.5, sound: 'snd1' }] })], [file], 1, 50, 10)[0].duration).toBeCloseTo(0.5);
    const early = soundPlays([track({ clips: [{ start: 1, end: 10, offset: -0.3, sound: 'snd1' }] })], [file], 1, 10, 10)[0];
    expect(early.when).toBeCloseTo(0.3);
    expect(early.offset).toBe(0);
    expect(early.duration).toBeCloseTo(0.7);
    // Muted tracks and missing files play nothing.
    expect(soundPlays([track({ visible: false })], [file], 1, 30, 10)).toEqual([]);
    expect(soundPlays([track()], [], 1, 30, 10)).toEqual([]);
    expect(soundPlays([track()], [file], 21, 30, 10)).toEqual([]);
  });

  it('volume keyframes fade', () => {
    const t = track({
      volume: 0.8,
      keys: [
        { frame: 5, interp: 'linear', values: { volume: 0 } },
        { frame: 15, interp: 'hold', values: { volume: 1 } },
      ],
    });
    expect(volumeAt({ ...t, keys: [] }, 9)).toBe(0.8);
    expect(volumeAt(t, 1)).toBe(0);
    expect(volumeAt(t, 10)).toBeCloseTo(0.5);
    expect(volumeAt(t, 30)).toBe(1);
    const steps = volumeSteps(t, { from: 5, to: 7 }, 5, 10);
    expect(steps.map(([s]) => s)).toEqual([0, 0.1, 0.2]);
    expect(steps[1][1]).toBeCloseTo(0.1);
    expect(volumeSteps({ volume: 0.5, keys: [] }, { from: 8, to: 20 }, 5, 10)).toEqual([[0.3, 0.5]]);
  });

  it('peaks and PCM', () => {
    const samples = Float32Array.from({ length: 100 }, (_, i) => (i < 50 ? 0.25 : -0.75));
    expect([...peaks(samples, 100, 0, 1, 2)]).toEqual([0.25, 0.75]);
    expect([...interleave16([Float32Array.of(1, -1), Float32Array.of(0, 0.5)])]).toEqual([0xff, 0x7f, 0, 0, 0, 0x80, 0, 0x40]);
    const wav = encodeWav([Float32Array.of(0, 0.5)], 8000);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(8000);
    expect(wav.length).toBe(48);
  });

  it('reads sound from files safely', () => {
    expect(sanitizeSound(null)).toBeUndefined();
    const s = sanitizeSound({
      files: [{ id: 'snd1', name: 'Beat', type: 'audio/mpeg', duration: 3 }, { id: '../x' }, { id: 'snd2', type: 'text/html' }],
      tracks: [
        {
          id: 's1',
          name: 'Audio',
          volume: 2,
          clips: [
            { start: 1, end: 9, sound: 'snd1', offset: 0.5 },
            { start: 12, end: 14, sound: 'nope' },
          ],
          keys: [{ frame: 3, volume: 0.5 }, { frame: 0 }],
        },
      ],
    })!;
    expect(s.files.map((f) => [f.id, f.type])).toEqual([
      ['snd1', 'audio/mpeg'],
      ['snd2', 'audio/wav'],
    ]);
    expect(s.tracks[0]).toMatchObject({ id: 's1', volume: 1, clips: [{ start: 1, end: 9, sound: 'snd1', offset: 0.5 }], keys: [{ frame: 3, interp: 'linear', values: { volume: 0.5 } }] });
  });
});
