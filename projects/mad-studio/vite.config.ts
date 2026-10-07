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
    name: 'mad-studio-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

export default defineConfig({
  // Relative asset URLs so the build also loads inside the Electron app.
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5173, strictPort: true },
});
