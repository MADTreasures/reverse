#!/usr/bin/env node
// End-to-end test of the MAD Engine stdio protocol (Node >= 20, no dependencies).
//
//   node engine/tests/protocol-test.mjs [--engine <path>] [--plugins <dir>] [--keep] [--verbose] [--seed <n>]
//
// Defaults: the engine from engine/build/Release (or $MAD_ENGINE) and the test plugins from
// engine/build/Release/plugins (built with -DMAD_BUILD_TEST_PLUGINS=ON; skipped if missing).
// The engine runs with the null audio device and a 440 Hz test tone on its inputs.
// Exits non-zero and prints what failed.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(here, '..');
const isMac = platform() === 'darwin';

// ---- options ----------------------------------------------------------------------------
const argv = process.argv.slice(2);
const option = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name) => argv.includes(name);
const verbose = flag('--verbose');
const keep = flag('--keep');
const stressSeed = Number(option('--seed') ?? 20251008) >>> 0; // stress section PRNG seed

const defaultEngine = isMac
  ? join(engineRoot, 'build/Release/MAD Engine.app/Contents/MacOS/MAD Engine')
  : join(engineRoot, 'build/Release', platform() === 'win32' ? 'mad-engine.exe' : 'mad-engine');
const enginePath = resolve(option('--engine') ?? process.env.MAD_ENGINE ?? defaultEngine);
const pluginDir = resolve(option('--plugins') ?? join(engineRoot, 'build/Release/plugins'));

if (!existsSync(enginePath)) {
  console.error(`engine not found: ${enginePath} (build it first or pass --engine)`);
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'mad-engine-test-'));
const failures = [];
let passed = 0;

