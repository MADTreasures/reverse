#!/usr/bin/env node
// Probes Chromium's DynamicsCompressorNode start-up behaviour: silence for `lead` seconds,
// then a 440 Hz tone (amplitude 0.5). Prints the output RMS of the first 50 ms windows after
// the onset. Used to model Chromium's silence handling (a node whose inputs are silent stops
// processing after latency + tail time, freezing its state).
//
//   cd projects/mad-studio && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node engine/tests/parity/probe-compressor.mjs
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();
const result = await page.evaluate(async () => {
  const out = {};
  for (const lead of [0, 0.004, 0.02, 0.1, 0.5, 1, 2, 4]) {
    const rate = 48000;
    const total = Math.ceil((lead + 0.5) * rate);
    const ctx = new OfflineAudioContext(1, total, rate);
    const buffer = ctx.createBuffer(1, total, rate);
    const d = buffer.getChannelData(0);
    const onset = Math.round(lead * rate);
    for (let i = onset; i < total; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * 440 * (i - onset)) / rate);
    // A tone that starts later on its own source, so the compressor input is truly silent before.
    const src = ctx.createBufferSource();
    const tone = ctx.createBuffer(1, total - onset, rate);
    tone.copyToChannel(d.slice(onset), 0);
    src.buffer = tone;
    const comp = ctx.createDynamicsCompressor();
    src.connect(comp).connect(ctx.destination);
    src.start(lead);
    const rendered = await ctx.startRendering();
    const y = rendered.getChannelData(0);
    const windows = [];
    for (let w = 0; w < 8; w++) {
      let s = 0;
      const a = onset + w * 0.01 * rate, b = a + 0.01 * rate;
      for (let i = a; i < b; i++) s += y[i] * y[i];
      windows.push(Math.round(2000 * Math.log10(Math.sqrt(s / (b - a)) + 1e-12)) / 100);
    }
    let s = 0;
    for (let i = onset + 0.3 * rate; i < onset + 0.45 * rate; i++) s += y[i] * y[i];
    out[lead] = { firstWindowsDb: windows, settledDb: Math.round(2000 * Math.log10(Math.sqrt(s / (0.15 * rate)))) / 100 };
  }
  return out;
});
console.log(navigatorInfo());
for (const [lead, r] of Object.entries(result)) console.log(`lead ${lead.padEnd(6)} first 10 ms windows (dB): ${r.firstWindowsDb.join(' ')}   settled ${r.settledDb}`);
await browser.close();

function navigatorInfo() {
  return `chromium ${browser.version()}`;
}
