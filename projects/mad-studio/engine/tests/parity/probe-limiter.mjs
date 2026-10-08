#!/usr/bin/env node
// Probes the peak level of the app's limiter chain (effects.ts LimiterEffect) in Chromium for loud
// white noise: gain +18 dB -> DynamicsCompressor (threshold ceiling-3, knee 0, ratio 20, attack 1 ms)
// -> gain 0.5 -> WaveShaper(clipperCurve(ceiling), '2x'). The 2x oversampler's downsampling filter
// rings above the clipper's ceiling on heavily clipped material; this shows by how much, for
// comparison with the native limiter (`mad-engine --render` of the same chain).
// Linux, Chromium 141: peak 1.032 (+0.78 dB over the -0.5 dB ceiling); mad-engine: 1.043 (+0.86 dB).
//
//   cd projects/mad-studio && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node engine/tests/parity/probe-limiter.mjs
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();
const result = await page.evaluate(async () => {
  const rate = 48000;
  const frames = rate;
  const ceilingDb = -0.5;
  const ceiling = 10 ** (ceilingDb / 20);
  const clipperCurve = (c) => {
    const n = 4096;
    const curve = new Float32Array(n);
    const knee = c * 0.85;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 4 - 2;
      const a = Math.abs(x);
      const y = a <= knee ? a : knee + (c - knee) * Math.tanh((a - knee) / (c - knee));
      curve[i] = Math.sign(x) * y;
    }
    return curve;
  };
  const ctx = new OfflineAudioContext(2, frames + rate, rate);
  const buffer = ctx.createBuffer(1, frames, rate);
  const d = buffer.getChannelData(0);
  let seed = 1;
  for (let i = 0; i < frames; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    d[i] = (seed / 4294967296) * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const strip = ctx.createGain();
  strip.gain.value = 0.8; // sampler gain 0.8, channel volume 0.8 (unity)
  const pan = ctx.createStereoPanner(); // mono input: -3 dB per side at centre
  const input = ctx.createGain();
  input.gain.value = 10 ** (18 / 20);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = ceilingDb - 3;
  comp.knee.value = 0;
  comp.ratio.value = 20;
  comp.attack.value = 0.001;
  comp.release.value = 0.1;
  const pre = ctx.createGain();
  pre.gain.value = 0.5;
  const clipper = ctx.createWaveShaper();
  clipper.oversample = '2x';
  clipper.curve = clipperCurve(ceiling);
  src.connect(strip).connect(pan).connect(input).connect(comp).connect(pre).connect(clipper).connect(ctx.destination);
  src.start(0);
  const out = await ctx.startRendering();
  let peak = 0;
  for (let c = 0; c < 2; c++) for (const v of out.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  return { peak, ceiling };
});
console.log(`chromium ${browser.version()}: limiter peak ${result.peak.toFixed(4)} (ceiling ${result.ceiling.toFixed(4)}, +${(20 * Math.log10(result.peak / result.ceiling)).toFixed(2)} dB)`);
await browser.close();
