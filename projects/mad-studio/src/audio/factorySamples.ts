import { FACTORY_SAMPLES, findFactorySample, type FactorySampleDef } from '../model/factory';
import { Biquad, applyEdgeFades, hashString, mulberry32, normalize, softClip } from './dsp';

/**
 * Procedurally synthesised drum kit and FX. Every sound is generated from
 * scratch here, deterministically, so no third-party samples are needed.
 */

type Samples = Float32Array<ArrayBuffer>;
type Generator = (sr: number, rand: () => number) => Samples;

const TWO_PI = Math.PI * 2;

function alloc(sr: number, seconds: number): Samples {
  return new Float32Array(Math.ceil(sr * seconds));
}

/** Mixes equally long signals, each first normalised to peak 1, with the given weights. */
function mix(parts: [Samples, number][]): Samples {
  const out = new Float32Array(parts[0][0].length);
  for (const [data, weight] of parts) {
    normalize(data, 1);
    for (let i = 0; i < out.length; i++) out[i] += data[i] * weight;
  }
  return out;
}

function kick(o: { f0: number; f1: number; pitchTau: number; ampTau: number; hold: number; click: number; drive: number; seconds: number }): Generator {
  return (sr, rand) => {
    const out = alloc(sr, o.seconds);
    const hp = new Biquad('highpass', 1500, 0.7, sr);
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const f = o.f1 + (o.f0 - o.f1) * Math.exp(-t / o.pitchTau);
      phase += (TWO_PI * f) / sr;
      const amp = t < o.hold ? 1 : Math.exp(-(t - o.hold) / o.ampTau);
      const click = hp.process(rand() * 2 - 1) * Math.exp(-t / 0.004) * o.click;
      out[i] = softClip(Math.sin(phase) * amp + click, o.drive);
    }
    return out;
  };
}

function snare(o: { tone: number; toneTau: number; noiseTau: number; noiseFreq: number; toneMix: number; seconds: number }): Generator {
  return (sr, rand) => {
    const tone = alloc(sr, o.seconds);
    const noise = alloc(sr, o.seconds);
    const bp = new Biquad('bandpass', o.noiseFreq, 0.6, sr);
    const hp = new Biquad('highpass', 500, 0.7, sr);
    let p1 = 0;
    let p2 = 0;
    for (let i = 0; i < tone.length; i++) {
      const t = i / sr;
      const bend = 1 + 0.35 * Math.exp(-t / 0.012);
      p1 += (TWO_PI * o.tone * bend) / sr;
      p2 += (TWO_PI * o.tone * 1.62 * bend) / sr;
      tone[i] = (Math.sin(p1) * 0.7 + Math.sin(p2) * 0.3) * Math.exp(-t / o.toneTau);
      noise[i] = hp.process(bp.process(rand() * 2 - 1)) * Math.exp(-t / o.noiseTau);
    }
    const out = mix([
      [tone, o.toneMix],
      [noise, 1 - o.toneMix],
    ]);
    for (let i = 0; i < out.length; i++) out[i] = softClip(out[i] * 1.2, 1.4);
    return out;
  };
}

function clap(): Generator {
  return (sr, rand) => {
    const out = alloc(sr, 0.5);
    const bp = new Biquad('bandpass', 1150, 1.1, sr);
    const hp = new Biquad('highpass', 700, 0.7, sr);
    const bursts: [number, number][] = [
      [0, 1],
      [0.0105, 0.85],
      [0.021, 0.7],
    ];
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      let env = 0;
      for (const [start, amp] of bursts) if (t >= start) env = Math.max(env, amp * Math.exp(-(t - start) / 0.0032));
      if (t >= 0.028) env = Math.max(env, 0.75 * Math.exp(-(t - 0.028) / 0.12));
      out[i] = hp.process(bp.process(rand() * 2 - 1)) * env;
    }
    return out;
  };
}

function snap(): Generator {
  return (sr, rand) => {
    const noise = alloc(sr, 0.25);
    const tone = alloc(sr, 0.25);
    const hp = new Biquad('highpass', 2500, 0.8, sr);
    for (let i = 0; i < noise.length; i++) {
      const t = i / sr;
      noise[i] = hp.process(rand() * 2 - 1) * Math.exp(-t / 0.018);
      tone[i] = Math.sin(TWO_PI * 2200 * t) * Math.exp(-t / 0.01);
    }
    return mix([
      [noise, 0.8],
      [tone, 0.3],
    ]);
  };
}

