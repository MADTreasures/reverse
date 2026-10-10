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

// ---------------------------------------------------------------- FL Studio editing behaviour

async function openLeadInPianoRoll(page: Page) {
  const info = await page.evaluate(() => {
    const m = window.__madStudio;
    const s = m.useStore.getState();
    const lead = s.project.channels.find((c: any) => c.name === 'Lead');
    const pat = s.project.patterns.find((p: any) => p.name === 'Lead');
    m.actions.selectPattern(pat.id);
    m.actions.selectChannel(lead.id);
    m.actions.setUi((d: any) => {
      d.pianoRollChannelId = lead.id;
      d.windows.channelRack.open = false;
    });
    return { channelId: lead.id, patternId: pat.id };
  });
  await page.keyboard.press('F7');
  const canvas = page.locator('[data-window="pianoRoll"] canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const view = (await state(page)).ui.pianoRoll;
  const at = (tick: number, key: number) => ({
    x: box.x + 62 + (tick - view.scrollTick) * view.pxPerTick,
    y: box.y + 22 + (127 - key) * view.rowHeight - view.scrollY + view.rowHeight / 2,
  });
  const notes = () =>
    page.evaluate(
      ({ channelId, patternId }) => window.__madStudio.useStore.getState().project.patterns.find((p: any) => p.id === patternId).notes[channelId],
      info,
    );
  return { ...info, at, notes, box };
}

test('piano roll: Shift+drag clones, Ctrl+D deselects, double-click opens note properties, ruler sets the position', async ({ page }) => {
  await boot(page);
  const roll = await openLeadInPianoRoll(page);
  const key = 59; // B4 – the demo's lead pattern does not use it
  const p = roll.at(192 + 4, key);
  await page.mouse.click(p.x, p.y);
  expect((await roll.notes()).filter((n: any) => n.key === key).map((n: any) => n.start)).toEqual([192]);

  // Shift+drag leaves the original and drags a copy (FL Studio).
  const to = roll.at(288 + 4, key);
  await page.keyboard.down('Shift');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move((p.x + to.x) / 2, p.y, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect((await roll.notes()).filter((n: any) => n.key === key).map((n: any) => n.start).sort((a: number, b: number) => a - b)).toEqual([192, 288]);

  // Ctrl+D deselects instead of duplicating.
  const count = (await roll.notes()).length;
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+d');
  expect((await roll.notes()).length).toBe(count);

  // Double-click → note properties; the duration is typed in as BARS:STEPS:TICKS.
  await page.mouse.dblclick(to.x, to.y);
  const dialog = page.getByRole('dialog', { name: 'Note properties' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Duration').fill('0:08:00');
  await dialog.getByRole('button', { name: 'Accept' }).click();
  await expect(dialog).toBeHidden();
  expect((await roll.notes()).find((n: any) => n.key === key && n.start === 288).length).toBe(8 * 24);

  // Clicking the ruler moves the playback position inside the pattern.
  const r = roll.at(384, 60);
  await page.mouse.click(r.x + 2, roll.box.y + 10);
  const t = (await state(page)).transport;
  expect(t.mode).toBe('pattern');
  expect(t.patternStart).toBe(384);
});

test('piano roll: note properties – event lane, properties window, colour groups, slide notes, mute tool, note template', async ({ page }) => {
  await boot(page);
  const roll = await openLeadInPianoRoll(page);
  const key = 59;
  const p = roll.at(192 + 4, key);
  await page.mouse.click(p.x, p.y);
  const note = async () => (await roll.notes()).find((n: any) => n.key === key && n.start === 192);
  expect(await note()).toBeTruthy();

  // Event lane: show Pan, drag at the top of the lane (hard right), right-click resets it.
  const win = page.locator('[data-window="pianoRoll"]');
  await win.locator('select[data-hint^="Note property"]').selectOption('pan');
  expect((await state(page)).ui.pianoRoll.lane).toBe('pan');
  const laneTop = roll.box.y + roll.box.height - 74 + 9;
  await page.mouse.click(p.x - 2, laneTop);
  expect((await note()).pan).toBeGreaterThan(0.9);
  await page.mouse.click(p.x - 2, laneTop + 20, { button: 'right' });
  expect((await note()).pan).toBeUndefined();

  // Note properties: slide note in colour group 3.
  await page.mouse.dblclick(p.x, p.y);
  const dialog = page.getByRole('dialog', { name: 'Note properties' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Slide').check();
  await dialog.getByRole('button', { name: 'Colour group 3', exact: true }).click();
  await dialog.getByRole('button', { name: 'Accept' }).click();
  await expect(dialog).toBeHidden();
  expect(await note()).toMatchObject({ slide: true, color: 2 });

  // Mute tool (T): click mutes, a second click unmutes.
  await page.keyboard.press('t');
  expect((await state(page)).ui.pianoRoll.tool).toBe('mute');
  await page.mouse.click(p.x, p.y);
  expect((await note()).muted).toBe(true);
  await page.mouse.click(p.x, p.y);
  expect((await note()).muted).toBeUndefined();

  // Back to drawing: the clicked note's colour group becomes the template for new notes.
  await page.keyboard.press('p');
  await page.mouse.click(p.x, p.y);
  const q = roll.at(384 + 4, key);
  await page.mouse.click(q.x, q.y);
  const drawn = (await roll.notes()).find((n: any) => n.key === key && n.start === 384);
  expect(drawn).toMatchObject({ color: 2 });
  expect(drawn.slide).toBeUndefined();
});

test('piano roll tools: glue and quick chop, arpeggiate with live preview, stamps, scale snap, chord progression', async ({ page }) => {
  await boot(page);
  const roll = await openLeadInPianoRoll(page);
  const set = (notes: any[]) =>
    page.evaluate(({ patternId, channelId, notes }) => window.__madStudio.actions.setChannelNotes(patternId, channelId, notes, 'test'), {
      patternId: roll.patternId,
      channelId: roll.channelId,
      notes,
    });
  const keysAt = (list: any[]) => list.map((n: any) => [n.start, n.key, n.length]);

  // Glue (Ctrl+G) joins touching notes, quick chop (Ctrl+U) slices by the snap (Main = Line at this zoom).
  await set([
    { id: 'a', key: 60, start: 0, length: 24, velocity: 0.8 },
    { id: 'b', key: 60, start: 24, length: 24, velocity: 0.8 },
  ]);
  await page.mouse.click(roll.at(0, 60).x + 2, roll.box.y + 10); // a click in the ruler focuses the piano roll
  await page.keyboard.press('ControlOrMeta+g');
  expect(keysAt(await roll.notes())).toEqual([[0, 60, 48]]);
  await page.keyboard.press('ControlOrMeta+u');
  const chopped = await roll.notes();
  expect(chopped.length).toBeGreaterThan(1);
  expect(chopped.reduce((sum: number, n: any) => sum + n.length, 0)).toBe(48);

  // Arpeggiate (Alt+A): the dialog previews live, Cancel restores, Accept is one undo step.
  await set([60, 64, 67].map((key) => ({ id: `c${key}`, key, start: 0, length: 96, velocity: 0.8 })));
  await page.keyboard.press('Alt+a');
  const dialog = page.getByRole('dialog', { name: 'Arpeggiate' });
  await expect(dialog).toBeVisible();
  await expect.poll(async () => (await roll.notes()).length).toBe(4);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect(keysAt(await roll.notes())).toEqual([[0, 60, 96], [0, 64, 96], [0, 67, 96]]);
  await page.keyboard.press('Alt+a');
  await dialog.getByLabel('Pattern').selectOption('down');
  await expect.poll(async () => (await roll.notes()).map((n: any) => n.key)).toEqual([67, 64, 60, 67]);
  await dialog.getByRole('button', { name: 'Accept' }).click();
  await page.keyboard.press('ControlOrMeta+z');
  expect(keysAt(await roll.notes())).toEqual([[0, 60, 96], [0, 64, 96], [0, 67, 96]]);

  // Stamp: a minor chord with one click, then normal entry again.
  await set([]);
  const win = page.locator('[data-window="pianoRoll"]');
  await win.getByRole('button', { name: 'Stamp' }).click();
  await page.getByRole('menuitem', { name: 'Chords' }).hover();
  await page.getByRole('menuitem', { name: /^\S* ?Minor$/ }).click();
  const p = roll.at(96 + 4, 57);
  await page.mouse.click(p.x, p.y);
  expect((await roll.notes()).map((n: any) => n.key)).toEqual([57, 60, 64]);
  expect((await state(page)).ui.pianoRoll.stamp).toBeNull();

  // Scale highlighting: C major with snap to scale; drawing on C#5 lands on D5.
  await win.getByRole('button', { name: 'Scale' }).click();
  await page.getByRole('menuitem', { name: 'Major (Ionian)' }).click();
  expect((await state(page)).project.scale).toEqual({ root: 0, type: 'major' });
  await win.getByRole('button', { name: 'Scale' }).click();
  await page.getByRole('menuitem', { name: 'Snap to scale' }).click();
  const q = roll.at(288 + 4, 61);
  await page.mouse.click(q.x, q.y);
  expect((await roll.notes()).filter((n: any) => n.start === 288).map((n: any) => n.key)).toEqual([62]);

  // Chord progression (Alt+P) in the project key: four bars of triads from the last click.
  await set([]);
  await page.keyboard.press('Alt+p');
  const chords = page.getByRole('dialog', { name: 'Generate chord progression' });
  await expect(chords).toBeVisible();
  await chords.getByRole('button', { name: 'Accept' }).click();
  const generated = await roll.notes();
  expect(generated).toHaveLength(12);
  expect(generated.every((n: any) => [0, 2, 4, 5, 7, 9, 11].includes(n.key % 12))).toBe(true);
});

test('graph editor edits step properties; channel settings drive the arpeggiator', async ({ page }) => {
  await boot(page);
  const info = await page.evaluate(() => {
    const m = window.__madStudio;
    const s = m.useStore.getState();
    const hat = s.project.channels.find((c: any) => c.name === 'Hat Closed');
    const pat = s.project.patterns.find((p: any) => p.name === 'Hats');
    m.actions.selectPattern(pat.id);
    m.actions.selectChannel(hat.id);
    return { channelId: hat.id, patternId: pat.id };
  });
  const notes = () =>
    page.evaluate(({ channelId, patternId }) => window.__madStudio.useStore.getState().project.patterns.find((p: any) => p.id === patternId).notes[channelId], info);
  const rack = page.locator('[data-window="channelRack"]');
  await rack.getByRole('button', { name: 'Graph editor' }).click();
  const graph = rack.locator('.graph-canvas');
  await expect(graph).toBeVisible();
  await graph.scrollIntoViewIfNeeded();

  // Velocity lane: drag along the bottom of the first step lowers its velocity; right-drag resets.
  const box = (await graph.boundingBox())!;
  const first = (await notes()).find((n: any) => n.start === 0);
  await page.mouse.move(box.x + 8, box.y + box.height - 10);
  await page.mouse.down();
  await page.mouse.up();
  const lowered = (await notes()).find((n: any) => n.start === 0);
  expect(lowered.velocity).toBeLessThan(first.velocity);

  // Note pitch lane: the top of the lane is two octaves above the step key; a step keeps showing as a step.
  await rack.getByRole('tab', { name: 'Note pitch' }).click();
  await page.mouse.click(box.x + 8, box.y + 6);
  expect((await notes()).find((n: any) => n.start === 0).key).toBeGreaterThan(80);
  await expect(rack.locator('.rack-row.selected .step.on').first()).toBeVisible();
  await page.mouse.click(box.x + 8, box.y + 40, { button: 'right' });
  expect((await notes()).find((n: any) => n.start === 0).key).toBe(60);

  // Shift lane: a step delayed inside its cell is still step 1.
  await rack.getByRole('tab', { name: 'Shift' }).click();
  await page.mouse.click(box.x + 8, box.y + box.height / 2);
  const shifted = (await notes()).find((n: any) => n.start > 0 && n.start < 24);
  expect(shifted).toBeTruthy();

  // Channel settings: the arpeggiator turns the lead's chords into arpeggios in the timeline.
  const timeline = await page.evaluate(() => {
    const m = window.__madStudio;
    const s = m.useStore.getState();
    const chords = s.project.channels.find((c: any) => c.name === 'Chords');
    m.actions.updateChannelSettings(chords.id, (st: any) => {
      st.arp.direction = 'up';
      st.arp.time = 24;
    });
    m.actions.updateChannelSettings(chords.id, (st: any) => void (st.mono = true));
    const project = m.useStore.getState().project;
    const pat = project.patterns.find((p: any) => p.name === 'Chords');
    return { settings: project.channels.find((c: any) => c.id === chords.id).settings, notes: pat.notes[chords.id].length };
  });
  expect(timeline.settings).toMatchObject({ mono: true, arp: { direction: 'up', time: 24 } });
  // The channel window shows the settings.
  await page.evaluate(() => {
    const m = window.__madStudio;
    const chords = m.useStore.getState().project.channels.find((c: any) => c.name === 'Chords');
    m.runCommand && m.actions.selectChannel(chords.id);
  });
  await rack.locator('.rack-row', { hasText: 'Chords' }).locator('.channel-name').click();
  const win = page.locator('[data-window^="channel:"]').last();
  await win.getByRole('tab', { name: 'Misc' }).click();
  await expect(win.getByLabel('Arpeggiator direction')).toHaveValue('up');
  await win.getByLabel('Arpeggiator direction').selectOption('off');
  const after = await page.evaluate(() => {
    const s = window.__madStudio.useStore.getState();
    return s.project.channels.find((c: any) => c.name === 'Chords').settings;
  });
  expect(after).toMatchObject({ mono: true, arp: { direction: 'off' } });
});

test('playlist: clip menu and mute tool mute clips, track menu inserts a track, double-click opens the piano roll', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__madStudio.actions.setUi((d: any) => void (d.windows.channelRack.open = false)));
  const s = await state(page);
  const view = s.ui.playlist;
  const clip = s.project.clips.find((c: any) => c.kind === 'pattern' && c.start === 0 && c.length * view.pxPerTick > 60);
  const ti = s.project.tracks.findIndex((t: any) => t.id === clip.trackId);
  const canvas = page.locator('[data-window="playlist"] canvas');
  const box = (await canvas.boundingBox())!;
  const left = box.x + 150 + (clip.start - view.scrollTick) * view.pxPerTick;
  const top = box.y + 24 + ti * view.trackHeight - view.scrollY;
  const muted = async () => (await state(page)).project.clips.find((c: any) => c.id === clip.id).muted === true;

  // The icon at the left of the title opens FL Studio's clip menu.
  await page.mouse.click(left + 7, top + 8);
  await page.getByRole('menuitem', { name: 'Muted' }).click();
  expect(await muted()).toBe(true);

  // Mute tool (T): a click toggles the clip back.
  await page.keyboard.press('t');
  expect((await state(page)).ui.playlist.tool).toBe('mute');
  await page.mouse.click(left + 40, top + view.trackHeight / 2 + 4);
  expect(await muted()).toBe(false);
  await page.keyboard.press('p');

  // Track menu → Insert one.
  const tracks = s.project.tracks.length;
  await page.mouse.click(box.x + 40, top + view.trackHeight / 2, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Insert one' }).click();
  expect((await state(page)).project.tracks.length).toBe(tracks + 1);

  // Double-clicking a pattern clip opens the piano roll (the clip moved down one track).
  await page.mouse.dblclick(left + 40, top + view.trackHeight * 1.5 + 4);
  const after = await state(page);
  expect(after.ui.windows.pianoRoll.open).toBe(true);
  expect(after.ui.focusedWindow).toBe('pianoRoll');
  expect(after.ui.selectedPatternId).toBe(clip.patternId);
});

test('channel rack: the channel button opens and closes the channel window', async ({ page }) => {
  await boot(page);
  const id = (await state(page)).project.channels[0].id;
  const button = page.locator('.rack-row').first().locator('.channel-name');
  await button.click();
  expect((await state(page)).ui.windows[`channel:${id}`]?.open).toBe(true);
  await button.click();
  expect((await state(page)).ui.windows[`channel:${id}`]?.open ?? false).toBe(false);
});

test('score logger: notes played while stopped can be dumped into the pattern; start on input starts playback', async ({ page }) => {
  await boot(page);
  const target = await page.evaluate(() => {
    const m = window.__madStudio;
    const s = m.useStore.getState();
    const lead = s.project.channels.find((c: any) => c.name === 'Lead');
    m.actions.selectChannel(lead.id);
    m.actions.addPattern();
    return { channelId: lead.id, patternId: m.useStore.getState().ui.selectedPatternId };
  });
  await page.keyboard.press('ControlOrMeta+t');
  for (const key of ['z', 'c', 'b']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(120);
    await page.keyboard.up(key);
    await page.waitForTimeout(60);
  }
  await page.locator('.menubar .menu-btn', { hasText: /^Tools$/i }).click();
  await page.getByRole('menuitem', { name: 'Dump score log to selected pattern' }).hover();
  await page.getByRole('menuitem', { name: 'Last minute' }).click();
  const notes = await page.evaluate(
    ({ channelId, patternId }) => window.__madStudio.useStore.getState().project.patterns.find((p: any) => p.id === patternId).notes[channelId] ?? [],
    target,
  );
  expect(notes.map((n: any) => n.key)).toEqual([48, 52, 55]);
  expect(notes[0].start).toBe(0);
  expect(notes[1].start).toBeGreaterThan(notes[0].start);
  expect((await state(page)).transport.playing).toBe(false);

  // Start on input: with recording armed, the first note starts playback.
  await page.keyboard.press('ControlOrMeta+i');
  await page.locator('.transport-btn.record').click(); // R is a note while the typing keyboard is on
  expect((await state(page)).transport.startOnInput).toBe(true);
  expect((await state(page)).transport.recording).toBe(true);
  await page.keyboard.down('x');
  await expect.poll(async () => (await state(page)).transport.playing).toBe(true);
  await page.keyboard.up('x');
  await page.keyboard.press('Space');
});

test('playlist: right-drag in the ruler selects a time range that song playback loops in, Ctrl+D clears it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__madStudio.actions.setUi((d: any) => void (d.windows.channelRack.open = false)));
  const view = (await state(page)).ui.playlist;
  const box = (await page.locator('[data-window="playlist"] canvas').boundingBox())!;
  const xAt = (tick: number) => box.x + 150 + (tick - view.scrollTick) * view.pxPerTick;
  await page.mouse.move(xAt(384) + 2, box.y + 10);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(xAt(576), box.y + 10, { steps: 5 });
  await page.mouse.move(xAt(768) + 2, box.y + 10, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  const t = (await state(page)).transport;
  expect(t.loop).toEqual({ start: 384, end: 768 });
  expect(t.mode).toBe('song');
  expect(t.songStart).toBe(384);

  await page.evaluate(() => window.__madStudio.actions.setBpm(240));
  await page.locator('.transport-btn.play').click();
  await page.waitForTimeout(1600); // more than one pass through the 1-bar loop at 240 BPM
  const ticks: number[] = [];
  for (let i = 0; i < 5; i++) {
    ticks.push(await page.evaluate(() => window.__madStudio.engine.playheadTick()));
    await page.waitForTimeout(150);
  }
  await page.keyboard.press('Space');
  for (const tick of ticks) {
    expect(tick).toBeGreaterThanOrEqual(384);
    expect(tick).toBeLessThan(768);
  }

  await page.mouse.click(xAt(2000), box.y + 200, { button: 'middle' }); // focus the playlist without editing
  await page.keyboard.press('ControlOrMeta+d');
  expect((await state(page)).transport.loop).toBeNull();
});

test('slice tool (C) cuts a playlist clip and a piano roll note', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__madStudio.actions.setUi((d: any) => void (d.windows.channelRack.open = false)));
  const s = await state(page);
  const view = s.ui.playlist;
  const clip = s.project.clips.find((c: any) => c.kind === 'pattern' && c.start === 0 && c.length >= 768);
  const ti = s.project.tracks.findIndex((t: any) => t.id === clip.trackId);
  const box = (await page.locator('[data-window="playlist"] canvas').boundingBox())!;
  const y = box.y + 24 + ti * view.trackHeight - view.scrollY + view.trackHeight / 2;
  await page.mouse.click(box.x + 150 + 2000 * view.pxPerTick, box.y + 200, { button: 'middle' }); // focus
  await page.keyboard.press('c');
  expect((await state(page)).ui.playlist.tool).toBe('slice');
  await page.mouse.click(box.x + 150 + (384 - view.scrollTick) * view.pxPerTick + 1, y);
  const parts = (await state(page)).project.clips.filter((c: any) => c.trackId === clip.trackId && c.kind === 'pattern' && c.start < clip.start + clip.length && c.start + c.length > clip.start);
  expect(parts.map((c: any) => [c.start, c.offset])).toEqual(expect.arrayContaining([[0, 0], [384, 384]]));
  await page.keyboard.press('p');

  const roll = await openLeadInPianoRoll(page);
  const key = 59;
  const p = roll.at(0 + 4, key);
  await page.mouse.click(p.x, p.y); // a note of the default length at the start
  await page.evaluate(
    ({ channelId, patternId }) => {
      window.__madStudio.actions.updateNotes(patternId, channelId, (list: any[]) => {
        for (const n of list) if (n.key === 59) n.length = 96;
      });
    },
    { channelId: roll.channelId, patternId: roll.patternId },
  );
  await page.keyboard.press('c');
  const cut = roll.at(48, key);
  await page.mouse.click(cut.x + 1, cut.y);
  const notes = (await roll.notes()).filter((n: any) => n.key === key).map((n: any) => [n.start, n.length]);
  expect(notes).toEqual([
    [0, 48],
    [48, 48],
  ]);
});

test('undo names the step like FL Studio: Ctrl+Z undoes, Ctrl+Alt+Z redoes', async ({ page }) => {
  await boot(page);
  const roll = await openLeadInPianoRoll(page);
  const count = (await roll.notes()).length;
  const p = roll.at(96 + 4, 59);
  await page.mouse.click(p.x, p.y);
  expect((await roll.notes()).length).toBe(count + 1);

  await page.locator('.menubar .menu-btn', { hasText: /^Edit$/i }).click();
  await expect(page.getByRole('menuitem', { name: 'Undo piano roll add note' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('ControlOrMeta+z');
  expect((await roll.notes()).length).toBe(count);
  await expect(page.locator('.hint-bar')).toContainText('Undone: piano roll add note · Level 2/');
  await page.keyboard.press('ControlOrMeta+Alt+z');
  expect((await roll.notes()).length).toBe(count + 1);
  await expect(page.locator('.hint-bar')).toContainText('Redone: piano roll add note · Level 1/');
});

test('mute switches: right-click solos a mixer track, opens the channel menu in the rack', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('F9');
  const led = page.locator('.strip').nth(2).locator('.mute-led');
  await led.click({ button: 'right' });
  expect((await state(page)).project.mixer[2].solo).toBe(true);
  await led.click({ button: 'right' });
  expect((await state(page)).project.mixer[2].solo).toBe(false);

  await page.keyboard.press('F6');
  await page.locator('.rack-row').nth(1).locator('.mute-led').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Solo' }).click();
  const channels = (await state(page)).project.channels;
  expect(channels[1].muted).toBe(false);
  expect(channels.filter((c: any) => !c.muted).length).toBe(1);
});

test('channel menu: copy a channel\'s steps and paste them into another channel', async ({ page }) => {
  await boot(page);
  const before = await state(page);
  const pattern = before.project.patterns.find((p: any) => p.id === before.ui.selectedPatternId);
  const [src, dst] = before.project.channels;
  const srcNotes = pattern.notes[src.id] ?? [];
  expect(srcNotes.length).toBeGreaterThan(0);
  await page.locator('.rack-row').nth(0).locator('.channel-name').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await page.locator('.rack-row').nth(1).locator('.channel-name').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  const after = await state(page);
  const pasted = after.project.patterns.find((p: any) => p.id === before.ui.selectedPatternId).notes[dst.id];
  const strip = (list: any[]) => list.map((n: any) => [n.key, n.start, n.length]);
  expect(strip(pasted)).toEqual(strip(srcNotes));
  expect(after.pastLabels[after.pastLabels.length - 1]).toBe('channel rack paste');
});

test('about box shows the VST Compatible logo with its trademark notice (Steinberg usage guidelines)', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__madStudio.runCommand('about'));
  const logo = page.locator('.modal .brand-logo.vst');
  await expect(logo).toBeVisible();
  await expect(logo.locator('figcaption')).toHaveText('VST is a registered trademark of Steinberg Media Technologies GmbH.');
  // The SVG loads under the app's Content-Security-Policy and keeps Steinberg's minimum size (15 × 10 mm ≈ 57 × 38 px).
  const img = await logo.locator('img').evaluate((el: HTMLImageElement) => ({ loaded: el.complete && el.naturalWidth > 0, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
  expect(img.loaded).toBe(true);
  expect(img.w).toBeGreaterThanOrEqual(57);
  expect(img.h).toBeGreaterThanOrEqual(38);
  // ASIO belongs to the Windows desktop app only.
  await expect(page.locator('.modal .brand-logo.asio')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('mixer routing: route switches, send knobs, route only, sidechain links, loop check; the sidechain compressor ducks', async ({ page }) => {
  const errors = await boot(page);
  await page.keyboard.press('F9');
  const strips = page.locator('.strip');
  const bus = 12; // an empty insert as the bus
  const routes = async (i: number) => (await state(page)).project.mixer[i].routes;

  // Select Kick (insert 1); the bus's switch sends it there, the master send stays.
  await strips.nth(1).locator('.strip-num').click();
  await strips.nth(bus).locator('.route-switch').click();
  expect(await routes(1)).toEqual([{ to: 0, level: 0.8 }, { to: bus, level: 0.8 }]);
  await expect(strips.nth(bus)).toHaveClass(/routed/);
  const knob = strips.nth(bus).locator('.route-send [role="slider"]');
  await expect(knob).toBeVisible();
  // Right-click on the send knob: route to this track only (the master send goes away).
  await knob.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Route to this track only' }).click();
  expect(await routes(1)).toEqual([{ to: bus, level: 0.8 }]);
  await expect(page.locator('.mixer-fx .io-select.output')).toContainText(`Insert ${bus}`);

  // From the bus back to Kick would close a loop: refused with a message.
  await strips.nth(bus).locator('.strip-num').click();
  await strips.nth(1).locator('.route-switch').click();
  await expect(page.locator('.toast')).toContainText('feed the track back into itself');
  expect(await routes(bus)).toBeUndefined();

  // Hats (insert 3): sidechain link to the bus (level 0, master send kept).
  await strips.nth(3).locator('.strip-num').click();
  await strips.nth(bus).locator('.route-switch').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Sidechain to this track' }).click();
  expect(await routes(3)).toEqual([{ to: 0, level: 0.8 }, { to: bus, level: 0, sidechain: true }]);
  await strips.nth(bus).locator('.strip-num').click();
  await expect(page.locator('.mixer-fx .routed-list')).toContainText('Sidechain: Hat');

  // Alt+click on the bus's mute switch solos it with every track routed to or from it.
  await strips.nth(bus).locator('.mute-led').click({ modifiers: ['Alt'] });
  const solo = (await state(page)).project.mixer.map((t: any) => t.solo);
  expect(solo.flatMap((on: boolean, i: number) => (on ? [i] : []))).toEqual([1, 3, bus]);
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await routes(3)).toBeUndefined();

  // The browser engine: a kick linked to the chords insert keys its compressor (AudioWorklet).
  const ratio = await page.evaluate(async () => {
    const m = window.__madStudio;
    const base = structuredClone(m.useStore.getState().project);
    const kick = base.channels.find((c: any) => c.name === 'Kick');
    const chords = base.channels.find((c: any) => c.name === 'Chords');
    base.channels = [kick, chords];
    // A steady pad: fast attack, no LFO or filter envelope, so only the compressor changes its level.
    chords.synth.ampEnv = { attack: 0.005, decay: 0.1, sustain: 1, release: 0.1 };
    chords.synth.filter.envAmount = 0;
    chords.synth.lfo = { ...chords.synth.lfo, depth: 0 };
    const pattern = { ...structuredClone(base.patterns[0]), id: 'pat_sc', notes: {} as Record<string, unknown[]> };
    pattern.notes[kick.id] = [0, 1, 2, 3].map((b) => ({ id: `k${b}`, key: 60, start: b * 96, length: 24, velocity: 1 }));
    pattern.notes[chords.id] = [{ id: 'c0', key: 60, start: 0, length: 384, velocity: 1 }];
    base.patterns = [pattern];
    base.mixer[kick.mixerTrack].routes = [{ to: chords.mixerTrack, level: 0, sidechain: true }];
    base.mixer[chords.mixerTrack].effects = [
      { id: 'fx_sc', type: 'compressor', enabled: true, params: { threshold: -40, ratio: 20, attack: 0.001, release: 0.08, knee: 0, makeup: 0, sidechain: 1 } },
    ];
    base.mixer[0].effects = [];
    const level = async (project: any) => {
      const buffer = await m.renderProject(project, { mode: 'pattern', patternId: 'pat_sc', sampleRate: 48000, tail: 0 });
      const [l] = m.bufferChannels(buffer);
      const rms = (a: number, b: number) => {
        let s = 0;
        for (let i = a; i < b; i++) s += l[i] * l[i];
        return Math.sqrt(s / (b - a));
      };
      // A kick on every beat; 10-60 ms after a hit against the end of the beat (render starts at 5 ms).
      const beatFrames = (60 / project.bpm) * 48000;
      let hit = 0;
      let rest = 0;
      for (let beat = 1; beat < 4; beat++) {
        const t = Math.round(beat * beatFrames + 240);
        hit += rms(t + 480, t + 2880);
        rest += rms(t + Math.round(beatFrames * 0.7), t + Math.round(beatFrames * 0.95));
      }
      return hit / rest;
    };
    const keyed = await level(base);
    const off = structuredClone(base);
    off.mixer[chords.mixerTrack].effects[0].params.sidechain = 0;
    return { keyed, off: await level(off) };
  });
  expect(ratio.keyed).toBeLessThan(0.5);
  expect(ratio.off).toBeGreaterThan(0.8);
  expect(errors).toEqual([]);
});
