#!/usr/bin/env node
// Web Audio vs. native engine parity check of the demo song ("MAD Groove").
//
// Prerequisites (in projects/mad-studio): npm ci && npm run build, a built engine, and
// Playwright's Chromium (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers in the dev container).
//
//   cd projects/mad-studio
//   node --experimental-transform-types --no-warnings --import ./engine/tests/tools/ts-hooks.mjs \
//        engine/tests/parity/parity.mjs [--engine <path>] [--tolerance-db 2] [--keep]
//
// The demo project, its song timeline and the factory samples are produced by the app's own
// TypeScript code; the same project JSON is rendered by window.__madStudio.renderProject() in
// Chromium (OfflineAudioContext) and by `mad-engine --render`. Levels are compared overall, per
// second and per soloed mixer insert. Exits non-zero when a difference exceeds the tolerance.

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(here, '../..');
const app = resolve(engineRoot, '..');
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const toleranceDb = Number(option('--tolerance-db', '2'));
const keep = argv.includes('--keep');
const defaultEngine = platform() === 'darwin'
  ? join(engineRoot, 'build/Release/MAD Engine.app/Contents/MacOS/MAD Engine')
  : join(engineRoot, 'build/Release/mad-engine');
const enginePath = resolve(option('--engine', process.env.MAD_ENGINE ?? defaultEngine));

const { createDemoProject } = await import(`${app}/src/model/demo.ts`);
const { songTimeline } = await import(`${app}/src/model/timeline.ts`);
const { factorySampleKeys, generateFactorySample } = await import(`${app}/src/audio/factorySamples.ts`);
const { factorySampleId, factorySampleInfo } = await import(`${app}/src/model/factory.ts`);
const { createSamplerChannel } = await import(`${app}/src/model/defaults.ts`);
const { neededVariants, processVariant } = await import(`${app}/src/audio/clipVariants.ts`);
const { parseVariantSampleId } = await import(`${app}/src/model/clips.ts`);

const dist = join(app, 'dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('run `npm run build` in projects/mad-studio first');
if (!existsSync(enginePath)) throw new Error(`engine not found: ${enginePath}`);

const work = mkdtempSync(join(tmpdir(), 'mad-parity-'));
const sampleRate = 48000;
const tail = 2;

// ---- static server for dist/ ------------------------------------------------------------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = join(dist, decodeURIComponent(url.pathname));
  if (!file.startsWith(dist) || !existsSync(file) || url.pathname === '/') file = join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// ---- helpers ------------------------------------------------------------------------------
const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);

function windowStats(channels, rate, windowSeconds) {
  const n = Math.floor(windowSeconds * rate);
  const out = [];
  for (let start = 0; start < channels[0].length; start += n) {
    const row = channels.map((ch) => {
      let sum = 0;
      let peak = 0;
      const end = Math.min(ch.length, start + n);
      for (let i = start; i < end; i++) {
        sum += ch[i] * ch[i];
        peak = Math.max(peak, Math.abs(ch[i]));
      }
      return { rms: Math.sqrt(sum / Math.max(1, end - start)), peak };
    });
    out.push(row);
  }
  return out;
}

function totalStats(channels) {
  return channels.map((ch) => {
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < ch.length; i++) {
      sum += ch[i] * ch[i];
      peak = Math.max(peak, Math.abs(ch[i]));
    }
    return { rms: Math.sqrt(sum / ch.length), peak };
  });
}

function readWavFloat(path) {
  const b = readFileSync(path);
  let pos = 12;
  let fmt;
  let data;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(pos + 10), bits: b.readUInt16LE(pos + 22) };
    if (id === 'data') data = { offset: pos + 8, size };
    pos += 8 + size + (size & 1);
  }
  if (fmt.bits !== 32) throw new Error('expected a 32-bit float WAV');
  const frames = data.size / (4 * fmt.channels);
  const chans = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < fmt.channels; c++) chans[c][i] = b.readFloatLE(data.offset + (i * fmt.channels + c) * 4);
  return chans;
}

// ---- browser render -----------------------------------------------------------------------
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.__madStudio && window.__madStudio.engine && window.__madStudio.samplePool.hasFactorySamples(), null, { timeout: 30000 });
const factoryRate = await page.evaluate(() => window.__madStudio.engine.sampleRate);

