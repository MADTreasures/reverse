import { _electron as electron, expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    __madStudio: any;
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const release = path.join(root, 'engine/build/Release');
const enginePath =
  process.platform === 'darwin'
    ? path.join(release, 'MAD Engine.app/Contents/MacOS/MAD Engine')
    : path.join(release, process.platform === 'win32' ? 'mad-engine.exe' : 'mad-engine');
const pluginDir = path.join(release, 'plugins');

test.skip(!existsSync(enginePath), `native engine not built (${enginePath})`);

test('desktop app drives the native engine: playback, VST3 plugins, render, plugin state, delay compensation', async () => {
  // A fresh profile: no restored session, no plugin cache, no "save changes?" prompt on close.
  const profile = mkdtempSync(path.join(tmpdir(), 'mad-studio-native-'));
  const app = await electron.launch({
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    cwd: root,
    env: { ...process.env, MAD_ENGINE_PATH: enginePath, MAD_STUDIO_TEST_PROFILE: profile },
  });
  const t0 = Date.now();
  const step = (name: string) => console.log(`[native ${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}`);
  // The app's stderr (engine messages included), printed when a step fails.
  let stderrTail = '';
  app.process().stderr?.on('data', (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-6000);
  });
  if (process.env.MAD_NATIVE_DEBUG) {
    app.process().stdout?.on('data', (d) => process.stdout.write(`[main] ${d}`));
    app.process().stderr?.on('data', (d) => process.stdout.write(`[main:err] ${d}`));
  }
  try {
    const page = await app.firstWindow();
    if (process.env.MAD_NATIVE_DEBUG) page.on('console', (m) => console.log(`[renderer:${m.type()}] ${m.text()}`));
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForFunction(() => window.__madStudio?.useStore.getState().audioReady === true);
    await page.waitForFunction(() => window.__madStudio.usePlugins.getState().nativeEngine === true);
    expect(await page.evaluate(() => window.__madStudio.engine.isNative)).toBe(true);
    await page.waitForFunction(() => window.__madStudio.usePlugins.getState().device !== null);
    const device = await page.evaluate(() => window.__madStudio.usePlugins.getState().device);
    step(`engine ready: ${device.type} "${device.output}", ${device.sampleRate} Hz, ${device.bufferSize} frames, output latency ${device.outputLatency}`);

    // Playback: the engine's status messages move the playhead.
    await page.evaluate(() => window.__madStudio.engine.play());
    try {
      await expect.poll(() => page.evaluate(() => window.__madStudio.engine.playheadTick() ?? -1)).toBeGreaterThan(48);
    } catch (e) {
      const state = await page.evaluate(() => {
        const m = window.__madStudio;
        const impl = m.engine.impl; // the facade's native engine
        return { status: impl?.status, ready: impl?.ready, playing: m.useStore.getState().transport.playing, device: m.usePlugins.getState().device };
      });
      console.log(`[native] the playhead did not move: ${JSON.stringify(state)}\n[native] app stderr (tail):\n${stderrTail}`);
      throw e;
    }
    await page.evaluate(() => window.__madStudio.engine.stop());
    await expect.poll(() => page.evaluate(() => window.__madStudio.useStore.getState().transport.playing)).toBe(false);

    step('playback ok');
    // Plugin scan of the test plugins (each plugin is checked in its own engine process).
    const hasPlugins = existsSync(pluginDir);
    test.skip(!hasPlugins, 'test plugins not built (-DMAD_BUILD_TEST_PLUGINS=ON)');
    await page.evaluate((dir) => window.__madStudio.engine.scanPlugins({ paths: { VST3: [dir] } }), pluginDir);
    await expect
      .poll(() => page.evaluate(() => window.__madStudio.usePlugins.getState().plugins.map((p: any) => p.name).sort()), { timeout: 60_000 })
      .toEqual(expect.arrayContaining(['MAD Test Gain', 'MAD Test Synth']));

    step('scan ok');
    // Instrument plugin as a channel, effect plugin in a mixer slot.
    const keys = await page.evaluate(() => {
      const m = window.__madStudio;
      const list = m.usePlugins.getState().plugins;
      const synth = list.find((p: any) => p.name === 'MAD Test Synth');
      const gain = list.find((p: any) => p.name === 'MAD Test Gain');
      const channelId = m.actions.addPluginChannel(m.pluginInstanceFrom(synth));
      const slotId = m.actions.addPluginEffect(1, m.pluginInstanceFrom(gain));
      const pattern = m.useStore.getState().ui.selectedPatternId;
      m.actions.addNotes(pattern, channelId, [{ key: 60, start: 0, length: 96, velocity: 0.9 }]);
      return { channelId, slot: `fx:${slotId}`, channel: `ch:${channelId}` };
    });
    await expect
      .poll(() => page.evaluate((k) => [k.channel, k.slot].map((key) => window.__madStudio.usePlugins.getState().instances[key]?.state), keys))
      .toEqual(['ready', 'ready']);

    // The plugin channel's row in the channel rack keeps its layout: name button after the mute switch.
    const row = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.rack-row')];
      const last = rows[rows.length - 1];
      const box = (selector: string) => {
        const r = last?.querySelector(selector)?.getBoundingClientRect();
        return r ? { x: r.x, width: r.width } : null;
      };
      return { mute: box('.mute-led'), name: box('.channel-name') };
    });
    expect(row.mute && row.name && row.name.x >= row.mute.x + row.mute.width).toBe(true);

    step('plugins loaded');
    // Parameters come from the plugin and can be set.
    await page.evaluate((k) => window.__madStudio.engine.requestPluginParams(k.slot), keys);
    await expect.poll(() => page.evaluate((k) => window.__madStudio.usePlugins.getState().params[k.slot]?.length ?? 0, keys)).toBeGreaterThan(0);
    await page.evaluate((k) => window.__madStudio.engine.setPluginParam(k.slot, 0, 0.5), keys);

    step('params ok');
    // The plugin synth plays its pattern note.
    await page.evaluate(() => window.__madStudio.engine.play());
    await expect.poll(() => page.evaluate((k) => window.__madStudio.engine.channelActivityAge(k.channelId), keys)).toBeLessThan(1);
    await page.evaluate(() => window.__madStudio.engine.stop());

    step('synth played');
    // Offline render through the engine.
    const render = await page.evaluate(async () => {
      const m = window.__madStudio;
      const { wav, buffer } = await m.engine.renderWav({ mode: 'pattern', patternId: m.useStore.getState().ui.selectedPatternId, loops: 1, sampleRate: 48000, bitDepth: 16 });
      let peak = 0;
      for (let c = 0; c < buffer.numberOfChannels; c++) for (const v of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
      return { riff: String.fromCharCode(...wav.slice(0, 4)), seconds: buffer.duration, peak };
    });
    expect(render.riff).toBe('RIFF');
    expect(render.seconds).toBeGreaterThan(0.5);
    expect(render.peak).toBeGreaterThan(0.01);

    step('render ok');
    // Saving stores the plugins' state in the project.
    await page.evaluate(() => window.__madStudio.engine.capturePluginStates());
    const states = await page.evaluate((k) => {
      const p = window.__madStudio.useStore.getState().project;
      const ch = p.channels.find((c: any) => c.id === k.channelId);
      const slot = p.mixer[1].effects.find((e: any) => `fx:${e.id}` === k.slot);
      return [typeof ch?.plugin?.state, (ch?.plugin?.state ?? '').length > 0, (slot?.plugin?.state ?? '').length > 0];
    }, keys);
    expect(states).toEqual(['string', true, true]);
    expect(errors).toEqual([]);
    step('plugin states ok');

    // Plugin delay compensation (FL Studio: automatic PDC, the mixer's delay panel, wrapper latency).
    // MAD Test Delay on insert 2 reports 1000 samples; insert 1 (MAD Test Gain) waits for it.
    const delayKey = await page.evaluate(() => {
      const m = window.__madStudio;
      const delay = m.usePlugins.getState().plugins.find((p: any) => p.name === 'MAD Test Delay');
      return delay ? `fx:${m.actions.addPluginEffect(2, m.pluginInstanceFrom(delay))}` : null;
    });
    expect(delayKey).not.toBeNull();
    await expect.poll(() => page.evaluate((k) => window.__madStudio.usePlugins.getState().instances[k]?.state, delayKey)).toBe('ready');
    const latency = () =>
      page.evaluate(() => {
        const l = window.__madStudio.usePlugins.getState().latency;
        return l ? { automatic: l.automatic, total: l.total, rate: l.sampleRate, latency2: l.tracks[2]?.latency, delay1: l.tracks[1]?.delay } : null;
      });
    await expect.poll(async () => (await latency())?.total).toBe(1000);
    const report = await latency();
    expect([report?.latency2, report?.delay1]).toEqual([1000, 1000]);
    const rate = report!.rate;

    await page.evaluate(() => {
      const m = window.__madStudio;
      if (!m.useStore.getState().ui.windows.mixer?.open) m.runCommand('window:mixer');
    });
    const panel = page.locator('.strip').nth(2).locator('.pdc');
    await expect(panel).toHaveClass(/latent/);
    await expect(panel).toHaveAttribute('data-hint', /1000 samples/);
    await expect(page.locator('.strip').nth(1).locator('.pdc')).toHaveAttribute('data-hint', /delayed/);

    // Manual offset through the delay panel: Set in samples…, then the mouse wheel (+10 ms).
    await panel.click();
    await page.locator('.context-menu .menu-label', { hasText: 'Set in samples' }).click();
    await page.locator('.modal input').fill('480');
    await page.keyboard.press('Enter');
    const offset = () => page.evaluate(() => window.__madStudio.useStore.getState().project.mixer[2].latencyOffset);
    await expect.poll(offset).toBeCloseTo((480 * 1000) / rate, 6);
    await expect.poll(async () => (await latency())?.total).toBe(520);
    await expect(panel).toHaveClass(/manual/);
    await panel.hover();
    await page.mouse.wheel(0, -100);
    await expect.poll(offset).toBeCloseTo((480 * 1000) / rate + 10, 6);

    // Mixer menu › Plugin delay compensation › Automatic off: only the manual offset applies.
    await page.locator('button[data-hint="Mixer menu"]').click();
    await page.locator('.context-menu .menu-label', { hasText: 'Plugin delay compensation' }).hover();
    await page.locator('.context-menu .menu-label', { hasText: /^Automatic$/ }).click();
    await expect.poll(() => page.evaluate(() => window.__madStudio.useStore.getState().project.pdc)).toBe(false);
    await expect.poll(async () => {
      const l = await latency();
      return l && [l.automatic, l.total];
    }).toEqual([false, 0]);

    // The plugin wrapper shows the reported latency and takes an offset for misreporting plugins.
    await page.locator('.strip').nth(2).locator('.strip-num').click();
    await page.locator('.mixer-fx .fx-name', { hasText: 'MAD Test Delay' }).click();
    await expect(page.locator('.plugin-latency')).toContainText('1000 samples');
    await page.locator('.plugin-latency .drag-number').dblclick();
    await page.locator('.plugin-latency input').fill('200');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate((k) => window.__madStudio.usePlugins.getState().latency?.plugins[k], delayKey))
      .toEqual({ reported: 1000, offset: 200 });
    await expect(page.locator('.plugin-latency')).toContainText('compensated as');
    expect(errors).toEqual([]);
    step('plugin delay compensation ok');
  } finally {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