function check(ok, what) {
  if (ok) {
    passed++;
    if (verbose) console.log(`  ok   ${what}`);
  } else {
    failures.push(what);
    console.log(`  FAIL ${what}`);
  }
}
const near = (actual, expected, tolerance, what) =>
  check(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${what} (got ${actual}, expected ${expected} ± ${tolerance})`);

// ---- engine process ---------------------------------------------------------------------
class Engine {
  constructor(args) {
    this.messages = [];
    this.sent = []; // { index: messages received before it, type } for failure diagnostics
    this.waiters = [];
    this.stderr = '';
    this.proc = spawn(enginePath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise((res) => this.proc.on('exit', (code, signal) => res({ code, signal })));
    this.proc.stderr.on('data', (d) => {
      this.stderr += d.toString();
      if (this.stderr.length > 200000) this.stderr = this.stderr.slice(-100000);
    });
    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        failures.push(`engine wrote a non-JSON line: ${line.slice(0, 200)}`);
        return;
      }
      if (verbose && msg.type !== 'meters' && msg.type !== 'status') console.log('  <-', line.slice(0, 300));
      this.messages.push(msg);
      for (const w of [...this.waiters]) {
        if (w.match(msg)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          clearTimeout(w.timer);
          w.resolve(msg);
        }
      }
    });
  }

  send(msg) {
    if (verbose) console.log('  ->', JSON.stringify(msg).slice(0, 300));
    this.sent.push({ index: this.messages.length, type: msg.type });
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  sendRaw(text) {
    this.proc.stdin.write(text);
  }

  /** Resolves with the next message matching `match` (also checks messages since `since`). */
  waitFor(match, timeoutMs, what, since = this.messages.length) {
    const earlier = this.messages.slice(since).find(match);
    if (earlier) return Promise.resolve(earlier);
    return new Promise((resolvePromise, reject) => {
      const w = { match, resolve: resolvePromise };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`timeout waiting for ${what}`));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  async request(msg, match, timeoutMs, what) {
    const since = this.messages.length;
    this.send(msg);
    return this.waitFor(match, timeoutMs, what, since);
  }

  async close() {
    this.proc.stdin.end();
    const timer = setTimeout(() => this.proc.kill('SIGKILL'), 15000);
    const result = await this.exited;
    clearTimeout(timer);
    return result;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- fixtures -----------------------------------------------------------------------------
function writeRawSample(name, channels, frames, fn) {
  const data = new Float32Array(frames * channels);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) data[i * channels + c] = fn(i, c);
  const path = join(work, name);
  writeFileSync(path, Buffer.from(data.buffer));
  return path;
}

function synthParams(overrides = {}) {
  return {
    osc: [
      { wave: 'sawtooth', level: 0.7, coarse: 0, fine: 0, unison: 3, detune: 18, pan: 0 },
      { wave: 'square', level: 0.35, coarse: -12, fine: 0, unison: 1, detune: 0, pan: 0 },
      { wave: 'sine', level: 0, coarse: 0, fine: 0, unison: 1, detune: 0, pan: 0 },
    ],
    filter: { enabled: true, type: 'lowpass', cutoff: 1800, resonance: 4, envAmount: 0.4, keyTrack: 0.3 },
    ampEnv: { attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.25 },
    filterEnv: { attack: 0.01, decay: 0.4, sustain: 0.2, release: 0.3 },
    lfo: { target: 'filter', rate: 4, depth: 0.3 },
    gain: 0.6,
    ...overrides,
  };
}

function samplerParams(sampleId, overrides = {}) {
  return {
    sampleId,
    rootKey: 60,
    fine: 0,
    keyTrack: true,
    reverse: false,
    oneShot: true,
    loop: false,
    start: 0,
    ampEnv: { attack: 0.001, decay: 0.3, sustain: 1, release: 0.08 },
    chokeGroup: 0,
    cutSelf: false,
    gain: 0.8,
    ...overrides,
  };
}

function mixerTrack(index, overrides = {}) {
  return {
    id: `mx_${index}`,
    name: index === 0 ? 'Master' : `Insert ${index}`,
    volume: 0.8,
    pan: 0,
    muted: false,
    solo: false,
    input: null,
    armed: false,
    effects: [],
    ...overrides,
  };
}

function baseProject() {
  return {
    bpm: 120,
    beatsPerBar: 4,
    swing: 0,
    channels: [
      { id: 'ch_syn', kind: 'synth', volume: 0.8, pan: 0, muted: false, mixerTrack: 1, synth: synthParams() },
      { id: 'ch_kick', kind: 'sampler', volume: 0.8, pan: 0, muted: false, mixerTrack: 2, sampler: samplerParams('test:kick') },
      { id: 'ch_auto', kind: 'automation' },
    ],
    mixer: [
      mixerTrack(0, { effects: [{ id: 'fx_lim', type: 'limiter', enabled: true, params: { gain: 0, ceiling: -0.5, release: 0.1 } }] }),
      mixerTrack(1, { effects: [{ id: 'fx_rev', type: 'reverb', enabled: true, params: { decay: 1.2, mix: 0.2 } }] }),
      mixerTrack(2, { effects: [{ id: 'fx_eq', type: 'eq', enabled: true, params: { lowGain: 3 } }] }),
      mixerTrack(3),
    ],
    samples: { 'test:kick': { id: 'test:kick', name: 'Kick', source: 'factory' } },
  };
}

function timeline() {
  const events = [];
  for (let beat = 0; beat < 4; beat++) events.push({ tick: beat * 96, length: 24, channelId: 'ch_kick', key: 60, velocity: 0.9 });
  [57, 60, 64].forEach((key) => events.push({ tick: 0, length: 360, channelId: 'ch_syn', key, velocity: 0.7 }));
  events.sort((a, b) => a.tick - b.tick);
  return { type: 'timeline.set', mode: 'song', loopStart: 0, loopEnd: 384, events };
}

// ---- WAV helpers ------------------------------------------------------------------------------
function readWav(path) {
  const b = readFileSync(path);
  const str = (o) => b.toString('ascii', o, o + 4);
  if (str(0) !== 'RIFF' || str(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= b.length) {
    const id = str(pos);
    const size = b.readUInt32LE(pos + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(pos + 8), channels: b.readUInt16LE(pos + 10), rate: b.readUInt32LE(pos + 12), bits: b.readUInt16LE(pos + 22) };
    if (id === 'data') data = { offset: pos + 8, size };
    pos += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('missing fmt/data');
  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.size / (bytes * fmt.channels));
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const o = data.offset + (i * fmt.channels + c) * bytes;
      let v;
      if (fmt.bits === 16) v = b.readInt16LE(o) / 32768;
      else if (fmt.bits === 24) v = b.readIntLE(o, 3) / 8388608;
      else v = b.readFloatLE(o);
      channels[c][i] = v;
    }
  }
  return { format: fmt.format, numChannels: fmt.channels, rate: fmt.rate, bits: fmt.bits, frames, data: channels, fileSize: b.length, dataSize: data.size };
}

function stats(channels, from = 0, to = Infinity) {
  let peak = 0;
  let sum = 0;
  let count = 0;
  let nonFinite = 0;
  for (const ch of channels) {
    const end = Math.min(to, ch.length);
    for (let i = from; i < end; i++) {
      const v = ch[i];
      if (!Number.isFinite(v)) {
        nonFinite++;
        continue;
      }
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
      count++;
    }
  }
  return { peak, rms: count ? Math.sqrt(sum / count) : 0, nonFinite };
}

// ---- tests --------------------------------------------------------------------------------------
async function testBasics(engine, ready) {
  console.log('basics');
  check(ready.protocol === 1, 'ready.protocol is 1');
  check(typeof ready.version === 'string', 'ready.version');
  check(ready.sampleRate > 0 && ready.bufferSize > 0, 'ready has sampleRate and bufferSize');
  check(ready.device && ready.device.null === true, 'null device is used');
  check(Array.isArray(ready.formats) && ready.formats.includes('VST3'), 'VST3 hosting available');

  const pong = await engine.request({ type: 'ping', requestId: 'p1' }, (m) => m.type === 'pong', 5000, 'pong');
  check(pong.requestId === 'p1', 'requestId echoed');

  // Malformed input never crashes the engine.
  const since = engine.messages.length;
  engine.sendRaw('this is not json\n{"type":\n{"no":"type"}\n[1,2,3]\n\n');
  engine.send({ type: 'no.such.command', requestId: 9 });
  engine.send({ type: 'samples.loadRaw' });
  engine.send({ type: 'project.sync', project: 5 });
  engine.send({ type: 'plugin.getParams', key: 'nope' });
  engine.send({ type: 'live.noteOn', handle: 1, channelId: 'missing', key: 60, velocity: 0.5 });
  engine.send({ type: 'live.noteOff', handle: 1 });
  const unknown = await engine.waitFor((m) => m.type === 'error' && m.request === 'no.such.command', 5000, 'unknown command error', since);
  check(/unknown command/.test(unknown.message) && unknown.requestId === 9, 'unknown command -> error with requestId');
  await engine.request({ type: 'ping' }, (m) => m.type === 'pong', 5000, 'pong after garbage');
  const errors = engine.messages.slice(since).filter((m) => m.type === 'error');
  check(errors.length >= 6, `malformed messages produce errors (${errors.length})`);

  const devices = await engine.request({ type: 'audio.getDevices', requestId: 'd' }, (m) => m.type === 'audio.devices', 10000, 'audio.devices');
  check(Array.isArray(devices.types) && devices.types.some((t) => t.name === 'Null'), 'audio.devices lists types');
  check(devices.current && devices.current.null === true && devices.current.inputChannels.length === 2, 'audio.devices current (null device, 2 inputs)');
  const paths = await engine.request({ type: 'plugins.getPaths' }, (m) => m.type === 'plugins.paths', 5000, 'plugins.paths');
  check(paths.paths && Array.isArray(paths.paths.VST3), 'plugins.paths has VST3');
}

async function testPlayback(engine) {
  console.log('playback');
  const kick = writeRawSample('kick.f32', 1, 21000, (i) => Math.sin((2 * Math.PI * 60 * i) / 48000) * Math.exp(-i / 4000) * 0.9);
  const loaded = await engine.request(
    { type: 'samples.loadRaw', requestId: 's1', id: 'test:kick', path: kick, sampleRate: 48000, channels: 1, frames: 21000 },
    (m) => m.type === 'samples.loaded' || (m.type === 'error' && m.request === 'samples.loadRaw'),
    5000,
    'samples.loaded',
  );
  check(loaded.type === 'samples.loaded' && loaded.id === 'test:kick' && loaded.requestId === 's1', 'samples.loaded');

  engine.send({ type: 'project.sync', project: baseProject() });
  engine.send(timeline());
  engine.send({ type: 'transport.settings', metronome: true });
  const since = engine.messages.length;
  engine.send({ type: 'transport.play', fromTick: 0 });
  const first = await engine.waitFor((m) => m.type === 'status' && m.playing, 5000, 'status playing', since);
  await sleep(700);
  const later = engine.messages.filter((m) => m.type === 'status' && m.playing).at(-1);
  check(later.tick > first.tick + 50, `status.tick advances while playing (${first.tick.toFixed(1)} -> ${later.tick.toFixed(1)})`);
  // 0.7 s at 120 BPM = 134 ticks (real time, null device).
  near(later.tick - first.tick, 0.7 * 192, 60, 'transport advances in real time');
  check(later.cpu >= 0 && later.cpu < 1, 'status.cpu in 0..1');
  const meters = engine.messages.slice(since).filter((m) => m.type === 'meters');
  check(meters.length >= 10, `meters arrive while playing (${meters.length} in ~0.8 s)`);
  const last = meters.at(-1);
  check(last && last.peaks.length === 4 && last.waveform.length === 256, 'meters: one [l,r] per mixer track, 256 waveform samples');
  check(meters.some((m) => m.peaks[0][0] > 0.01), 'master meter shows signal');
  check(meters.some((m) => m.peaks[1][0] > 0.001) && meters.some((m) => m.peaks[2][0] > 0.001), 'insert meters show signal');
  check(meters.every((m) => m.peaks[3][0] === 0), 'unused insert is silent');
  const active = engine.messages.slice(since).filter((m) => m.type === 'status' && Object.keys(m.activity ?? {}).length > 0);
  check(active.some((m) => 'ch_kick' in m.activity), 'status.activity reports triggered channels');

  // Seek while playing, then stop.
  engine.send({ type: 'transport.seek', tick: 288 });
  await sleep(150);
  const sought = engine.messages.filter((m) => m.type === 'status' && m.playing).at(-1);
  check(sought.tick >= 250 || sought.tick < 100, `seek relocates (tick ${sought.tick.toFixed(1)})`);
  engine.send({ type: 'transport.stop' });
  const stopped = await engine.waitFor((m) => m.type === 'status' && !m.playing, 3000, 'status stopped');
  check(stopped.playing === false, 'transport.stop');
  engine.send({ type: 'transport.settings', metronome: false });
  await sleep(500);

  // Live notes.
  const before = engine.messages.length;
  engine.send({ type: 'live.noteOn', handle: 42, channelId: 'ch_syn', key: 64, velocity: 0.8 });
  await sleep(400);
  const during = engine.messages.slice(before).filter((m) => m.type === 'meters');
  check(during.some((m) => m.peaks[1][0] > 0.01), 'live.noteOn sounds on the channel insert');
  engine.send({ type: 'live.noteOff', handle: 42 });
  await sleep(1500);
  const afterOff = engine.messages.filter((m) => m.type === 'meters').at(-1);
  check(!afterOff || afterOff.peaks[1][0] < 0.01, 'live.noteOff releases the note (reverb tail decays)');

  // Previews.
  const p0 = engine.messages.length;
  engine.send({ type: 'preview.sample', id: 'test:kick' });
  engine.send({ type: 'preview.synth', synth: synthParams({ lfo: { target: 'off', rate: 1, depth: 0 } }), keys: [60, 64, 67], duration: 0.3 });
  await sleep(300);
  check(engine.messages.slice(p0).some((m) => m.type === 'meters' && m.peaks[0][0] > 0.01), 'previews play through the master');
  engine.send({ type: 'preview.stop' });
  engine.send({ type: 'live.allNotesOff' });
  await sleep(300);
}

async function testRender(engine) {
  console.log('offline render');
  const path = join(work, 'render.wav');
  const since = engine.messages.length;
  engine.send({ type: 'render.start', requestId: 'r1', path, sampleRate: 48000, bitDepth: 32, startTick: 0, endTick: 768, tailSeconds: 1 });
  const done = await engine.waitFor((m) => (m.type === 'render.done' && m.requestId === 'r1') || (m.type === 'error' && m.request === 'render.start'), 60000, 'render.done', since);
  check(done.type === 'render.done', `render.done (${done.message ?? ''})`);
  if (done.type !== 'render.done') return;
  check(engine.messages.slice(since).some((m) => m.type === 'render.progress' && m.requestId === 'r1'), 'render.progress events');
  check(existsSync(path), 'render file exists');
  const wav = readWav(path);
  check(wav.format === 3 && wav.bits === 32 && wav.numChannels === 2 && wav.rate === 48000, 'render WAV header (32-bit float stereo 48 kHz)');
  // 768 ticks at 120 BPM = 4 s, plus 1 s tail.
  near(wav.frames, 5 * 48000, 2, 'render length');
  check(wav.fileSize === 44 + wav.dataSize, 'RIFF sizes are consistent');
  const s = stats(wav.data);
  check(s.nonFinite === 0, 'render has no NaN/Inf');
  check(s.rms > 0.005, `render is not silent (rms ${s.rms.toFixed(4)})`);
  check(s.peak < 1.5, `render peak < 1.5 (${s.peak.toFixed(3)})`);
  near(done.peak, s.peak, 1e-3, 'render.done peak');
  near(done.seconds, 5, 0.01, 'render.done seconds');
  // The timeline holds one bar: the second bar of the range only contains tails (no looping).
  const bar1 = stats(wav.data, 0, 96000);
  const bar2 = stats(wav.data, 120000, 192000);
  check(bar2.rms < bar1.rms * 0.2, `render does not loop inside the range (bar 2 rms ${bar2.rms.toFixed(4)} vs ${bar1.rms.toFixed(4)})`);

  // 16- and 24-bit renders of the same range.
  for (const bits of [16, 24]) {
    const p = join(work, `render${bits}.wav`);
    const d = await engine.request({ type: 'render.start', requestId: `r${bits}`, path: p, sampleRate: 44100, bitDepth: bits, startTick: 0, endTick: 384, tailSeconds: 0 },
      (m) => (m.type === 'render.done' && m.requestId === `r${bits}`) || (m.type === 'error' && m.request === 'render.start'), 60000, `render ${bits}`);
    check(d.type === 'render.done', `${bits}-bit render`);
    if (d.type === 'render.done') {
      const w = readWav(p);
      check(w.bits === bits && w.format === 1 && w.rate === 44100 && Math.abs(w.frames - 88200) <= 2, `${bits}-bit WAV header and length`);
    }
  }
}

async function testRecording(engine, ready) {
  console.log('recording');
  const folder = join(work, 'recorded');
  engine.send({ type: 'record.config', folder, monitoring: 'armed', latencyCompensation: true, bitDepth: 24 });
  const project = baseProject();
  project.mixer[3] = mixerTrack(3, { name: 'Vocal/Take', input: 'stereo:0', armed: true });
  engine.send({ type: 'project.sync', project });
  await sleep(200);
  const since = engine.messages.length;
  engine.send({ type: 'transport.play', fromTick: 96, countInTicks: 96, record: true });
  const counting = await engine.waitFor((m) => m.type === 'status' && m.playing, 3000, 'count-in status', since);
  check(counting.tick < 96, `count-in reported before fromTick (tick ${counting.tick.toFixed(1)})`);
  await sleep(1500);
  const monitored = engine.messages.slice(since).filter((m) => m.type === 'meters');
  check(monitored.some((m) => m.peaks[3][0] > 0.1), 'armed input is monitored on its track');
  engine.send({ type: 'transport.stop' });
  const done = await engine.waitFor((m) => m.type === 'record.done', 10000, 'record.done', since);
  check(Array.isArray(done.takes) && done.takes.length === 1, 'record.done lists one take');
  const take = done.takes?.[0];
  if (!take) return;
  check(take.trackIndex === 3 && take.channels === 2 && take.sampleRate === ready.sampleRate, 'take metadata');
  check(take.startTick === 96, `take.startTick is fromTick (${take.startTick})`);
  check(/Vocal_Take_\d{8}-\d{6}\.wav$/.test(take.path), `take file name (${take.path})`);
  check(existsSync(take.path), 'take file exists');
  const wav = readWav(take.path);
  check(wav.bits === 24 && wav.numChannels === 2 && wav.frames === take.frames, 'take WAV header matches record.done');
  // About 1.5 s minus the 0.5 s count-in at 120 BPM.
  near(take.frames / take.sampleRate, 1.0, 0.35, 'take length');
  near(stats(wav.data).rms, 0.25 / Math.SQRT2, 0.01, 'take contains the 440 Hz input tone');

  // Nothing armed -> error, playback still works.
  engine.send({ type: 'project.sync', project: baseProject() });
  const e0 = engine.messages.length;
  engine.send({ type: 'transport.play', fromTick: 0, record: true });
  await engine.waitFor((m) => m.type === 'error' && m.request === 'transport.play', 3000, 'record without armed tracks error', e0);
  engine.send({ type: 'transport.stop' });
  await sleep(200);
}

async function testAutomation(engine) {
  console.log('automation');
  // Kick only (synth muted), master volume automated to 0 in the second half of the bar.
  const project = baseProject();
  project.channels[0].muted = true;
  project.mixer[0].effects = [];
  engine.send({ type: 'project.sync', project });
  engine.send(timeline());
  engine.send({ type: 'automation.set', lanes: [{ target: 'mx:0:volume', points: [[0, 0.8], [190, 0.8], [192, 0], [384, 0]] }] });
  const path = join(work, 'automation.wav');
  const done = await engine.request({ type: 'render.start', requestId: 'ra', path, sampleRate: 48000, bitDepth: 32, startTick: 0, endTick: 384, tailSeconds: 0 },
    (m) => m.type === 'render.done' || (m.type === 'error' && m.request === 'render.start'), 60000, 'automation render');
  check(done.type === 'render.done', 'automation render');
  if (done.type === 'render.done') {
    const wav = readWav(path);
    check(stats(wav.data, 0, 40000).rms > 0.01, 'audible before the automation step');
    check(stats(wav.data, 52000, 96000).peak < 1e-4, 'mx:0:volume automation silences the second half');
  }
  engine.send({ type: 'automation.set', lanes: [] });
  engine.send({ type: 'project.sync', project: baseProject() });
}

async function testPlugins(engine) {
  const gainPath = join(pluginDir, 'MAD Test Gain.vst3');
  const synthPath = join(pluginDir, 'MAD Test Synth.vst3');
  if (!existsSync(gainPath) || !existsSync(synthPath)) {
    console.log(`plugins: skipped (no test plugins in ${pluginDir}; configure with -DMAD_BUILD_TEST_PLUGINS=ON)`);
    return;
  }
  console.log('plugins');
  const since = engine.messages.length;
  engine.send({ type: 'plugins.scan', formats: ['VST3'], paths: [pluginDir], rescanAll: true });
  const list = await engine.waitFor((m) => m.type === 'plugins.list', 120000, 'plugins.list after scan', since);
  check(engine.messages.slice(since).some((m) => m.type === 'plugins.scanProgress' && m.format === 'VST3'), 'plugins.scanProgress');
  const synth = list.plugins.find((p) => p.name === 'MAD Test Synth');
  const gain = list.plugins.find((p) => p.name === 'MAD Test Gain');
  check(synth && synth.isInstrument === true && synth.format === 'VST3' && synth.vendor === 'MAD', 'scan finds MAD Test Synth');
  check(gain && gain.isInstrument === false && typeof gain.uid === 'string', 'scan finds MAD Test Gain');
  if (!synth || !gain) return;
  const cached = await engine.request({ type: 'plugins.getList' }, (m) => m.type === 'plugins.list', 5000, 'plugins.getList');
  check(cached.plugins.some((p) => p.uid === synth.uid), 'plugins.getList returns the cached list');

  const pluginRef = (p, state = null) => ({ uid: p.uid, name: p.name, vendor: p.vendor, format: p.format, fileOrIdentifier: p.fileOrIdentifier, isInstrument: p.isInstrument, state });
  const project = {
    bpm: 120,
    beatsPerBar: 4,
    swing: 0,
    channels: [{ id: 'ch_plug', kind: 'plugin', volume: 0.8, pan: 0, muted: false, mixerTrack: 1, plugin: pluginRef(synth) }],
    mixer: [
      mixerTrack(0, { effects: [{ id: 'fx_gain', type: 'plugin', enabled: true, params: {}, plugin: pluginRef(gain) }] }),
      mixerTrack(1),
    ],
    samples: {},
  };
  const s0 = engine.messages.length;
  engine.send({ type: 'project.sync', project });
  const loaded1 = await engine.waitFor((m) => (m.type === 'plugin.loaded' || m.type === 'plugin.error') && m.key === 'ch:ch_plug', 30000, 'synth plugin.loaded', s0);
  const loaded2 = await engine.waitFor((m) => (m.type === 'plugin.loaded' || m.type === 'plugin.error') && m.key === 'fx:fx_gain', 30000, 'gain plugin.loaded', s0);
  check(loaded1.type === 'plugin.loaded' && loaded1.name === 'MAD Test Synth', `plugin instrument loads (${loaded1.message ?? ''})`);
  check(loaded2.type === 'plugin.loaded' && loaded2.numParams >= 1, `plugin effect loads (${loaded2.message ?? ''})`);
  if (loaded1.type !== 'plugin.loaded' || loaded2.type !== 'plugin.loaded') return;

  const params = await engine.request({ type: 'plugin.getParams', key: 'fx:fx_gain', requestId: 'gp' }, (m) => m.type === 'plugin.params', 5000, 'plugin.params');
  const gp = params.params.find((p) => p.name === 'Gain');
  check(gp && Math.abs(gp.value - 0.5) < 1e-6 && gp.automatable === true, 'plugin.params lists gain = 0.5');

  // A4 (440 Hz) at velocity 1 for one bar: sine amplitude 0.25 * gain 0.5 = 0.125.
  engine.send({ type: 'timeline.set', mode: 'song', loopStart: 0, loopEnd: 384, events: [{ tick: 0, length: 384, channelId: 'ch_plug', key: 69, velocity: 1 }] });
  const render = async (name) => {
    const path = join(work, name);
    const d = await engine.request({ type: 'render.start', requestId: name, path, sampleRate: 48000, bitDepth: 32, startTick: 0, endTick: 384, tailSeconds: 0.2 },
      (m) => (m.type === 'render.done' && m.requestId === name) || (m.type === 'error' && m.request === 'render.start'), 60000, `render ${name}`);
    check(d.type === 'render.done', `plugin render ${name}`);
    return d.type === 'render.done' ? readWav(path) : null;
  };
  let wav = await render('plugin-gain-0.5.wav');
  if (wav) {
    const s = stats(wav.data, 4800, 86400);
    near(s.peak, 0.125, 0.002, 'test synth sine (0.25) through test gain (0.5): peak');
    near(s.rms, 0.125 / Math.SQRT2, 0.002, 'test synth sine through test gain: rms');
    // Frequency: count positive zero crossings over one second.
    let crossings = 0;
    const l = wav.data[0];
    for (let i = 24001; i < 72000; i++) if (l[i - 1] < 0 && l[i] >= 0) crossings++;
    near(crossings, 440, 2, 'test synth plays the note frequency (A4 = 440 Hz)');
  }

  engine.send({ type: 'plugin.setParam', key: 'fx:fx_gain', index: gp ? gp.index : 0, value: 1 });
  await sleep(100);
  wav = await render('plugin-gain-1.wav');
  if (wav) near(stats(wav.data, 4800, 86400).peak, 0.25, 0.003, 'plugin.setParam changes the plugin gain');

  // Plugin parameter automation (normalised 0..1).
  engine.send({ type: 'automation.set', lanes: [{ target: `plug:fx:fx_gain:${gp ? gp.index : 0}`, points: [[0, 0.2], [384, 0.2]] }] });
  wav = await render('plugin-automation.wav');
  if (wav) near(stats(wav.data, 4800, 86400).peak, 0.05, 0.002, 'plug:<key>:<index> automation');
  engine.send({ type: 'automation.set', lanes: [] });

  const states = await engine.request({ type: 'plugins.getStates', requestId: 'st' }, (m) => m.type === 'plugins.states', 5000, 'plugins.states');
  check(states.requestId === 'st' && typeof states.states['fx:fx_gain'] === 'string' && typeof states.states['ch:ch_plug'] === 'string', 'plugins.getStates returns base64 states');

  // State restore: a new effect slot created with the stored state reports the stored gain.
  const restored = structuredClone(project);
  restored.mixer[0].effects = [{ id: 'fx_gain2', type: 'plugin', enabled: true, params: {}, plugin: pluginRef(gain, states.states['fx:fx_gain']) }];
  const s1 = engine.messages.length;
  engine.send({ type: 'project.sync', project: restored });
  const l3 = await engine.waitFor((m) => (m.type === 'plugin.loaded' || m.type === 'plugin.error') && m.key === 'fx:fx_gain2', 30000, 'restored plugin.loaded', s1);
  check(l3.type === 'plugin.loaded', 'restored plugin loads');
  const p2 = await engine.request({ type: 'plugin.getParams', key: 'fx:fx_gain2' }, (m) => m.type === 'plugin.params' && m.key === 'fx:fx_gain2', 5000, 'restored params');
  check(p2.params.some((p) => p.name === 'Gain' && (Math.abs(p.value - 0.2) < 1e-4 || Math.abs(p.value - 1) < 1e-4)), 'plugin state is restored from base64');

  // Editor commands never crash (headless machines report an error instead of a window).
  engine.send({ type: 'plugin.openEditor', key: 'fx:fx_gain2', title: 'Gain' });
  await sleep(300);
  engine.send({ type: 'plugin.closeEditor', key: 'fx:fx_gain2' });
  await engine.request({ type: 'ping' }, (m) => m.type === 'pong', 5000, 'pong after editor commands');

  // Removing the plugins from the project releases them.
  engine.send({ type: 'project.sync', project: baseProject() });
  await sleep(200);
  const gone = await engine.request({ type: 'plugin.getParams', key: 'fx:fx_gain2' }, (m) => m.type === 'error' && m.request === 'plugin.getParams', 5000, 'released plugin');
  check(gone.type === 'error', 'plugins are released when removed from the project');

  if (isMac) await testAudioUnits(engine);
  return { synth, gain };
}

async function testAudioUnits(engine) {
  console.log('AudioUnits (macOS)');
  const since = engine.messages.length;
  engine.send({ type: 'plugins.scan', formats: ['AudioUnit'] });
  const list = await engine.waitFor((m) => m.type === 'plugins.list', 600000, 'AudioUnit scan', since);
  const lowpass = list.plugins.find((p) => p.format === 'AudioUnit' && p.name === 'AULowpass');
  const dls = list.plugins.find((p) => p.format === 'AudioUnit' && p.name === 'DLSMusicDevice');
  check(!!lowpass, 'AU scan finds AULowpass');
  check(!!dls && dls.isInstrument, 'AU scan finds DLSMusicDevice (instrument)');
  if (!lowpass || !dls) return;
  const ref = (p) => ({ uid: p.uid, name: p.name, vendor: p.vendor, format: p.format, fileOrIdentifier: p.fileOrIdentifier, isInstrument: p.isInstrument, state: null });
  const project = {
    bpm: 120,
    beatsPerBar: 4,
    swing: 0,
    channels: [{ id: 'ch_dls', kind: 'plugin', volume: 0.8, pan: 0, muted: false, mixerTrack: 1, plugin: ref(dls) }],
    mixer: [mixerTrack(0, { effects: [{ id: 'fx_lp', type: 'plugin', enabled: true, params: {}, plugin: ref(lowpass) }] }), mixerTrack(1)],
    samples: {},
  };
  const s0 = engine.messages.length;
  engine.send({ type: 'project.sync', project });
  const a = await engine.waitFor((m) => (m.type === 'plugin.loaded' || m.type === 'plugin.error') && m.key === 'ch:ch_dls', 60000, 'DLSMusicDevice load', s0);
  const b = await engine.waitFor((m) => (m.type === 'plugin.loaded' || m.type === 'plugin.error') && m.key === 'fx:fx_lp', 60000, 'AULowpass load', s0);
  check(a.type === 'plugin.loaded', `DLSMusicDevice loads (${a.message ?? ''})`);
  check(b.type === 'plugin.loaded', `AULowpass loads (${b.message ?? ''})`);
  engine.send({ type: 'timeline.set', mode: 'song', loopStart: 0, loopEnd: 384, events: [{ tick: 0, length: 300, channelId: 'ch_dls', key: 60, velocity: 0.9 }] });
  const path = join(work, 'au.wav');
  const d = await engine.request({ type: 'render.start', requestId: 'au', path, sampleRate: 48000, bitDepth: 32, startTick: 0, endTick: 384, tailSeconds: 0.5 },
    (m) => (m.type === 'render.done' && m.requestId === 'au') || (m.type === 'error' && m.request === 'render.start'), 120000, 'AU render');
  check(d.type === 'render.done', 'AU render');
  if (d.type === 'render.done') {
    const s = stats(readWav(path).data);
    check(s.rms > 1e-4 && s.nonFinite === 0, `DLSMusicDevice through AULowpass is audible (rms ${s.rms})`);
  }
  engine.send({ type: 'project.sync', project: baseProject() });
}

// Random project edits (structural and parameter changes), timeline/automation updates, sample
// reloads, live notes, previews, seeks and device restarts while the transport plays and while an
// offline render runs. Checks that the engine stays responsive, its output stays finite and the
// master limiter keeps it bounded. Most useful with sanitizer builds (ASan/TSan).
const STRESS_EFFECTS = {
  eq: { lowGain: [-18, 18], lowFreq: [30, 1000], midGain: [-18, 18], midFreq: [150, 8000], midQ: [0.2, 8], highGain: [-18, 18], highFreq: [1500, 16000] },
  filter: { mode: [0, 3, true], cutoff: [20, 20000], resonance: [0.1, 18], lfoRate: [0.05, 20], lfoDepth: [0, 1] },
  compressor: { threshold: [-60, 0], ratio: [1, 20], attack: [0.0005, 0.3], release: [0.02, 1.5], knee: [0, 30], makeup: [0, 24] },
  distortion: { drive: [0, 1], tone: [500, 16000], output: [-24, 6], mix: [0, 1] },
  chorus: { rate: [0.05, 8], depth: [0, 1], delay: [2, 30], mix: [0, 1] },
  delay: { time: [0, 10, true], feedback: [0, 0.95], tone: [500, 16000], pingPong: [0, 1, true], mix: [0, 1] },
  reverb: { decay: [0.3, 3], predelay: [0, 0.2], damping: [0, 1], lowCut: [20, 1000], mix: [0, 1] },
  limiter: { gain: [0, 18], ceiling: [-12, 0], release: [0.01, 1] },
};

async function testStress(engine, plugins) {
  console.log('stress: edits while playing and rendering');
  let seed = stressSeed;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const range = (lo, hi) => lo + rnd() * (hi - lo);
  const value = ([lo, hi, int]) => (int ? Math.round(range(lo, hi)) : range(lo, hi));

  let sampleFiles = 0;
  const snareFile = () => writeRawSample(`stress-snare-${sampleFiles++}.f32`, 2, 12000, (i, c) => (rnd() * 2 - 1) * Math.exp(-i / 2500) * (c ? 0.4 : 0.5));
  const loadSnare = () => ({ type: 'samples.loadRaw', id: 'test:snare', path: snareFile(), sampleRate: 44100, channels: 2, frames: 12000 });
  const loaded = await engine.request(loadSnare(), (m) => (m.type === 'samples.loaded' && m.id === 'test:snare') || (m.type === 'error' && m.request === 'samples.loadRaw'), 5000, 'stress sample');
  check(loaded.type === 'samples.loaded', 'stress: 44.1 kHz stereo sample loads');

  let nextId = 1;
  const newEffect = (type = pick(Object.keys(STRESS_EFFECTS))) => {
    const params = {};
    for (const [key, spec] of Object.entries(STRESS_EFFECTS[type])) params[key] = value(spec);
    return { id: `fx_s${nextId++}`, type, enabled: true, params };
  };
  const pluginRef = (p) => ({ uid: p.uid, name: p.name, vendor: p.vendor, format: p.format, fileOrIdentifier: p.fileOrIdentifier, isInstrument: p.isInstrument, state: null });

  // Every playable channel carries synth and sampler parameters so its kind can flip. The master
  // keeps only its limiter at unity gain, so the output stays bounded.
  const project = baseProject();
  project.samples['test:snare'] = { id: 'test:snare', name: 'Snare', source: 'factory' };
  project.channels[0].sampler = samplerParams('test:kick');
  project.channels[1].synth = synthParams();
  project.channels.push({ id: 'ch_snare', kind: 'sampler', volume: 0.8, pan: 0, muted: false, mixerTrack: 3, synth: synthParams(), sampler: samplerParams('test:snare', { oneShot: false }) });
  const playable = () => project.channels.filter((c) => c.kind === 'synth' || c.kind === 'sampler' || c.kind === 'plugin');
  const insert = () => project.mixer[1 + Math.floor(rnd() * (project.mixer.length - 1))];
  const internalEffects = () => project.mixer.slice(1).flatMap((t) => t.effects.filter((fx) => fx.type !== 'plugin'));

  const mutate = () => {
    switch (Math.floor(rnd() * (plugins ? 14 : 12))) {
      case 0: { // parameter change of an existing effect (smoothing only, no rebuild)
        const fx = internalEffects();
        if (fx.length > 0) {
          const e = pick(fx);
          const [key, spec] = pick(Object.entries(STRESS_EFFECTS[e.type]));
          e.params[key] = value(spec);
        }
        break;
      }
      case 1: {
        const t = insert();
        if (t.effects.length < 4) t.effects.push(newEffect());
        break;
      }
      case 2: {
        const t = insert();
        if (t.effects.length > 0) t.effects.splice(Math.floor(rnd() * t.effects.length), 1);
        break;
      }
      case 3:
        insert().effects.reverse();
        break;
      case 4: {
        const fx = internalEffects();
        if (fx.length > 0) {
          const e = pick(fx);
          e.enabled = !e.enabled;
        }
        break;
      }
      case 5: {
        const c = pick(playable());
        if (c.kind !== 'plugin') c.kind = c.kind === 'synth' ? 'sampler' : 'synth';
        break;
      }
      case 6: {
        const c = pick(playable());
        if (c.sampler) {
          Object.assign(c.sampler, {
            sampleId: pick(['test:kick', 'test:snare']), reverse: rnd() < 0.4, loop: rnd() < 0.3, oneShot: rnd() < 0.5,
            start: rnd() * 0.5, chokeGroup: Math.floor(rnd() * 3), cutSelf: rnd() < 0.5, fine: range(-100, 100),
          });
        }
        break;
      }
      case 7:
        pick(playable()).mixerTrack = Math.floor(rnd() * project.mixer.length);
        break;
      case 8: {
        Object.assign(insert(), { volume: rnd(), pan: range(-1, 1), muted: rnd() < 0.15, solo: rnd() < 0.15 });
        Object.assign(pick(playable()), { volume: rnd(), pan: range(-1, 1), muted: rnd() < 0.1 });
        break;
      }
      case 9: {
        const c = pick(playable());
        if (c.synth) {
          Object.assign(pick(c.synth.osc), { wave: pick(['sine', 'square', 'sawtooth', 'triangle', 'noise']), unison: 1 + Math.floor(rnd() * 7), pan: range(-1, 1), level: rnd() });
          Object.assign(c.synth.filter, { enabled: rnd() < 0.8, cutoff: range(40, 18000), resonance: range(0, 20), type: pick(['lowpass', 'highpass', 'bandpass', 'notch']) });
          c.synth.lfo = { target: pick(['off', 'filter', 'pitch', 'amp']), rate: range(0.1, 12), depth: rnd() };
        }
        break;
      }
      case 10:
        project.bpm = range(60, 200);
        project.swing = rnd();
        break;
      case 11: {
        const i = project.channels.findIndex((c) => c.id === 'ch_extra');
        if (i >= 0) project.channels.splice(i, 1);
        else project.channels.push({ id: 'ch_extra', kind: 'synth', volume: 0.8, pan: 0, muted: false, mixerTrack: 3, synth: synthParams({ gain: 0.4 }), sampler: samplerParams('test:kick') });
        break;
      }
      case 12: { // a plugin effect appears or disappears (asynchronous instance creation while playing)
        const t = insert();
        const i = t.effects.findIndex((fx) => fx.type === 'plugin');
        if (i >= 0) t.effects.splice(i, 1);
        else t.effects.push({ id: `fx_p${nextId++}`, type: 'plugin', enabled: true, params: {}, plugin: pluginRef(plugins.gain) });
        break;
      }
      default: { // a plugin instrument channel appears or disappears
        const i = project.channels.findIndex((c) => c.kind === 'plugin');
        if (i >= 0) project.channels.splice(i, 1);
        else project.channels.push({ id: `ch_p${nextId++}`, kind: 'plugin', volume: 0.8, pan: 0, muted: false, mixerTrack: 1, plugin: pluginRef(plugins.synth) });
        break;
      }
    }
  };

  const randomTimeline = () => {
    const events = [];
    for (const c of playable()) {
      for (let n = 0; n < 6; n++) {
        const clip = rnd() < 0.2 ? { audioClip: true, sampleOffset: Math.floor(rnd() * 48) } : {};
        events.push({ tick: Math.floor(rnd() * 32) * 24, length: 12 + Math.floor(rnd() * 200), channelId: c.id, key: 36 + Math.floor(rnd() * 48), velocity: 0.3 + rnd() * 0.7, ...clip });
      }
    }
    events.sort((a, b) => a.tick - b.tick);
    return { type: 'timeline.set', mode: rnd() < 0.8 ? 'song' : 'pattern', loopStart: 0, loopEnd: 768, events };
  };

  const randomAutomation = () => {
    const targets = [['proj:bpm', 60, 200], ['proj:swing', 0, 1]];
    for (const c of playable()) {
      targets.push([`ch:${c.id}:volume`, 0, 1], [`ch:${c.id}:pan`, -1, 1]);
      if (c.kind === 'synth') targets.push([`ch:${c.id}:synth.filter.cutoff`, 100, 12000], [`ch:${c.id}:synth.osc.0.level`, 0, 1], [`ch:${c.id}:synth.lfo.rate`, 0.1, 12]);
      if (c.kind === 'sampler') targets.push([`ch:${c.id}:sampler.fine`, -100, 100], [`ch:${c.id}:sampler.gain`, 0, 1]);
    }
    for (let i = 1; i < project.mixer.length; i++) targets.push([`mx:${i}:volume`, 0, 1], [`mx:${i}:pan`, -1, 1]);
    for (const fx of internalEffects()) {
      const [key, [lo, hi]] = pick(Object.entries(STRESS_EFFECTS[fx.type]));
      targets.push([`fx:${fx.id}:${key}`, lo, hi]);
    }
    const lanes = [];
    for (let n = 0; n < 4; n++) {
      const [target, lo, hi] = pick(targets);
      const points = [];
      for (let t = 0; t <= 768; t += 96 + Math.floor(rnd() * 96)) points.push([t, range(lo, hi)]);
      lanes.push({ target, points });
    }
    return { type: 'automation.set', lanes };
  };

  let handle = 1000;
  const openHandles = [];
  let snareLoaded = true; // preview.sample of an unloaded sample is an error
  const extras = (allowDevice) => {
    if (rnd() < 0.15) engine.send(randomTimeline());
    if (rnd() < 0.1) engine.send(randomAutomation());
    if (rnd() < 0.06) engine.send({ type: 'transport.seek', tick: Math.floor(rnd() * 768) });
    if (rnd() < 0.12) {
      openHandles.push(++handle);
      engine.send({ type: 'live.noteOn', handle, channelId: pick(playable()).id, key: 40 + Math.floor(rnd() * 40), velocity: rnd() });
    }
    if (openHandles.length > 0 && rnd() < 0.12) engine.send({ type: 'live.noteOff', handle: openHandles.shift() });
    if (rnd() < 0.04) engine.send({ type: 'preview.sample', id: pick(snareLoaded ? ['test:kick', 'test:snare'] : ['test:kick']) });
    if (rnd() < 0.03) engine.send({ type: 'preview.synth', synth: synthParams(), keys: [48, 55, 60], duration: 0.4 });
    if (rnd() < 0.02) engine.send({ type: 'preview.stop' });
    if (rnd() < 0.04) {
      engine.send(loadSnare());
      snareLoaded = true;
    }
    if (rnd() < 0.015) {
      engine.send({ type: 'samples.unload', id: 'test:snare' });
      snareLoaded = false;
    }
    if (rnd() < 0.02) engine.send({ type: 'live.allNotesOff' });
    if (allowDevice && rnd() < 0.015) engine.send({ type: 'audio.setDevice', bufferSize: pick([128, 256, 512, 1024, 4096]) });
  };

  const steps = async (count, allowDevice) => {
    for (let i = 0; i < count; i++) {
      mutate();
      if (rnd() < 0.5) mutate();
      engine.send({ type: 'project.sync', project });
      extras(allowDevice);
      await sleep(15);
    }
  };

  // The limiter clips to -0.5 dBFS in its 2x oversampled domain; like Chromium's WaveShaper, the
  // downsampling filter rings above that on heavily clipped material, so allow +1 dBFS.
  const limiterBound = 1.12;

  const s0 = engine.messages.length;
  engine.send({ type: 'project.sync', project });
  engine.send(randomTimeline());
  engine.send({ type: 'transport.play', fromTick: 0 });
  await steps(120, true);
  const statusDuring = engine.messages.slice(s0).filter((m) => m.type === 'status' && m.playing).length;
  // ~30/s normally; sanitizer builds spend most of the message thread on project.sync parsing.
  check(statusDuring >= 3, `stress: status keeps arriving while playing (${statusDuring})`);

  // Edits while an offline render of the current state runs (live playback stops for it).
  const renderPath = join(work, 'stress-render.wav');
  const r0 = engine.messages.length;
  engine.send({ type: 'render.start', requestId: 'stress', path: renderPath, sampleRate: 48000, bitDepth: 32, startTick: 0, endTick: 384, tailSeconds: 0.3 });
  await steps(40, false);
  const done = await engine.waitFor((m) => (m.type === 'render.done' && m.requestId === 'stress') || (m.type === 'error' && m.request === 'render.start'), 120000, 'stress render', r0);
  check(done.type === 'render.done', `stress: a render during edits finishes (${done.message ?? 'ok'})`);
  if (done.type === 'render.done') {
    const s = stats(readWav(renderPath).data);
    check(s.nonFinite === 0 && s.peak <= limiterBound, `stress: rendered audio is finite and limited (peak ${s.peak.toFixed(3)})`);
  }

  // Play again with the final state, then stop.
  engine.send({ type: 'transport.play', fromTick: 96 });
  await steps(40, true);
  engine.send({ type: 'transport.stop' });
  engine.send({ type: 'live.allNotesOff' });
  const pong = await engine.request({ type: 'ping', requestId: 'stress-ping' }, (m) => m.type === 'pong' && m.requestId === 'stress-ping', 20000, 'pong after stress');
  check(pong.type === 'pong', 'stress: engine stays responsive');
  await sleep(300);

  const recent = engine.messages.slice(s0);
  const meters = recent.filter((m) => m.type === 'meters');
  const finite = (m) => m.peaks.every((p) => p.every(Number.isFinite)) && m.waveform.every(Number.isFinite);
  check(meters.length > 0 && meters.every(finite), `stress: meters stay finite (${meters.length} frames)`);
  const masterPeak = Math.max(0, ...meters.map((m) => Math.max(m.peaks[0][0], m.peaks[0][1])));
  check(masterPeak <= limiterBound, `stress: the master limiter keeps the output bounded (peak ${masterPeak.toFixed(3)})`);
  if (masterPeak > limiterBound) {
    // What was sent shortly before the loudest meter frame (helps to reproduce with --seed).
    const at = engine.messages.findIndex((m, i) => i >= s0 && m.type === 'meters' && Math.max(m.peaks[0][0], m.peaks[0][1]) === masterPeak);
    const before = engine.sent.filter((s) => s.index <= at && s.index > at - 60 && s.type !== 'project.sync').map((s) => s.type);
    console.log(`  loudest master frame: message #${at}; commands before it (project.sync omitted): ${before.join(', ')}`);
  }
  const errors = recent.filter((m) => m.type === 'error' || m.type === 'plugin.error');
  check(errors.length === 0, `stress: no errors (${errors.length}${errors.length ? `: ${errors.slice(0, 3).map((e) => e.message).join('; ')}` : ''})`);
  check(engine.proc.exitCode === null, 'stress: engine still running');

  engine.send({ type: 'automation.set', lanes: [] });
  engine.send({ type: 'audio.setDevice', bufferSize: 512 });
  engine.send({ type: 'project.sync', project: baseProject() });
  engine.send(timeline());
  await engine.request({ type: 'ping' }, (m) => m.type === 'pong', 10000, 'pong after restoring the project');
}

