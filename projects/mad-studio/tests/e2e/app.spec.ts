import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    __madStudio: any;
  }
}

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__madStudio?.useStore.getState().audioReady === true);
  return errors;
}

const state = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__madStudio.useStore.getState())));

test('boots with the demo song and no errors', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator('.brand')).toContainText('MAD');
  await expect(page.locator('.rack-row')).toHaveCount(10);
  const s = await state(page);
  expect(s.project.name).toContain('MAD Groove');
  expect(s.project.clips.length).toBeGreaterThan(5);
  await expect(page).toHaveTitle(/MAD Studio/);
  expect(errors).toEqual([]);
});

test('step sequencer: click toggles a step, undo restores it', async ({ page }) => {
  await boot(page);
  const clapRow = page.locator('.rack-row').nth(1);
  const step = clapRow.locator('.step').nth(2);
  await expect(step).not.toHaveClass(/on/);
  await step.click();
  await expect(step).toHaveClass(/on/);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(step).not.toHaveClass(/on/);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(step).toHaveClass(/on/);
});

test('piano roll: clicking the grid draws a note, right-click deletes it', async ({ page }) => {
  await boot(page);
  const info = await page.evaluate(() => {
    const m = window.__madStudio;
    const s = m.useStore.getState();
    const lead = s.project.channels.find((c: any) => c.name === 'Lead');
    const pat = s.project.patterns.find((p: any) => p.name === 'Lead');
    m.actions.selectPattern(pat.id);
    m.actions.selectChannel(lead.id);
    return { channelId: lead.id, patternId: pat.id, count: pat.notes[lead.id].length };
  });
  await page.keyboard.press('F7');
  const canvas = page.locator('[data-window="pianoRoll"] canvas');
  await expect(canvas).toBeVisible();
  const view = (await state(page)).ui.pianoRoll;
  const box = (await canvas.boundingBox())!;
  const x = 62 + (192 - view.scrollTick) * view.pxPerTick + 4; // step 9, KEYS_W = 62
  const y = 22 + (127 - 60) * view.rowHeight - view.scrollY + view.rowHeight / 2; // C5
  await page.mouse.click(box.x + x, box.y + y);
  const notesAfter = await page.evaluate(
    ({ channelId, patternId }) => window.__madStudio.useStore.getState().project.patterns.find((p: any) => p.id === patternId).notes[channelId],
    info,
  );
  expect(notesAfter.length).toBe(info.count + 1);
  expect(notesAfter.some((n: any) => n.key === 60 && n.start === 192)).toBe(true);
  await page.mouse.click(box.x + x, box.y + y, { button: 'right' });
  const notesFinal = await page.evaluate(
    ({ channelId, patternId }) => window.__madStudio.useStore.getState().project.patterns.find((p: any) => p.id === patternId).notes[channelId].length,
    info,
  );
  expect(notesFinal).toBe(info.count);
});

test('playlist: click places the current pattern, right-click removes it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__madStudio.actions.setUi((d: any) => void (d.windows.channelRack.open = false)));
  const before = (await state(page)).project.clips.length;
  const view = (await state(page)).ui.playlist;
  const canvas = page.locator('[data-window="playlist"] canvas');
  const box = (await canvas.boundingBox())!;
  const x = 150 + (384 - view.scrollTick) * view.pxPerTick + 6; // bar 2, TRACK_W = 150
  const y = 24 + 9 * view.trackHeight + view.trackHeight / 2 - view.scrollY; // track 10
  await page.mouse.click(box.x + x, box.y + y);
  expect((await state(page)).project.clips.length).toBe(before + 1);
  await page.mouse.click(box.x + x + 4, box.y + y, { button: 'right' });
  expect((await state(page)).project.clips.length).toBe(before);
});

test('mixer: add an insert effect from the UI', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('F9');
  await page.locator('.strip').nth(3).click({ position: { x: 30, y: 10 } });
  const index = (await state(page)).ui.selectedMixerTrack;
  const before = (await state(page)).project.mixer[index].effects.length;
  await page.locator('.fx-slot.empty:not([disabled])').first().click();
  await page.getByRole('menuitem', { name: 'Reverb' }).click();
  const after = (await state(page)).project.mixer[index].effects;
  expect(after.length).toBe(before + 1);
  expect(after[after.length - 1].type).toBe('reverb');
  await expect(page.locator('.window', { hasText: 'Reverb –' }).first()).toBeVisible();
});

