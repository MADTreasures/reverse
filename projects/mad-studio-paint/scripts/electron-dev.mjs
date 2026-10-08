// Starts the Vite dev server and opens it in Electron with hot reload.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';

const require = createRequire(import.meta.url);
const PORT = 5174;
const URL = `http://localhost:${PORT}`;

function waitForPort(port, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error(`Vite did not start on port ${port}`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

// vite/bin is not in the package's "exports", so locate it via package.json.
const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort'], { stdio: 'inherit' });
await waitForPort(PORT);
const electronBinary = require('electron');
// Extra arguments (e.g. --smoke-test) are passed through to Electron.
const app = spawn(electronBinary, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, MAD_PAINT_DEV_URL: URL } });
app.on('exit', (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
process.on('SIGINT', () => {
  app.kill();
  vite.kill();
});
