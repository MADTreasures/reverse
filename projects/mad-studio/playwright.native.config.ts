import { defineConfig } from '@playwright/test';

/**
 * Desktop app + native engine (engine/build/Release). Run after `npm run build` and an engine build:
 *   npx playwright test -c playwright.native.config.ts   (Linux CI: under xvfb-run)
 * The tests skip themselves when no engine build is found.
 */
export default defineConfig({
  testDir: 'tests/native',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list']] : 'list',
});