test('transport: playback advances the playhead and stop resets it', async ({ page }) => {
  await boot(page);
  await page.locator('.transport-btn.play').click();
  await page.waitForTimeout(800);
  const tick = await page.evaluate(() => window.__madStudio.engine.playheadTick());
  expect(tick).toBeGreaterThan(20);
  expect((await state(page)).transport.playing).toBe(true);
  await page.keyboard.press('Space');
  expect((await state(page)).transport.playing).toBe(false);
});

test('typing keyboard records notes into the pattern while playing', async ({ page }) => {
  await boot(page);
  const target = await page.evaluate(() => {
    const m = window.__madStudio;
    const s = m.useStore.getState();
    const lead = s.project.channels.find((c: any) => c.name === 'Lead');
    m.actions.selectChannel(lead.id);
    const pat = s.project.patterns.find((p: any) => p.name === 'Kick');
    m.actions.selectPattern(pat.id);
    return { channelId: lead.id, patternId: pat.id };
  });
  await page.keyboard.press('ControlOrMeta+t');
  await page.locator('.transport-btn.record').click();
  await page.locator('.transport-btn.play').click();
  await page.waitForTimeout(300);
  for (const key of ['z', 'c', 'b']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(150);
    await page.keyboard.up(key);
  }
  await page.locator('.transport-btn.play').click();
  const notes = await page.evaluate(
    ({ channelId, patternId }) => window.__madStudio.useStore.getState().project.patterns.find((p: any) => p.id === patternId).notes[channelId] ?? [],
    target,
  );
  expect(notes.map((n: any) => n.key).sort()).toEqual([48, 52, 55]);
});

test('offline render of the demo song is clean and not clipping', async ({ page }) => {
  await boot(page);
  const stats = await page.evaluate(async () => {
    const m = window.__madStudio;
    const buf = await m.renderProject(m.useStore.getState().project, { mode: 'song', sampleRate: 22050, tail: 1 });
    return { ...m.signalStats(m.bufferChannels(buf)), duration: buf.duration };
  });
  expect(stats.nonFinite).toBe(0);
  expect(stats.peak).toBeLessThanOrEqual(1);
  expect(stats.rms).toBeGreaterThan(0.05);
  expect(stats.duration).toBeGreaterThan(30);
});

test('WAV export produces a valid file', async ({ page }) => {
  await boot(page);
  const header = await page.evaluate(async () => {
    const m = window.__madStudio;
    const s = m.useStore.getState();
    const { wav } = await m.engine.renderWav({ mode: 'pattern', patternId: s.ui.selectedPatternId, sampleRate: 22050, tail: 0.5, loops: 1, bitDepth: 16 });
    const view = new DataView(wav.buffer);
    return {
      riff: String.fromCharCode(...wav.slice(0, 4)),
      wave: String.fromCharCode(...wav.slice(8, 12)),
      channels: view.getUint16(22, true),
      rate: view.getUint32(24, true),
      size: wav.length,
    };
  });
  expect(header.riff).toBe('RIFF');
  expect(header.wave).toBe('WAVE');
  expect(header.channels).toBe(2);
  expect(header.rate).toBe(22050);
  expect(header.size).toBeGreaterThan(44 + 22050);
});

test('project bundle round-trips through save and open', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const m = window.__madStudio;
    m.actions.setBpm(133);
    const before = JSON.stringify(m.useStore.getState().project);
    const bundle = m.buildProjectBundle();
    m.actions.setBpm(90);
    await m.openProjectBytes({ name: 'test.madstudio', data: bundle });
    return { before, after: JSON.stringify(m.useStore.getState().project), dirty: m.useStore.getState().dirty };
  });
  expect(JSON.parse(result.after)).toEqual(JSON.parse(result.before));
  expect(result.dirty).toBe(false);
});

