// Renders build/icon.svg (plus the generated step grid) to build/icon.png with Playwright's Chromium.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

// 5×5 step grid; 1 = lit step. The lit steps form an "M".
const M = [
  [1, 0, 0, 0, 1],
  [1, 1, 0, 1, 1],
  [1, 0, 1, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 0, 0, 0, 1],
];
const size = 104;
const gap = 24;
const origin = 512 - (5 * size + 4 * gap) / 2;
let cells = '';
M.forEach((row, r) =>
  row.forEach((on, c) => {
    const x = origin + c * (size + gap);
    const y = origin + r * (size + gap);
    cells += on
      ? `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="22" fill="url(#lit)" filter="url(#glow)"/>`
      : `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="22" fill="#2c353e" stroke="#0b0e10" stroke-width="3"/>`;
  }),
);
const svg = readFileSync('build/icon.svg', 'utf8').replace('<g id="grid"></g>', `<g id="grid">${cells}</g>`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator('svg').screenshot({ path: 'build/icon.png', omitBackground: true });
// Small favicon for the browser build.
await page.setViewportSize({ width: 128, height: 128 });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="1024" height="1024"', 'width="128" height="128"')}</body></html>`);
await page.locator('svg').screenshot({ path: 'public/favicon.png', omitBackground: true });
await browser.close();
console.log('wrote build/icon.png and public/favicon.png');