function rim(): Generator {
  return (sr, rand) => {
    const out = alloc(sr, 0.15);
    const bp = new Biquad('bandpass', 5000, 1.2, sr);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const tri = (2 / Math.PI) * Math.asin(Math.sin(TWO_PI * 820 * t));
      out[i] =
        Math.sin(TWO_PI * 1700 * t) * Math.exp(-t / 0.012) * 0.6 +
        tri * Math.exp(-t / 0.02) * 0.4 +
        bp.process(rand() * 2 - 1) * Math.exp(-t / 0.006) * 0.8;
    }
    return out;
  };
}

/** TR-style metallic source: six detuned square waves. */
const METAL_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800];

function metallic(o: { seconds: number; tau: number; mult: number; bpFreq: number; hpFreq: number; noiseMix: number; attack?: number }): Generator {
  return (sr, rand) => {
    const out = alloc(sr, o.seconds);
    const bp = new Biquad('bandpass', o.bpFreq, 0.9, sr);
    const hp = new Biquad('highpass', o.hpFreq, 0.7, sr);
    const hpNoise = new Biquad('highpass', o.hpFreq, 0.7, sr);
    const phases = new Array<number>(METAL_FREQS.length).fill(0).map(() => rand());
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      let m = 0;
      for (let k = 0; k < METAL_FREQS.length; k++) {
        phases[k] = (phases[k] + (METAL_FREQS[k] * o.mult) / sr) % 1;
        m += phases[k] < 0.5 ? 1 : -1;
      }
      const x = hp.process(bp.process(m / METAL_FREQS.length)) + o.noiseMix * hpNoise.process(rand() * 2 - 1);
      const attack = o.attack ? Math.min(1, t / o.attack) : 1;
      out[i] = x * attack * Math.exp(-t / o.tau);
    }
    return out;
  };
}

function tom(o: { f0: number; f1: number; ampTau: number; seconds: number }): Generator {
  return (sr, rand) => {
    const out = alloc(sr, o.seconds);
    const lp = new Biquad('lowpass', 3000, 0.7, sr);
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const f = o.f1 + (o.f0 - o.f1) * Math.exp(-t / 0.08);
      phase += (TWO_PI * f) / sr;
      const noise = lp.process(rand() * 2 - 1) * Math.exp(-t / 0.02) * 0.15;
      out[i] = softClip(Math.sin(phase) * Math.exp(-t / o.ampTau) + noise, 1.3);
    }
    return out;
  };
}

function cowbell(): Generator {
  return (sr) => {
    const out = alloc(sr, 0.45);
    const bp = new Biquad('bandpass', 800, 1.5, sr);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const sq = (Math.sin(TWO_PI * 540 * t) >= 0 ? 1 : -1) + (Math.sin(TWO_PI * 800 * t) >= 0 ? 1 : -1);
      const env = Math.exp(-t / 0.06) * 0.6 + Math.exp(-t / 0.25) * 0.4;
      out[i] = bp.process(sq * 0.5) * env;
    }
    return out;
  };
}

function shaker(): Generator {
  return (sr, rand) => {
    const out = alloc(sr, 0.2);
    const bp = new Biquad('bandpass', 6500, 0.8, sr);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const env = t < 0.018 ? t / 0.018 : Math.exp(-(t - 0.018) / 0.035);
      out[i] = bp.process(rand() * 2 - 1) * env;
    }
    return out;
  };
}

function blip(): Generator {
  return (sr) => {
    const out = alloc(sr, 0.18);
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      phase += (TWO_PI * 1046.5 * (1 + 0.5 * Math.exp(-t / 0.005))) / sr;
      out[i] = Math.sin(phase) * Math.exp(-t / 0.045);
    }
    return out;
  };
}

function bass808(): Generator {
  return (sr) => {
    const out = alloc(sr, 2.2);
    const base = 65.406; // MIDI 36
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      phase += (TWO_PI * base * (1 + 0.8 * Math.exp(-t / 0.012))) / sr;
      const env = Math.min(1, t / 0.002) * Math.exp(-t / 0.9);
      out[i] = softClip(Math.sin(phase) * env, 1.8);
    }
    return out;
  };
}