test('automation: right-click a knob creates an automation clip, right-click in the clip adds a point', async ({ page }) => {
  const errors = await boot(page);
  const volume = page.locator('.rack-row').first().locator('.knob').nth(1);
  await volume.click({ button: 'right' });
  await expect(page.locator('.menu-header', { hasText: 'Automation' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Create automation clip' }).click();
  let s = await state(page);
  const auto = s.project.channels.find((c: any) => c.kind === 'automation');
  expect(auto.name).toBe('Kick - Channel volume');
  expect(auto.automation.target).toBe(`ch:${s.project.channels[0].id}:volume`);
  expect(s.ui.rackFilter).toBe('automation');
  await expect(page.locator('.rack-row')).toHaveCount(1);
  const clip = s.project.clips.find((c: any) => c.kind === 'automation');
  expect(clip.length).toBeGreaterThan(0);
  await expect(page.locator('.picker-item.automation.selected')).toBeVisible();

  // Right-click inside the clip body (away from the tension handle) adds a point.
  await page.keyboard.press('F6');
  const box = await page.evaluate((clipId) => {
    const st = window.__madStudio.useStore.getState();
    const c = st.project.clips.find((x: any) => x.id === clipId);
    const ti = st.project.tracks.findIndex((t: any) => t.id === c.trackId);
    const r = document.querySelector('.with-picker canvas')!.getBoundingClientRect();
    const v = st.ui.playlist;
    return { x: r.left + 150 + (c.start - v.scrollTick) * v.pxPerTick + c.length * v.pxPerTick * 0.3, y: r.top + 24 + ti * v.trackHeight - v.scrollY + v.trackHeight - 6 };
  }, clip.id);
  await page.mouse.click(box.x, box.y, { button: 'right' });
  s = await state(page);
  const pts = s.project.channels.find((c: any) => c.kind === 'automation').automation.points;
  expect(pts).toHaveLength(3);
  expect(pts[1].value).toBeLessThan(0.3);
  expect(errors).toEqual([]);
});

test('automation clips drive the control during song playback', async ({ page }) => {
  await boot(page);
  const value = await page.evaluate(async () => {
    const m = window.__madStudio;
    const st = m.useStore.getState();
    const target = `mx:0:volume`;
    m.createAutomationClip(target);
    // Turn the flat line into a ramp down to zero over the first bar.
    const ch = m.useStore.getState().project.channels.find((c: any) => c.kind === 'automation');
    m.updateAutomation(ch.id, (a: any) => {
      a.points = [
        { tick: 0, value: 0.8, tension: 0, mode: 'single' },
        { tick: 384, value: 0, tension: 0, mode: 'single' },
      ];
    });
    m.useStore.setState({ transport: { ...st.transport, mode: 'song', songStart: 0 } });
    await m.engine.play();
    await new Promise((r) => setTimeout(r, 1300));
    const v = m.engine.automation.value(target);
    m.engine.stop();
    return v;
  });
  expect(value).toBeGreaterThanOrEqual(0);
  expect(value).toBeLessThan(0.8);
});

test('recording: an armed mixer track records its input into a playlist audio clip', async ({ page }) => {
  const errors = await boot(page);
  // Choose the input in the track inspector like in FL Studio: picking an input arms the track.
  await page.keyboard.press('F9');
  await page.locator('.strip').nth(11).click({ position: { x: 30, y: 10 } });
  await page.locator('.io-select').first().click();
  await page.getByRole('menuitem', { name: 'In 1 - In 2' }).click();
  let s = await state(page);
  expect(s.project.mixer[11].input).toBe('stereo:0');
  expect(s.project.mixer[11].armed).toBe(true);
  await expect(page.locator('.strip').nth(11).locator('.arm-dot')).toHaveClass(/on/);

  const take = await page.evaluate(async () => {
    const m = window.__madStudio;
    const st = m.useStore.getState();
    m.useStore.setState({ transport: { ...st.transport, mode: 'song', songStart: 0, recording: true } });
    await m.engine.play();
    await new Promise((r) => setTimeout(r, 1500));
    m.engine.stop();
    for (let i = 0; i < 40; i++) {
      const p = m.useStore.getState().project;
      if (Object.values(p.samples).some((x: any) => x.recorded)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const p = m.useStore.getState().project;
    const info: any = Object.values(p.samples).find((x: any) => x.recorded);
    const entry = info && m.samplePool.get(info.id);
    const clip = p.clips.find((c: any) => c.kind === 'audio' && p.channels.find((ch: any) => ch.id === c.channelId)?.sampler?.sampleId === info?.id);
    const ch = clip && p.channels.find((c: any) => c.id === clip.channelId);
    return { name: info?.name, seconds: entry?.buffer.duration ?? 0, clipStart: clip?.start, mixerTrack: ch?.mixerTrack };
  });
  expect(take.name).toMatch(/take 1$/);
  expect(take.seconds).toBeGreaterThan(0.8);
  expect(take.clipStart).toBe(0);
  expect(take.mixerTrack).toBe(11);
  s = await state(page);
  expect(s.transport.recording).toBe(true);
  expect(errors).toEqual([]);
});