async function browserRender(project) {
  // The audio comes back as base64 float32 (much faster than JSON arrays).
  const encoded = await page.evaluate(async ({ project, sampleRate, tail }) => {
    const s = window.__madStudio;
    const buffer = await s.renderProject(project, { mode: 'song', sampleRate, tail });
    const chans = s.bufferChannels(buffer);
    // Drop the 5 ms start offset renderProject() uses so both renders line up.
    const offset = Math.round(0.005 * sampleRate);
    return chans.map((c) => {
      const bytes = new Uint8Array(c.slice(offset).buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    });
  }, { project, sampleRate, tail });
  return encoded.map((b64) => {
    const buf = Buffer.from(b64, 'base64');
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  });
}

// ---- native render ------------------------------------------------------------------------
const sampleFiles = [];
for (const key of factorySampleKeys()) {
  const data = generateFactorySample(key, factoryRate);
  const path = join(work, `${key}.f32`);
  writeFileSync(path, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  sampleFiles.push({ id: factorySampleId(key), path, sampleRate: factoryRate, channels: 1, frames: data.length });
}

function nativeRender(project, name) {
  const tl = songTimeline(project);
  const job = {
    project,
    timeline: { mode: 'song', loopStart: tl.start, loopEnd: tl.end, events: tl.events },
    automation: { lanes: [] },
    samples: sampleFiles,
    startTick: tl.start,
    endTick: tl.end,
    tailSeconds: tail,
  };
  const jobPath = join(work, `${name}.json`);
  const out = join(work, `${name}.wav`);
  writeFileSync(jobPath, JSON.stringify(job));
  const r = spawnSync(enginePath, ['--render', jobPath, '--out', out, '--sample-rate', String(sampleRate), '--bit-depth', '32'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`native render failed: ${r.stdout}\n${r.stderr}`);
  return readWavFloat(out);
}

// ---- compare -------------------------------------------------------------------------------
const demo = createDemoProject();
let worst = 0;
const rows = [];

const dumpLabel = option('--dump', null); // write both renders of one comparison as raw float32
function compare(label, web, native) {
  if (dumpLabel !== null && label.trim() === dumpLabel) {
    for (const [name, chans] of [['web', web], ['native', native]]) {
      chans.forEach((c, i) => writeFileSync(join(work, `dump-${name}-${i}.f32`), Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
    }
  }
  const len = Math.min(web[0].length, native[0].length);
  const w = web.map((c) => c.slice(0, len));
  const n = native.map((c) => c.slice(0, len));
  const tw = totalStats(w);
  const tn = totalStats(n);
  const dRms = [0, 1].map((c) => db(tn[c].rms) - db(tw[c].rms));
  const dPeak = [0, 1].map((c) => db(tn[c].peak) - db(tw[c].peak));
  // Per-second RMS differences where the browser render is not near-silent.
  const ws = windowStats(w, sampleRate, 1);
  const ns = windowStats(n, sampleRate, 1);
  let maxSecond = 0;
  let worstAt = '';
  for (let i = 0; i < ws.length; i++) {
    for (let c = 0; c < 2; c++) {
      if (ws[i][c].rms < 1e-3) continue;
      const d = Math.abs(db(ns[i][c].rms) - db(ws[i][c].rms));
      if (d > maxSecond) {
        maxSecond = d;
        worstAt = `s${i} ${c ? 'R' : 'L'} web ${db(ws[i][c].rms).toFixed(1)} native ${db(ns[i][c].rms).toFixed(1)} dB`;
      }
    }
  }
  rows.push({ label, webRms: db(tw[0].rms), nativeRms: db(tn[0].rms), dRmsL: dRms[0], dRmsR: dRms[1], dPeakL: dPeak[0], dPeakR: dPeak[1], maxSecond, worstAt });
  worst = Math.max(worst, Math.abs(dRms[0]), Math.abs(dRms[1]));
  return maxSecond;
}

// --only demo|notes|routing|clips runs one group of comparisons (default: all).
const only = option('--only', null);
const runs = (group) => only === null || only === group;

console.log(`engine: ${enginePath}\nfactory samples at ${factoryRate} Hz, renders at ${sampleRate} Hz`);
let fullMaxSecond = 0;
if (runs('demo')) {
const fullWeb = await browserRender(demo);
const fullNative = nativeRender(demo, 'demo');
fullMaxSecond = compare('full mix', fullWeb, fullNative);

// Each insert soloed (isolates instruments and their effects).
const detail = option('--detail', null); // insert index: print 2 ms RMS around the first sound
for (let i = 1; i < demo.mixer.length; i++) {
  if (!demo.channels.some((c) => c.mixerTrack === i)) continue;
  const solo = structuredClone(demo);
  solo.mixer[i].solo = true;
  const web = await browserRender(solo);
  const native = nativeRender(solo, `solo${i}`);
  compare(`insert ${i} ${demo.mixer[i].name}`, web, native);
  if (detail !== null && Number(detail) === i) {
    const first = web[0].findIndex((v, idx) => idx > sampleRate && Math.abs(v) > 1e-4);
    const win = Math.round(0.002 * sampleRate);
    console.log(`insert ${i}: first sound at ${(first / sampleRate).toFixed(4)} s; 2 ms RMS (dB) web / native:`);
    for (let k = -2; k < 30; k++) {
      const a = first + k * win;
      const r = (ch) => {
        let sum = 0;
        for (let j = a; j < a + win; j++) sum += (ch[j] ?? 0) ** 2;
        return db(Math.sqrt(sum / win)).toFixed(1);
      };
      console.log(`  ${(a / sampleRate).toFixed(4)}  ${r(web[0]).padStart(7)} ${r(native[0]).padStart(7)}`);
    }
  }
}

}

// The demo again with note properties on every note: pan, fine pitch, release, Mod X/Y, portamento
// and slide notes (model/notes.ts; resolved by songTimeline() for both engines).
if (runs('notes')) {
const styled = structuredClone(demo);
let k = 0;
for (const pattern of styled.patterns) {
  for (const notes of Object.values(pattern.notes)) {
    const slides = [];
    for (const n of notes) {
      k++;
      n.pan = ((k % 5) - 2) / 2;
      n.fine = ((k % 7) - 3) * 30;
      n.release = (k % 3) / 2;
      n.modX = (k % 4) / 3;
      n.modY = ((k + 1) % 4) / 3;
      if (k % 6 === 0) n.porta = true;
      if (n.length >= 48 && k % 4 === 1) slides.push({ id: `${n.id}-slide`, key: Math.min(127, n.key + 5), start: n.start + n.length / 2, length: n.length / 4, velocity: n.velocity, slide: true });
    }
    notes.push(...slides);
    notes.sort((a, b) => a.start - b.start || a.key - b.key);
  }
}
// Channel settings: the chords arpeggiated over two octaves, the bass mono with portamento, the lead
// limited to two voices (the voice limit is applied by each engine itself).
const settingsFor = (name, patch) => {
  const ch = styled.channels.find((c) => c.name === name);
  if (ch) ch.settings = { polyphony: 0, mono: false, porta: false, glide: 0.08, arp: { direction: 'off', range: 1, time: 24, gate: 0.9, repeat: 1, chord: 'none' }, ...patch };
};
settingsFor('Chords', { arp: { direction: 'upDown', range: 2, time: 24, gate: 0.7, repeat: 1, chord: 'none' } });
settingsFor('Bass', { mono: true, porta: true });
settingsFor('Lead', { polyphony: 2 });
const styledWeb = await browserRender(styled);
const styledNative = nativeRender(styled, 'styled');
compare('note properties', styledWeb, styledNative);
for (let i = 1; i < styled.mixer.length; i++) {
  if (!styled.channels.some((c) => c.mixerTrack === i)) continue;
  const solo = structuredClone(styled);
  solo.mixer[i].solo = true;
  compare(`  notes insert ${i}`, await browserRender(solo), nativeRender(solo, `styled${i}`));
}
}

// Mixer routing (model/routing.ts): both hats only through a reverb bus, the clap also sends to it,
// the kick keys the bass compressor through a sidechain link (level 0) and the lead goes through a
// second bus with a delay that itself feeds the reverb bus.
if (runs('routing')) {
const routed = structuredClone(demo);
const insertOf = (name) => routed.channels.find((c) => c.name === name)?.mixerTrack ?? -1;
const reverbBus = 12;
const delayBus = 11;
routed.mixer[reverbBus].name = 'Reverb bus';
routed.mixer[reverbBus].effects = [{ id: 'fx_bus_rev', type: 'reverb', enabled: true, params: { decay: 1.6, mix: 0.45 } }];
routed.mixer[delayBus].name = 'Delay bus';
routed.mixer[delayBus].effects = [{ id: 'fx_bus_del', type: 'delay', enabled: true, params: { time: 4, feedback: 0.3, mix: 0.4 } }];
routed.mixer[delayBus].routes = [{ to: 0, level: 0.8 }, { to: reverbBus, level: 0.5 }];
for (const name of ['Hat Closed', 'Hat Open']) if (insertOf(name) > 0) routed.mixer[insertOf(name)].routes = [{ to: reverbBus, level: 0.7 }];
if (insertOf('Clap') > 0) routed.mixer[insertOf('Clap')].routes = [{ to: 0, level: 0.8 }, { to: reverbBus, level: 0.45 }];
if (insertOf('Lead') > 0) routed.mixer[insertOf('Lead')].routes = [{ to: delayBus, level: 0.8 }];
const kickInsert = insertOf('Kick');
const bassInsert = insertOf('Bass');
routed.mixer[kickInsert].routes = [{ to: 0, level: 0.8 }, { to: bassInsert, level: 0, sidechain: true }];
routed.mixer[bassInsert].effects = [{ id: 'fx_bass_sc', type: 'compressor', enabled: true, params: { threshold: -30, ratio: 8, attack: 0.002, release: 0.12, knee: 3, makeup: 4, sidechain: 1 } }];
compare('routing', await browserRender(routed), nativeRender(routed, 'routed'));
const duo = structuredClone(routed);
duo.mixer[kickInsert].solo = true;
duo.mixer[bassInsert].solo = true;
compare('  kick keys the bass', await browserRender(duo), nativeRender(duo, 'routed-duo'));
for (const bus of [reverbBus, delayBus]) {
  const solo = structuredClone(routed);
  solo.mixer[bus].solo = true;
  for (let i = 1; i < solo.mixer.length; i++) if ((solo.mixer[i].routes ?? []).some((r) => r.to === bus)) solo.mixer[i].solo = true;
  compare(`  ${solo.mixer[bus].name.toLowerCase()}`, await browserRender(solo), nativeRender(solo, `routed-bus${bus}`));
}
}

// Audio clips (model/clips.ts): gain, fades with tension, pitch, stretch and reverse on clips of the
// riser. The browser computes the sample variants itself (renderProject); the native engine gets the
// same variants, computed here with the same code, as sample files.
if (runs('clips')) {
const clipped = structuredClone(demo);
const insert = 13;
const ch = createSamplerChannel({ name: 'Riser clip', sampleId: factorySampleId('fx_riser'), params: { oneShot: true }, audioClip: true, mixerTrack: insert });
clipped.channels.push(ch);
clipped.samples[ch.sampler.sampleId] = factorySampleInfo('fx_riser');
const track = clipped.tracks[clipped.tracks.length - 1].id;
const audio = (id, start, length, props) => ({ id, kind: 'audio', trackId: track, channelId: ch.id, start, length, offset: 0, ...props });
clipped.clips.push(
  audio('pc_fades', 0, 384, { gain: -3, fadeIn: 96, fadeOut: 120, fadeInTension: 0.6, fadeOutTension: -0.4 }),
  audio('pc_pitch', 768, 384, { offset: 48, pitch: 5, fine: -20 }),
  audio('pc_stretch', 1536, 576, { stretch: 1.5, reverse: true, fadeOut: 200 }),
  audio('pc_quiet', 2304, 192, { gain: -18, pitch: -7, fadeIn: 192 }),
);
for (const id of neededVariants(clipped)) {
  const parsed = parseVariantSampleId(id);
  const key = parsed.sampleId.replace(/^factory:/, '');
  const [data] = processVariant([generateFactorySample(key, factoryRate)], factoryRate, parsed.variant);
  const path = join(work, `variant-${sampleFiles.length}.f32`);
  writeFileSync(path, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  sampleFiles.push({ id, path, sampleRate: factoryRate, channels: 1, frames: data.length });
}
compare('audio clips', await browserRender(clipped), nativeRender(clipped, 'clips'));
const soloClips = structuredClone(clipped);
soloClips.mixer[insert].solo = true;
compare('  clip insert', await browserRender(soloClips), nativeRender(soloClips, 'clips-solo'));
}

await browser.close();
server.close();

const f = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
console.log('\n' + 'part'.padEnd(22) + 'web RMS  native RMS   dRMS L   dRMS R   dPeak L  dPeak R  max |d| per s');
for (const r of rows) {
  console.log(
    r.label.padEnd(22) + `${r.webRms.toFixed(1).padStart(7)}  ${r.nativeRms.toFixed(1).padStart(9)}  ${f(r.dRmsL).padStart(7)}  ${f(r.dRmsR).padStart(7)}  ${f(r.dPeakL).padStart(7)}  ${f(r.dPeakR).padStart(7)}  ${r.maxSecond.toFixed(2).padStart(8)}  (${r.worstAt})`,
  );
}
console.log(`\nworst overall RMS difference: ${worst.toFixed(2)} dB (tolerance ${toleranceDb} dB)${runs('demo') ? `; full mix worst second ${fullMaxSecond.toFixed(2)} dB` : ''}`);
if (!keep) rmSync(work, { recursive: true, force: true });
else console.log(`kept ${work}`);
process.exit(worst <= toleranceDb ? 0 : 1);
