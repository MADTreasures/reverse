// Copies the locally built native engine (engine/build/…) to build/engine-staging/, which
// electron-builder ships as Resources/engine/. Without an engine build the folder stays empty and
// the app falls back to the Web Audio engine.
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = path.join(root, 'build', 'engine-staging');
const build = path.join(root, 'engine', 'build');
const exe = process.platform === 'win32' ? 'mad-engine.exe' : 'mad-engine';

const bases = [];
for (const cfg of ['Release', 'RelWithDebInfo', 'Debug', '']) {
  bases.push(path.join(build, 'MadEngine_artefacts', cfg), path.join(build, cfg), build);
}

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

const fromEnv = process.env.MAD_ENGINE_BUNDLE;
let staged = null;
for (const base of fromEnv ? [path.dirname(fromEnv)] : bases) {
  const app = path.join(base, 'MAD Engine.app');
  const bin = path.join(base, exe);
  if (existsSync(path.join(app, 'Contents', 'MacOS', 'MAD Engine'))) {
    cpSync(app, path.join(staging, 'MAD Engine.app'), { recursive: true, verbatimSymlinks: true });
    staged = app;
    break;
  }
  if (existsSync(bin) && statSync(bin).isFile()) {
    cpSync(bin, path.join(staging, exe));
    staged = bin;
    break;
  }
}

if (staged) console.log(`Staged native engine: ${path.relative(root, staged)} → build/engine-staging/`);
else console.warn('No native engine build found (engine/build) – the app will use the Web Audio engine.');
