// Starts the Vite dev server and opens it in Electron with hot reload.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';

const require = createRequire(import.meta.url);
const PORT = 5173;
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

const vite = spawn(process.execPath, [require.resolve('vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { stdio: 'inherit' });
await waitForPort(PORT);
const electronBinary = require('electron');
const app = spawn(electronBinary, ['.'], { stdio: 'inherit', env: { ...process.env, MAD_DEV_URL: URL } });
app.on('exit', (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
process.on('SIGINT', () => {
  app.kill();
  vite.kill();
});
