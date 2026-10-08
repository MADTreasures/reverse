// Starts the native audio engine (engine/, JUCE) as a child process and relays its stdio JSON-line
// protocol (engine/PROTOCOL.md) between the engine and the renderer.
const { app } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');

const PROJECT_ROOT = path.join(__dirname, '..');
const MAX_LINE = 64 * 1024 * 1024;

/** Candidate locations of the engine binary: packaged app first, then local builds. */
function candidatePaths() {
  const fromEnv = process.env.MAD_ENGINE_PATH ? [process.env.MAD_ENGINE_PATH] : [];
  const exe = process.platform === 'win32' ? 'mad-engine.exe' : 'mad-engine';
  const macApp = (dir) => path.join(dir, 'MAD Engine.app', 'Contents', 'MacOS', 'MAD Engine');
  const packaged = app.isPackaged ? [macApp(path.join(process.resourcesPath, 'engine')), path.join(process.resourcesPath, 'engine', exe)] : [];
  const build = path.join(PROJECT_ROOT, 'engine', 'build');
  const local = [];
  for (const cfg of ['Release', 'RelWithDebInfo', 'Debug', '']) {
    for (const base of [path.join(build, 'MadEngine_artefacts', cfg), path.join(build, cfg), build]) {
      local.push(macApp(base), path.join(base, exe));
    }
  }
  return [...fromEnv, ...packaged, ...local];
}

function findEngine() {
  if (process.env.MAD_DISABLE_NATIVE_ENGINE === '1') return null;
  for (const p of candidatePaths()) {
    try {
      if (fsSync.statSync(p).isFile()) return p;
    } catch {
      // not there
    }
  }
  return null;
}

class EngineHost {
  constructor(send) {
    this.sendToRenderer = send;
    this.binary = findEngine();
    this.child = null;
    this.restarts = 0;
    this.stopping = false;
    this.pendingFiles = new Map();
    this.tempDir = path.join(os.tmpdir(), `mad-studio-${process.pid}`);
    this.dataDir = path.join(app.getPath('userData'), 'engine');
    this.recordFolder = path.join(app.getPath('music'), 'MAD Studio', 'Recorded');
  }

  get available() {
    return this.binary !== null;
  }

  start() {
    if (!this.binary || this.child) return;
    fsSync.mkdirSync(this.dataDir, { recursive: true });
    fsSync.mkdirSync(this.tempDir, { recursive: true });
    try {
      fsSync.mkdirSync(this.recordFolder, { recursive: true });
    } catch {
      // The renderer reports recording errors; startup must not fail.
    }
    const child = spawn(this.binary, ['--stdio', '--data-dir', this.dataDir], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => this.onLine(line));
    child.stderr.on('data', (chunk) => process.stderr.write(`[engine] ${chunk}`));
    child.on('error', (err) => this.sendToRenderer({ type: 'engine.error', message: String(err.message || err) }));
    child.on('exit', (code, signal) => {
      this.child = null;
      if (this.stopping) return;
      this.sendToRenderer({ type: 'engine.exit', code, signal });
      // Restart after crashes, backing off; the renderer re-sends its state on "ready".
      if (this.restarts < 5) {
        const delay = 500 * 2 ** this.restarts;
        this.restarts += 1;
        setTimeout(() => this.start(), delay);
      }
    });
  }

  onLine(line) {
    if (!line || line.length > MAX_LINE) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'ready') this.restarts = 0;
    if (msg.type === 'samples.loaded' && typeof msg.id === 'string') this.cleanupSample(msg.id);
    this.sendToRenderer(msg);
  }

  send(msg) {
    if (!this.child || !msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    // Recording always goes to our Recorded folder; the renderer cannot point it elsewhere.
    if (msg.type === 'record.config') msg = { ...msg, folder: this.recordFolder };
    try {
      this.child.stdin.write(`${JSON.stringify(msg)}\n`);
    } catch {
      // Engine is restarting.
    }
  }

  /** Writes interleaved float32 PCM to a temporary file and tells the engine to load it. */
  async loadSample(id, sampleRate, channels) {
    if (!this.child || typeof id !== 'string' || !Array.isArray(channels) || channels.length === 0) return;
    const count = Math.min(channels.length, 8);
    const frames = Math.min(...channels.slice(0, count).map((c) => c.length));
    const interleaved = new Float32Array(frames * count);
    for (let c = 0; c < count; c++) {
      const src = channels[c];
      for (let i = 0; i < frames; i++) interleaved[i * count + c] = src[i];
    }
    const file = path.join(this.tempDir, `${crypto.randomUUID()}.f32`);
    await fs.writeFile(file, Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength));
    const prev = this.pendingFiles.get(id);
    if (prev) void fs.rm(prev, { force: true });
    this.pendingFiles.set(id, file);
    this.send({ type: 'samples.loadRaw', id, path: file, sampleRate: Number(sampleRate) || 44100, channels: count, frames });
    // In case the engine never confirms (crash), clean up later.
    setTimeout(() => this.cleanupSample(id, file), 60_000);
  }

  cleanupSample(id, only) {
    const file = this.pendingFiles.get(id);
    if (!file || (only && file !== only)) return;
    this.pendingFiles.delete(id);
    void fs.rm(file, { force: true });
  }

  /** Files the renderer may read back: recordings and renders, nothing else. */
  isReadable(p) {
    const resolved = path.resolve(p);
    return [this.recordFolder, this.tempDir].some((dir) => resolved.startsWith(path.resolve(dir) + path.sep));
  }

  async readFile(p) {
    if (typeof p !== 'string' || !this.isReadable(p)) throw new Error('Access denied');
    return new Uint8Array(await fs.readFile(p));
  }

  tempPath(name) {
    const safe = String(name).replace(/[^\w.-]/g, '_').slice(-60) || 'render.wav';
    fsSync.mkdirSync(this.tempDir, { recursive: true });
    return path.join(this.tempDir, `${Date.now()}-${safe}`);
  }

  restart() {
    this.restarts = 0;
    if (this.child) this.child.kill();
    else this.start();
  }

  stop() {
    this.stopping = true;
    if (this.child) {
      try {
        this.child.stdin.end();
      } catch {
        // ignore
      }
      const child = this.child;
      setTimeout(() => child.kill(), 1500);
    }
    try {
      fsSync.rmSync(this.tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

module.exports = { EngineHost, findEngine };