function riser(): Generator {
  return (sr, rand) => {
    const seconds = 3;
    const out = alloc(sr, seconds);
    const bp = new Biquad('bandpass', 300, 3, sr);
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const x = t / seconds;
      if (i % 32 === 0) bp.set(300 * Math.pow(8000 / 300, x), 3);
      phase += (TWO_PI * 220 * Math.pow(8, x)) / sr;
      out[i] = (bp.process(rand() * 2 - 1) * 2.5 + Math.sin(phase) * 0.15) * x * x;
    }
    return out;
  };
}

function impact(): Generator {
  return (sr, rand) => {
    const out = alloc(sr, 2.2);
    const lp = new Biquad('lowpass', 1200, 0.7, sr);
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      phase += (TWO_PI * (45 + 65 * Math.exp(-t / 0.15))) / sr;
      const boom = Math.sin(phase) * Math.exp(-t / 0.7);
      const noise = lp.process(rand() * 2 - 1) * Math.exp(-t / 0.3) * 0.6;
      out[i] = softClip(boom + noise, 1.5);
    }
    return out;
  };
}

const GENERATORS: Record<string, Generator> = {
  kick_punch: kick({ f0: 165, f1: 48, pitchTau: 0.045, ampTau: 0.28, hold: 0.01, click: 0.35, drive: 1.6, seconds: 0.6 }),
  kick_deep: kick({ f0: 120, f1: 42, pitchTau: 0.07, ampTau: 0.45, hold: 0.02, click: 0.15, drive: 1.2, seconds: 0.9 }),
  kick_808: kick({ f0: 110, f1: 49, pitchTau: 0.09, ampTau: 0.8, hold: 0.02, click: 0.05, drive: 1.1, seconds: 1.6 }),
  snare_tight: snare({ tone: 200, toneTau: 0.06, noiseTau: 0.09, noiseFreq: 3000, toneMix: 0.45, seconds: 0.35 }),
  snare_fat: snare({ tone: 180, toneTau: 0.09, noiseTau: 0.16, noiseFreq: 1800, toneMix: 0.5, seconds: 0.5 }),
  clap: clap(),
  snap: snap(),
  rim: rim(),
  hat_closed: metallic({ seconds: 0.12, tau: 0.022, mult: 1, bpFreq: 10000, hpFreq: 7000, noiseMix: 0.4 }),
  hat_open: metallic({ seconds: 0.7, tau: 0.22, mult: 1, bpFreq: 10000, hpFreq: 7000, noiseMix: 0.4 }),
  ride: metallic({ seconds: 2.2, tau: 0.7, mult: 2.1, bpFreq: 6000, hpFreq: 3500, noiseMix: 0.15 }),
  crash: metallic({ seconds: 2.6, tau: 0.9, mult: 1.4, bpFreq: 7000, hpFreq: 4000, noiseMix: 0.9, attack: 0.002 }),
  tom_low: tom({ f0: 130, f1: 85, ampTau: 0.25, seconds: 0.6 }),
  tom_high: tom({ f0: 220, f1: 150, ampTau: 0.18, seconds: 0.45 }),
  cowbell: cowbell(),
  shaker: shaker(),
  blip: blip(),
  bass_808: bass808(),
  fx_riser: riser(),
  fx_impact: impact(),
};

const CATEGORY_PEAK: Record<FactorySampleDef['category'], number> = {
  Kicks: 0.95,
  'Snares & Claps': 0.85,
  'Hats & Cymbals': 0.55,
  Percussion: 0.7,
  Bass: 0.9,
  FX: 0.7,
};

/** Generates one built-in sound as mono PCM at the given sample rate. */
export function generateFactorySample(key: string, sampleRate: number): Samples {
  const gen = GENERATORS[key];
  const def = findFactorySample(key);
  if (!gen || !def) throw new Error(`Unknown factory sample: ${key}`);
  const data = gen(sampleRate, mulberry32(hashString(key)));
  normalize(data, CATEGORY_PEAK[def.category]);
  return applyEdgeFades(data, sampleRate);
}

export function factorySampleKeys(): string[] {
  return FACTORY_SAMPLES.map((s) => s.key);
}
