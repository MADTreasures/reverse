// Renders build/icon.svg to build/icon.png (1024 px) and public/favicon.png with Playwright's Chromium.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const svg = readFileSync('build/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.locator('svg').screenshot({ path: 'build/icon.png', omitBackground: true });
await page.setViewportSize({ width: 128, height: 128 });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="1024" height="1024"', 'width="128" height="128"')}</body></html>`);
await page.locator('svg').screenshot({ path: 'public/favicon.png', omitBackground: true });
await browser.close();
console.log('wrote build/icon.png and public/favicon.png');