// ---- main ---------------------------------------------------------------------------------------
async function main() {
  console.log(`engine: ${enginePath}`);
  const dataDir = join(work, 'data');
  const engine = new Engine(['--stdio', '--data-dir', dataDir, '--null-audio', '--null-input-tone', '440']);
  let exitInfo = null;
  try {
    const ready = await engine.waitFor((m) => m.type === 'ready', 20000, 'ready');
    await testBasics(engine, ready);
    await testPlayback(engine);
    await testRender(engine);
    await testRecording(engine, ready);
    await testAutomation(engine);
    const plugins = await testPlugins(engine);
    await testStress(engine, plugins);
    exitInfo = await engine.close();
    check(exitInfo.code === 0, `engine exits cleanly when stdin closes (code ${exitInfo.code}, signal ${exitInfo.signal})`);
    check(existsSync(join(dataDir, 'plugins.json')) || !existsSync(join(pluginDir, 'MAD Test Gain.vst3')), 'plugin list cached in <data-dir>/plugins.json');
  } catch (err) {
    failures.push(err.message);
    console.log(`  FAIL ${err.message}`);
    if (!exitInfo) engine.proc.kill('SIGKILL');
  }

  if (failures.length > 0) {
    console.log(`\n--- engine stderr (tail) ---\n${engine.stderr.split('\n').slice(-40).join('\n')}`);
    console.log(`\n${passed} passed, ${failures.length} FAILED:`);
    for (const f of failures) console.log(`  - ${f}`);
  } else {
    console.log(`\nall ${passed} checks passed`);
  }
  if (!keep) rmSync(work, { recursive: true, force: true });
  else console.log(`kept ${work}`);
  process.exit(failures.length > 0 ? 1 : 0);
}

main();
