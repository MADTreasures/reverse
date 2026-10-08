import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Adds a strict Content-Security-Policy to the production build only (dev needs HMR). */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "connect-src 'self' data: blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
  return {
    name: 'mad-studio-paint-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

/**
 * Writes THIRD_PARTY_LICENSES.txt next to the build: name, version and licence text of every
 * package that ends up in the bundle (their licences ask for the notice to travel with the code).
 */
function thirdPartyLicenses(): Plugin {
  return {
    name: 'mad-studio-paint-licenses',
    apply: 'build',
    generateBundle() {
      // Package name → its directory (the innermost node_modules, for nested packages).
      const packages = new Map<string, string>();
      for (const id of this.getModuleIds()) {
        const m = /^(.*node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+))/.exec(id);
        if (m) packages.set(m[2].replace(/\\/g, '/'), m[1]);
      }
      const parts = [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([name, dir]) => {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: string; license?: string };
        const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
        const text = file ? readFileSync(join(dir, file), 'utf8').trim() : `License: ${pkg.license ?? 'see package'}`;
        return `${name} ${pkg.version ?? ''}\n${'-'.repeat(60)}\n${text}\n`;
      });
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_LICENSES.txt',
        source: `MAD Studio Paint includes the following open source packages.\n\n${parts.join('\n')}`,
      });
    },
  };
}

export default defineConfig({
  // Relative asset URLs so the build also loads inside the Electron app.
  base: './',
  plugins: [react(), contentSecurityPolicy(), thirdPartyLicenses()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5174, strictPort: true },
});
