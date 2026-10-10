import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    __madPaint: any;
  }
}

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__madPaint !== undefined);
  // Start every test from a small, predictable canvas.
  await page.evaluate(() => {
    const m = window.__madPaint;
    m.actions.newDocument('Test', 400, 300, 72, '#ffffff');
  });
  await page.waitForTimeout(100);
  return errors;
}

const state = (page: Page) =>
  page.evaluate(() => {
    const s = window.__madPaint.useStore.getState();
    return { tool: s.tool, activeSub: s.activeSub, view: s.view, canUndo: s.canUndo, canRedo: s.canRedo, layers: s.doc.layers, colors: s.colors, selection: s.selection !== null, workspace: s.workspace, activeLayerId: s.activeLayerId, hint: s.hint };
  });

/** Alpha of a pixel on the active layer. */
const layerAlpha = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => {
    const m = window.__madPaint;
    const s = m.useStore.getState();
    return m.engine.sampleLayer(s.activeLayerId, px, py)?.[3] ?? -1;
  }, [x, y]);

/** Screen position of a document point. */
async function docToScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = (await page.locator('[data-testid=paint-canvas]').boundingBox())!;
  const p = await page.evaluate(
    ([dx, dy]) => {
      const m = window.__madPaint;
      const { a, b, c, d, e, f } = m.controller.view.matrix.reduce((acc: any, v: number, i: number) => ({ ...acc, ['abcdef'[i]]: v }), {});
      return { x: a * dx + c * dy + e, y: b * dx + d * dy + f };
    },
    [x, y],
  );
  return { x: box.x + p.x, y: box.y + p.y };
}

/** Selects a tool directly (pressing its key would cycle when it is already active). */
const selectTool = (page: Page, tool: string) => page.evaluate((t) => window.__madPaint.actions.setTool(t), tool);

async function drag(page: Page, from: [number, number], to: [number, number], steps = 12) {
  const a = await docToScreen(page, ...from);
  const b = await docToScreen(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  await page.mouse.up();
}

test('boots into the default workspace without errors', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator('[data-testid=tool-palette]')).toBeVisible();
  await expect(page.locator('[data-testid=layer-row]')).toHaveCount(1);
  await expect(page.locator('[data-testid=paper-row]')).toBeVisible();
  await expect(page.locator('[data-testid=tool-sliders]')).toBeVisible();
  await expect(page).toHaveTitle(/Test \(400 x 300px 72dpi .*%\) - MAD Studio Paint/);
  expect(errors).toEqual([]);
});

test('pen stroke draws on the layer; ⌘Z / ⇧⌘Z undo and redo it', async ({ page }) => {
  await boot(page);
  await selectTool(page, 'pen');
  await drag(page, [50, 150], [350, 150]);
  expect(await layerAlpha(page, 200, 150)).toBeGreaterThan(200);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await layerAlpha(page, 200, 150)).toBe(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect(await layerAlpha(page, 200, 150)).toBeGreaterThan(200);
});

test('tool keys cycle through tools that share a key', async ({ page }) => {
  await boot(page);
  await selectTool(page, 'eraser');
  await page.keyboard.press('p');
  expect((await state(page)).tool).toBe('pen');
  await page.keyboard.press('p');
  expect((await state(page)).tool).toBe('pencil');
  await page.keyboard.press('p');
  expect((await state(page)).tool).toBe('pen');
  await page.keyboard.press('e');
  expect((await state(page)).tool).toBe('eraser');
  await page.keyboard.press('g');
  expect(['fill', 'gradient']).toContain((await state(page)).tool);
});

test('holding a tool key while drawing switches back on release', async ({ page }) => {
  await boot(page);
  await selectTool(page, 'pen');
  await page.keyboard.down('e');
  expect((await state(page)).tool).toBe('eraser');
  await drag(page, [10, 10], [40, 40], 4);
  await page.keyboard.up('e');
  expect((await state(page)).tool).toBe('pen');
});

test('Space + drag pans the view, Shift + Space + drag rotates it', async ({ page }) => {
  await boot(page);
  const before = (await state(page)).view;
  await page.keyboard.down('Space');
  await drag(page, [200, 150], [260, 150], 6);
  await page.keyboard.up('Space');
  const panned = (await state(page)).view;
  expect(panned.panX).not.toBeCloseTo(before.panX);
  expect(await layerAlpha(page, 230, 150)).toBe(0);
  await page.keyboard.down('Shift');
  await page.keyboard.down('Space');
  await drag(page, [300, 50], [300, 250], 10);
  await page.keyboard.up('Space');
  await page.keyboard.up('Shift');
  expect(Math.abs((await state(page)).view.rotation)).toBeGreaterThan(1);
});

test('⌥-click with a brush picks the colour (eyedropper)', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const m = window.__madPaint;
    m.actions.setDrawingColor('#ff0000');
  });
  await selectTool(page, 'pen');
  await page.evaluate(() => {
    const m = window.__madPaint;
    const s = m.useStore.getState();
    const sub = s.subTools.find((t: any) => t.id === s.activeSub.pen);
    m.actions.updateSubTool(sub.id, { brush: { ...sub.brush, size: 30, sizePressure: false } });
  });
  await drag(page, [100, 100], [300, 100]);
  await page.evaluate(() => window.__madPaint.actions.setDrawingColor('#00ff00'));
  const p = await docToScreen(page, 200, 100);
  await page.keyboard.down('Alt');
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Alt');
  // Allow 8-bit rounding of the premultiplied canvas.
  const picked = parseInt((await state(page)).colors.main.slice(1), 16);
  expect(Math.abs(((picked >> 16) & 255) - 255)).toBeLessThanOrEqual(2);
  expect((picked >> 8) & 255).toBeLessThanOrEqual(2);
  expect(picked & 255).toBeLessThanOrEqual(2);
});

test('X swaps main and sub colour, C toggles the transparent colour', async ({ page }) => {
  await boot(page);
  const before = (await state(page)).colors;
  await page.keyboard.press('x');
  const after = (await state(page)).colors;
  expect(after.main).toBe(before.sub);
  expect(after.sub).toBe(before.main);
  await page.keyboard.press('c');
  expect((await state(page)).colors.transparent).toBe(true);
});

test('[ and ] step the brush size through the preset sizes', async ({ page }) => {
  await boot(page);
  await selectTool(page, 'pen');
  const size = () => page.evaluate(() => {
    const s = window.__madPaint.useStore.getState();
    return s.subTools.find((t: any) => t.id === s.activeSub[s.tool]).brush.size;
  });
  const start = await size();
  await page.keyboard.press(']');
  expect(await size()).toBeGreaterThan(start);
  await page.keyboard.press('[');
  await page.keyboard.press('[');
  expect(await size()).toBeLessThan(start);
});

test('selection: drag selects, Shift adds, painting stays inside, ⌘D deselects', async ({ page }) => {
  await boot(page);
  await selectTool(page, 'pen');
  await page.keyboard.press('m');
  expect((await state(page)).tool).toBe('select');
  await drag(page, [20, 20], [120, 120]);
  expect((await state(page)).selection).toBe(true);
  await expect(page.locator('[data-testid=selection-launcher]')).toBeVisible();
  await selectTool(page, 'pen');
  await drag(page, [10, 70], [390, 70]);
  expect(await layerAlpha(page, 70, 70)).toBeGreaterThan(0);
  expect(await layerAlpha(page, 300, 70)).toBe(0);
  await page.keyboard.press('ControlOrMeta+d');
  expect((await state(page)).selection).toBe(false);
});

test('fill tool fills a closed area on the current layer', async ({ page }) => {
  await boot(page);
  await selectTool(page, 'pen');
  await page.evaluate(() => {
    const m = window.__madPaint;
    const s = m.useStore.getState();
    const sub = s.subTools.find((t: any) => t.id === s.activeSub.pen);
    m.actions.updateSubTool(sub.id, { brush: { ...sub.brush, size: 6, sizePressure: false } });
  });
  // A closed rectangle drawn as four straight lines (Shift = straight line).
  await page.keyboard.down('Shift');
  await drag(page, [50, 50], [250, 50], 4);
  await drag(page, [250, 50], [250, 250], 4);
  await drag(page, [250, 250], [50, 250], 4);
  await drag(page, [50, 250], [50, 50], 4);
  await page.keyboard.up('Shift');
  await page.evaluate(() => window.__madPaint.actions.setSubTool('fill', 'fill-layer'));
  const inside = await docToScreen(page, 150, 150);
  await page.mouse.click(inside.x, inside.y);
  expect(await layerAlpha(page, 150, 150)).toBe(255);
  expect(await layerAlpha(page, 320, 150)).toBe(0);
});

test('layers: new layer, rename, clip, merge down, undo', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('ControlOrMeta+Shift+n');
  await expect(page.locator('[data-testid=layer-row]')).toHaveCount(2);
  const row = page.locator('[data-testid=layer-row]').first();
  await row.locator('.layer-name').dblclick();
  // Type at once, like a user: the keys must reach the name field, not the tool shortcuts (I, K).
  await page.keyboard.type('Ink');
  await page.keyboard.press('Enter');
  await expect(row.locator('.layer-name')).toHaveText('Ink');
  await page.getByRole('button', { name: 'Clip to layer below' }).click();
  expect((await state(page)).layers[0].clip).toBe(true);
  await page.keyboard.press('ControlOrMeta+e');
  await expect(page.locator('[data-testid=layer-row]')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('[data-testid=layer-row]')).toHaveCount(2);
});

test('blend mode and opacity apply to the composite', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const m = window.__madPaint;
    m.actions.setDrawingColor('#000000');
    m.actions.fillWithColor();
    const id = m.useStore.getState().activeLayerId;
    m.actions.setLayerProps(id, { opacity: 0.5 }, 'Layer opacity');
  });
  const px = await page.evaluate(() => window.__madPaint.engine.sampleDisplayed(10, 10, '#ffffff'));
  expect(px[0]).toBeGreaterThan(110);
  expect(px[0]).toBeLessThan(145);
});

test('free transform: ⌘T, drag to move, Enter confirms', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__madPaint.actions.setDrawingColor('#000000'));
  await selectTool(page, 'select');
  await drag(page, [20, 20], [80, 80]);
  await page.keyboard.press('Alt+Backspace');
  await page.keyboard.press('ControlOrMeta+d');
  expect(await layerAlpha(page, 50, 50)).toBe(255);
  await page.keyboard.press('ControlOrMeta+t');
  expect((await state(page)).hint).toContain('Enter');
  // (The + in the middle is the reference point: grab the image beside it.)
  await drag(page, [40, 60], [240, 160]);
  await page.keyboard.press('Enter');
  expect(await layerAlpha(page, 50, 50)).toBe(0);
  expect(await layerAlpha(page, 250, 150)).toBe(255);
});

test('saves and reopens a .madpaint document with layers intact', async ({ page }) => {
  await boot(page);
  await selectTool(page, 'pen');
  await drag(page, [50, 150], [350, 150]);
  await page.keyboard.press('ControlOrMeta+Shift+n');
  const result = await page.evaluate(async () => {
    const m = window.__madPaint;
    const bytes = await m.buildDocumentBytes();
    m.actions.newDocument('Other', 100, 100, 72, '#ffffff');
    await m.openFileBytes({ name: 'roundtrip.madpaint', data: bytes });
    const s = m.useStore.getState();
    const layers = s.doc.layers.length;
    const bottom = s.doc.layers[s.doc.layers.length - 1].id;
    return { layers, w: s.doc.width, alpha: m.engine.sampleLayer(bottom, 200, 150)?.[3] };
  });
  expect(result).toEqual({ layers: 2, w: 400, alpha: expect.any(Number) });
  expect(result.alpha).toBeGreaterThan(200);
});

test('workspace switch shows the classic layout with brush size palette', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name: /Classic/ }).click();
  await expect(page.locator('[data-testid=brushsize-panel]')).toBeVisible();
  await expect(page.locator('[data-testid=tool-sliders]')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-testid=tool-palette]')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-testid=tool-palette]')).toBeVisible();
});

// ---------------------------------------------------------------- behaviour taken from the reference manual

test('⇧-click connects a straight line to the end of the previous stroke', async ({ page }) => {
  await boot(page);
  await selectTool(page, 'pen');
  await drag(page, [40, 40], [60, 40], 4);
  const p = await docToScreen(page, 300, 240);
  await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  await page.keyboard.up('Shift');
  // Midpoint of the connecting line (60,40) → (300,240).
  expect(await layerAlpha(page, 180, 140)).toBeGreaterThan(100);
});

test('polyline selection: clicks add corners, clicking the first corner closes it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__madPaint.actions.setSubTool('select', 'sel-polyline'));
  for (const [x, y] of [
    [50, 50],
    [250, 50],
    [250, 200],
  ] as [number, number][]) {
    const p = await docToScreen(page, x, y);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(400);
  }
  expect((await state(page)).selection).toBe(false);
  const first = await docToScreen(page, 50, 50);
  await page.mouse.click(first.x, first.y);
  expect((await state(page)).selection).toBe(true);
});

test('selection pen paints a selection', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__madPaint.actions.setSubTool('select', 'sel-pen'));
  await drag(page, [50, 150], [350, 150]);
  const inside = await page.evaluate(() => {
    const s = window.__madPaint.useStore.getState();
    return s.selection ? s.selection.data[150 * s.selection.width + 200] : -1;
  });
  expect(inside).toBe(255);
});

test('per-pixel blending modes: Subtract with white turns red black', async ({ page }) => {
  await boot(page);
  const px = await page.evaluate(() => {
    const m = window.__madPaint;
    m.actions.setDrawingColor('#ff0000');
    m.actions.fillWithColor();
    m.actions.addRasterLayer();
    m.actions.setDrawingColor('#ffffff');
    m.actions.fillWithColor();
    const id = m.useStore.getState().activeLayerId;
    m.actions.setLayerProps(id, { blend: 'subtract' }, 'Blending mode');
    return m.engine.sampleDisplayed(20, 20, '#ffffff');
  });
  expect(px.slice(0, 3)).toEqual([0, 0, 0]);
});

test('merging is refused for hidden layers, as in the reference', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const m = window.__madPaint;
    const bottom = m.useStore.getState().activeLayerId;
    m.actions.addRasterLayer();
    m.actions.setLayerProps(bottom, { visible: false }, 'Hide layer');
    m.actions.mergeDown();
    const s = m.useStore.getState();
    return { layers: s.doc.layers.length, hint: s.hint };
  });
  expect(result.layers).toBe(2);
  expect(result.hint).toMatch(/Hidden/);
});

test('rotation: "-" rotates 5°, double-click with the rotate tool resets', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('-');
  expect((await state(page)).view.rotation).toBe(-5);
  await page.keyboard.press('r');
  const p = await docToScreen(page, 200, 150);
  await page.mouse.dblclick(p.x, p.y);
  expect((await state(page)).view.rotation).toBe(0);
});

test('zoom steps follow the scale list (100 % → 150 % → 200 %)', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('ControlOrMeta+Alt+0');
  expect((await state(page)).view.zoom).toBe(1);
  await page.keyboard.press('ControlOrMeta+=');
  expect((await state(page)).view.zoom).toBe(1.5);
  await page.keyboard.press('ControlOrMeta+=');
  expect((await state(page)).view.zoom).toBe(2);
  await page.keyboard.press('ControlOrMeta+-');
  expect((await state(page)).view.zoom).toBe(1.5);
});

test(', and . step through the tools of the current group', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__madPaint.actions.setSubTool('pen', 'pen-g'));
  await page.keyboard.press('.');
  expect((await state(page)).activeSub.pen).toBe('pen-real-g');
  await page.keyboard.press(',');
  expect((await state(page)).activeSub.pen).toBe('pen-g');
});

test('⌘[ and ⌘] change the opacity of the current tool', async ({ page }) => {
  await boot(page);
  await selectTool(page, 'pen');
  const opacity = () => page.evaluate(() => {
    const s = window.__madPaint.useStore.getState();
    return s.subTools.find((t: any) => t.id === s.activeSub.pen).brush.opacity;
  });
  await page.keyboard.press('ControlOrMeta+[');
  expect(await opacity()).toBeCloseTo(0.9);
  await page.keyboard.press('ControlOrMeta+]');
  expect(await opacity()).toBeCloseTo(1);
});

test('layer palette: ⌥-click on the eye shows only that layer, again shows all', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('ControlOrMeta+Shift+n');
  await page.keyboard.press('ControlOrMeta+Shift+n');
  const eye = page.locator('[data-testid=layer-row]').nth(1).locator('.eye');
  await eye.click({ modifiers: ['Alt'] });
  let layers = (await state(page)).layers;
  expect(layers.map((l: any) => l.visible)).toEqual([false, true, false]);
  await eye.click({ modifiers: ['Alt'] });
  layers = (await state(page)).layers;
  expect(layers.map((l: any) => l.visible)).toEqual([true, true, true]);
});

test('folders: new layers go into a selected folder; ⇧⌘G ungroups', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const m = window.__madPaint;
    const folder = m.actions.addFolder();
    m.actions.addRasterLayer();
    const s = m.useStore.getState();
    const f = s.doc.layers.find((l: any) => l.id === folder);
    return { children: f.children.length, blend: f.blend };
  });
  expect(r).toEqual({ children: 1, blend: 'normal' });
  await page.evaluate(() => {
    const m = window.__madPaint;
    const s = m.useStore.getState();
    m.actions.selectLayer(s.doc.layers.find((l: any) => l.kind === 'folder').id);
  });
  await page.keyboard.press('ControlOrMeta+Shift+g');
  const kinds = (await state(page)).layers.map((l: any) => l.kind);
  expect(kinds).toEqual(['raster', 'raster']);
});

test('preferences (⌘K) switch to the light interface', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('button', { name: 'Light mode' }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  await page.getByRole('button', { name: 'Dark mode' }).click();
  await page.getByRole('button', { name: 'OK' }).click();
});

/** Displayed red channel at a document point (layers over white paper). */
const shown = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => window.__madPaint.engine.sampleDisplayed(px, py, '#ffffff')[0], [x, y]);

const fillBlack = (page: Page) =>
  page.evaluate(() => {
    const m = window.__madPaint;
    m.actions.setDrawingColor('#000000');
    m.actions.fillWithColor();
  });

test('layer mask: mask outside selection, draw on the mask, disable, apply', async ({ page }) => {
  await boot(page);
  await fillBlack(page);
  await selectTool(page, 'select');
  await drag(page, [100, 100], [200, 200]);
  await page.getByRole('button', { name: 'Mask outside selection' }).click();
  await expect(page.locator('[data-testid=mask-thumb]')).toHaveCount(1);
  expect(await shown(page, 150, 150)).toBe(0);
  expect(await shown(page, 50, 50)).toBe(255);
  // The layer's own pixels are untouched; the mask thumbnail is now the drawing target.
  expect(await layerAlpha(page, 50, 50)).toBe(255);
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().maskEditing)).toBe(true);
  await page.keyboard.press('ControlOrMeta+d');
  // Any colour reveals, the eraser hides.
  await selectTool(page, 'pen');
  await drag(page, [20, 50], [80, 50]);
  expect(await shown(page, 50, 50)).toBe(0);
  await selectTool(page, 'eraser');
  await drag(page, [140, 150], [160, 150]);
  expect(await shown(page, 150, 150)).toBe(255);
  expect(await layerAlpha(page, 150, 150)).toBe(255);
  // Disabled, the mask hides nothing.
  await page.evaluate(() => window.__madPaint.runCommand('enableMask'));
  expect(await shown(page, 20, 280)).toBe(0);
  await page.evaluate(() => window.__madPaint.runCommand('enableMask'));
  expect(await shown(page, 20, 280)).toBe(255);
  // Applying erases the hidden pixels and removes the mask; undo brings it back.
  await page.evaluate(() => window.__madPaint.runCommand('applyMask'));
  await expect(page.locator('[data-testid=mask-thumb]')).toHaveCount(0);
  expect(await layerAlpha(page, 20, 280)).toBe(0);
  expect(await layerAlpha(page, 120, 120)).toBe(255);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('[data-testid=mask-thumb]')).toHaveCount(1);
  expect(await layerAlpha(page, 20, 280)).toBe(255);
});

test('layer mask: submenu, Delete unmasks, thumbnails pick the target, saved in the file', async ({ page }) => {
  await boot(page);
  await fillBlack(page);
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: 'Layer', exact: true }).dispatchEvent('pointerdown');
  await page.locator('.menu-sub', { hasText: 'Layer mask' }).hover();
  await page.locator('[data-command=maskOutside]').click();
  await expect(page.locator('[data-testid=mask-thumb]')).toHaveCount(1);
  // Without a selection, "Mask outside selection" hides the whole layer.
  expect(await shown(page, 10, 10)).toBe(255);
  await page.keyboard.press('Delete');
  expect(await shown(page, 10, 10)).toBe(0);
  // Clicking the layer thumbnail makes the pixels the target again: Delete now erases them.
  await page.locator('[data-testid=layer-row] .layer-thumb').first().click();
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().maskEditing)).toBe(false);
  await page.keyboard.press('Delete');
  expect(await layerAlpha(page, 10, 10)).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  await page.locator('[data-testid=mask-thumb]').click();
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().maskEditing)).toBe(true);
  // Hide the left half through the mask, then save and reopen.
  await page.evaluate(() => {
    const m = window.__madPaint;
    m.actions.setSelection({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => (i % 400 < 200 ? 255 : 0)) });
  });
  await page.evaluate(() => window.__madPaint.runCommand('maskSelection'));
  expect(await shown(page, 100, 150)).toBe(255);
  expect(await shown(page, 300, 150)).toBe(0);
  await page.evaluate(async () => {
    const m = window.__madPaint;
    const bytes = await m.buildDocumentBytes();
    await m.openFileBytes({ name: 'masked.madpaint', data: bytes });
  });
  await expect(page.locator('[data-testid=mask-thumb]')).toHaveCount(1);
  expect(await shown(page, 100, 150)).toBe(255);
  expect(await shown(page, 300, 150)).toBe(0);
});

test('layer mask: a linked mask moves with the layer, an unlinked one stays', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const m = window.__madPaint;
    const sel = (x0: number, x1: number) => ({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => (i % 400 >= x0 && i % 400 < x1 && i / 400 >= 50 && i / 400 < 100 ? 255 : 0)) });
    m.actions.setDrawingColor('#000000');
    m.actions.setSelection(sel(50, 100));
    m.actions.fillWithColor();
    // Mask the left half of the square.
    m.actions.setSelection(sel(50, 75));
    m.actions.maskLayer(false);
    m.actions.deselect();
    m.actions.selectLayer(m.useStore.getState().activeLayerId, false);
  });
  expect(await shown(page, 60, 75)).toBe(255);
  expect(await shown(page, 90, 75)).toBe(0);
  await selectTool(page, 'move');
  await drag(page, [90, 75], [190, 75], 6);
  expect(await shown(page, 160, 75)).toBe(255);
  expect(await shown(page, 190, 75)).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  await page.getByRole('button', { name: 'Link mask to layer' }).click();
  await drag(page, [90, 75], [190, 75], 6);
  // The layer moved without its mask: nothing of it is hidden any more.
  expect(await shown(page, 160, 75)).toBe(0);
  expect(await shown(page, 190, 75)).toBe(0);
});

test('Through folders with opacity or a mask mix their result with the backdrop', async ({ page }) => {
  await boot(page);
  const px = await page.evaluate(() => {
    const m = window.__madPaint;
    const a = m.actions;
    a.setDrawingColor('#ff0000');
    a.fillWithColor();
    const folder = a.addFolder();
    a.setLayerProps(folder, { blend: 'pass-through', opacity: 0.5 }, 'Blending mode');
    a.addRasterLayer();
    a.setDrawingColor('#0000ff');
    a.fillWithColor();
    a.setLayerProps(m.useStore.getState().activeLayerId, { blend: 'multiply' }, 'Blending mode');
    const half = m.engine.sampleDisplayed(10, 10, '#ffffff');
    // Full opacity, but a mask that hides the left half of the folder.
    a.setLayerProps(folder, { opacity: 1 }, 'Layer opacity');
    a.setSelection({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => (i % 400 < 200 ? 255 : 0)) });
    a.maskLayer(false, folder);
    return { half, left: m.engine.sampleDisplayed(100, 10, '#ffffff'), right: m.engine.sampleDisplayed(300, 10, '#ffffff') };
  });
  // Red × blue (multiply) = black, mixed half and half with the red backdrop.
  expect(px.half[0]).toBeGreaterThan(120);
  expect(px.half[0]).toBeLessThan(136);
  expect(px.half[2]).toBeLessThan(4);
  expect(px.left.slice(0, 3)).toEqual([255, 0, 0]);
  expect(px.right.slice(0, 3)).toEqual([0, 0, 0]);
});

const openMenu = async (page: Page, menu: string, sub: string, command: string) => {
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: menu, exact: true }).dispatchEvent('pointerdown');
  await page.locator('.menu-sub', { hasText: sub }).first().hover();
  await page.locator(`[data-command=${command}]`).click();
};

test('correction layer: dialog preview, OK is one undo step, settings reopen from the icon', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const a = window.__madPaint.actions;
    a.setDrawingColor('#808080');
    a.fillWithColor();
  });
  await openMenu(page, 'Layer', 'New correction layer', 'correction-brightnessContrast');
  const dialog = page.getByRole('dialog', { name: 'Brightness/Contrast' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('spinbutton', { name: 'Brightness' }).fill('50');
  // The preview shows on the canvas while the dialog is open.
  await expect.poll(() => shown(page, 10, 10)).toBeGreaterThan(160);
  await dialog.getByRole('button', { name: 'OK' }).click();
  const after = await state(page);
  expect(after.layers[0]).toMatchObject({ kind: 'correction', name: 'Brightness/Contrast 1', correction: { type: 'brightnessContrast', brightness: 50 } });
  expect(after.layers[0].mask).toBeTruthy();
  // The pixels below are untouched.
  expect(await page.evaluate(() => window.__madPaint.engine.sampleLayer(window.__madPaint.useStore.getState().doc.layers[1].id, 10, 10)[0])).toBe(128);
  // Clicking the layer icon reopens the settings; Cancel restores them.
  await page.locator('[data-testid=correction-icon]').click();
  await expect(dialog.getByRole('spinbutton', { name: 'Brightness' })).toHaveValue('50');
  await dialog.getByRole('spinbutton', { name: 'Brightness' }).fill('-50');
  await expect.poll(() => shown(page, 10, 10)).toBeLessThan(100);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect.poll(() => shown(page, 10, 10)).toBeGreaterThan(160);
  // One undo removes the whole new layer.
  await page.keyboard.press('ControlOrMeta+z');
  expect((await state(page)).layers).toHaveLength(1);
  expect(await shown(page, 10, 10)).toBe(128);
});

test('correction layers see the paper, can be clipped, and are limited by the selection', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const m = window.__madPaint;
    const a = m.actions;
    // A red square on the left.
    a.setDrawingColor('#ff0000');
    a.setSelection({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => (i % 400 < 100 ? 255 : 0)) });
    a.fillWithColor();
    a.deselect();
    a.addCorrectionLayer({ type: 'reverse' });
    const root = { paper: m.engine.sampleDisplayed(300, 10, '#ffffff'), red: m.engine.sampleDisplayed(50, 10, '#ffffff') };
    a.undo();
    // Clipped onto the red layer, only the red pixels are inverted.
    const id = a.addCorrectionLayer({ type: 'reverse' });
    a.setLayerProps(id, { clip: true }, 'Clip to layer below');
    const clipped = { paper: m.engine.sampleDisplayed(300, 10, '#ffffff'), red: m.engine.sampleDisplayed(50, 10, '#ffffff') };
    a.undo();
    a.undo();
    // With a selection, the paired mask limits the effect to it.
    a.setSelection({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => (i % 400 >= 200 ? 255 : 0)) });
    a.addCorrectionLayer({ type: 'reverse' });
    const masked = { left: m.engine.sampleDisplayed(150, 10, '#ffffff'), right: m.engine.sampleDisplayed(300, 10, '#ffffff') };
    return { root, clipped, masked };
  });
  // Like the reference's paper layer, the paper is part of the stack.
  expect(r.root.paper.slice(0, 3)).toEqual([0, 0, 0]);
  expect(r.root.red.slice(0, 3)).toEqual([0, 255, 255]);
  expect(r.clipped.paper.slice(0, 3)).toEqual([255, 255, 255]);
  expect(r.clipped.red.slice(0, 3)).toEqual([0, 255, 255]);
  expect(r.masked.left.slice(0, 3)).toEqual([255, 255, 255]);
  expect(r.masked.right.slice(0, 3)).toEqual([0, 0, 0]);
});

test('Edit > Tonal correction changes pixels; tone curve points are added by clicking', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const a = window.__madPaint.actions;
    a.setDrawingColor('#646464');
    a.fillWithColor();
  });
  await openMenu(page, 'Edit', 'Tonal correction', 'tonal-posterize');
  const posterize = page.getByRole('dialog', { name: 'Posterization' });
  await posterize.getByRole('spinbutton', { name: 'Levels' }).fill('2');
  await posterize.getByRole('button', { name: 'OK' }).click();
  expect(await page.evaluate(() => window.__madPaint.engine.sampleLayer(window.__madPaint.useStore.getState().activeLayerId, 5, 5)[0])).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  await openMenu(page, 'Edit', 'Tonal correction', 'tonal-toneCurve');
  const curve = page.getByRole('dialog', { name: 'Tone curve' });
  const box = (await curve.getByTestId('tone-curve').boundingBox())!;
  // Drag the middle of the line up: brighter midtones.
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3, { steps: 4 });
  await page.mouse.up();
  await curve.getByRole('button', { name: 'OK' }).click();
  expect(await page.evaluate(() => window.__madPaint.engine.sampleLayer(window.__madPaint.useStore.getState().activeLayerId, 5, 5)[0])).toBeGreaterThan(140);
  // ⌘I: Reverse gradient on the pixels.
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+i');
  expect(await page.evaluate(() => window.__madPaint.engine.sampleLayer(window.__madPaint.useStore.getState().activeLayerId, 5, 5)[0])).toBe(155);
});

test('gradient map correction layers are saved and reopened', async ({ page }) => {
  await boot(page);
  const px = await page.evaluate(async () => {
    const m = window.__madPaint;
    const a = m.actions;
    a.setDrawingColor('#000000');
    a.fillWithColor();
    a.addCorrectionLayer({ type: 'gradientMap', stops: [{ pos: 0, color: '#ff0000', opacity: 1 }, { pos: 1, color: '#0000ff', opacity: 1 }] });
    const bytes = await m.buildDocumentBytes();
    await m.openFileBytes({ name: 'map.madpaint', data: bytes });
    return m.engine.sampleDisplayed(5, 5, '#ffffff');
  });
  expect(px.slice(0, 3)).toEqual([255, 0, 0]);
  await expect(page.locator('[data-testid=correction-icon]')).toHaveCount(1);
});

test('Layer Property palette: border effect and layer colour change the display, not the pixels', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const a = window.__madPaint.actions;
    a.setDrawingColor('#000000');
    a.setSelection({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => (i % 400 >= 100 && i % 400 < 200 && i / 400 >= 100 && i / 400 < 200 ? 255 : 0)) });
    a.fillWithColor();
    a.deselect();
  });
  const panel = page.getByTestId('layer-property-panel');
  await panel.getByRole('button', { name: 'Border effect' }).click();
  await panel.getByLabel('Edge color').fill('#ff0000');
  // Two pixels outside the square: edge colour; ten pixels outside: paper.
  expect((await page.evaluate(() => window.__madPaint.engine.sampleDisplayed(97, 150, '#ffffff'))).slice(0, 3)).toEqual([255, 0, 0]);
  expect(await shown(page, 90, 150)).toBe(255);
  expect(await layerAlpha(page, 97, 150)).toBe(0);
  // Layer colour shows black in the chosen colour.
  await panel.getByRole('button', { name: 'Layer color' }).click();
  await panel.getByLabel('Layer color value').fill('#0000ff');
  expect((await page.evaluate(() => window.__madPaint.engine.sampleDisplayed(150, 150, '#ffffff'))).slice(0, 3)).toEqual([0, 0, 255]);
  // Saved with the document.
  const fx = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'fx.madpaint', data: await m.buildDocumentBytes() });
    return m.useStore.getState().doc.layers[0].effects;
  });
  expect(fx.border).toMatchObject({ enabled: true, kind: 'edge', color: '#ff0000' });
  expect(fx.layerColor).toMatchObject({ enabled: true, color: '#0000ff' });
});

/** Opaque pixels of the active layer in a vertical (or horizontal) line of `n` pixels. */
const thickness = (page: Page, x: number, y: number, n = 60, vertical = true) =>
  page.evaluate(
    ([px, py, len, vert]) => {
      const m = window.__madPaint;
      const id = m.useStore.getState().activeLayerId;
      let count = 0;
      for (let i = -len / 2; i < len / 2; i++) {
        const a = vert ? m.engine.sampleLayer(id, px, py + i) : m.engine.sampleLayer(id, px + i, py);
        if (a && a[3] > 100) count++;
      }
      return count;
    },
    [x, y, n, vertical ? 1 : 0] as [number, number, number, number],
  );

const useSubTool = (page: Page, tool: string, id: string) =>
  page.evaluate(([t, s]) => window.__madPaint.actions.setSubTool(t, s), [tool, id]);

test('starting and ending taper a brush pen stroke even with a mouse', async ({ page }) => {
  await boot(page);
  await useSubTool(page, 'brush', 'brush-pen');
  await page.evaluate(() => window.__madPaint.actions.setBrushSize(20));
  await drag(page, [40, 150], [360, 150], 24);
  const middle = await thickness(page, 200, 150);
  const nearStart = await thickness(page, 45, 150);
  const nearEnd = await thickness(page, 355, 150);
  expect(middle).toBeGreaterThanOrEqual(17);
  expect(nearStart).toBeLessThan(middle / 2);
  expect(nearEnd).toBeLessThan(middle / 2);
});

test('colour mixing: oil paint carries the colour it passes over', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const a = window.__madPaint.actions;
    a.setDrawingColor('#ff0000');
    a.setSelection({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => (i % 400 < 150 ? 255 : 0)) });
    a.fillWithColor();
    a.deselect();
    a.setDrawingColor('#0000ff');
    a.setSubTool('brush', 'brush-oil');
  });
  await drag(page, [60, 150], [300, 150], 30);
  const px = await page.evaluate(() => {
    const m = window.__madPaint;
    return m.engine.sampleLayer(m.useStore.getState().activeLayerId, 250, 150);
  });
  // Beyond the red area the stroke is still reddish-violet, not pure blue.
  expect(px[3]).toBeGreaterThan(100);
  expect(px[0]).toBeGreaterThan(40);
  expect(px[2]).toBeLessThan(250);
});

test('a flat brush tip (calligraphy) is thin along its angle and wide across it', async ({ page }) => {
  await boot(page);
  await useSubTool(page, 'pen', 'pen-calligraphy');
  await page.evaluate(() => window.__madPaint.actions.setBrushSize(24));
  // The tip leans at 45°: a stroke along 45° is thin, one along −45° is wide.
  await drag(page, [60, 60], [140, 140], 16);
  await drag(page, [260, 140], [340, 60], 16);
  const along = await thickness(page, 100, 100, 60, false);
  const across = await thickness(page, 300, 100, 60, false);
  expect(across).toBeGreaterThan(along * 2);
});

test('brush dynamics popover, pen pressure settings and Advanced Tool Settings', async ({ page }) => {
  await boot(page);
  await selectTool(page, 'pen');
  await page.getByRole('button', { name: 'Tool Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Brush Size: dynamics' }).click();
  const pop = page.getByRole('dialog', { name: 'Brush size dynamics' });
  await expect(pop.getByTestId('size-curve')).toBeVisible();
  await pop.getByLabel('Tilt').check();
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().subTools.find((t: any) => t.id === 'pen-g').brush.sizeTilt)).toBe(true);
  // File > Pen pressure settings: "Stronger" bends the graph for every tool.
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: 'File', exact: true }).dispatchEvent('pointerdown');
  await page.locator('[data-command=pressureSettings]').click();
  const dlg = page.getByRole('dialog', { name: 'Pen pressure settings' });
  await dlg.getByRole('button', { name: 'Stronger' }).click();
  await dlg.getByRole('button', { name: 'Done' }).click();
  const curve = await page.evaluate(() => window.__madPaint.useStore.getState().prefs.pressureCurve);
  expect(curve.length).toBeGreaterThan(2);
  // Advanced Tool Settings: Starting and ending.
  await page.getByRole('button', { name: 'Advanced tool settings' }).click();
  const adv = page.getByRole('dialog', { name: 'Advanced Tool Settings' });
  await adv.getByRole('button', { name: 'Starting and ending' }).click();
  await adv.getByRole('spinbutton', { name: 'Starting' }).fill('20');
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().subTools.find((t: any) => t.id === 'pen-g').brush.taperStart)).toBe(20);
});

const thinPen = (page: Page) =>
  page.evaluate(() => {
    const m = window.__madPaint;
    m.actions.setTool('pen');
    const s = m.useStore.getState();
    const sub = s.subTools.find((t: any) => t.id === s.activeSub.pen);
    m.actions.updateSubTool(sub.id, { brush: { ...sub.brush, size: 6, sizePressure: false, stabilization: 0 } });
  });

/** Alpha values of the active layer along a row. */
const alphasAlong = (page: Page, x0: number, x1: number, y: number) =>
  page.evaluate(
    ([a, b, row]) => {
      const m = window.__madPaint;
      const id = m.useStore.getState().activeLayerId;
      const out: number[] = [];
      for (let x = a; x <= b; x++) out.push(m.engine.sampleLayer(id, x, row)[3]);
      return out;
    },
    [x0, x1, y],
  );

test('brush materials: image tips, paper textures and imported tip images', async ({ page }) => {
  const errors = await boot(page);
  // Decoration: stars stamped along the stroke, with gaps between them.
  await useSubTool(page, 'decoration', 'deco-stars');
  await drag(page, [40, 50], [360, 50], 16);
  const stars = await page.evaluate(() => {
    const m = window.__madPaint;
    const id = m.useStore.getState().activeLayerId;
    let n = 0;
    for (let y = 0; y < 110; y += 2) for (let x = 0; x < 400; x += 2) if (m.engine.sampleLayer(id, x, y)[3] > 0) n++;
    return n;
  });
  expect(stars).toBeGreaterThan(40);
  // Pencil on paper: the paper grain shows inside the line.
  await useSubTool(page, 'pencil', 'pencil-paper');
  await page.evaluate(() => window.__madPaint.actions.setBrushSize(24));
  await drag(page, [40, 150], [360, 150], 16);
  const grain = await alphasAlong(page, 80, 320, 150);
  expect(Math.max(...grain) - Math.min(...grain)).toBeGreaterThan(80);
  // A plain pen line is even.
  await thinPen(page);
  await drag(page, [40, 200], [360, 200], 16);
  const plain = await alphasAlong(page, 80, 320, 200);
  expect(Math.max(...plain) - Math.min(...plain)).toBeLessThan(10);
  // Advanced Tool Settings > Brush tip: import an image as the pen's tip (a bar across its top).
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    c.getContext('2d')!.fillRect(0, 0, 32, 6);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: 'Tool Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced tool settings' }).click();
  const adv = page.getByRole('dialog', { name: 'Advanced Tool Settings' });
  await adv.getByRole('button', { name: 'Brush tip', exact: true }).click();
  await adv.getByRole('radio', { name: 'Material' }).click();
  await page.getByTestId('import-tip').setInputFiles({ name: 'bar.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(adv.getByRole('option', { name: 'bar' })).toHaveAttribute('aria-selected', 'true');
  // Only the imported tip: the chalk tip chosen first is removed by clicking it.
  await adv.getByRole('option', { name: 'Chalk' }).click();
  const tips = await page.evaluate(() => {
    const s = window.__madPaint.useStore.getState();
    return s.subTools.find((t: any) => t.id === s.activeSub.pen).brush.tipMaterials;
  });
  expect(tips).toHaveLength(1);
  expect(tips[0]).toMatch(/^img-/);
  await page.evaluate(() => window.__madPaint.actions.setBrushSize(32));
  await drag(page, [60, 260], [300, 260], 16);
  // The tip's bar lies across its top: paint above the line's middle, none below it.
  expect(await layerAlpha(page, 180, 248)).toBeGreaterThan(100);
  expect(await layerAlpha(page, 180, 268)).toBe(0);
  expect(errors).toEqual([]);
});

test('symmetrical ruler mirrors strokes; ⌘2 turns special snapping off', async ({ page }) => {
  await boot(page);
  await useSubTool(page, 'ruler', 'ruler-symmetry');
  // Drag upwards from the centre: a vertical mirror axis at x = 200.
  await drag(page, [200, 150], [200, 60], 6);
  expect((await state(page)).layers[0].rulers.items[0]).toMatchObject({ kind: 'symmetry', lines: 2, mirror: true });
  await thinPen(page);
  await drag(page, [80, 100], [120, 200], 8);
  expect(await layerAlpha(page, 100, 150)).toBeGreaterThan(200);
  expect(await layerAlpha(page, 300, 150)).toBeGreaterThan(200);
  await page.keyboard.press('ControlOrMeta+2');
  await drag(page, [80, 250], [120, 260], 8);
  expect(await layerAlpha(page, 100, 255)).toBeGreaterThan(200);
  expect(await layerAlpha(page, 300, 255)).toBe(0);
});

test('special and linear rulers straighten strokes; the Object tool edits and deletes rulers', async ({ page }) => {
  await boot(page);
  await useSubTool(page, 'ruler', 'ruler-special');
  // Parallel lines: drag a horizontal direction.
  await drag(page, [50, 50], [150, 50], 6);
  await thinPen(page);
  await drag(page, [100, 200], [250, 260], 10);
  // The stroke stays on y = 200 instead of going down to 260.
  expect(await layerAlpha(page, 240, 200)).toBeGreaterThan(200);
  expect(await layerAlpha(page, 240, 256)).toBe(0);
  // Object tool: select the ruler by clicking its line, Delete removes it, undo brings it back.
  await selectTool(page, 'object');
  const at = await docToScreen(page, 300, 50);
  await page.mouse.click(at.x, at.y);
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().selectedRuler)).toBeTruthy();
  await page.keyboard.press('Delete');
  expect((await state(page)).layers[0].rulers).toBeUndefined();
  await page.keyboard.press('ControlOrMeta+z');
  expect((await state(page)).layers[0].rulers.items).toHaveLength(1);
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  // A linear ruler only catches strokes that start near it.
  await useSubTool(page, 'ruler', 'ruler-linear');
  await drag(page, [20, 100], [380, 100], 6);
  await thinPen(page);
  await drag(page, [60, 104], [200, 140], 10);
  expect(await layerAlpha(page, 190, 100)).toBeGreaterThan(200);
  expect(await layerAlpha(page, 190, 137)).toBe(0);
  await drag(page, [60, 220], [200, 280], 10);
  expect(await layerAlpha(page, 190, 277)).toBeGreaterThan(100);
});

test('perspective ruler: strokes run towards the closest vanishing point; rulers are saved', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__madPaint.runCommand('perspective2'));
  const vps = (await state(page)).layers[0].rulers.items[0].vps;
  expect(vps).toHaveLength(2);
  await thinPen(page);
  // Start at (200, 250) heading right and slightly up: towards the right vanishing point.
  await drag(page, [200, 250], [330, 230], 12);
  const right = vps[1];
  const endOnLine = await page.evaluate(
    ([vx, vy]) => {
      const m = window.__madPaint;
      const id = m.useStore.getState().activeLayerId;
      // Where the line from (200, 250) to the vanishing point crosses x = 320.
      const y = 250 + ((vy - 250) * (320 - 200)) / (vx - 200);
      return m.engine.sampleLayer(id, 320, Math.round(y))[3];
    },
    [right.x, right.y],
  );
  expect(endOnLine).toBeGreaterThan(150);
  const saved = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'rulers.madpaint', data: await m.buildDocumentBytes() });
    return m.useStore.getState().doc.layers[0].rulers;
  });
  expect(saved.items[0].kind).toBe('perspective');
  // "Show only when editing target": another layer does not use it.
  await page.locator('[data-testid=ruler-icon]').click();
  await page.getByRole('menuitem', { name: 'Show only when editing target' }).click();
  await page.keyboard.press('ControlOrMeta+Shift+n');
  expect(await page.evaluate(() => window.__madPaint.actions.activeRulers().length)).toBe(0);
});

/** Clicks document points (with a pause, so they are not double-clicks); `last` is double-clicked. */
async function clickPoints(page: Page, points: [number, number][], last?: [number, number]) {
  for (const [x, y] of points) {
    const at = await docToScreen(page, x, y);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(400);
  }
  if (last) {
    const at = await docToScreen(page, ...last);
    await page.mouse.dblclick(at.x, at.y);
  }
}

/** A pen stroke through document points. */
async function strokeThrough(page: Page, points: [number, number][], steps = 6) {
  const [first, ...rest] = points;
  let prev = await docToScreen(page, ...first);
  await page.mouse.move(prev.x, prev.y);
  await page.mouse.down();
  for (const pt of rest) {
    const next = await docToScreen(page, ...pt);
    for (let i = 1; i <= steps; i++) await page.mouse.move(prev.x + ((next.x - prev.x) * i) / steps, prev.y + ((next.y - prev.y) * i) / steps);
    prev = next;
  }
  await page.mouse.up();
}

test('curve ruler: clicked points make a spline that strokes follow; its points edit with the Object tool', async ({ page }) => {
  await boot(page);
  await useSubTool(page, 'ruler', 'ruler-curve');
  // Backspace removes the last point, Esc cancels the curve.
  await clickPoints(page, [
    [40, 40],
    [120, 40],
  ]);
  expect((await state(page)).hint).toContain('double-click');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  expect((await state(page)).layers[0].rulers).toBeUndefined();
  await clickPoints(page, [
    [60, 200],
    [200, 80],
  ], [340, 200]);
  const ruler = (await state(page)).layers[0].rulers.items[0];
  expect(ruler).toMatchObject({ kind: 'curve', curve: 'spline' });
  expect(ruler.points.map((p: any) => [Math.round(p.x), Math.round(p.y)])).toEqual([
    [60, 200],
    [200, 80],
    [340, 200],
  ]);
  // A stroke that starts near the curve follows it over the top, wherever the pointer goes.
  await thinPen(page);
  await strokeThrough(page, [
    [64, 196],
    [150, 140],
    [200, 110],
    [250, 140],
  ]);
  expect(await layerAlpha(page, 200, 80)).toBeGreaterThan(150);
  expect(await layerAlpha(page, 200, 110)).toBe(0);
  expect(await layerAlpha(page, 150, 140)).toBe(0);
  // A stroke elsewhere is free.
  await drag(page, [100, 270], [300, 270], 8);
  expect(await layerAlpha(page, 200, 270)).toBeGreaterThan(150);
  // Object tool: drag the middle point up.
  await selectTool(page, 'object');
  await drag(page, [200, 80], [200, 50], 6);
  const moved = (await state(page)).layers[0].rulers.items[0].points[1];
  expect([Math.round(moved.x), Math.round(moved.y)]).toEqual([200, 50]);
});

test('figure ruler and ruler pen: strokes go round the figure; rulers are saved with the canvas', async ({ page }) => {
  await boot(page);
  await useSubTool(page, 'ruler', 'ruler-figure');
  await page.getByRole('button', { name: 'Tool Settings', exact: true }).click();
  await page.getByRole('radio', { name: 'Rectangle' }).click();
  await drag(page, [100, 100], [300, 200], 8);
  const fig = (await state(page)).layers[0].rulers.items[0];
  expect(fig).toMatchObject({ kind: 'figure', shape: 'rect' });
  expect([fig.center.x, fig.center.y, fig.rx, fig.ry].map(Math.round)).toEqual([200, 150, 100, 50]);
  await thinPen(page);
  // Along the top edge and round the corner down the right side.
  await strokeThrough(page, [
    [120, 104],
    [290, 106],
    [306, 150],
    [304, 190],
  ]);
  expect(await layerAlpha(page, 200, 100)).toBeGreaterThan(150);
  expect(await layerAlpha(page, 300, 150)).toBeGreaterThan(150);
  expect(await layerAlpha(page, 290, 108)).toBe(0);
  // The ruler pen keeps a hand-drawn line as a curve ruler.
  await useSubTool(page, 'ruler', 'ruler-pen');
  await strokeThrough(page, [
    [40, 260],
    [120, 230],
    [200, 270],
    [280, 230],
    [360, 260],
  ]);
  const pen = (await state(page)).layers[0].rulers.items[1];
  expect(pen.kind).toBe('curve');
  expect(pen.points.length).toBeGreaterThanOrEqual(4);
  expect([Math.round(pen.points[0].x), Math.round(pen.points[0].y)]).toEqual([40, 260]);
  // Layer > Ruler/Frame > Draw along ruler: the selected (figure) ruler, as a line of the chosen width.
  await page.evaluate(() => window.__madPaint.actions.deleteLayerRulers());
  await page.keyboard.press('ControlOrMeta+Shift+n');
  await useSubTool(page, 'ruler', 'ruler-figure');
  await drag(page, [60, 40], [160, 90], 8);
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: 'Layer', exact: true }).dispatchEvent('pointerdown');
  await page.getByRole('menuitem', { name: 'Ruler/Frame' }).hover();
  await page.locator('[data-command=drawAlongRuler]').click();
  const along = page.getByRole('dialog', { name: 'Draw along ruler' });
  await along.getByLabel('Line width').fill('5');
  await along.getByRole('button', { name: 'OK' }).click();
  expect(await layerAlpha(page, 110, 40)).toBeGreaterThan(200);
  expect(await layerAlpha(page, 160, 65)).toBeGreaterThan(200);
  expect(await layerAlpha(page, 110, 65)).toBe(0);
  const saved = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'curves.madpaint', data: await m.buildDocumentBytes() });
    return m.useStore.getState().doc.layers.flatMap((l: any) => l.rulers?.items.map((r: any) => r.kind) ?? []);
  });
  expect(saved).toEqual(['figure']);
});

test('special curve rulers: parallel curves keep their distance, radial curves turn around the centre', async ({ page }) => {
  await boot(page);
  await useSubTool(page, 'ruler', 'ruler-special');
  await page.getByRole('button', { name: 'Tool Settings', exact: true }).click();
  await page.getByRole('radio', { name: 'Parallel curve' }).click();
  await page.getByRole('radio', { name: 'Polyline' }).click();
  await clickPoints(page, [
    [40, 100],
    [200, 100],
  ], [360, 100]);
  expect((await state(page)).layers[0].rulers.items[0]).toMatchObject({ kind: 'parallelCurve', curve: 'polyline' });
  await thinPen(page);
  // 50 px below the ruler, the stroke stays 50 px below it.
  await drag(page, [100, 150], [300, 190], 10);
  expect(await layerAlpha(page, 290, 150)).toBeGreaterThan(150);
  expect(await layerAlpha(page, 290, 186)).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  // Radial curve: the centre first, then the curve's points.
  await useSubTool(page, 'ruler', 'ruler-special');
  await page.getByRole('radio', { name: 'Radial curve' }).click();
  await clickPoints(page, [
    [200, 150],
    [300, 150],
  ], [350, 180]);
  const radial = (await state(page)).layers[0].rulers.items[0];
  expect(radial.kind).toBe('radialCurve');
  expect([Math.round(radial.center.x), Math.round(radial.center.y)]).toEqual([200, 150]);
  await thinPen(page);
  // 50 px above the centre: the curve turned a quarter round, up from the centre.
  await drag(page, [200, 100], [206, 60], 8);
  expect(await layerAlpha(page, 200, 64)).toBeGreaterThan(150);
  expect(await layerAlpha(page, 206, 62)).toBe(0);
});

/** Lines of the active (vector) layer. */
const lines = (page: Page) =>
  page.evaluate(() => {
    const s = window.__madPaint.useStore.getState();
    const find = (ls: any[]): any => ls.map((l) => (l.id === s.activeLayerId ? l : l.children ? find(l.children) : null)).find(Boolean);
    return (find(s.doc.layers)?.strokes ?? []).map((x: any) => ({ id: x.id, color: x.color, size: x.brush.size, erase: Boolean(x.erase), n: x.points.length, curve: x.curve ?? null }));
  });

/** Changes settings of a Correct line sub tool and selects it. */
const correctWith = (page: Page, id: string, patch: Record<string, unknown> = {}) =>
  page.evaluate(
    ([sid, p]) => {
      const m = window.__madPaint;
      const t = m.useStore.getState().subTools.find((x: any) => x.id === sid);
      m.actions.updateSubTool(sid, { correct: { ...t.correct, ...p } });
      m.actions.setSubTool('correct', sid);
    },
    [id, patch] as const,
  );

/** Half the thickness of the active layer's line at x, measured downwards from y. */
async function halfThickness(page: Page, x: number, y: number): Promise<number> {
  let d = 0;
  while (d < 40 && (await layerAlpha(page, x, y + d + 1)) > 100) d++;
  return d;
}

test('vector layer: strokes become lines; the vector eraser erases up to intersections or whole lines', async ({ page }) => {
  const errors = await boot(page);
  await page.getByRole('button', { name: 'New vector layer' }).click();
  expect((await state(page)).layers[0].kind).toBe('vector');
  await expect(page.getByTestId('vector-icon')).toHaveCount(1);
  await thinPen(page);
  await drag(page, [40, 150], [360, 150], 12);
  await drag(page, [150, 50], [150, 250], 12);
  await drag(page, [250, 50], [250, 250], 12);
  expect(await lines(page)).toHaveLength(3);
  expect(await layerAlpha(page, 200, 150)).toBeGreaterThan(200);
  // "Up to intersection": the horizontal line goes between the two vertical ones.
  await useSubTool(page, 'eraser', 'eraser-vector');
  await drag(page, [200, 148], [201, 151], 2);
  expect(await layerAlpha(page, 200, 150)).toBe(0);
  expect(await layerAlpha(page, 100, 150)).toBeGreaterThan(200);
  expect(await layerAlpha(page, 300, 150)).toBeGreaterThan(200);
  expect(await layerAlpha(page, 150, 100)).toBeGreaterThan(200);
  expect(await lines(page)).toHaveLength(4);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await lines(page)).toHaveLength(3);
  expect(await layerAlpha(page, 200, 150)).toBeGreaterThan(200);
  // "Whole line".
  await page.evaluate(() => window.__madPaint.actions.updateSubTool('eraser-vector', { vectorErase: 'whole' }));
  await drag(page, [150, 60], [151, 62], 2);
  expect(await layerAlpha(page, 150, 200)).toBe(0);
  expect(await lines(page)).toHaveLength(2);
  // A normal eraser erases the touched part only.
  await useSubTool(page, 'eraser', 'eraser-hard');
  await drag(page, [250, 100], [252, 100], 2);
  expect(await layerAlpha(page, 250, 100)).toBe(0);
  expect(await layerAlpha(page, 250, 200)).toBeGreaterThan(200);
  expect(await lines(page)).toHaveLength(3);
  // The transparent colour draws erasing lines.
  await thinPen(page);
  await page.keyboard.press('c');
  await drag(page, [80, 120], [80, 180], 8);
  expect(await layerAlpha(page, 80, 150)).toBe(0);
  expect((await lines(page)).filter((l: any) => l.erase)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('Correct line: drawn lines keep few control points; the Control point tool moves, adds, deletes, splits and widens', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__madPaint.actions.addVectorLayer());
  await thinPen(page);
  await drag(page, [40, 150], [360, 150], 12);
  const [line] = await lines(page);
  expect(line.curve).toBe('spline');
  expect(line.n).toBeLessThanOrEqual(3);
  // Move: drag the end point down.
  await correctWith(page, 'correct-point', { mode: 'move' });
  await drag(page, [360, 150], [360, 250], 8);
  expect(await layerAlpha(page, 359, 249)).toBeGreaterThan(150);
  expect(await layerAlpha(page, 350, 150)).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await layerAlpha(page, 350, 150)).toBeGreaterThan(200);
  // Add: click the line and drag the new point up (Tool Settings > Mode).
  await page.getByRole('button', { name: 'Tool Settings', exact: true }).click();
  await page.getByRole('radio', { name: 'Add control point' }).click();
  await drag(page, [200, 150], [200, 100], 8);
  expect((await lines(page))[0].n).toBe(line.n + 1);
  expect(await layerAlpha(page, 200, 100)).toBeGreaterThan(150);
  // Width: drag the new point to the right; the line gets thicker around it.
  const thin = await halfThickness(page, 200, 100);
  await correctWith(page, 'correct-point', { mode: 'width' });
  await drag(page, [200, 100], [290, 100], 8);
  expect(await halfThickness(page, 200, 100)).toBeGreaterThan(thin + 2);
  await page.keyboard.press('ControlOrMeta+z');
  // Split there: two lines.
  await correctWith(page, 'correct-point', { mode: 'split' });
  await drag(page, [200, 100], [200, 100], 1);
  expect(await lines(page)).toHaveLength(2);
  await page.keyboard.press('ControlOrMeta+z');
  // Delete the point: straight again.
  await correctWith(page, 'correct-point', { mode: 'delete' });
  await drag(page, [200, 100], [200, 100], 1);
  expect((await lines(page))[0].n).toBe(line.n);
  expect(await layerAlpha(page, 200, 150)).toBeGreaterThan(200);
  expect(await layerAlpha(page, 200, 100)).toBe(0);
  expect(errors).toEqual([]);
});

test('Correct line: connect, pinch, adjust width, redraw and simplify vector lines', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__madPaint.actions.addVectorLayer());
  await thinPen(page);
  await drag(page, [40, 100], [190, 100], 10);
  await drag(page, [200, 100], [360, 100], 10);
  expect(await lines(page)).toHaveLength(2);
  // Connect: brush over the gap.
  await correctWith(page, 'correct-connect');
  await drag(page, [194, 100], [196, 100], 2);
  expect(await lines(page)).toHaveLength(1);
  expect(await layerAlpha(page, 195, 100)).toBeGreaterThan(200);
  // Pinch: grab the line and pull it up.
  await correctWith(page, 'correct-pinch', { fixEnds: true });
  await drag(page, [120, 100], [120, 60], 8);
  expect(await layerAlpha(page, 120, 60)).toBeGreaterThan(150);
  expect(await layerAlpha(page, 41, 100)).toBeGreaterThan(150);
  await page.keyboard.press('ControlOrMeta+z');
  // Adjust line width: thicker where the brush went, not elsewhere.
  await correctWith(page, 'correct-width', { widthMode: 'thicken', widthAmount: 8, size: 30 });
  await drag(page, [280, 100], [300, 100], 4);
  expect(await halfThickness(page, 290, 100)).toBeGreaterThan(5);
  expect(await halfThickness(page, 80, 100)).toBeLessThan(4);
  await page.keyboard.press('ControlOrMeta+z');
  // Redraw: a bump drawn over part of the line replaces that part.
  await correctWith(page, 'correct-redraw');
  await strokeThrough(page, [
    [60, 100],
    [100, 75],
    [140, 65],
    [180, 75],
    [220, 100],
  ]);
  expect(await layerAlpha(page, 140, 66)).toBeGreaterThan(150);
  expect(await layerAlpha(page, 140, 100)).toBe(0);
  expect(await layerAlpha(page, 300, 100)).toBeGreaterThan(200);
  // Simplify the whole line: fewer control points.
  const before = (await lines(page))[0].n;
  expect(before).toBeGreaterThan(3);
  await correctWith(page, 'correct-simplify', { wholeLine: true, simplify: 100, size: 20 });
  await drag(page, [300, 100], [302, 100], 2);
  expect((await lines(page))[0].n).toBeLessThan(before);
  expect(errors).toEqual([]);
});

test('Object tool drags the control points of selected lines; Ruler from vector', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__madPaint.actions.addVectorLayer());
  await thinPen(page);
  await strokeThrough(page, [
    [60, 200],
    [200, 120],
    [340, 200],
  ]);
  await selectTool(page, 'object');
  const at = await docToScreen(page, 60, 200);
  await page.mouse.click(at.x, at.y);
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().selectedObjects)).toHaveLength(1);
  await drag(page, [60, 200], [60, 260], 6);
  expect(await layerAlpha(page, 61, 258)).toBeGreaterThan(150);
  // Layer > Ruler/Frame > Ruler from vector.
  await page.evaluate(() => window.__madPaint.runCommand('rulerFromVector'));
  const ruler = (await state(page)).layers[0].rulers.items[0];
  expect(ruler.kind).toBe('curve');
  expect(ruler.points.length).toBe((await lines(page))[0].n);
});

test('Object tool: select, move, recolour and delete vector lines; transforms stay lossless', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__madPaint.actions.addVectorLayer());
  await thinPen(page);
  await drag(page, [100, 100], [200, 100], 10);
  await selectTool(page, 'object');
  const on = await docToScreen(page, 150, 101);
  await page.mouse.click(on.x, on.y);
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().selectedObjects)).toHaveLength(1);
  // Dragging the line moves it.
  await drag(page, [150, 100], [150, 180], 10);
  expect(await layerAlpha(page, 150, 180)).toBeGreaterThan(200);
  expect(await layerAlpha(page, 150, 100)).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await layerAlpha(page, 150, 100)).toBeGreaterThan(200);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect(await layerAlpha(page, 150, 180)).toBeGreaterThan(200);
  // ⌘-drag with the pen works like the Object tool.
  await selectTool(page, 'pen');
  await page.keyboard.down('ControlOrMeta');
  await drag(page, [150, 180], [150, 200], 6);
  await page.keyboard.up('ControlOrMeta');
  expect(await layerAlpha(page, 150, 200)).toBeGreaterThan(200);
  expect(await lines(page)).toHaveLength(1);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await layerAlpha(page, 150, 180)).toBeGreaterThan(200);
  await selectTool(page, 'object');
  // Tool Settings: give it the drawing colour, then a new width.
  await page.evaluate(() => window.__madPaint.actions.setDrawingColor('#ff0000'));
  await page.getByRole('button', { name: 'Tool Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Use drawing color' }).click();
  expect((await lines(page))[0].color).toBe('#ff0000');
  const red = await page.evaluate(() => window.__madPaint.engine.sampleLayer(window.__madPaint.useStore.getState().activeLayerId, 150, 180));
  expect(red[0]).toBeGreaterThan(240);
  expect(red[1] + red[2]).toBeLessThan(10);
  expect(red[3]).toBe(255);
  // Delete removes the selected line; undo brings it back.
  await page.keyboard.press('Delete');
  expect(await lines(page)).toHaveLength(0);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await lines(page)).toHaveLength(1);
  // Doubling the resolution doubles the line exactly (width too).
  await page.evaluate(() => window.__madPaint.actions.changeImageResolution(800, 600, 144));
  expect((await lines(page))[0].size).toBe(12);
  expect(await thickness(page, 300, 360, 40)).toBeGreaterThanOrEqual(11);
  // Lines are saved and come back as lines.
  const back = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'lines.madpaint', data: await m.buildDocumentBytes() });
    const l = m.useStore.getState().doc.layers[0];
    return { kind: l.kind, n: l.strokes.length, alpha: m.engine.sampleLayer(l.id, 300, 360)[3] };
  });
  expect(back).toEqual({ kind: 'vector', n: 1, alpha: 255 });
  expect(errors).toEqual([]);
});

test('fill, gradient and blend refuse vector layers; Rasterize turns one into a raster layer', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__madPaint.actions.addVectorLayer());
  await thinPen(page);
  await drag(page, [100, 150], [300, 150], 10);
  await selectTool(page, 'fill');
  const at = await docToScreen(page, 50, 50);
  await page.mouse.click(at.x, at.y);
  expect((await state(page)).hint).toMatch(/vector layers/);
  expect(await layerAlpha(page, 50, 50)).toBe(0);
  await page.evaluate(() => window.__madPaint.runCommand('rasterize'));
  const l = (await state(page)).layers[0];
  expect(l.kind).toBe('raster');
  expect(await layerAlpha(page, 200, 150)).toBeGreaterThan(200);
  await page.mouse.click(at.x, at.y);
  expect(await layerAlpha(page, 50, 50)).toBe(255);
});

test('Move layer, ⌘T and Flip move vector lines, not pixels; Select overlapping vectors', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__madPaint.actions.addVectorLayer());
  await thinPen(page);
  await drag(page, [100, 100], [160, 100], 8);
  await drag(page, [100, 200], [160, 200], 8);
  const first = async () =>
    page.evaluate(() => {
      const s = window.__madPaint.useStore.getState();
      const p = s.doc.layers[0].strokes[0].points;
      return { x: Math.round(p[0].x), y: Math.round(p[0].y), size: s.doc.layers[0].strokes[0].brush.size };
    });
  // Move layer: both lines move by the drag.
  await selectTool(page, 'move');
  await drag(page, [200, 150], [230, 170], 6);
  expect(await first()).toEqual({ x: 130, y: 120, size: 6 });
  expect(await layerAlpha(page, 150, 120)).toBeGreaterThan(200);
  // ⌘T, drag inside the box (beside the reference point in the middle), Enter.
  await page.keyboard.press('ControlOrMeta+t');
  await drag(page, [150, 180], [150, 200], 6);
  await page.keyboard.press('Enter');
  expect(await first()).toEqual({ x: 130, y: 140, size: 6 });
  await page.keyboard.press('ControlOrMeta+z');
  expect(await first()).toEqual({ x: 130, y: 120, size: 6 });
  // Flip horizontal mirrors the lines around the canvas centre (x → 400 − x).
  await page.evaluate(() => window.__madPaint.runCommand('flipLayerH'));
  expect((await first()).x).toBe(270);
  // A selection over the lower line selects only that line.
  await page.evaluate(() => {
    const a = window.__madPaint.actions;
    a.setSelection({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => (Math.floor(i / 400) > 180 ? 255 : 0)) });
    window.__madPaint.runCommand('selectOverlappingVectors');
  });
  const picked = await page.evaluate(() => {
    const s = window.__madPaint.useStore.getState();
    return { tool: s.tool, ids: s.selectedObjects, lower: s.doc.layers[0].strokes[1].id };
  });
  expect(picked.tool).toBe('object');
  expect(picked.ids).toEqual([picked.lower]);
  expect(errors).toEqual([]);
});

/** Opaque pixels of the active layer inside a rectangle. */
const inkIn = (page: Page, x: number, y: number, w: number, h: number) =>
  page.evaluate(
    ([rx, ry, rw, rh]) => {
      const m = window.__madPaint;
      const id = m.useStore.getState().activeLayerId;
      let n = 0;
      for (let yy = ry; yy < ry + rh; yy += 2) for (let xx = rx; xx < rx + rw; xx += 2) if ((m.engine.sampleLayer(id, xx, yy)?.[3] ?? 0) > 100) n++;
      return n;
    },
    [x, y, w, h],
  );

test('text tool: type, confirm, edit, cancel; the text layer is named after its text', async ({ page }) => {
  const errors = await boot(page);
  await page.keyboard.press('t');
  expect((await state(page)).tool).toBe('text');
  const at = await docToScreen(page, 60, 100);
  await page.mouse.click(at.x, at.y);
  const editor = page.getByTestId('text-editor');
  await expect(editor).toBeFocused();
  await page.keyboard.type('Hi there');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(editor).toHaveCount(0);
  let l = (await state(page)).layers[0];
  expect(l).toMatchObject({ kind: 'text', name: 'Hi there' });
  expect(l.texts[0].text).toBe('Hi there');
  expect(await inkIn(page, 55, 85, 120, 30)).toBeGreaterThan(20);
  // Clicking the text edits it; a click outside confirms.
  await page.mouse.click(at.x + 10, at.y);
  await expect(editor).toHaveValue('Hi there');
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  const outside = await docToScreen(page, 300, 250);
  await page.mouse.click(outside.x, outside.y);
  await expect(editor).toHaveCount(0);
  l = (await state(page)).layers[0];
  expect(l.texts[0].text).toBe('Hi there!');
  expect(l.name).toBe('Hi there!');
  await page.keyboard.press('ControlOrMeta+z');
  expect((await state(page)).layers[0].texts[0].text).toBe('Hi there');
  // Esc cancels.
  await page.mouse.click(at.x + 10, at.y);
  await page.keyboard.type('xyz');
  await page.keyboard.press('Escape');
  expect((await state(page)).layers[0].texts[0].text).toBe('Hi there');
  // Tool Settings change the text being edited: size and bold.
  await page.mouse.click(at.x + 10, at.y);
  await page.getByRole('button', { name: 'Tool Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Bold' }).click();
  await page.getByRole('button', { name: 'Confirm text' }).click();
  expect((await state(page)).layers[0].texts[0].bold).toBe(true);
  // Removing all the text removes the layer.
  await page.mouse.click(at.x + 10, at.y);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('ControlOrMeta+Enter');
  expect((await state(page)).layers.some((x: any) => x.kind === 'text')).toBe(false);
  expect(errors).toEqual([]);
});

test('balloons: drawn over text, with a tail; the Object tool moves balloon and text; saved', async ({ page }) => {
  const errors = await boot(page);
  await selectTool(page, 'text');
  const at = await docToScreen(page, 150, 120);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.type('Wow');
  await page.keyboard.press('ControlOrMeta+Enter');
  await useSubTool(page, 'balloon', 'balloon-ellipse');
  await drag(page, [100, 80], [260, 180], 8);
  let l = (await state(page)).layers[0];
  expect(l.balloons).toHaveLength(1);
  await expect(page.getByTestId('balloon-icon')).toHaveCount(1);
  // The text is centred in the balloon.
  const t = l.texts[0];
  expect(t.x + t.w / 2).toBeCloseTo(180, 0);
  expect(t.y + t.h / 2).toBeCloseTo(130, 0);
  await useSubTool(page, 'balloon', 'balloon-tail');
  await drag(page, [180, 160], [120, 260], 8);
  l = (await state(page)).layers[0];
  expect(l.balloons[0].tails).toHaveLength(1);
  // The tail is drawn.
  expect(await inkIn(page, 115, 230, 30, 30)).toBeGreaterThan(3);
  // Object tool: drag the balloon (outside the text) – the text goes along.
  await selectTool(page, 'object');
  await drag(page, [120, 130], [150, 150], 8);
  l = (await state(page)).layers[0];
  // Moved by the drag (30, 20), give or take the pointer's rounding.
  expect(Math.abs(l.balloons[0].x - 130)).toBeLessThan(2.5);
  expect(Math.abs(l.texts[0].x + l.texts[0].w / 2 - 210)).toBeLessThan(2.5);
  // Saved and opened again.
  const back = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'balloons.madpaint', data: await m.buildDocumentBytes() });
    const x = m.useStore.getState().doc.layers[0];
    return { kind: x.kind, texts: x.texts.map((y: any) => y.text), balloons: x.balloons.length, tails: x.balloons[0].tails.length };
  });
  expect(back).toEqual({ kind: 'text', texts: ['Wow'], balloons: 1, tails: 1 });
  // Drawing tools refuse text layers; Rasterize converts them.
  await thinPen(page);
  await drag(page, [20, 20], [60, 20], 4);
  expect((await state(page)).hint).toMatch(/Text layers cannot be drawn on/);
  await page.evaluate(() => window.__madPaint.runCommand('rasterize'));
  expect((await state(page)).layers[0].kind).toBe('raster');
  expect(errors).toEqual([]);
});

test('comic frames: frame border folder, divide with gutters, content shows only inside, Object tool, saved', async ({ page }) => {
  const errors = await boot(page);
  // Layer > New frame border folder: one frame 15 px inside the canvas (5 % of 300).
  await page.evaluate(() => window.__madPaint.runCommand('newFrameFolder'));
  await page.getByRole('dialog', { name: 'New frame border folder' }).getByRole('button', { name: 'OK' }).click();
  let layers = (await state(page)).layers;
  expect(layers[0].frame.panels[0].points[0]).toEqual({ x: 15, y: 15 });
  await expect(page.getByTestId('frame-icon')).toHaveCount(1);
  // Divide it with a cut across: two frame border folders with a gutter between them.
  await useSubTool(page, 'frame', 'frame-divide');
  await drag(page, [5, 150], [395, 150], 8);
  layers = (await state(page)).layers;
  expect(layers.filter((l: any) => l.frame)).toHaveLength(2);
  const top = layers.find((l: any) => l.frame && l.frame.panels[0].points[0].y < 20);
  const bottomY = Math.min(...layers.find((l: any) => l.frame && l !== top).frame.panels[0].points.map((p: any) => p.y));
  const topY = Math.max(...top.frame.panels[0].points.map((p: any) => p.y));
  expect(bottomY - topY).toBeGreaterThan(8);
  // A layer in the top frame shows only inside it.
  await page.evaluate((id) => {
    const a = window.__madPaint.actions;
    a.selectLayer(id);
    a.addRasterLayer();
  }, top.id);
  await thinPen(page);
  await drag(page, [100, 60], [100, 260], 12);
  expect(await layerAlpha(page, 100, 240)).toBeGreaterThan(200);
  expect(await shown(page, 100, 100)).toBeLessThan(60);
  expect(await shown(page, 100, 240)).toBe(255);
  // The border is drawn.
  expect(await shown(page, 15, 100)).toBeLessThan(60);
  // Object tool: drag the bottom frame by its border.
  await selectTool(page, 'object');
  await drag(page, [15, 220], [35, 220], 6);
  const moved = Math.min(...(await state(page)).layers.find((l: any) => l.frame && l.id !== top.id).frame.panels[0].points.map((p: any) => p.x));
  expect(Math.abs(moved - 35)).toBeLessThan(2.5);
  // Divide equally (Layer > Ruler/Frame).
  await page.evaluate((id) => window.__madPaint.actions.selectLayer(id), top.id);
  await page.evaluate(() => window.__madPaint.runCommand('divideFrame'));
  const dlg = page.getByRole('dialog', { name: 'Divide frame border equally' });
  await dlg.getByLabel('Vertical divisions (columns)').fill('2');
  await dlg.getByLabel('Horizontal divisions (rows)').fill('1');
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect((await state(page)).layers.filter((l: any) => l.frame)).toHaveLength(3);
  // Saved and opened again.
  const back = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'frames.madpaint', data: await m.buildDocumentBytes() });
    return m.useStore.getState().doc.layers.filter((l: any) => l.frame).length;
  });
  expect(back).toBe(3);
  expect(errors).toEqual([]);
});

/** Share of dark displayed pixels in a region. */
const darkShare = (page: Page, x: number, y: number, w: number, h: number) =>
  page.evaluate(
    ([rx, ry, rw, rh]) => {
      const m = window.__madPaint;
      let dark = 0;
      let n = 0;
      for (let yy = ry; yy < ry + rh; yy++)
        for (let xx = rx; xx < rx + rw; xx++) {
          n++;
          if (m.engine.sampleDisplayed(xx, yy, '#ffffff')[0] < 128) dark++;
        }
      return dark / n;
    },
    [x, y, w, h],
  );

test('screentones: the Tone effect turns grey into dots; New tone makes a masked tone layer', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const a = window.__madPaint.actions;
    a.setDrawingColor('#808080');
    a.fillWithColor();
  });
  // Grey before; then dots of about half black.
  expect(await darkShare(page, 100, 100, 40, 40)).toBe(0);
  await page.getByRole('button', { name: 'Tone', exact: true }).click();
  await expect(page.getByTestId('tone-settings')).toBeVisible();
  const half = await darkShare(page, 100, 100, 40, 40);
  expect(half).toBeGreaterThan(0.35);
  expect(half).toBeLessThan(0.65);
  // Hide that layer; a 20 % tone layer in a selection.
  await page.evaluate(() => {
    const m = window.__madPaint;
    const s = m.useStore.getState();
    m.actions.setLayerProps(s.activeLayerId, { visible: false }, 'Hide');
    m.actions.setSelection({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => (i % 400 < 200 ? 255 : 0)) });
    m.runCommand('newTone');
  });
  const dlg = page.getByRole('dialog', { name: 'Simple tone settings' });
  await dlg.getByLabel('Density (%)').fill('20');
  await dlg.getByRole('button', { name: 'OK' }).click();
  const l = (await state(page)).layers[0];
  expect(l.name).toMatch(/line 20%/);
  // Like the reference: a fill layer (black) with the tone effect and a mask.
  expect([l.kind, l.color]).toEqual(['fill', '#000000']);
  expect(l.mask).toBeTruthy();
  const inside = await darkShare(page, 60, 100, 40, 40);
  expect(inside).toBeGreaterThan(0.1);
  expect(inside).toBeLessThan(0.3);
  expect(await darkShare(page, 300, 100, 40, 40)).toBe(0);
  // Saved with the document.
  const back = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'tone.madpaint', data: await m.buildDocumentBytes() });
    return m.useStore.getState().doc.layers[0].effects.tone;
  });
  expect(back).toMatchObject({ enabled: true, density: 'fixed', value: 20 });
  expect(errors).toEqual([]);
});

/** Displayed RGB at a point. */
const rgbAt = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => window.__madPaint.engine.sampleDisplayed(px, py, '#ffffff').slice(0, 3), [x, y]);

test('expression color (gray, monochrome) and mask expression (no gradients, threshold)', async ({ page }) => {
  const errors = await boot(page);
  // A red layer over the whole canvas.
  await page.evaluate(() => {
    const m = window.__madPaint;
    m.actions.setDrawingColor('#ff0000');
    m.actions.fillWithColor();
  });
  const prop = page.getByTestId('layer-property');
  expect(await rgbAt(page, 200, 150)).toEqual([255, 0, 0]);
  // Expression color: Gray, then Monochrome (red is darker than the colour threshold: black).
  await prop.getByLabel('Expression color').selectOption('gray');
  expect(await rgbAt(page, 200, 150)).toEqual([76, 76, 76]);
  await prop.getByLabel('Expression color').selectOption('mono');
  expect(await rgbAt(page, 200, 150)).toEqual([0, 0, 0]);
  await prop.getByRole('spinbutton', { name: 'Color threshold' }).fill('50');
  expect(await rgbAt(page, 200, 150)).toEqual([255, 255, 255]);
  // Only black shows: the white becomes transparent (with the paper hidden, the backdrop shows).
  await page.evaluate(() => window.__madPaint.actions.setPaper({ visible: false }));
  await prop.getByLabel('White', { exact: true }).uncheck();
  expect(await page.evaluate(() => window.__madPaint.engine.sampleDisplayed(200, 150, '#00ff00'))).toEqual([0, 255, 0, 255]);
  await page.evaluate(() => window.__madPaint.actions.setPaper({ visible: true }));
  // Color brings the colours back.
  await prop.getByLabel('Expression color').selectOption('color');
  expect(await rgbAt(page, 200, 150)).toEqual([255, 0, 0]);

  // A mask that fades from left (hidden) to right (shown).
  await page.evaluate(() => {
    const m = window.__madPaint;
    m.actions.setSelection({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => Math.round(((i % 400) / 399) * 255)) });
    m.runCommand('maskOutside');
  });
  await page.keyboard.press('ControlOrMeta+d');
  const faded = await rgbAt(page, 100, 150);
  expect(faded[0]).toBe(255);
  expect(faded[1]).toBeGreaterThan(150);
  expect(faded[1]).toBeLessThan(230);
  // With the mask selected the palette shows Mask expression: without gradients it shows fully or not at all.
  await page.getByTestId('mask-thumb').click();
  await expect(prop.getByTestId('mask-expression')).toBeVisible();
  await prop.getByLabel('Show gradients').selectOption('no');
  expect(await rgbAt(page, 100, 150)).toEqual([255, 255, 255]);
  expect(await rgbAt(page, 300, 150)).toEqual([255, 0, 0]);
  await prop.getByRole('spinbutton', { name: 'Threshold' }).fill('50');
  expect(await rgbAt(page, 100, 150)).toEqual([255, 0, 0]);
  expect(await rgbAt(page, 30, 150)).toEqual([255, 255, 255]);
  // Saved and opened again.
  const back = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'mask.madpaint', data: await m.buildDocumentBytes() });
    const l = m.useStore.getState().doc.layers[0];
    return { gradients: l.mask.gradients, threshold: l.mask.threshold };
  });
  expect(back).toEqual({ gradients: false, threshold: 50 });
  expect(await rgbAt(page, 100, 150)).toEqual([255, 0, 0]);
  expect(errors).toEqual([]);
});

test('fill layers: one colour in the selection; its colour from Color settings, the thumbnail, the Object tool and the colour palettes; saved', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => delete (window as any).showSaveFilePicker);
  // The left half selected; Layer > New Layer > Fill in red.
  await page.evaluate(() => {
    const m = window.__madPaint;
    m.actions.setSelection({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => (i % 400 < 200 ? 255 : 0)) });
    m.runCommand('newFillLayer');
  });
  const dlg = page.getByRole('dialog', { name: 'Color settings' });
  await dlg.getByLabel('Hex').fill('#ff0000');
  await dlg.getByRole('button', { name: 'OK' }).click();
  const top = () =>
    page.evaluate(() => {
      const l = window.__madPaint.useStore.getState().doc.layers[0];
      return { kind: l.kind, name: l.name, color: l.color, mask: Boolean(l.mask) };
    });
  expect(await top()).toEqual({ kind: 'fill', name: 'Fill 1', color: '#ff0000', mask: true });
  await expect(page.getByTestId('fill-icon')).toHaveCount(1);
  expect(await rgbAt(page, 100, 150)).toEqual([255, 0, 0]);
  expect(await rgbAt(page, 300, 150)).toEqual([255, 255, 255]);
  // It cannot be drawn on (its mask can).
  await page.keyboard.press('ControlOrMeta+d');
  await thinPen(page);
  await drag(page, [250, 100], [350, 100]);
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().hint)).toMatch(/Fill layers cannot be drawn on/);
  expect(await rgbAt(page, 300, 100)).toEqual([255, 255, 255]);
  // Double-clicking the thumbnail: blue.
  await page.getByTestId('fill-thumb').dblclick();
  await expect(dlg.getByLabel('Hex')).toHaveValue('#ff0000');
  await dlg.getByLabel('R', { exact: true }).fill('0');
  await dlg.getByLabel('B', { exact: true }).fill('255');
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect((await top()).color).toBe('#0000ff');
  expect(await rgbAt(page, 100, 150)).toEqual([0, 0, 255]);
  // Object tool: Tool Settings > Fill color; a colour picked in the Color Set palette fills it.
  await selectTool(page, 'object');
  await page.getByRole('button', { name: 'Tool Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fill color' })).toBeVisible();
  await page.getByTestId('color-set').getByRole('button', { name: '#43a047' }).click();
  expect((await top()).color).toBe('#43a047');
  expect(await rgbAt(page, 100, 150)).toEqual([0x43, 0xa0, 0x47]);
  await page.evaluate(() => window.__madPaint.actions.undo());
  expect((await top()).color).toBe('#0000ff');
  // Saved as .madpaint and as .psd (a Photoshop fill layer): still a fill layer.
  const reopened = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'fill.madpaint', data: await m.buildDocumentBytes() });
    const l = m.useStore.getState().doc.layers[0];
    return [l.kind, l.color];
  });
  expect(reopened).toEqual(['fill', '#0000ff']);
  expect(await rgbAt(page, 100, 150)).toEqual([0, 0, 255]);
  await page.evaluate(() => window.__madPaint.runCommand('saveDuplicatePsd'));
  const [psd] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog', { name: 'Export settings' }).getByRole('button', { name: 'OK' }).click()]);
  const fromPsd = await page.evaluate(async (data) => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'fill.psd', data: new Uint8Array(data) });
    const l = m.useStore.getState().doc.layers[0];
    return [l.kind, l.color, Boolean(l.mask)];
  }, [...readFileSync((await psd.path())!)]);
  expect(fromPsd).toEqual(['fill', '#0000ff', true]);
  expect(await rgbAt(page, 100, 150)).toEqual([0, 0, 255]);
  expect(await rgbAt(page, 300, 150)).toEqual([255, 255, 255]);
  expect(errors).toEqual([]);
});

test('gradients: shapes and edge rules, the Edit gradient dialog, editable gradient layers', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__madPaint.actions.setColor({ main: '#ff0000', sub: '#0000ff' }));
  // Circle, "Do not draw": only inside the dragged radius.
  await useSubTool(page, 'gradient', 'grad-circle');
  await page.getByRole('button', { name: 'Tool Settings', exact: true }).click();
  await page.getByLabel('Edge process').selectOption('clear');
  await drag(page, [200, 150], [260, 150], 6);
  expect(await layerAlpha(page, 200, 150)).toBe(255);
  expect(await layerAlpha(page, 300, 150)).toBe(0);
  expect((await rgbAt(page, 201, 150))[0]).toBeGreaterThan(200);
  await page.keyboard.press('ControlOrMeta+z');
  // Edit gradient: load a preset from the list.
  await useSubTool(page, 'gradient', 'grad-background');
  await page.getByRole('button', { name: 'Advanced settings…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Edit gradient' });
  await dlg.getByRole('option', { name: 'Moonlight' }).click();
  await dlg.getByRole('button', { name: 'Load to gradient bar' }).click();
  await dlg.getByRole('button', { name: 'OK' }).click();
  const stops = await page.evaluate(() => window.__madPaint.useStore.getState().subTools.find((t: any) => t.id === 'grad-background').gradient.stops);
  expect(stops).toHaveLength(3);
  // A gradient layer: drawn with the tool, its direction changed by dragging again.
  await useSubTool(page, 'gradient', 'grad-layer');
  await drag(page, [0, 150], [400, 150], 6);
  let l = (await state(page)).layers[0];
  expect(l.kind).toBe('gradient');
  await expect(page.getByTestId('gradient-icon')).toHaveCount(1);
  const leftBefore = await rgbAt(page, 5, 150);
  expect(leftBefore[0]).toBeGreaterThan(200);
  await drag(page, [400, 150], [0, 150], 6);
  l = (await state(page)).layers[0];
  expect(l.gradient.a.x).toBeGreaterThan(390);
  expect((await rgbAt(page, 5, 150))[2]).toBeGreaterThan(200);
  // Object tool: drag the end handle; undo restores it.
  await selectTool(page, 'object');
  await drag(page, [0, 150], [0, 50], 6);
  expect((await state(page)).layers[0].gradient.b.y).toBeLessThan(60);
  await page.keyboard.press('ControlOrMeta+z');
  expect((await state(page)).layers[0].gradient.b.y).toBeCloseTo(150, 0);
  // Saved and opened again.
  const back = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'gradient.madpaint', data: await m.buildDocumentBytes() });
    return m.useStore.getState().doc.layers[0].kind;
  });
  expect(back).toBe('gradient');
  expect(errors).toEqual([]);
});

test('Photoshop documents keep text editable and layer styles; the Layer Property palette edits styles', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => delete (window as any).showSaveFilePicker);
  // A text layer.
  await page.keyboard.press('t');
  const at = await docToScreen(page, 60, 100);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.type('Hello PSD');
  await page.keyboard.press('ControlOrMeta+Enter');
  // A black square with a drop shadow from the Layer Property palette.
  await page.evaluate(() => {
    const a = window.__madPaint.actions;
    a.setLayerProps(a.addRasterLayer(), { name: 'Square' });
  });
  await selectTool(page, 'select');
  await drag(page, [250, 150], [330, 230]);
  await fillBlack(page);
  await page.keyboard.press('ControlOrMeta+d');
  expect(await shown(page, 300, 234)).toBe(255);
  await page.getByTestId('layer-styles').getByRole('button', { name: 'Add…' }).click();
  await page.getByRole('menuitem', { name: 'Drop shadow' }).click();
  await expect(page.getByTestId('style-dropShadow')).toBeVisible();
  // Light from the upper left: the shadow falls down and to the right of the square.
  const shadow = await shown(page, 300, 234);
  expect(shadow).toBeLessThan(220);
  expect(await shown(page, 300, 146)).toBe(255);
  // Save as PSD and open it again.
  await page.evaluate(() => window.__madPaint.runCommand('saveDuplicatePsd'));
  const dlg = page.getByRole('dialog', { name: 'Export settings' });
  const [download] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'OK' }).click()]);
  const psd = readFileSync((await download.path())!);
  const chooser = page.waitForEvent('filechooser');
  await page.evaluate(() => void window.__madPaint.runCommand('open'));
  await page.getByRole('dialog', { name: 'Unsaved changes' }).getByRole('button', { name: 'Discard' }).click();
  await (await chooser).setFiles({ name: 'Text.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: psd });
  await expect.poll(async () => (await state(page)).layers.map((l: any) => l.name)).toEqual(['Square', 'Hello PSD', 'Layer 1']);
  const { layers } = await state(page);
  expect(layers[1]).toMatchObject({ kind: 'text', texts: [{ text: 'Hello PSD' }] });
  expect(layers[0].effects.dropShadow).toMatchObject({ enabled: true, angle: 120, distance: 8 });
  expect(Math.abs((await shown(page, 300, 234)) - shadow)).toBeLessThan(4);
  // The text is still text: the Object tool edits it with a double-click.
  await page.evaluate(() => window.__madPaint.actions.selectLayer(window.__madPaint.useStore.getState().doc.layers[1].id));
  await page.keyboard.press('t');
  await page.mouse.click(at.x + 10, at.y);
  await expect(page.getByTestId('text-editor')).toHaveValue('Hello PSD');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('Photoshop documents: Save duplicate as .psd keeps the layers, File > Open reads them back', async ({ page }) => {
  const errors = await boot(page);
  // No save picker in tests: saving falls back to a download.
  await page.evaluate(() => delete (window as any).showSaveFilePicker);
  // Bottom layer: black, masked outside a square.
  await fillBlack(page);
  await selectTool(page, 'select');
  await drag(page, [100, 100], [200, 200]);
  await page.getByRole('button', { name: 'Mask outside selection' }).click();
  await page.keyboard.press('ControlOrMeta+d');
  // A vector line on a 50 % Multiply layer (rasterized in the PSD) and a draft layer (left out).
  await page.getByRole('button', { name: 'New vector layer' }).click();
  await thinPen(page);
  await drag(page, [50, 250], [350, 250], 10);
  await page.evaluate(() => {
    const a = window.__madPaint.actions;
    const s = window.__madPaint.useStore.getState();
    a.setLayerProps(s.activeLayerId, { blend: 'multiply', opacity: 0.5, name: 'Lines' });
    a.setLayerProps(a.addRasterLayer(), { draft: true, name: 'Sketch' });
  });

  // File > Save duplicate > .psd: drafts are not output by default.
  await page.evaluate(() => window.__madPaint.runCommand('saveDuplicatePsd'));
  const dlg = page.getByRole('dialog', { name: 'Export settings' });
  await expect(dlg.getByLabel('Draft layers')).not.toBeChecked();
  const [download] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'OK' }).click()]);
  expect(download.suggestedFilename()).toBe('Test.psd');
  const psd = readFileSync((await download.path())!);
  expect(psd.subarray(0, 4).toString('latin1')).toBe('8BPS');

  // File > Open: the unsaved canvas is discarded, the PSD opens with its layers.
  const chooser = page.waitForEvent('filechooser');
  // Not awaited: the command waits for the confirmation and the file chooser.
  await page.evaluate(() => void window.__madPaint.runCommand('open'));
  await page.getByRole('dialog', { name: 'Unsaved changes' }).getByRole('button', { name: 'Discard' }).click();
  await (await chooser).setFiles({ name: 'Test.psd', mimeType: 'image/vnd.adobe.photoshop', buffer: psd });
  await expect.poll(async () => (await state(page)).layers.map((l: any) => l.name)).toEqual(['Lines', 'Layer 1']);
  const { layers } = await state(page);
  expect(layers.map((l: any) => [l.kind, l.blend, Math.round(l.opacity * 100), Boolean(l.mask)])).toEqual([
    ['raster', 'multiply', 50, false],
    ['raster', 'normal', 100, true],
  ]);
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().doc.paper)).toEqual({ visible: true, color: '#ffffff' });
  // The mask still hides the black outside the square; the line shows at half strength.
  expect(await shown(page, 150, 150)).toBe(0);
  expect(await shown(page, 50, 50)).toBe(255);
  const line = await shown(page, 200, 250);
  expect(line).toBeGreaterThan(90);
  expect(line).toBeLessThan(170);

  // File > Export (single layer) > .psd, output as background: one opaque layer.
  await page.evaluate(() => window.__madPaint.runCommand('export-psd'));
  const ex = page.getByRole('dialog', { name: 'Photoshop document export settings' });
  await ex.getByLabel('Output as background').check();
  await expect(ex.getByText('Export transparency')).toHaveCount(0);
  const [flat] = await Promise.all([page.waitForEvent('download'), ex.getByRole('button', { name: 'OK' }).click()]);
  const flatBytes = [...readFileSync((await flat.path())!)];
  const opened = await page.evaluate(async (data) => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'flat.psd', data: new Uint8Array(data) });
    const s = m.useStore.getState();
    return { names: s.doc.layers.map((l: any) => l.name), centre: m.engine.sampleDisplayed(150, 150, '#ffffff')[0] };
  }, flatBytes);
  expect(opened).toEqual({ names: ['Background'], centre: 0 });
  expect(errors).toEqual([]);
});

/** Tags of a little-endian baseline TIFF and the RGB(A) bytes of its pixel at x, y. */
function tiffInfo(t: Buffer, x: number, y: number) {
  const ifd = t.readUInt32LE(4);
  const tags = new Map<number, number>();
  for (let i = 0; i < t.readUInt16LE(ifd); i++) {
    const o = ifd + 2 + i * 12;
    const type = t.readUInt16LE(o + 2);
    tags.set(t.readUInt16LE(o), type === 3 ? t.readUInt16LE(o + 8) : t.readUInt32LE(o + 8));
  }
  const w = tags.get(256)!;
  const spp = tags.get(277)!;
  const at = tags.get(273)! + (y * w + x) * spp;
  return { width: w, height: tags.get(257)!, dpi: t.readUInt32LE(tags.get(282)!) / t.readUInt32LE(tags.get(282)! + 4), pixel: [...t.subarray(at, at + spp)] };
}

test('export (single layer): formats, output image, export range, expression color, output size, resolution, preview', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => delete (window as any).showSaveFilePicker);
  // Text at the top left; a black square (still selected) on its own layer.
  await page.keyboard.press('t');
  const at = await docToScreen(page, 40, 60);
  await page.mouse.click(at.x, at.y);
  await page.keyboard.type('Hello');
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.evaluate(() => {
    const m = window.__madPaint;
    m.actions.setLayerProps(m.actions.addRasterLayer(), { name: 'Square' });
    // Selected: x 200…299, y 100…199.
    const data = new Uint8Array(400 * 300);
    for (let y = 100; y < 200; y++) data.fill(255, y * 400 + 200, y * 400 + 300);
    m.useStore.setState({ selection: { width: 400, height: 300, data } });
  });
  await fillBlack(page);
  const save = async (dialog: ReturnType<Page['getByRole']>) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'OK' }).click()]);
    return { name: dl.suggestedFilename(), bytes: readFileSync((await dl.path())!) };
  };

  // TIFF: the selection, at 144 dpi (twice the pixels), in grey.
  await page.evaluate(() => window.__madPaint.runCommand('export-tiff'));
  const tiff = page.getByRole('dialog', { name: 'TIFF export settings' });
  await expect(tiff.getByText('Export transparency')).toHaveCount(0);
  await tiff.getByLabel('Export range').selectOption('selection');
  await expect(tiff.getByTestId('export-size')).toHaveText('100 × 100 px · 72 dpi');
  await tiff.getByLabel('Specify resolution').check();
  await tiff.getByLabel('Resolution', { exact: true }).fill('144');
  await expect(tiff.getByTestId('export-size')).toHaveText('200 × 200 px · 144 dpi');
  await tiff.getByLabel('Expression color').selectOption('gray');
  const t = await save(tiff);
  expect(t.name).toBe('Test.tif');
  expect(tiffInfo(t.bytes, 100, 100)).toEqual({ width: 200, height: 200, dpi: 144, pixel: [0, 0, 0] });

  // PNG: half size, without the text, duotone, transparent; Export preview first.
  await page.evaluate(() => window.__madPaint.runCommand('export-png'));
  const png = page.getByRole('dialog', { name: 'PNG export settings' });
  await png.getByLabel('Scale ratio from original data').check();
  await png.getByLabel('Scale ratio', { exact: true }).fill('50');
  await expect(png.getByTestId('export-size')).toHaveText('200 × 150 px · 72 dpi');
  await png.getByLabel('Text', { exact: true }).uncheck();
  await png.getByLabel('Expression color').selectOption('threshold');
  await png.getByLabel('Export transparency').check();
  await png.getByLabel('Preview rendering result on output').check();
  await png.getByRole('button', { name: 'OK' }).click();
  const preview = page.getByRole('dialog', { name: 'Export preview' });
  await expect(preview.getByTestId('export-file-size')).toContainText('[KByte]');
  await expect(preview.locator('img')).toHaveCount(1);
  const p = await save(preview);
  expect(p.name).toBe('Test.png');
  // pHYs: 72 dpi = 2835 pixels per metre.
  const phys = p.bytes.indexOf(Buffer.from('pHYs'));
  expect(phys).toBe(37);
  expect([p.bytes.readUInt32BE(phys + 4), p.bytes[phys + 12]]).toEqual([2835, 1]);
  const px = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    const pick = (x: number, y: number) => [...g.getImageData(x, y, 1, 1).data];
    let text = 0;
    const d = g.getImageData(15, 15, 40, 25).data;
    for (let i = 3; i < d.length; i += 4) text = Math.max(text, d[i]);
    return { size: [bmp.width, bmp.height], square: pick(125, 75), outside: pick(180, 140), text };
  }, p.bytes.toString('base64'));
  expect(px).toEqual({ size: [200, 150], square: [0, 0, 0, 255], outside: [0, 0, 0, 0], text: 0 });

  // JPEG: the preview's quality changes the file size; the file says 72 dpi.
  await page.evaluate(() => window.__madPaint.runCommand('export-jpeg'));
  const jpeg = page.getByRole('dialog', { name: 'JPEG export settings' });
  await jpeg.getByLabel('Quality').fill('90');
  await expect(jpeg.getByLabel('Preview rendering result on output')).toBeChecked();
  await jpeg.getByRole('button', { name: 'OK' }).click();
  await expect(preview.getByTestId('export-file-size')).not.toContainText('…');
  const big = await preview.getByTestId('export-file-size').textContent();
  await preview.getByLabel('Quality').fill('10');
  await expect(preview.getByTestId('export-file-size')).not.toHaveText(big!);
  const j = await save(preview);
  expect(j.name).toBe('Test.jpg');
  expect([j.bytes[0], j.bytes[1], j.bytes.subarray(6, 10).toString('latin1'), j.bytes[13], j.bytes.readUInt16BE(14)]).toEqual([0xff, 0xd8, 'JFIF', 1, 72]);

  // BMP and Targa without preview; Save duplicate as .psb.
  await page.evaluate(() => window.__madPaint.runCommand('export-bmp'));
  const bmp = page.getByRole('dialog', { name: 'BMP export settings' });
  await bmp.getByLabel('Preview rendering result on output').uncheck();
  const b = await save(bmp);
  expect([b.name, b.bytes.subarray(0, 2).toString('latin1')]).toEqual(['Test.bmp', 'BM']);
  await page.evaluate(() => window.__madPaint.runCommand('export-tga'));
  const g = await save(page.getByRole('dialog', { name: 'Targa export settings' }));
  expect([g.name, g.bytes[2], g.bytes.subarray(g.bytes.length - 18, g.bytes.length - 1).toString('latin1')]).toEqual(['Test.tga', 2, 'TRUEVISION-XFILE.']);
  await page.evaluate(() => window.__madPaint.runCommand('saveDuplicatePsb'));
  const psb = await save(page.getByRole('dialog', { name: 'Export settings' }));
  // Signature 8BPS, version 2 (big document).
  expect([psb.name, psb.bytes.subarray(0, 4).toString('latin1'), psb.bytes.readUInt16BE(4)]).toEqual(['Test.psb', '8BPS', 2]);
  expect(errors).toEqual([]);
});

const frameNow = (page: Page) => page.evaluate(() => window.__madPaint.useStore.getState().frame);
const activeName = (page: Page) =>
  page.evaluate(() => {
    const s = window.__madPaint.useStore.getState();
    const find = (ls: any[]): any => ls.map((l) => (l.id === s.activeLayerId ? l : l.children ? find(l.children) : null)).find(Boolean);
    return find(s.doc.layers)?.name;
  });

test('animation: animated illustration, a cel per frame, onion skin, playback, GIF export, saved', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => delete (window as any).showSaveFilePicker);
  // File > New with "Create animated illustration": 4 cels at 4 fps.
  await page.evaluate(() => void window.__madPaint.runCommand('new'));
  const dlg = page.getByRole('dialog', { name: 'New canvas' });
  await dlg.getByLabel('Width').fill('400');
  await dlg.getByLabel('Height').fill('300');
  await dlg.getByText('Create animated illustration').click();
  await dlg.getByLabel('Number of cels').fill('4');
  await dlg.getByLabel('Frame rate').fill('4');
  await dlg.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('timeline')).toBeVisible();
  await expect(page.getByTestId('animation-icon')).toHaveCount(1);
  expect((await state(page)).layers.map((l: any) => [l.name, l.children.map((c: any) => c.name)])).toEqual([['A', ['1']]]);
  expect(await activeName(page)).toBe('1');
  // Cel 1: a line at y = 100. New animation cel: cel 2 on frame 2, a line at y = 200.
  await thinPen(page);
  await drag(page, [50, 100], [350, 100]);
  await page.getByRole('button', { name: 'New animation cel' }).click();
  expect(await frameNow(page)).toBe(2);
  expect(await activeName(page)).toBe('2');
  await drag(page, [50, 200], [350, 200]);
  // Frame 2 shows cel 2 only; frames 3 and 4 hold it.
  expect(await shown(page, 200, 100)).toBe(255);
  expect(await shown(page, 200, 200)).toBeLessThan(60);
  // Onion skin: cel 1 shows faintly (tinted) under cel 2.
  await page.getByRole('button', { name: 'Enable onion skin' }).click();
  const skin = await shown(page, 200, 100);
  expect(skin).toBeGreaterThan(60);
  expect(skin).toBeLessThan(250);
  await page.getByRole('button', { name: 'Enable onion skin' }).click();
  // Clicking frame 1 on the ruler shows cel 1, which becomes the layer being edited.
  await page.getByTestId('timeline-ruler').locator('.tl-cell').nth(0).click();
  expect(await frameNow(page)).toBe(1);
  expect(await activeName(page)).toBe('1');
  expect(await shown(page, 200, 100)).toBeLessThan(60);
  // Selecting cel 2 in the Layer palette goes to a frame that shows it.
  await page.locator('.layer-row', { hasText: /^.*2$/ }).first().click();
  expect(await frameNow(page)).toBe(2);
  // Frame 4: assign cel 1 from the frame's menu; frame 3 still holds cel 2.
  await page.locator('[data-testid=timeline-track] .tl-cell[data-frame="4"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '1', exact: true }).click();
  expect(await frameNow(page)).toBe(4);
  expect(await shown(page, 200, 100)).toBeLessThan(60);
  await page.getByTestId('timeline-ruler').locator('.tl-cell').nth(2).click();
  expect(await shown(page, 200, 200)).toBeLessThan(60);
  // A cel that is not shown at the current frame cannot be drawn on.
  await page.evaluate(() => {
    const s = window.__madPaint.useStore.getState();
    const cel1 = s.doc.layers[0].children.find((c: any) => c.name === '1');
    window.__madPaint.useStore.setState({ activeLayerId: cel1.id });
  });
  await drag(page, [50, 250], [350, 250]);
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().hint)).toMatch(/not shown at the current frame/);
  // Play: frames advance at 4 fps (looping); Esc stops.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().playing)).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().playing)).toBe(false);
  // File > Export animation > Animated GIF: one image per frame.
  await page.evaluate(() => window.__madPaint.runCommand('exportGif'));
  const ex = page.getByRole('dialog', { name: 'Animated GIF export settings' });
  await expect(ex.getByTestId('export-playback')).toHaveText('Playback time: 1.0 s ( Image number: 4 )');
  const [gif] = await Promise.all([page.waitForEvent('download'), ex.getByRole('button', { name: 'OK' }).click()]);
  expect(gif.suggestedFilename()).toBe('Illustration.gif');
  const bytes = readFileSync((await gif.path())!);
  expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a');
  let images = 0;
  for (let i = 0; i + 2 < bytes.length; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) images++;
  expect(images).toBe(4);
  // Saved and opened again: timeline and assignments are kept.
  const back = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'anim.madpaint', data: await m.buildDocumentBytes() });
    const s = m.useStore.getState();
    const a = s.doc.layers[0];
    return { timeline: s.doc.timeline, cels: a.animation.cels.map((x: any) => [x.frame, a.children.find((c: any) => c.id === x.cel)?.name]) };
  });
  expect(back).toEqual({ timeline: { enabled: true, fps: 4, frames: 4 }, cels: [[1, '1'], [2, '2'], [4, '1']] });
  expect(errors).toEqual([]);
});

/** The top-level chunks of a RIFF file (WebP). */
function riffChunks(b: Buffer, from = 12, to = b.length): { fourcc: string; data: Buffer }[] {
  const out: { fourcc: string; data: Buffer }[] = [];
  for (let p = from; p + 8 <= to; ) {
    const size = b.readUInt32LE(p + 4);
    out.push({ fourcc: b.subarray(p, p + 4).toString('latin1'), data: b.subarray(p + 8, p + 8 + size) });
    p += 8 + size + (size % 2);
  }
  return out;
}

test('animation exports: animated WebP, APNG sticker options, image sequence types', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => delete (window as any).showSaveFilePicker);
  await page.evaluate(() => void window.__madPaint.runCommand('new'));
  const dlg = page.getByRole('dialog', { name: 'New canvas' });
  await dlg.getByLabel('Width').fill('200');
  await dlg.getByLabel('Height').fill('100');
  await dlg.getByText('Create animated illustration').click();
  await dlg.getByLabel('Number of cels').fill('4');
  await dlg.getByLabel('Frame rate').fill('4');
  await dlg.getByRole('button', { name: 'OK' }).click();
  // Cel 1 (frame 1): a line on the left; cel 2 (frames 2–4): a line on the right.
  await thinPen(page);
  await drag(page, [40, 50], [60, 50]);
  await page.getByRole('button', { name: 'New animation cel' }).click();
  await drag(page, [140, 70], [160, 70]);

  // File > Export animation > Animated WebP: half size, two loops, transparent, lossy.
  await page.evaluate(() => window.__madPaint.runCommand('exportWebp'));
  const wp = page.getByRole('dialog', { name: 'Animated WebP export settings' });
  await expect(wp.getByTestId('export-playback')).toHaveText('Playback time: 1.0 s ( Image number: 4 )');
  await expect(wp.getByLabel('Height')).toHaveValue('100');
  await wp.getByLabel('Height').fill('50');
  await expect(wp.getByLabel('Width')).toHaveValue('100');
  await wp.getByLabel('Loop count').selectOption('count');
  await wp.getByLabel('Number of loops').fill('2');
  await wp.getByLabel('Export transparency').check();
  await expect(wp.getByLabel('Quality', { exact: true })).toBeDisabled();
  await wp.getByLabel('Prioritize file size').check();
  await wp.getByLabel('Quality', { exact: true }).fill('80');
  const [webp] = await Promise.all([page.waitForEvent('download'), wp.getByRole('button', { name: 'OK' }).click()]);
  expect(webp.suggestedFilename()).toBe('Illustration.webp');
  const w = readFileSync((await webp.path())!);
  expect([w.subarray(0, 4).toString('latin1'), w.subarray(8, 12).toString('latin1'), w.readUInt32LE(4)]).toEqual(['RIFF', 'WEBP', w.length - 8]);
  const top = riffChunks(w);
  expect(top.map((c) => c.fourcc)).toEqual(['VP8X', 'ANIM', 'ANMF', 'ANMF', 'ANMF', 'ANMF']);
  expect(top[0].data[0] & 0x12).toBe(0x12);
  expect([top[0].data.readUIntLE(4, 3) + 1, top[0].data.readUIntLE(7, 3) + 1]).toEqual([100, 50]);
  expect(top[1].data.readUInt16LE(4)).toBe(2);
  for (const f of top.slice(2)) {
    expect(f.data.readUIntLE(12, 3)).toBe(250);
    // Lossy pictures with an alpha chunk.
    expect(riffChunks(f.data, 16).map((c) => c.fourcc)).toEqual(['ALPH', 'VP8 ']);
  }
  // The browser plays it: 4 frames; frame 1 shows cel 1 only, frame 2 cel 2 only.
  const decoded = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dec = new (window as any).ImageDecoder({ data: bytes, type: 'image/webp' });
    await dec.tracks.ready;
    const alphaNear = async (index: number, x: number, y: number) => {
      const { image } = await dec.decode({ frameIndex: index });
      const c = new OffscreenCanvas(image.displayWidth, image.displayHeight);
      const g = c.getContext('2d')!;
      g.drawImage(image, 0, 0);
      image.close();
      const d = g.getImageData(x - 2, y - 2, 5, 5).data;
      let a = 0;
      for (let i = 3; i < d.length; i += 4) a = Math.max(a, d[i]);
      return a;
    };
    return { frames: dec.tracks.selectedTrack.frameCount, f1: [await alphaNear(0, 25, 25), await alphaNear(0, 75, 35)], f2: [await alphaNear(1, 25, 25), await alphaNear(1, 75, 35)] };
  }, w.toString('base64'));
  expect(decoded.frames).toBe(4);
  expect(decoded.f1[0]).toBeGreaterThan(100);
  expect(decoded.f1[1]).toBe(0);
  expect(decoded.f2[0]).toBe(0);
  expect(decoded.f2[1]).toBeGreaterThan(100);

  // Animated sticker (APNG): always transparent; Delete blank spaces and Color reduction.
  await page.evaluate(() => window.__madPaint.runCommand('exportApng'));
  const ap = page.getByRole('dialog', { name: 'Animated sticker (APNG) export settings' });
  await expect(ap.getByLabel('Export transparency')).toHaveCount(0);
  await ap.getByLabel('Delete blank spaces').check();
  await ap.getByLabel('Color reduction').check();
  const [apng] = await Promise.all([page.waitForEvent('download'), ap.getByRole('button', { name: 'OK' }).click()]);
  const png = readFileSync((await apng.path())!);
  const types: string[] = [];
  for (let p = 8; p < png.length; p += 12 + png.readUInt32BE(p)) types.push(png.subarray(p + 4, p + 8).toString('latin1'));
  expect(types.slice(0, 4)).toEqual(['IHDR', 'PLTE', 'tRNS', 'acTL']);
  // Cropped to both lines (x 40…160, y 50…70 plus the pen's width); indexed colour.
  const [pw, ph] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  expect(pw).toBeGreaterThan(120);
  expect(pw).toBeLessThan(135);
  expect(ph).toBeGreaterThan(20);
  expect(ph).toBeLessThan(35);
  expect(png[25]).toBe(3);

  // Image sequence: file name settings, TIFF pictures; BMP has no transparency.
  await page.evaluate(() => window.__madPaint.runCommand('exportSequence'));
  const sq = page.getByRole('dialog', { name: 'Image sequence export settings' });
  await expect(sq.getByTestId('sequence-name')).toHaveText('Illustration_0001.png');
  await sq.getByLabel('Type').selectOption('bmp');
  await expect(sq.getByLabel('Export transparency')).toHaveCount(0);
  await sq.getByLabel('Type').selectOption('tiff');
  await sq.getByLabel('File prefix').fill('walk');
  await sq.getByLabel('File suffix').fill('x');
  await sq.getByLabel('Separator').fill('-');
  await expect(sq.getByTestId('sequence-name')).toHaveText('walk-0001-x.tif');
  await sq.getByLabel('Export transparency').check();
  const [zip] = await Promise.all([page.waitForEvent('download'), sq.getByRole('button', { name: 'OK' }).click()]);
  const files = unzipSync(readFileSync((await zip.path())!));
  expect(Object.keys(files).sort()).toEqual(['walk-0001-x.tif', 'walk-0002-x.tif', 'walk-0003-x.tif', 'walk-0004-x.tif']);
  const tif = Buffer.from(files['walk-0002-x.tif']);
  expect(tif.subarray(0, 4).toString('latin1')).toBe('II*\0');
  expect(errors).toEqual([]);
});

test('timeline: frame display and division lines, Assign multiple cels, dragging and copying assigned cels and keyframes', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => void window.__madPaint.runCommand('new'));
  const dlg = page.getByRole('dialog', { name: 'New canvas' });
  await dlg.getByLabel('Width').fill('400');
  await dlg.getByLabel('Height').fill('300');
  await dlg.getByText('Create animated illustration').click();
  await dlg.getByLabel('Number of cels').fill('8');
  await dlg.getByLabel('Frame rate').fill('8');
  await dlg.getByRole('button', { name: 'OK' }).click();
  // Cels 1, 2 and 3 (on frames 1, 2 and 3).
  await page.getByRole('button', { name: 'New animation cel' }).first().click();
  await page.getByRole('button', { name: 'New animation cel' }).first().click();
  const cels = () =>
    page.evaluate(() => {
      const a = window.__madPaint.useStore.getState().doc.layers[0];
      return a.animation.cels.map((x: any) => `${x.frame}:${x.cel ? a.children.find((c: any) => c.id === x.cel).name : '-'}`).join(' ');
    });
  expect(await cels()).toBe('1:1 2:2 3:3');
  const ruler = page.getByTestId('timeline-ruler');
  // Change settings: frames as seconds + frame, a division line every 4 frames.
  await page.evaluate(() => window.__madPaint.runCommand('timelineSettings'));
  const settings = page.getByRole('dialog', { name: 'Change timeline settings' });
  await settings.getByLabel('Frame display').selectOption('secframe');
  await settings.getByLabel('Division line').fill('4');
  await settings.getByRole('button', { name: 'OK' }).click();
  await ruler.locator('.tl-cell').nth(2).click();
  await expect(page.getByTestId('timeline-frame')).toHaveText('0+3');
  await expect(ruler.locator('.tl-cell').nth(3)).toHaveClass(/div/);
  await expect(ruler.locator('.tl-cell').nth(0)).toHaveClass(/second/);
  await page.evaluate(() => window.__madPaint.anim.setTimeline({ display: 'timecode' }));
  await expect(page.getByTestId('timeline-frame')).toHaveText('00:00:02');
  // Assign multiple cels from frame 1: cels 1 to 3, two frames each, repeated to the end.
  await ruler.locator('.tl-cell').nth(0).click();
  await page.evaluate(() => window.__madPaint.runCommand('assignMultiple'));
  const am = page.getByRole('dialog', { name: 'Assign multiple cels' });
  await expect(am.getByTestId('assign-multiple-cels')).toHaveText('1, 2, 3');
  await am.getByLabel('Number of frames').fill('2');
  await am.getByLabel('Repeat to end').check();
  await am.getByRole('button', { name: 'OK' }).click();
  expect(await cels()).toBe('1:1 3:2 5:3 7:1');
  // Dragging the cel on frame 3 to frame 4; Alt-dragging the one on frame 5 to frame 6 duplicates it.
  const cell = (f: number) => page.locator(`[data-testid=timeline-track][data-track="A"] .tl-cell[data-frame="${f}"]`);
  const dragCell = async (from: number, to: number, alt = false) => {
    const a = (await cell(from).boundingBox())!;
    const b = (await cell(to).boundingBox())!;
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await page.mouse.up();
    if (alt) await page.keyboard.up('Alt');
  };
  await dragCell(3, 4);
  expect(await cels()).toBe('1:1 4:2 5:3 7:1');
  await dragCell(5, 6, true);
  expect(await cels()).toBe('1:1 4:2 5:3 6:3 7:1');
  // Copy the cels on frames 1 and 4 (Ctrl/⌘-click) and paste them on frame 5.
  await cell(1).click();
  await cell(4).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('[data-testid=timeline-track][data-track="A"] .tl-cell.picked')).toHaveCount(2);
  await page.evaluate(() => window.__madPaint.runCommand('trackCopy'));
  await ruler.locator('.tl-cell').nth(4).click();
  await page.evaluate(() => window.__madPaint.runCommand('trackPaste'));
  expect(await cels()).toBe('1:1 4:2 5:1 6:3 7:1 8:2');
  // Delete: the selected (pasted) cels.
  await page.evaluate(() => window.__madPaint.runCommand('trackDelete'));
  expect(await cels()).toBe('1:1 4:2 6:3 7:1');
  // Keyframes: copied from frame 1, pasted on frame 3.
  await ruler.locator('.tl-cell').nth(0).click();
  await page.getByRole('button', { name: 'Add keyframe' }).click();
  const keyOf = () => page.evaluate(() => window.__madPaint.useStore.getState().doc.layers[0].keys.frames.map((k: any) => k.frame));
  expect(await keyOf()).toEqual([1]);
  await page.locator('[data-testid=timeline-track][data-track="A"] [data-testid=timeline-key][data-frame="1"]').click();
  await page.evaluate(() => window.__madPaint.runCommand('trackCopy'));
  await ruler.locator('.tl-cell').nth(2).click();
  await page.evaluate(() => window.__madPaint.runCommand('trackPaste'));
  expect(await keyOf()).toEqual([1, 3]);
  // Cut moves one: frame 3 → frame 6.
  await page.evaluate(() => window.__madPaint.runCommand('trackCut'));
  await ruler.locator('.tl-cell').nth(5).click();
  await page.evaluate(() => window.__madPaint.runCommand('trackPaste'));
  expect(await keyOf()).toEqual([1, 6]);
  // Saved with the document: display and division line.
  const back = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'tl.madpaint', data: await m.buildDocumentBytes() });
    const t = m.useStore.getState().doc.timeline;
    return [t.display, t.division];
  });
  expect(back).toEqual(['timecode', 4]);
  expect(errors).toEqual([]);
});

test('animation clips: trim, first and last displayed frame, merge, split, move, delete, copy and paste', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => void window.__madPaint.runCommand('new'));
  const dlg = page.getByRole('dialog', { name: 'New canvas' });
  await dlg.getByLabel('Width').fill('400');
  await dlg.getByLabel('Height').fill('300');
  await dlg.getByText('Create animated illustration').click();
  await dlg.getByLabel('Number of cels').fill('8');
  await dlg.getByLabel('Frame rate').fill('8');
  await dlg.getByRole('button', { name: 'OK' }).click();
  const ruler = (f: number) => page.getByTestId('timeline-ruler').locator('.tl-cell').nth(f - 1).click();
  const clips = () => page.evaluate(() => window.__madPaint.useStore.getState().doc.layers[0].clips?.map((c: any) => [c.start, c.end]) ?? null);
  // Cel 1 (a line at y = 100) on frame 1, cel 2 (y = 200) on frame 4.
  await thinPen(page);
  await drag(page, [50, 100], [350, 100]);
  await ruler(4);
  await page.getByRole('button', { name: 'New animation cel' }).click();
  expect(await frameNow(page)).toBe(4);
  await drag(page, [50, 200], [350, 200]);
  const track = page.locator('[data-testid=timeline-track][data-track="A"]');
  const clip = (n: number) => track.getByTestId('timeline-clip').nth(n).locator('.tl-clip-grip');
  // One clip over the whole timeline.
  await expect(track.getByTestId('timeline-clip')).toHaveCount(1);
  expect(await clips()).toBeNull();
  // Trim: the clip's end dragged from frame 8 to frame 6; frame 7 shows nothing and cannot be drawn on.
  const box = (await clip(0).boundingBox())!;
  await page.mouse.move(box.x + box.width - 2, box.y + 3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 50, box.y + 3, { steps: 4 });
  await page.mouse.up();
  expect(await clips()).toEqual([[1, 6]]);
  await ruler(7);
  expect(await shown(page, 200, 200)).toBe(255);
  await drag(page, [50, 250], [350, 250]);
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().hint)).toMatch(/no clip at the current frame/);
  // Set as first displayed frame on frame 8: a new clip shows the last cel.
  await ruler(8);
  await page.evaluate(() => window.__madPaint.runCommand('setFirstDisplayed'));
  expect(await clips()).toEqual([
    [1, 6],
    [8, 8],
  ]);
  expect(await shown(page, 200, 200)).toBeLessThan(60);
  // Set as last displayed frame on frame 3: the clip ends at 2 and goes on from cel 2.
  await ruler(3);
  await page.evaluate(() => window.__madPaint.runCommand('setLastDisplayed'));
  expect(await clips()).toEqual([
    [1, 2],
    [4, 6],
    [8, 8],
  ]);
  expect(await shown(page, 200, 100)).toBe(255);
  // Merge the first two (Ctrl/⌘-click selects both; the frame's pop-up menu merges): frame 3 shows cel 1 again.
  await clip(0).click();
  await clip(1).click({ modifiers: ['ControlOrMeta'] });
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().clipSelection.length)).toBe(2);
  await track.locator('.tl-cell[data-frame="3"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Merge clips' }).click();
  expect(await clips()).toEqual([
    [1, 6],
    [8, 8],
  ]);
  await ruler(3);
  expect(await shown(page, 200, 100)).toBeLessThan(60);
  // Split at frame 5, then drag the second part one frame to the right.
  await ruler(5);
  await page.evaluate(() => window.__madPaint.runCommand('splitClip'));
  expect(await clips()).toEqual([
    [1, 4],
    [5, 6],
    [8, 8],
  ]);
  const part = (await clip(1).boundingBox())!;
  await page.mouse.move(part.x + part.width / 2, part.y + 3);
  await page.mouse.down();
  await page.mouse.move(part.x + part.width / 2 + 26, part.y + 3, { steps: 4 });
  await page.mouse.up();
  expect(await clips()).toEqual([
    [1, 4],
    [6, 7],
    [8, 8],
  ]);
  await ruler(5);
  expect(await shown(page, 200, 200)).toBe(255);
  await ruler(7);
  expect(await shown(page, 200, 200)).toBeLessThan(60);
  // Delete the last clip; copy the first and paste it on frame 5 (over the moved one).
  await clip(2).click();
  await page.evaluate(() => window.__madPaint.runCommand('deleteClip'));
  expect(await clips()).toEqual([
    [1, 4],
    [6, 7],
  ]);
  await clip(0).click();
  await page.evaluate(() => window.__madPaint.runCommand('copyClip'));
  await ruler(5);
  await page.evaluate(() => window.__madPaint.runCommand('pasteClip'));
  expect(await clips()).toEqual([
    [1, 4],
    [5, 8],
  ]);
  await ruler(6);
  expect(await shown(page, 200, 100)).toBeLessThan(60);
  await ruler(8);
  expect(await shown(page, 200, 200)).toBeLessThan(60);
  // The palette's top edge resizes it.
  const edge = (await page.getByRole('separator', { name: 'Resize the Timeline palette' }).boundingBox())!;
  const h0 = await page.evaluate(() => window.__madPaint.useStore.getState().timelineHeight);
  await page.mouse.move(edge.x + 200, edge.y + 3);
  await page.mouse.down();
  await page.mouse.move(edge.x + 200, edge.y - 77, { steps: 4 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().timelineHeight)).toBe(h0 + 80);
  // Undo takes the paste back; clips are saved with the document.
  await page.evaluate(() => window.__madPaint.actions.undo());
  expect(await clips()).toEqual([
    [1, 4],
    [6, 7],
  ]);
  const back = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'clips.madpaint', data: await m.buildDocumentBytes() });
    return m.useStore.getState().doc.layers[0].clips.map((c: any) => [c.start, c.end]);
  });
  expect(back).toEqual([
    [1, 4],
    [6, 7],
  ]);
  expect(errors).toEqual([]);
});

test('keyframes move a track over time; a 2D camera folder frames the output', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => void window.__madPaint.runCommand('new'));
  const dlg = page.getByRole('dialog', { name: 'New canvas' });
  await dlg.getByLabel('Width').fill('400');
  await dlg.getByLabel('Height').fill('300');
  await dlg.getByText('Create animated illustration').click();
  await dlg.getByLabel('Number of cels').fill('8');
  await dlg.getByLabel('Frame rate').fill('8');
  await dlg.getByRole('button', { name: 'OK' }).click();
  const ruler = (f: number) => page.getByTestId('timeline-ruler').locator('.tl-cell').nth(f - 1).click();
  const keysOf = (i = 0) =>
    page.evaluate((n) => {
      const s = window.__madPaint.useStore.getState();
      const find = (ls: any[]): any[] => ls.flatMap((l) => [l, ...(l.children && !l.animation ? find(l.children) : [])]);
      const track = find(s.doc.layers).filter((l) => l.keys)[n];
      return track ? { enabled: track.keys.enabled, frames: track.keys.frames.map((k: any) => [k.frame, Math.round(k.values.x), k.interp]) } : null;
    }, i);
  // A short thick line at x 30 … 90 on cel 1.
  await thinPen(page);
  await page.evaluate(() => {
    const m = window.__madPaint;
    const s = m.useStore.getState();
    const sub = s.subTools.find((t: any) => t.id === s.activeSub.pen);
    m.actions.updateSubTool(sub.id, { brush: { ...sub.brush, size: 20 } });
  });
  await drag(page, [40, 150], [80, 150]);
  // Add keyframe: keyframes turn on for the animation folder, which can no longer be drawn on.
  await page.getByRole('button', { name: 'Add keyframe' }).click();
  expect(await keysOf()).toEqual({ enabled: true, frames: [[1, 0, 'linear']] });
  await expect(page.locator('[data-testid=timeline-track][data-track="A"] [data-testid=timeline-key]')).toHaveCount(1);
  await drag(page, [40, 250], [80, 250]);
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().hint)).toMatch(/Keyframes are on/);
  // Frame 8: the Object tool drags the box 200 px to the right, which records a keyframe.
  await ruler(8);
  await selectTool(page, 'object');
  await drag(page, [200, 100], [400, 100], 8);
  expect(await keysOf()).toEqual({ enabled: true, frames: [[1, 0, 'linear'], [8, 200, 'linear']] });
  expect(await shown(page, 260, 150)).toBeLessThan(60);
  expect(await shown(page, 60, 150)).toBe(255);
  // Frame 4 lies 3/7 of the way (linear): about 86 px to the right.
  await ruler(4);
  expect(await shown(page, 145, 150)).toBeLessThan(60);
  expect(await shown(page, 60, 150)).toBe(255);
  // Hold: the first keyframe's place stays until frame 8.
  await page.locator('[data-testid=timeline-track][data-track="A"] [data-testid=timeline-key][data-frame="1"]').click();
  await page.getByLabel('Keyframe interpolation').first().selectOption('hold');
  expect((await keysOf())!.frames[0]).toEqual([1, 0, 'hold']);
  await ruler(4);
  expect(await shown(page, 60, 150)).toBeLessThan(60);
  // Edit layers with active keyframes: drawn as it is, and it can be drawn on.
  await ruler(8);
  await page.getByRole('button', { name: 'Edit layers with active keyframes' }).click();
  expect(await shown(page, 60, 150)).toBeLessThan(60);
  await thinPen(page);
  await drag(page, [200, 250], [260, 250]);
  expect(await layerAlpha(page, 230, 250)).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Edit layers with active keyframes' }).click();
  expect(await shown(page, 60, 150)).toBe(255);
  // 2D camera folder around A: at frame 1 the camera frame is half the size, centred on (100, 150).
  await page.evaluate(() => window.__madPaint.runCommand('newCameraFolder'));
  const camDialog = page.getByRole('dialog', { name: '2D camera folder' });
  await expect(camDialog.getByLabel('Output frame width')).toHaveValue('400');
  await camDialog.getByRole('button', { name: 'OK' }).click();
  await page.evaluate(() => {
    const m = window.__madPaint;
    const s = m.useStore.getState();
    const cam = s.doc.layers.find((l: any) => l.camera);
    const a = s.doc.layers.find((l: any) => l.animation);
    m.actions.moveLayer(a.id, cam.id, 'inside');
    m.actions.selectLayer(cam.id);
  });
  await expect(page.getByTestId('camera-icon')).toHaveCount(1);
  await ruler(1);
  await page.evaluate(() => {
    const m = window.__madPaint;
    m.actions.selectLayer(m.useStore.getState().doc.layers.find((l: any) => l.camera).id);
  });
  await selectTool(page, 'object');
  await page.getByRole('button', { name: 'Tool Settings', exact: true }).click();
  await expect(page.getByTestId('keyframe-info')).toContainText('2D camera folder');
  await page.getByRole('spinbutton', { name: 'Scale ratio W' }).fill('50');
  await page.getByRole('spinbutton', { name: 'Position X' }).fill('-100');
  // New keyframes take the interpolation chosen last (Hold).
  expect(await keysOf(0)).toEqual({ enabled: true, frames: [[1, -100, 'hold']] });
  // Field guides: the canvas shows the layers as they are; the camera's field of view shows them through it.
  expect(await shown(page, 120, 150)).toBe(255);
  await page.getByRole('radio', { name: "Show camera's field of view" }).click();
  expect(await shown(page, 120, 150)).toBeLessThan(60);
  expect(await shown(page, 40, 150)).toBe(255);
  await page.evaluate(() => window.__madPaint.runCommand('cameraView'));
  // GIF export applies the camera.
  await page.evaluate(() => window.__madPaint.runCommand('exportGif'));
  const ex = page.getByRole('dialog', { name: 'Animated GIF export settings' });
  await expect(ex.getByLabel('Apply 2D camera effects')).toBeChecked();
  await ex.getByRole('button', { name: 'Cancel' }).click();
  // Saved and opened again: keyframes and the camera folder are kept.
  const back = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'keys.madpaint', data: await m.buildDocumentBytes() });
    const cam = m.useStore.getState().doc.layers.find((l: any) => l.camera);
    return { camera: cam.keys.frames.map((k: any) => [k.frame, k.values.x, k.values.scaleX]), a: cam.children[0].keys.frames.map((k: any) => [k.frame, Math.round(k.values.x), k.interp]) };
  });
  expect(back).toEqual({ camera: [[1, -100, 0.5]], a: [[1, 0, 'hold'], [8, 200, 'linear']] });
  expect(errors).toEqual([]);
});

test('keyframes record each setting: Details rows, small keyframes, selecting by dragging', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => void window.__madPaint.runCommand('new'));
  const dlg = page.getByRole('dialog', { name: 'New canvas' });
  await dlg.getByLabel('Width').fill('400');
  await dlg.getByLabel('Height').fill('300');
  await dlg.getByText('Create animated illustration').click();
  await dlg.getByLabel('Number of cels').fill('8');
  await dlg.getByLabel('Frame rate').fill('8');
  await dlg.getByRole('button', { name: 'OK' }).click();
  const ruler = (f: number) => page.getByTestId('timeline-ruler').locator('.tl-cell').nth(f - 1).click();
  const keys = () => page.evaluate(() => window.__madPaint.useStore.getState().doc.layers[0].keys.frames.map((k: any) => [k.frame, Object.keys(k.values).sort().join(' ')]));
  await thinPen(page);
  await drag(page, [40, 150], [80, 150]);
  await page.getByRole('button', { name: 'Add keyframe' }).click();
  // Frame 5: moving with the Object tool records the position only; the keyframe shows small.
  await ruler(5);
  await selectTool(page, 'object');
  await drag(page, [200, 100], [300, 100], 8);
  expect(await keys()).toEqual([
    [1, 'opacity pivotX pivotY rotation scaleX scaleY x y'],
    [5, 'x y'],
  ]);
  const track = page.locator('[data-testid=timeline-track][data-track="A"]');
  await expect(track.locator('[data-testid=timeline-key][data-frame="5"]')).toHaveClass(/partial/);
  await expect(track.locator('[data-testid=timeline-key][data-frame="1"]')).not.toHaveClass(/partial/);
  // Details (+): Transform and Opacity; > opens Position, Scale ratio, Rotate and Center of rotation.
  await track.getByRole('button', { name: 'Details' }).click();
  await expect(track).toContainText('A : Transform');
  const rows = page.getByTestId('timeline-subtrack');
  await expect(rows).toHaveText(['Opacity']);
  await track.getByRole('button', { name: 'Open Transform' }).click();
  await expect(rows).toHaveText(['Position', 'Scale ratio', 'Rotate', 'Center of rotation', 'Opacity']);
  const row = (g: string) => page.locator(`[data-testid=timeline-subtrack][data-group="${g}"]`);
  await expect(row('position').getByTestId('timeline-key')).toHaveCount(2);
  await expect(row('position').locator('[data-testid=timeline-key][data-frame="5"]')).not.toHaveClass(/partial/);
  await expect(row('rotation').getByTestId('timeline-key')).toHaveCount(1);
  // Opacity at frame 5 (Tool Settings) goes into that keyframe.
  await page.getByRole('button', { name: 'Tool Settings', exact: true }).click();
  await page.getByTestId('tool-property').getByRole('spinbutton', { name: 'Opacity' }).fill('50');
  expect((await keys())[1]).toEqual([5, 'opacity x y']);
  await expect(row('opacity').getByTestId('timeline-key')).toHaveCount(2);
  // Delete keyframe on the Opacity row takes out the opacity only.
  await row('opacity').locator('[data-testid=timeline-key][data-frame="5"]').click();
  await page.getByRole('button', { name: 'Delete keyframe' }).click();
  expect((await keys())[1]).toEqual([5, 'x y']);
  // Dragging around the keyframes of the Position row selects them …
  const lane = (await row('position').locator('.tl-lane').boundingBox())!;
  await page.mouse.move(lane.x + 2, lane.y + 2);
  await page.mouse.down();
  await page.mouse.move(lane.x + 60, lane.y + 12, { steps: 4 });
  await expect(page.getByTestId('timeline-marquee')).toBeVisible();
  await page.mouse.move(lane.x + 130, lane.y + lane.height - 2, { steps: 4 });
  await page.mouse.up();
  const selection = () => page.evaluate(() => window.__madPaint.useStore.getState().keySelection.map((k: any) => [k.frame, k.group ?? '']));
  expect(await selection()).toEqual([
    [1, 'position'],
    [5, 'position'],
  ]);
  await expect(row('position').locator('.tl-key.selected')).toHaveCount(2);
  await expect(row('rotation').locator('.tl-key.selected')).toHaveCount(0);
  // … and dragging one moves both positions two frames on; the other settings stay.
  const key5 = (await row('position').locator('[data-testid=timeline-key][data-frame="5"]').boundingBox())!;
  await page.mouse.move(key5.x + key5.width / 2, key5.y + key5.height / 2);
  await page.mouse.down();
  await page.mouse.move(key5.x + key5.width / 2 + 48, key5.y + key5.height / 2, { steps: 6 });
  await page.mouse.up();
  expect(await keys()).toEqual([
    [1, 'opacity pivotX pivotY rotation scaleX scaleY'],
    [3, 'x y'],
    [7, 'x y'],
  ]);
  // Shift adds to the selection, Ctrl/⌘ takes out.
  const rot = (await row('rotation').locator('.tl-lane').boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.move(rot.x + 2, rot.y + 2);
  await page.mouse.down();
  await page.mouse.move(rot.x + 40, rot.y + rot.height - 2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect(await selection()).toEqual([
    [3, 'position'],
    [7, 'position'],
    [1, 'rotation'],
  ]);
  await page.keyboard.down('ControlOrMeta');
  const pos = (await row('position').locator('.tl-lane').boundingBox())!;
  await page.mouse.move(pos.x + 30, pos.y + 2);
  await page.mouse.down();
  await page.mouse.move(pos.x + 100, pos.y + pos.height - 2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('ControlOrMeta');
  expect(await selection()).toEqual([
    [7, 'position'],
    [1, 'rotation'],
  ]);
  // One undo step brings the positions back.
  await page.evaluate(() => window.__madPaint.runCommand('undo'));
  expect(await keys()).toEqual([
    [1, 'opacity pivotX pivotY rotation scaleX scaleY x y'],
    [5, 'x y'],
  ]);
  expect(errors).toEqual([]);
});

test('Graph Editor: curves per setting, move and add keyframes on one curve, slope handles, unpair', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => void window.__madPaint.runCommand('new'));
  const dlg = page.getByRole('dialog', { name: 'New canvas' });
  await dlg.getByLabel('Width').fill('400');
  await dlg.getByLabel('Height').fill('300');
  await dlg.getByText('Create animated illustration').click();
  await dlg.getByLabel('Number of cels').fill('12');
  await dlg.getByLabel('Frame rate').fill('12');
  await dlg.getByRole('button', { name: 'OK' }).click();
  await page.evaluate(() => window.__madPaint.useStore.setState({ timelineHeight: 300 }));
  const ruler = (f: number) => page.getByTestId('timeline-ruler').locator('.tl-cell').nth(f - 1).click();
  const keys = () => page.evaluate(() => window.__madPaint.useStore.getState().doc.layers[0].keys.frames);
  await page.getByRole('button', { name: 'Add keyframe' }).click();
  await ruler(9);
  await selectTool(page, 'object');
  await page.getByRole('button', { name: 'Tool Settings', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Position X' }).fill('100');
  // The Graph Editor shows the current track's curves; View: only the X curves.
  await page.getByRole('button', { name: 'Graph Editor' }).click();
  const graph = page.getByTestId('graph-editor');
  await expect(graph.getByTestId('graph-setting')).toHaveText(['Position', 'Scale ratio', 'Rotate', 'Center of rotation', 'Opacity']);
  await expect(graph.locator('[data-testid=graph-curve][data-ch="y"]')).toHaveCount(1);
  await graph.getByRole('button', { name: 'Y graph' }).click();
  await graph.getByRole('button', { name: 'Other' }).click();
  await expect(graph.getByTestId('graph-curve')).toHaveCount(3);
  await expect(graph.locator('[data-testid=graph-curve][data-ch="y"]')).toHaveCount(0);
  // The eye of a setting hides its curves.
  await graph.getByRole('button', { name: 'Hide Center of rotation' }).click();
  await expect(graph.getByTestId('graph-curve')).toHaveCount(2);
  const key = (f: number, ch = 'x') => graph.locator(`[data-testid=graph-key][data-frame="${f}"][data-ch="${ch}"]`);
  const centre = async (f: number, ch = 'x') => {
    const b = (await key(f, ch).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  // Shift+drag moves the X keyframe of frame 9 two frames on, keeping its value; Y stays on frame 9.
  const k9 = await centre(9);
  await page.keyboard.down('Shift');
  await page.mouse.move(k9.x, k9.y);
  await page.mouse.down();
  await page.mouse.move(k9.x + 30, k9.y + 3, { steps: 3 });
  await page.mouse.move(k9.x + 48, k9.y + 9, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  let k = await keys();
  expect(k.map((x: any) => [x.frame, Object.keys(x.values).sort().join(' ')])).toEqual([
    [1, 'opacity pivotX pivotY rotation scaleX scaleY x y'],
    [9, 'y'],
    [11, 'x'],
  ]);
  expect(k[2].values.x).toBe(100);
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().graphSelection.map((r: any) => [r.frame, r.ch]))).toEqual([[11, 'x']]);
  // Alt+click on the X curve at frame 5 adds a keyframe on that curve only, where it runs (40).
  const a = await centre(1);
  const b = await centre(11);
  await page.keyboard.down('Alt');
  await page.mouse.click(a.x + (b.x - a.x) * 0.4, a.y + (b.y - a.y) * 0.4);
  await page.keyboard.up('Alt');
  k = await keys();
  expect(k.find((x: any) => x.frame === 5).values).toEqual({ x: 40 });
  // Unpair handles: the keyframe shows square, and its out handle turns alone.
  await key(5).click();
  await page.getByRole('button', { name: 'Unpair handles' }).click();
  await expect(key(5)).toHaveJSProperty('tagName', 'rect');
  const out = graph.locator('[data-testid=graph-handle][data-side="out"][data-frame="5"][data-ch="x"]');
  const ob = (await out.boundingBox())!;
  await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2);
  await page.mouse.down();
  await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2 - 30, { steps: 4 });
  await page.mouse.up();
  k = await keys();
  const c5 = k.find((x: any) => x.frame === 5).curves.x;
  expect(c5.broken).toBe(true);
  expect(c5.out[1]).toBeGreaterThan(20);
  expect(c5.in).toBeUndefined();
  // The curve bends: between 5 and 11 it rises faster than the straight line.
  expect(await page.evaluate(() => window.__madPaint.anim.placementNow(window.__madPaint.useStore.getState().doc.layers[0], 7).x)).toBeGreaterThan(60);
  // Delete keyframe removes the selected point.
  await page.getByRole('button', { name: 'Delete keyframe' }).click();
  expect((await keys()).map((x: any) => x.frame)).toEqual([1, 9, 11]);
  // Interpolation of one curve: hold from frame 1 on, the keyframe's own stays linear.
  await key(1).click();
  await page.getByTestId('timeline').getByLabel('Keyframe interpolation').selectOption('hold');
  k = await keys();
  expect([k[0].interp, k[0].curves.x.interp]).toEqual(['linear', 'hold']);
  // The wheel zooms the values.
  const before = (await centre(11)).y;
  const plot = (await graph.getByTestId('graph-plot').boundingBox())!;
  await page.mouse.move(plot.x + 40, plot.y + plot.height - 20);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => Math.round((await centre(11)).y)).not.toBe(Math.round(before));
  // Animation > Animation curve > Graph Editor goes back to the tracks.
  await page.evaluate(() => window.__madPaint.runCommand('graphEditor'));
  await expect(graph).toHaveCount(0);
  await expect(page.getByTestId('timeline-track')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('mask keyframes: the Mask row and the Object tool move a layer mask over time; saved', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => void window.__madPaint.runCommand('new'));
  const dlg = page.getByRole('dialog', { name: 'New canvas' });
  await dlg.getByLabel('Width').fill('400');
  await dlg.getByLabel('Height').fill('300');
  await dlg.getByText('Create animated illustration').click();
  await dlg.getByLabel('Number of cels').fill('8');
  await dlg.getByLabel('Frame rate').fill('8');
  await dlg.getByRole('button', { name: 'OK' }).click();
  const ruler = (f: number) => page.getByTestId('timeline-ruler').locator('.tl-cell').nth(f - 1).click();
  // Cel 1 black; the animation folder's mask shows its left 100 px only.
  await fillBlack(page);
  await page.evaluate(() => {
    const m = window.__madPaint;
    const a = m.useStore.getState().doc.layers[0];
    m.actions.setSelection({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => (i % 400 < 100 ? 255 : 0)) });
    m.actions.maskLayer(true, a.id);
    m.actions.deselect();
  });
  expect(await shown(page, 50, 150)).toBeLessThan(60);
  expect(await shown(page, 150, 150)).toBe(255);
  // Keyframes on for the folder; then, with the mask selected, Add keyframe records the mask.
  await page.getByRole('button', { name: 'Add keyframe' }).click();
  await page.getByRole('button', { name: 'Add keyframe' }).click();
  const folder = () => page.evaluate(() => window.__madPaint.useStore.getState().doc.layers[0]);
  let a = await folder();
  expect(a.keys.frames.map((k: any) => k.frame)).toEqual([1]);
  expect(a.mask.keys).toEqual([{ frame: 1, interp: 'linear', values: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, pivotX: 200, pivotY: 150 } }]);
  // Details (+): the Mask row shows the mask's keyframes; clicking it selects the mask.
  const track = page.locator('[data-testid=timeline-track][data-track="A"]');
  await track.getByRole('button', { name: 'Details' }).click();
  const maskRow = page.locator('[data-testid=timeline-subtrack][data-group="mask"]');
  await expect(maskRow.getByTestId('timeline-key')).toHaveCount(1);
  await page.evaluate(() => {
    const m = window.__madPaint;
    m.actions.selectLayer(m.useStore.getState().doc.layers[0].id, false);
  });
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().maskEditing)).toBe(false);
  await maskRow.getByRole('button', { name: 'Mask' }).click();
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().maskEditing)).toBe(true);
  // Frame 8: the Object tool drags the mask 200 px to the right.
  await ruler(8);
  await selectTool(page, 'object');
  await page.getByRole('button', { name: 'Tool Settings', exact: true }).click();
  await expect(page.getByTestId('keyframe-info')).toContainText('Mask of A');
  await drag(page, [50, 150], [250, 150], 8);
  a = await folder();
  expect(a.mask.keys.map((k: any) => [k.frame, Math.round(k.values.x ?? NaN), Object.keys(k.values).length])).toEqual([
    [1, 0, 7],
    [8, 200, 2],
  ]);
  expect(a.keys.frames.length).toBe(1);
  await expect(maskRow.getByTestId('timeline-key')).toHaveCount(2);
  expect(await shown(page, 250, 150)).toBeLessThan(60);
  expect(await shown(page, 50, 150)).toBe(255);
  // Frame 5: on its way (4/7 of 200 px).
  await ruler(5);
  expect(await shown(page, 160, 150)).toBeLessThan(60);
  expect(await shown(page, 50, 150)).toBe(255);
  // The Graph Editor shows the mask's curves (no opacity).
  await page.getByRole('button', { name: 'Graph Editor' }).click();
  await expect(page.getByTestId('graph-setting')).toHaveText(['Position', 'Scale ratio', 'Rotate', 'Center of rotation']);
  await expect(page.getByTestId('timeline').locator('.tl-head .tl-name')).toHaveText('A : Mask');
  await page.getByRole('button', { name: 'Graph Editor' }).click();
  // Saved and opened again.
  const back = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'mask-keys.madpaint', data: await m.buildDocumentBytes() });
    return m.useStore.getState().doc.layers[0].mask.keys.map((k: any) => [k.frame, Math.round(k.values.x)]);
  });
  expect(back).toEqual([
    [1, 0],
    [8, 200],
  ]);
  // With the folder's keyframes off the mask stays where it was drawn.
  await page.evaluate(() => {
    const m = window.__madPaint;
    m.actions.selectLayer(m.useStore.getState().doc.layers[0].id);
    m.anim.setFrame(8);
    m.runCommand('enableKeyframes');
  });
  expect(await shown(page, 50, 150)).toBeLessThan(60);
  expect(errors).toEqual([]);
});

test('animation frame lines: output frame, title-safe area, overflow frame and blank space; camera and exports use them', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => delete (window as any).showSaveFilePicker);
  await page.evaluate(() => void window.__madPaint.runCommand('new'));
  const dlg = page.getByRole('dialog', { name: 'New canvas' });
  await dlg.getByLabel('Width').fill('400');
  await dlg.getByLabel('Height').fill('300');
  await dlg.getByText('Create animated illustration').click();
  await dlg.getByLabel('Number of cels').fill('4');
  await dlg.getByText('Animation frame settings').click();
  // Defaults: a title-safe area and blank space of about a tenth; the canvas grows by the blank space.
  await expect(dlg.getByLabel('Title-safe area top')).toHaveValue('28');
  await expect(dlg.getByLabel('Blank space left')).toHaveValue('40');
  await expect(dlg.getByTestId('new-canvas-size')).toContainText('480 × 360');
  // An overflow frame twice as wide, the output frame on its left.
  await dlg.getByText('Overflow frame').click();
  await expect(dlg.getByRole('radio', { name: 'Reference point middle left' })).toHaveAttribute('aria-checked', 'true');
  await expect(dlg.getByTestId('new-canvas-size')).toContainText('880 × 360');
  await dlg.getByRole('button', { name: 'OK' }).click();
  const doc = () => page.evaluate(() => window.__madPaint.useStore.getState().doc);
  let d = await doc();
  expect([d.width, d.height]).toEqual([880, 360]);
  expect(d.outputFrame).toEqual({ x: 40, y: 30, w: 400, h: 300, safe: { top: 28, bottom: 28, left: 28, right: 28 }, overflow: { x: 40, y: 30, w: 800, h: 300 } });
  // View > Crop marks/Inner border shows and hides the lines.
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().showFrameLines)).toBe(true);
  await page.evaluate(() => window.__madPaint.runCommand('frameLines'));
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().showFrameLines)).toBe(false);
  await page.evaluate(() => window.__madPaint.runCommand('frameLines'));
  // A 2D camera folder frames the output frame: its centre of rotation is the output frame's middle.
  await page.evaluate(() => window.__madPaint.runCommand('newCameraFolder'));
  const cam = page.getByRole('dialog', { name: '2D camera folder' });
  await expect(cam.getByLabel('Output frame width')).toHaveValue('400');
  await cam.getByLabel('Output frame width').fill('320');
  await cam.getByLabel('Output frame height').fill('240');
  await cam.getByRole('button', { name: 'OK' }).click();
  d = await doc();
  expect([d.outputFrame.x, d.outputFrame.y, d.outputFrame.w, d.outputFrame.h]).toEqual([80, 60, 320, 240]);
  const pivot = await page.evaluate(() => {
    const m = window.__madPaint;
    const p = m.anim.placementNow(m.useStore.getState().doc.layers.find((l: any) => l.camera));
    return [p.pivotX, p.pivotY];
  });
  expect(pivot).toEqual([240, 180]);
  // Once a camera folder uses it, the output frame keeps its size.
  await page.evaluate(() => window.__madPaint.runCommand('newCameraFolder'));
  await expect(cam.getByLabel('Output frame width')).toBeDisabled();
  await cam.getByRole('button', { name: 'Cancel' }).click();
  // Exports: Drawing area output frame (default), overflow frame or entire canvas.
  await page.evaluate(() => window.__madPaint.runCommand('exportGif'));
  const ex = page.getByRole('dialog', { name: 'Animated GIF export settings' });
  await expect(ex.getByLabel('Drawing area')).toHaveValue('output');
  await expect(ex.getByLabel('Width')).toHaveValue('320');
  await expect(ex.getByLabel('Height')).toHaveValue('240');
  await ex.getByLabel('Drawing area').selectOption('overflow');
  await expect(ex.getByLabel('Width')).toHaveValue('800');
  await ex.getByLabel('Drawing area').selectOption('canvas');
  await expect(ex.getByLabel('Height')).toHaveValue('360');
  await ex.getByLabel('Drawing area').selectOption('output');
  const [dl] = await Promise.all([page.waitForEvent('download'), ex.getByRole('button', { name: 'OK' }).click()]);
  const gif = readFileSync((await dl.path())!);
  expect(gif.subarray(0, 6).toString('latin1')).toBe('GIF89a');
  expect([gif.readUInt16LE(6), gif.readUInt16LE(8)]).toEqual([320, 240]);
  // The frame lines follow the canvas when it changes size.
  await page.evaluate(() => window.__madPaint.actions.changeCanvasSize(980, 360));
  d = await doc();
  expect([d.outputFrame.x, d.outputFrame.overflow.x]).toEqual([130, 90]);
  // Saved and opened again.
  const back = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'frames.madpaint', data: await m.buildDocumentBytes() });
    return m.useStore.getState().doc.outputFrame;
  });
  expect(back).toEqual(d.outputFrame);
  expect(errors).toEqual([]);
});

test('several timelines, start and end frame, change frame rate, manage timeline', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => void window.__madPaint.runCommand('new'));
  const dlg = page.getByRole('dialog', { name: 'New canvas' });
  await dlg.getByText('Create animated illustration').click();
  await dlg.getByLabel('Number of cels').fill('4');
  await dlg.getByRole('button', { name: 'OK' }).click();
  const st = () =>
    page.evaluate(() => {
      const s = window.__madPaint.useStore.getState();
      return { timeline: s.doc.timeline, cels: s.doc.layers[0].animation.cels.map((a: any) => a.frame), frame: s.frame, names: [...document.querySelectorAll('[aria-label="Timeline list"] option')].map((o) => o.textContent) };
    });
  // New timeline (Timeline palette button): it starts empty and is edited.
  await page.getByRole('button', { name: 'New timeline' }).click();
  const nd = page.getByRole('dialog', { name: 'New timeline' });
  await expect(nd.getByLabel('Timeline name')).toHaveValue('Timeline 2');
  await nd.getByLabel('Frame rate').fill('12');
  await nd.getByLabel('Number of frames').fill('6');
  await nd.getByRole('button', { name: 'OK' }).click();
  let s = await st();
  expect(s.names).toEqual(['Timeline 1', 'Timeline 2']);
  expect(s.timeline).toMatchObject({ fps: 12, frames: 6, name: 'Timeline 2' });
  expect(s.cels).toEqual([]);
  await page.evaluate(() => {
    const m = window.__madPaint;
    const a = m.useStore.getState().doc.layers[0];
    m.anim.assignCel(a.id, 3, a.children[0].id);
  });
  // The timeline list switches back: the first timeline's cels and settings.
  await page.getByLabel('Timeline list').selectOption({ label: 'Timeline 1' });
  s = await st();
  expect(s.timeline).toMatchObject({ fps: 8, frames: 4 });
  expect(s.cels).toEqual([1]);
  await page.getByLabel('Timeline list').selectOption({ label: 'Timeline 2' });
  expect((await st()).cels).toEqual([3]);
  await page.getByLabel('Timeline list').selectOption({ label: 'Timeline 1' });
  // End frame: drag the blue mark from frame 4 back to frame 3.
  const end = (await page.getByTestId('timeline-end').boundingBox())!;
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2 - 24, end.y + end.height / 2, { steps: 4 });
  await page.mouse.up();
  expect((await st()).timeline).toMatchObject({ frames: 4, end: 3 });
  await expect(page.locator('.tl-info')).toContainText('/ 1 / 3');
  // Playback starts at the start frame when at the end.
  await page.evaluate(() => {
    const m = window.__madPaint;
    m.anim.setFrame(3);
    m.anim.play();
  });
  expect((await st()).frame).toBe(1);
  await page.evaluate(() => window.__madPaint.anim.stop());
  // Change frame rate with Change total number of frames: twice the frames, the same playing time.
  await page.evaluate(() => window.__madPaint.runCommand('frameRate'));
  const fr = page.getByRole('dialog', { name: 'Change frame rate' });
  await fr.getByLabel('Frame rate').fill('16');
  await expect(fr.getByTestId('frame-rate-result')).toContainText('8 frames · 0.50 s');
  await fr.getByRole('button', { name: 'OK' }).click();
  s = await st();
  expect(s.timeline).toMatchObject({ fps: 16, frames: 8, end: 6 });
  // Saved and opened again: both timelines.
  const back = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'timelines.madpaint', data: await m.buildDocumentBytes() });
    const d = m.useStore.getState().doc;
    return { edited: d.timeline.name ?? null, others: d.timelines.others.map((o: any) => o.timeline.name) };
  });
  expect(back).toEqual({ edited: null, others: ['Timeline 2'] });
  // Manage timeline: move Timeline 2 up, then delete it.
  await page.evaluate(() => window.__madPaint.runCommand('manageTimelines'));
  const mg = page.getByRole('dialog', { name: 'Manage timeline' });
  const items = mg.getByRole('listbox', { name: 'Timelines' }).getByRole('option');
  await expect(items).toHaveCount(2);
  await items.nth(1).click();
  await mg.getByRole('button', { name: 'Move up' }).click();
  await expect(items.first()).toContainText('Timeline 2');
  await mg.getByRole('button', { name: 'Delete' }).click();
  await expect(items).toHaveCount(1);
  await expect(mg.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await mg.getByRole('button', { name: 'Close' }).click();
  expect((await st()).names).toEqual(['Timeline 1']);
  expect(errors).toEqual([]);
});

test('movie import: a movie layer shows the movie frame by frame where its clip is; saved', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => void window.__madPaint.runCommand('new'));
  const dlg = page.getByRole('dialog', { name: 'New canvas' });
  await dlg.getByLabel('Width').fill('160');
  await dlg.getByLabel('Height').fill('120');
  await dlg.getByText('Create animated illustration').click();
  await dlg.getByLabel('Number of cels').fill('16');
  await dlg.getByLabel('Frame rate').fill('8');
  await dlg.getByRole('button', { name: 'OK' }).click();
  // File > Import > Movie: one second red, one second blue (own test movie).
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => void window.__madPaint.runCommand('importMovie'))]);
  await chooser.setFiles({ name: 'colors.webm', mimeType: 'video/webm', buffer: readFileSync(new URL('./fixtures/colors.webm', import.meta.url)) });
  await expect(page.getByTestId('movie-icon')).toHaveCount(1);
  const layer = () => page.evaluate(() => window.__madPaint.useStore.getState().doc.layers.find((l: any) => l.kind === 'movie'));
  const l = await layer();
  expect(l.clips).toEqual([{ start: 1, end: 17, offset: 0 }]);
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().doc.movies.map((m: any) => [m.width, m.height, Math.round(m.duration)]))).toEqual([[64, 48, 2]]);
  const rgb = () => page.evaluate(() => [...window.__madPaint.engine.sampleDisplayed(80, 60, '#ffffff')].slice(0, 3));
  const isRed = (c: number[]) => c[0] > 180 && c[2] < 80;
  const isBlue = (c: number[]) => c[2] > 180 && c[0] < 80;
  await expect.poll(async () => isRed(await rgb()), { timeout: 10000 }).toBe(true);
  // Frame 12 lies in the second second: blue.
  await page.getByTestId('timeline-ruler').locator('.tl-cell').nth(11).click();
  await expect.poll(async () => isBlue(await rgb()), { timeout: 10000 }).toBe(true);
  // Split at frame 9, the first part deleted, the rest moved to frame 1: it starts one second into the movie (blue).
  await page.evaluate((id) => {
    const a = window.__madPaint.anim;
    a.setFrame(9);
    a.splitClipAtFrame();
    a.selectClip(id, 1);
    a.deleteSelectedClips();
    a.selectClip(id, 9);
    a.moveSelectedClips(-8);
    a.setFrame(1);
  }, l.id);
  expect((await layer()).clips).toEqual([{ start: 1, end: 9, offset: 1 }]);
  await expect.poll(async () => isBlue(await rgb()), { timeout: 10000 }).toBe(true);
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.__madPaint.runCommand('undo'));
  expect((await layer()).clips).toEqual([{ start: 1, end: 17, offset: 0 }]);
  // Movie layers cannot be drawn on.
  await selectTool(page, 'pen');
  await drag(page, [20, 20], [100, 20]);
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().hint)).toMatch(/Movie layers cannot be drawn on/);
  // Saved and opened again: the movie comes back and shows.
  const back = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'movie.madpaint', data: await m.buildDocumentBytes() });
    m.anim.setFrame(2);
    const d = m.useStore.getState().doc;
    return { kinds: d.layers.map((x: any) => x.kind), movies: d.movies.length };
  });
  expect(back).toEqual({ kinds: ['movie', 'folder'], movies: 1 });
  await expect.poll(async () => isRed(await rgb()), { timeout: 10000 }).toBe(true);
  expect(errors).toEqual([]);
});

test('light table: a cel and an image on the target cel, colour mode, Light table tool, saved', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => void window.__madPaint.runCommand('new'));
  const dlg = page.getByRole('dialog', { name: 'New canvas' });
  await dlg.getByLabel('Width').fill('400');
  await dlg.getByLabel('Height').fill('300');
  await dlg.getByText('Create animated illustration').click();
  await dlg.getByLabel('Number of cels').fill('4');
  await dlg.getByLabel('Frame rate').fill('4');
  await dlg.getByRole('button', { name: 'OK' }).click();
  const ruler = (f: number) => page.getByTestId('timeline-ruler').locator('.tl-cell').nth(f - 1).click();
  const lightOf = (name: string) =>
    page.evaluate((n) => {
      const a = window.__madPaint.useStore.getState().doc.layers[0];
      return (a.children.find((c: any) => c.name === n).lightTable ?? []).map((l: any) => ({ kind: l.source.kind, mode: l.mode, y: Math.round(l.y) }));
    }, name);
  // Cel 1: a line at y = 100. Cel 2 on frame 2 is the target cel, locked.
  await thinPen(page);
  await drag(page, [50, 100], [350, 100]);
  await page.getByRole('button', { name: 'New animation cel' }).first().click();
  await page.locator('[data-testid=layer-panel] .palette-tab', { hasText: 'Animation cels' }).click();
  const cels = page.getByTestId('animation-cels');
  await cels.getByRole('button', { name: 'Lock current animation cel as editing target' }).click();
  await expect(cels.getByTestId('target-cel')).toContainText('A / 2');
  // Register cel 1 on cel 2's light table.
  await page.evaluate(() => {
    const m = window.__madPaint;
    const a = m.useStore.getState().doc.layers[0];
    m.actions.selectLayer(a.children.find((c: any) => c.name === '1').id);
  });
  await expect(cels.getByTestId('target-cel')).toContainText('A / 2');
  await cels.getByRole('button', { name: 'Register selected layer' }).click();
  expect(await lightOf('2')).toEqual([{ kind: 'layer', mode: 'color', y: 0 }]);
  await expect(cels.getByTestId('cel-light-table').getByTestId('light-layer')).toHaveCount(1);
  // On frame 2 (cel 2), cel 1 shows faintly; Monochrome in red recolours it.
  await ruler(2);
  const faint = await shown(page, 200, 100);
  expect(faint).toBeGreaterThan(60);
  expect(faint).toBeLessThan(250);
  await cels.getByLabel('Color mode').selectOption('mono');
  await cels.getByLabel('Light table layer color').fill('#ff0000');
  const red = await page.evaluate(() => window.__madPaint.engine.sampleDisplayed(200, 100, '#ffffff'));
  expect(red[0]).toBeGreaterThan(200);
  expect(red[1]).toBeLessThan(200);
  // Light table tool: dragged 50 px down, without changing cel 1.
  await cels.getByRole('button', { name: 'Light table tool' }).click();
  await drag(page, [200, 200], [200, 250], 6);
  expect(await lightOf('2')).toEqual([{ kind: 'layer', mode: 'mono', y: 50 }]);
  expect(await shown(page, 200, 100)).toBe(255);
  expect((await page.evaluate(() => window.__madPaint.engine.sampleDisplayed(200, 150, '#ffffff')))[1]).toBeLessThan(200);
  // An image file: centred on the canvas.
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 100;
    c.height = 60;
    const x = c.getContext('2d')!;
    x.fillStyle = '#000000';
    x.fillRect(0, 0, 100, 60);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await cels.getByTestId('light-file').setInputFiles({ name: 'ref.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(cels.getByTestId('cel-light-table').getByTestId('light-layer')).toHaveCount(2);
  await expect(cels.getByTestId('cel-light-table')).toContainText('ref');
  const grey = await shown(page, 200, 130);
  expect(grey).toBeGreaterThan(60);
  expect(grey).toBeLessThan(250);
  // Enable light table off: nothing shows.
  await cels.getByRole('button', { name: 'Enable light table' }).click();
  expect(await shown(page, 200, 130)).toBe(255);
  await cels.getByRole('button', { name: 'Enable light table' }).click();
  // Saved and opened again (with the image).
  await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'light.madpaint', data: await m.buildDocumentBytes() });
    const a = m.useStore.getState().doc.layers[0];
    m.actions.selectLayer(a.children.find((c: any) => c.name === '2').id);
  });
  expect(await lightOf('2')).toEqual([
    { kind: 'image', mode: 'color', y: 0 },
    { kind: 'layer', mode: 'mono', y: 50 },
  ]);
  const again = await shown(page, 200, 130);
  expect(again).toBeGreaterThan(60);
  expect(again).toBeLessThan(250);
  // Deregister all.
  await cels.getByRole('button', { name: 'Deregister all images from light table' }).click();
  expect(await lightOf('2')).toEqual([]);
  expect(errors).toEqual([]);
});

test('light table: layers dragged from the Layer palette, reordering, two selected, Move canvas to center', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => void window.__madPaint.runCommand('new'));
  const dlg = page.getByRole('dialog', { name: 'New canvas' });
  await dlg.getByLabel('Width').fill('400');
  await dlg.getByLabel('Height').fill('300');
  await dlg.getByText('Create animated illustration').click();
  await dlg.getByLabel('Number of cels').fill('4');
  await dlg.getByLabel('Frame rate').fill('4');
  await dlg.getByRole('button', { name: 'OK' }).click();
  // Keys: cel 1 (a line at y = 100) and cel 2 (y = 200); cel 3 is the inbetween, the locked target cel.
  await thinPen(page);
  await drag(page, [50, 100], [350, 100]);
  await page.getByRole('button', { name: 'New animation cel' }).first().click();
  await drag(page, [50, 200], [350, 200]);
  await page.getByRole('button', { name: 'New animation cel' }).first().click();
  await page.locator('[data-testid=layer-panel] .palette-tab', { hasText: 'Animation cels' }).click();
  const cels = page.getByTestId('animation-cels');
  await cels.getByRole('button', { name: 'Lock current animation cel as editing target' }).click();
  await expect(cels.getByTestId('target-cel')).toContainText('A / 3');
  const lists = () =>
    page.evaluate(() => {
      const s = window.__madPaint.useStore.getState();
      const a = s.doc.layers[0];
      const name = (l: any) => a.children.find((c: any) => c.id === l.source.layer)?.name;
      const cel = a.children.find((c: any) => c.name === '3');
      return { cel: (cel.lightTable ?? []).map(name), general: (s.doc.lightTable?.general ?? []).map(name) };
    });
  // A layer dragged from the Layer palette: over the Animation cels tab (it opens), onto the cel-specific light table.
  const dragLayer = async (name: string, to: string) => {
    await page.locator('[data-testid=layer-panel] .palette-tab', { hasText: /^Layer$/ }).click();
    const row = page.locator('.layer-row', { hasText: new RegExp(`^.*${name}$`) }).first();
    const from = (await row.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    const tab = (await page.locator('[data-testid=layer-panel] .palette-tab', { hasText: 'Animation cels' }).boundingBox())!;
    await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2, { steps: 5 });
    await expect(cels).toBeVisible();
    const target = (await cels.getByTestId(to).boundingBox())!;
    await page.mouse.move(target.x + target.width / 2, target.y + target.height - 4, { steps: 5 });
    await page.mouse.up();
  };
  await dragLayer('1', 'cel-light-table');
  expect(await lists()).toEqual({ cel: ['1'], general: [] });
  await dragLayer('2', 'cel-light-table');
  expect(await lists()).toEqual({ cel: ['1', '2'], general: [] });
  // Reordering: 2 above 1; 1 to the general light table and back below 2.
  const rowOf = (list: string, name: string) => cels.getByTestId(list).getByTestId('light-layer').filter({ hasText: name });
  await rowOf('cel-light-table', '2').dragTo(rowOf('cel-light-table', '1'), { targetPosition: { x: 20, y: 2 } });
  expect(await lists()).toEqual({ cel: ['2', '1'], general: [] });
  await rowOf('cel-light-table', '1').dragTo(cels.getByTestId('general-light-table'));
  expect(await lists()).toEqual({ cel: ['2'], general: ['1'] });
  await rowOf('general-light-table', '1').dragTo(cels.getByTestId('cel-light-table'), { targetPosition: { x: 40, y: 50 } });
  expect(await lists()).toEqual({ cel: ['2', '1'], general: [] });
  // The keys placed with the Light table tool: 2 moved 60 px right, 1 moved 20 px right and turned 20°.
  await page.evaluate(() => {
    const m = window.__madPaint;
    const cel = m.useStore.getState().doc.layers[0].children.find((c: any) => c.name === '3');
    const [two, one] = cel.lightTable;
    m.light.updateLight(two.id, (l: any) => ({ ...l, x: 60 }), 'Light table tool');
    m.light.updateLight(one.id, (l: any) => ({ ...l, x: 20, rotation: 20 }), 'Light table tool');
  });
  // Ctrl/⌘-click selects both.
  await rowOf('cel-light-table', '2').click();
  await rowOf('cel-light-table', '1').click({ modifiers: ['ControlOrMeta'] });
  await expect(cels.locator('[data-testid=light-layer][aria-pressed=true]')).toHaveCount(2);
  const view = () => page.evaluate(() => window.__madPaint.useStore.getState().view);
  const placements = () =>
    page.evaluate(() => {
      const cel = window.__madPaint.useStore.getState().doc.layers[0].children.find((c: any) => c.name === '3');
      return cel.lightTable.map((l: any) => [Math.round(l.x * 10) / 10, Math.round(l.y * 10) / 10, Math.round(l.rotation * 10) / 10]);
    });
  const before = await view();
  // Animation > Light table > Move canvas to center: Cancel leaves the canvas where it was.
  await page.evaluate(() => window.__madPaint.runCommand('centerCanvas'));
  const center = page.getByRole('dialog', { name: 'Move canvas to center' });
  await expect(center.getByTestId('center-from')).toHaveText('2');
  await expect(center.getByTestId('center-to')).toHaveText('1');
  await center.getByLabel('Position', { exact: true }).fill('0');
  expect((await view()).panX).not.toBeCloseTo(before.panX, 3);
  await center.getByRole('button', { name: 'Cancel' }).click();
  expect(await view()).toEqual(before);
  expect(await placements()).toEqual([
    [60, 0, 0],
    [20, 0, 20],
  ]);
  // 50: the canvas in the middle (40 px right, turned 10°); the keys stay where they are on screen.
  const screenOf = () =>
    page.evaluate(() => {
      const m = window.__madPaint;
      const s = m.useStore.getState();
      const cel = s.doc.layers[0].children.find((c: any) => c.name === '3');
      const [a, b, c, d, e, f] = m.controller.view.matrix;
      // Where the middle of light table layer "2" is on screen (it turns about the middle of the canvas).
      const l = cel.lightTable[0];
      const px = 200 + l.x;
      const py = 150 + l.y;
      return [Math.round(a * px + c * py + e), Math.round(b * px + d * py + f)];
    });
  // After Cancel the view's matrix is back on the next frames.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const keyOnScreen = await screenOf();
  await page.evaluate(() => window.__madPaint.runCommand('centerCanvas'));
  await center.getByRole('button', { name: 'OK' }).click();
  const after = await view();
  expect(after.rotation).toBeCloseTo(before.rotation + 10, 6);
  expect(await placements()).toEqual([
    [19.7, -3.5, -10],
    [-19.7, 3.5, 10],
  ]);
  // The view's matrix follows the store on the next frame.
  await expect.poll(screenOf).toEqual(keyOnScreen);
  // One undo step for the light table layers.
  await page.evaluate(() => window.__madPaint.actions.undo());
  expect(await placements()).toEqual([
    [60, 0, 0],
    [20, 0, 20],
  ]);
  // Light table tool settings: the selected light table layer's numbers, flips.
  await rowOf('cel-light-table', '1').click();
  await cels.getByRole('button', { name: 'Light table tool' }).click();
  await page.getByRole('button', { name: 'Tool Settings', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Rotation angle' })).toHaveValue('20');
  await page.getByRole('spinbutton', { name: 'Rotation angle' }).fill('35');
  await page.getByTestId('tool-property').getByRole('button', { name: 'Flip horizontal' }).click();
  expect(await placements()).toEqual([
    [60, 0, 0],
    [20, 0, 35],
  ]);
  expect(
    await page.evaluate(() => window.__madPaint.useStore.getState().doc.layers[0].children.find((c: any) => c.name === '3').lightTable.map((l: any) => l.flipH)),
  ).toEqual([false, true]);
  expect(errors).toEqual([]);
});

/** A stereo 16-bit WAV file with a sine tone. */
function sineWav(seconds: number, rate: number, freq: number): Buffer {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 4, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000);
    b.writeInt16LE(v, 44 + i * 4);
    b.writeInt16LE(v, 46 + i * 4);
  }
  return b;
}

test('sound: audio layers with clips, volume keyframes, mute; movies as MP4 and MOV; saved', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => delete (window as any).showSaveFilePicker);
  await page.evaluate(() => void window.__madPaint.runCommand('new'));
  const dlg = page.getByRole('dialog', { name: 'New canvas' });
  await dlg.getByLabel('Width').fill('160');
  await dlg.getByLabel('Height').fill('120');
  await dlg.getByText('Create animated illustration').click();
  await dlg.getByLabel('Number of cels').fill('12');
  await dlg.getByLabel('Frame rate').fill('12');
  await dlg.getByRole('button', { name: 'OK' }).click();
  await page.evaluate(() => {
    const m = window.__madPaint;
    m.actions.setDrawingColor('#d02020');
    m.actions.fillWithColor();
  });
  const sound = () =>
    page.evaluate(() => {
      const d = window.__madPaint.useStore.getState().doc;
      return { files: d.sound?.files ?? [], track: d.layers.find((l: any) => l.kind === 'audio'), kinds: d.layers.map((l: any) => l.kind) };
    });
  // File > Import > Audio: a one-second tone becomes a clip from frame 1 on a new audio layer, above the animation folder.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => void window.__madPaint.runCommand('importAudio'))]);
  await chooser.setFiles({ name: 'beep.wav', mimeType: 'audio/wav', buffer: sineWav(1, 48000, 440) });
  await expect(page.getByTestId('timeline-audio')).toHaveCount(1);
  await expect(page.getByTestId('audio-icon')).toHaveCount(1);
  let snd = await sound();
  expect(snd.kinds).toEqual(['audio', 'folder']);
  expect(snd.track.name).toBe('beep');
  expect(snd.track.clips.map((c: any) => [c.start, c.end, c.sound === snd.files[0].id])).toEqual([[1, 12, true]]);
  expect(snd.files[0].duration).toBeGreaterThan(0.99);
  // Audio layers cannot be drawn on.
  await thinPen(page);
  await drag(page, [20, 60], [140, 60]);
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().hint)).toMatch(/Audio layers cannot be drawn on/);
  // Clip commands work on the audio track: it ends before frame 7.
  await page.getByTestId('timeline-ruler').locator('.tl-cell').nth(6).click();
  await page.evaluate(() => window.__madPaint.runCommand('setLastDisplayed'));
  expect((await sound()).track.clips.map((c: any) => [c.start, c.end])).toEqual([[1, 6]]);
  // Volume: the Object tool's settings; with keyframes it fades.
  await selectTool(page, 'object');
  await page.getByRole('button', { name: 'Tool Settings', exact: true }).click();
  await expect(page.getByTestId('audio-info')).toContainText('beep');
  await page.getByRole('spinbutton', { name: 'Volume' }).fill('50');
  expect((await sound()).track.volume).toBe(0.5);
  await expect(page.locator('[data-testid=layer-row]', { hasText: 'beep' })).toContainText('Volume 50 %');
  await page.getByTestId('timeline-ruler').locator('.tl-cell').nth(0).click();
  await page.getByRole('button', { name: 'Add keyframe' }).first().click();
  await page.getByTestId('timeline-ruler').locator('.tl-cell').nth(5).click();
  await page.getByRole('spinbutton', { name: 'Volume' }).fill('0');
  snd = await sound();
  expect(snd.track.keys.frames.map((k: any) => [k.frame, k.values.volume])).toEqual([
    [1, 0.5],
    [6, 0],
  ]);
  await expect(page.getByTestId('timeline-audio').getByTestId('timeline-key')).toHaveCount(2);
  // File > Export animation > Movie: MP4 and MOV with the sound.
  const exportMovie = async (format: 'mp4' | 'mov') => {
    await page.evaluate(() => window.__madPaint.runCommand('exportMovie'));
    const md = page.getByRole('dialog', { name: 'Movie export settings' });
    await md.getByLabel('Format').selectOption(format);
    await expect(md.getByTestId('movie-codecs')).not.toHaveText('…');
    const codecs = await md.getByTestId('movie-codecs').textContent();
    const [dl] = await Promise.all([page.waitForEvent('download'), md.getByRole('button', { name: 'OK' }).click()]);
    expect(dl.suggestedFilename()).toBe(`Illustration.${format}`);
    return { codecs, bytes: readFileSync((await dl.path())!) };
  };
  const mp4 = await exportMovie('mp4');
  expect(mp4.bytes.subarray(4, 12).toString('latin1')).toBe('ftypisom');
  expect(mp4.codecs).toMatch(/H\.264|VP9/);
  expect(mp4.bytes.includes(Buffer.from('avc1')) || mp4.bytes.includes(Buffer.from('vp09'))).toBe(true);
  expect(mp4.bytes.includes(Buffer.from('mp4a')) || mp4.bytes.includes(Buffer.from('Opus'))).toBe(true);
  const mov = await exportMovie('mov');
  expect(mov.bytes.subarray(4, 12).toString('latin1')).toBe('ftypqt  ');
  expect(mov.bytes.includes(Buffer.from('mdat'))).toBe(true);
  expect(mov.bytes.includes(Buffer.from('sowt')) || mov.bytes.includes(Buffer.from('mp4a'))).toBe(true);
  // Muted: the movie has no sound.
  await page.getByTestId('timeline-audio').getByRole('button', { name: 'Mute track' }).click();
  const silent = await exportMovie('mov');
  expect(silent.bytes.includes(Buffer.from('soun'))).toBe(false);
  await page.getByTestId('timeline-audio').getByRole('button', { name: 'Unmute track' }).click();
  // Saved and opened again: the track, its keyframes and the sound file come back.
  const back = await page.evaluate(async () => {
    const m = window.__madPaint;
    await m.openFileBytes({ name: 'sound.madpaint', data: await m.buildDocumentBytes() });
    const d = m.useStore.getState().doc;
    const a = d.layers.find((l: any) => l.kind === 'audio');
    return { clips: a.clips.map((c: any) => [c.start, c.end]), keys: a.keys.frames.length, files: d.sound.files.length, bytes: (await m.buildDocumentBytes()).length };
  });
  expect(back.clips).toEqual([[1, 6]]);
  expect(back.keys).toBe(2);
  expect(back.files).toBe(1);
  expect(back.bytes).toBeGreaterThan(48000 * 4);
  expect(errors).toEqual([]);
});

test('animation exports: animation cels (a folder per animation folder), exposure sheet (CSV), audio (WAV)', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => delete (window as any).showSaveFilePicker);
  await page.evaluate(() => void window.__madPaint.runCommand('new'));
  const dlg = page.getByRole('dialog', { name: 'New canvas' });
  await dlg.getByLabel('Width').fill('200');
  await dlg.getByLabel('Height').fill('100');
  await dlg.getByText('Create animated illustration').click();
  await dlg.getByLabel('Number of cels').fill('6');
  await dlg.getByLabel('Frame rate').fill('6');
  await dlg.getByRole('button', { name: 'OK' }).click();
  // Folder A: cels 1 (frame 1, a line) and 2 (frame 3); folder B with cel 1 on frame 2.
  await thinPen(page);
  await drag(page, [40, 50], [160, 50]);
  await page.getByTestId('timeline-ruler').locator('.tl-cell').nth(2).click();
  await page.getByRole('button', { name: 'New animation cel' }).first().click();
  await page.getByTestId('timeline-ruler').locator('.tl-cell').nth(1).click();
  await page.evaluate(() => window.__madPaint.runCommand('newAnimationFolder'));
  await page.getByRole('button', { name: 'New animation cel' }).first().click();
  const save = async (dialog: ReturnType<Page['getByRole']> | null, run?: () => Promise<unknown>) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), dialog ? dialog.getByRole('button', { name: 'OK' }).click() : run!()]);
    return { name: dl.suggestedFilename(), bytes: readFileSync((await dl.path())!) };
  };
  // Export animation cels: folder name, Animation folder name + cel name, PNG.
  await page.evaluate(() => window.__madPaint.runCommand('exportCels'));
  const ac = page.getByRole('dialog', { name: 'Export animation cels' });
  await ac.getByLabel('Export folder name').fill('shot1');
  await ac.getByLabel('File name format').selectOption('folderCel');
  await expect(ac.getByTestId('cel-file-name')).toHaveText('A/A_1.png');
  await expect(ac.getByTestId('cel-count')).toContainText('3 cels in 2 animation folders');
  const z = await save(ac);
  expect(z.name).toBe('shot1.zip');
  const files = unzipSync(z.bytes);
  expect(Object.keys(files).sort()).toEqual(['shot1/A/A_1.png', 'shot1/A/A_2.png', 'shot1/B/B_1.png']);
  // Cel 1 holds the line; a cel is drawn alone, transparent around it.
  const alpha = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    return [bmp.width, bmp.height, g.getImageData(100, 50, 1, 1).data[3], g.getImageData(100, 80, 1, 1).data[3]];
  }, Buffer.from(files['shot1/A/A_1.png']).toString('base64'));
  expect(alpha).toEqual([200, 100, 255, 0]);
  // Exposure sheet: A on the left (the lowest track), a line per frame.
  const sheet = await save(null, () => page.evaluate(() => window.__madPaint.runCommand('exportSheet')));
  expect(sheet.name).toBe('Illustration.csv');
  const lines = sheet.bytes.toString('utf8').replace(/^\ufeff/, '').split('\r\n');
  expect(lines.slice(0, 5)).toEqual([',,', 'Frame,A,B', '1,1,', '2,,1', '3,2,']);
  // Audio: needs sound.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => void window.__madPaint.runCommand('importAudio'))]);
  await chooser.setFiles({ name: 'beep.wav', mimeType: 'audio/wav', buffer: sineWav(1, 48000, 440) });
  await expect(page.getByTestId('timeline-audio')).toHaveCount(1);
  await page.evaluate(() => window.__madPaint.runCommand('exportAudio'));
  const au = page.getByRole('dialog', { name: 'Audio export settings' });
  await au.getByLabel('Sampling frequency').selectOption('44100');
  await au.getByLabel('Channels').selectOption('1');
  await au.getByLabel('End frame').fill('3');
  const w = await save(au);
  expect(w.name).toBe('Illustration.wav');
  // RIFF/WAVE, mono, 44.1 kHz, 16 bit; frames 1–3 at 6 fps: half a second.
  expect([w.bytes.subarray(0, 4).toString('latin1'), w.bytes.subarray(8, 12).toString('latin1'), w.bytes.readUInt16LE(22), w.bytes.readUInt32LE(24), w.bytes.readUInt16LE(34)]).toEqual(['RIFF', 'WAVE', 1, 44100, 16]);
  expect(w.bytes.readUInt32LE(40)).toBe(22050 * 2);
  let peak = 0;
  for (let o = 44; o < w.bytes.length; o += 2) peak = Math.max(peak, Math.abs(w.bytes.readInt16LE(o)));
  expect(peak).toBeGreaterThan(3000);
  expect(errors).toEqual([]);
});

test('frame borders snap strokes that start near them, not along their extension', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__madPaint.runCommand('newFrameFolder'));
  await page.getByRole('dialog', { name: 'New frame border folder' }).getByRole('button', { name: 'OK' }).click();
  // Top and bottom frame, then the top one split into two columns: their vertical edges end above the bottom frame.
  await useSubTool(page, 'frame', 'frame-divide');
  await drag(page, [5, 150], [395, 150], 8);
  await drag(page, [200, 5], [200, 140], 8);
  const bottom = await page.evaluate(() => window.__madPaint.useStore.getState().doc.layers.find((l: any) => l.frame && Math.min(...l.frame.panels[0].points.map((p: any) => p.y)) > 100).id);
  await page.evaluate((id) => {
    const a = window.__madPaint.actions;
    a.selectLayer(id);
    a.addRasterLayer();
  }, bottom);
  await thinPen(page);
  // Right below the top frames' gutter, but far from their edges: the stroke stays diagonal.
  await drag(page, [205, 200], [300, 270], 10);
  expect(await layerAlpha(page, 300, 270)).toBeGreaterThan(100);
  expect(await layerAlpha(page, 203, 270)).toBe(0);
  // Next to the page frame's left edge: the stroke follows it.
  await drag(page, [18, 190], [60, 260], 10);
  expect(await layerAlpha(page, 60, 260)).toBe(0);
  expect(await layerAlpha(page, 15, 250)).toBeGreaterThan(100);
});

test('frame templates: a page layout makes its frames; frames on the canvas become an own template', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__madPaint.runCommand('frameTemplates'));
  const dlg = page.getByRole('dialog', { name: 'Frame templates' });
  await dlg.getByRole('option', { name: '2 × 2' }).click();
  await dlg.getByRole('button', { name: 'OK' }).click();
  let frames = (await state(page)).layers.filter((l: any) => l.frame);
  expect(frames.map((f: any) => f.name)).toEqual(['Frame 1', 'Frame 2', 'Frame 3', 'Frame 4']);
  // Reading order: Frame 1 top left, Frame 2 top right.
  const left = (f: any) => Math.min(...f.frame.panels[0].points.map((p: any) => p.x));
  const top = (f: any) => Math.min(...f.frame.panels[0].points.map((p: any) => p.y));
  expect(left(frames[1])).toBeGreaterThan(left(frames[0]));
  expect(top(frames[2])).toBeGreaterThan(top(frames[0]));
  // The border is drawn inside the page margin (5 % of 300 = 15 px).
  expect(await shown(page, 15, 100)).toBeLessThan(60);
  // Register the frames as a template and make it again, all in one folder.
  await page.evaluate(() => window.__madPaint.runCommand('frameTemplates'));
  await dlg.getByLabel('Template name').fill('Meine Seite');
  await dlg.getByRole('button', { name: 'Register frames on the canvas' }).click();
  await expect(dlg.getByRole('option', { name: 'Meine Seite' })).toHaveAttribute('aria-selected', 'true');
  await dlg.getByText('A frame border folder per frame').click();
  await dlg.getByRole('button', { name: 'OK' }).click();
  frames = (await state(page)).layers.filter((l: any) => l.frame);
  expect(frames).toHaveLength(5);
  expect(frames[0].name).toBe('Frame 5');
  expect(frames[0].frame.panels).toHaveLength(4);
  // Own templates are kept and can be deleted.
  await page.evaluate(() => window.__madPaint.runCommand('frameTemplates'));
  await dlg.getByRole('option', { name: 'Meine Seite' }).click();
  await dlg.getByRole('button', { name: 'Delete template' }).click();
  await expect(dlg.getByRole('option', { name: 'Meine Seite' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Filter menu: previewed filters, filters without settings, the centre × on the canvas; one undo step each', async ({ page }) => {
  const errors = await boot(page);
  // A black block on the left half (rows 50..249) of a transparent layer.
  await page.evaluate(() => {
    const a = window.__madPaint.actions;
    a.setDrawingColor('#000000');
    a.setSelection({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => (i % 400 < 200 && i >= 50 * 400 && i < 250 * 400 ? 255 : 0)) });
    a.fillWithColor();
    a.deselect();
  });
  const alpha = (x: number, y: number) => layerAlpha(page, x, y);
  expect(await alpha(203, 150)).toBe(0);
  // The menu has the reference's groups.
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: 'Filter', exact: true }).dispatchEvent('pointerdown');
  for (const g of ['Blur', 'Sharpen', 'Effect', 'Distort', 'Render', 'Correction']) await expect(page.locator('.menu-sub', { hasText: g }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  // Gaussian blur: the preview shows on the canvas while the dialog is open; Preview off hides it.
  await openMenu(page, 'Filter', 'Blur', 'filter-gaussianBlur');
  const gauss = page.getByRole('dialog', { name: 'Gaussian blur' });
  await gauss.getByRole('spinbutton', { name: 'Strength' }).fill('10');
  await expect.poll(() => alpha(203, 150)).toBeGreaterThan(0);
  // The preview is computed off the main thread.
  expect(page.workers().length).toBeGreaterThan(0);
  await gauss.getByRole('checkbox', { name: 'Preview' }).uncheck();
  await expect.poll(() => alpha(203, 150)).toBe(0);
  await gauss.getByRole('checkbox', { name: 'Preview' }).check();
  await gauss.getByRole('button', { name: 'OK' }).click();
  await expect(gauss).toBeHidden();
  expect(await alpha(203, 150)).toBeGreaterThan(0);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await alpha(203, 150)).toBe(0);
  // It reopens with the last strength.
  await openMenu(page, 'Filter', 'Blur', 'filter-gaussianBlur');
  await expect(gauss.getByRole('spinbutton', { name: 'Strength' })).toHaveValue('10');
  await gauss.getByRole('button', { name: 'Cancel' }).click();
  expect(await alpha(203, 150)).toBe(0);

  // Blur has no settings: it runs at once.
  await openMenu(page, 'Filter', 'Blur', 'filter-blur');
  expect(await alpha(200, 150)).toBeGreaterThan(0);
  expect(await alpha(199, 150)).toBeLessThan(255);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await alpha(200, 150)).toBe(0);

  // Mosaic: 30 px tiles from the canvas origin; the tile 180..209 is half covered.
  await openMenu(page, 'Filter', 'Effect', 'filter-mosaic');
  const mosaic = page.getByRole('dialog', { name: 'Mosaic' });
  await mosaic.getByRole('spinbutton', { name: 'Tile size' }).fill('30');
  await expect.poll(() => alpha(205, 100)).toBeGreaterThan(100);
  await mosaic.getByRole('button', { name: 'OK' }).click();
  await expect(mosaic).toBeHidden();
  expect(await alpha(181, 100)).toBe(await alpha(209, 119));
  expect(await alpha(181, 100)).toBeLessThan(255);
  await page.keyboard.press('ControlOrMeta+z');

  // Twirl: the red × starts in the middle; pressing the canvas moves it, and the preview follows.
  await openMenu(page, 'Filter', 'Distort', 'filter-twirl');
  const twirl = page.getByRole('dialog', { name: 'Twirl' });
  await expect.poll(() => page.evaluate(() => window.__madPaint.filterCenter.point)).toEqual({ x: 200, y: 150 });
  // Black from the left is twisted into the right half above the centre.
  await expect.poll(() => alpha(210, 120)).toBeGreaterThan(0);
  const at = await docToScreen(page, 300, 60);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => window.__madPaint.filterCenter.point)).toEqual({ x: 300, y: 60 });
  // Twisting around the new centre leaves the far left untouched.
  await expect.poll(() => alpha(20, 280)).toBe(0);
  // Cancel restores the layer and removes the ×.
  await twirl.getByRole('button', { name: 'Cancel' }).click();
  await expect(twirl).toBeHidden();
  expect(await page.evaluate(() => window.__madPaint.filterCenter.point)).toBeNull();
  expect(await alpha(210, 120)).toBe(0);
  expect(await alpha(100, 150)).toBe(255);

  // Inside a selection only the selected pixels change.
  await page.evaluate(() => window.__madPaint.actions.setSelection({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => (i < 150 * 400 ? 255 : 0)) }));
  await openMenu(page, 'Filter', 'Render', 'filter-perlinNoise');
  const perlin = page.getByRole('dialog', { name: 'Perlin noise' });
  await perlin.getByRole('button', { name: 'OK' }).click();
  await expect(perlin).toBeHidden();
  expect(await alpha(300, 20)).toBe(255);
  expect(await alpha(300, 280)).toBe(0);
  expect(errors).toEqual([]);
});

test('Edit > Transform modes: free transform corners, perspective, mesh; Tool Property settings and flip', async ({ page }) => {
  const errors = await boot(page);
  // A black square 100..199 on a transparent layer.
  await page.evaluate(() => {
    const a = window.__madPaint.actions;
    a.setDrawingColor('#000000');
    a.setSelection({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => (i % 400 >= 100 && i % 400 < 200 && i >= 100 * 400 && i < 200 * 400 ? 255 : 0)) });
    a.fillWithColor();
    a.deselect();
  });
  const alpha = (x: number, y: number) => layerAlpha(page, x, y);
  const settings = page.getByTestId('transform-settings');
  // Edit > Transform has the reference's modes.
  await openMenu(page, 'Edit', 'Transform', 'freeTransform');
  await page.locator('[data-testid=subtool-panel] .palette-tab', { hasText: 'Tool Settings' }).click();
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('combobox', { name: 'Transformation mode' })).toHaveValue('free');
  // Free transform: a corner goes anywhere.
  await drag(page, [100, 100], [60, 60]);
  await page.keyboard.press('Enter');
  await expect(settings).toBeHidden();
  expect(await alpha(70, 75)).toBe(255);
  expect(await alpha(150, 150)).toBe(255);
  expect(await alpha(70, 190)).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await alpha(70, 75)).toBe(0);
  expect(await alpha(100, 100)).toBe(255);

  // Perspective (chosen in the Tool Property palette): the top corners move towards each other.
  await page.keyboard.press('ControlOrMeta+t');
  await settings.getByRole('combobox', { name: 'Transformation mode' }).selectOption('perspective');
  await drag(page, [100, 100], [130, 100]);
  await page.keyboard.press('Enter');
  expect(await alpha(110, 103)).toBe(0);
  expect(await alpha(150, 103)).toBe(255);
  expect(await alpha(188, 103)).toBe(0);
  expect(await alpha(103, 196)).toBe(255);
  await page.keyboard.press('ControlOrMeta+z');

  // Mesh transformation: a 4 × 4 lattice; dragging a lattice point bends the square.
  await openMenu(page, 'Edit', 'Transform', 'transformMesh');
  await expect(settings.getByRole('spinbutton', { name: 'Number of horizontal lattice points' })).toHaveValue('4');
  await drag(page, [100, 133.3], [60, 133.3]);
  await page.keyboard.press('Enter');
  expect(await alpha(75, 133)).toBe(255);
  expect(await alpha(75, 198)).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');

  // Scale ratio and flip in the Tool Property palette; the reference point sits in the middle.
  await page.keyboard.press('ControlOrMeta+t');
  await expect(settings.getByRole('spinbutton', { name: 'Position X' })).toHaveValue('150');
  await settings.getByRole('spinbutton', { name: 'Scale ratio W' }).fill('50');
  // Keep aspect ratio: the height follows.
  await expect(settings.getByRole('spinbutton', { name: 'Scale ratio H' })).toHaveValue('50');
  await settings.getByRole('button', { name: 'Confirm transformation' }).click();
  expect(await alpha(130, 130)).toBe(255);
  expect(await alpha(110, 110)).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');
  // Dragging the + moves the reference point.
  await page.keyboard.press('ControlOrMeta+t');
  await drag(page, [150, 150], [170, 120]);
  await expect(settings.getByRole('combobox', { name: 'Reference point' })).toHaveValue('free');
  await expect(settings.getByRole('spinbutton', { name: 'Position X' })).toHaveValue('170');
  expect(await alpha(150, 150)).toBe(255);
  await page.keyboard.press('Escape');
  // Flip around a reference point on the left edge: the square lands left of it.
  await page.keyboard.press('ControlOrMeta+t');
  await settings.getByRole('combobox', { name: 'Reference point' }).selectOption('left');
  await settings.getByRole('button', { name: 'Flip horizontal' }).click();
  await page.keyboard.press('Enter');
  expect(await alpha(50, 150)).toBe(255);
  expect(await alpha(150, 150)).toBe(0);
  expect(errors).toEqual([]);
});

test('View > Grid, Ruler bar, Grid/Ruler bar settings and Snap to grid', async ({ page }) => {
  const errors = await boot(page);
  /** Darkest red of the screen canvas around a document point (lines are one screen pixel wide). */
  const screenRed = async (x: number, y: number) => {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const p = await docToScreen(page, x, y);
    return page.evaluate(
      ([sx, sy]) => {
        const c = document.querySelector('[data-testid=paint-canvas]') as HTMLCanvasElement;
        const r = c.getBoundingClientRect();
        const dpr = c.width / r.width;
        const d = c.getContext('2d')!.getImageData(Math.floor((sx - r.left) * dpr) - 1, Math.floor((sy - r.top) * dpr) - 1, 3, 3).data;
        return Math.min(...[0, 4, 8, 12, 16, 20, 24, 28, 32].map((i) => d[i]));
      },
      [p.x, p.y],
    );
  };
  // Settings: a 50 px grid in 2 parts from the top left.
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('button', { name: 'View', exact: true }).dispatchEvent('pointerdown');
  await page.locator('[data-command=gridSettings]').click();
  const dlg = page.getByRole('dialog', { name: 'Grid/Ruler bar settings' });
  await expect(dlg.getByRole('radio', { name: 'Top left' })).toBeChecked();
  await dlg.getByRole('spinbutton', { name: 'Gap' }).fill('50');
  await dlg.getByRole('spinbutton', { name: 'Number of divisions' }).fill('2');
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().doc.grid)).toMatchObject({ origin: 'topLeft', gap: 50, divisions: 2 });
  // The grid shows over the canvas.
  expect(await screenRed(103, 103)).toBe(255);
  await page.evaluate(() => window.__madPaint.runCommand('toggleGrid'));
  expect(await screenRed(100, 112)).toBeLessThan(230);
  expect(await screenRed(112, 112)).toBe(255);
  // ⌘R shows the ruler bar.
  await expect(page.getByTestId('ruler-bar-top')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+r');
  await expect(page.getByTestId('ruler-bar-top')).toBeVisible();
  await expect(page.getByTestId('ruler-bar-left')).toBeVisible();
  // ⌘3 Snap to grid: a stroke starting near a line follows it.
  await page.keyboard.press('ControlOrMeta+3');
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().snapGrid)).toBe(true);
  await thinPen(page);
  await drag(page, [60, 103], [190, 110], 12);
  expect(await layerAlpha(page, 180, 100)).toBeGreaterThan(200);
  expect(await layerAlpha(page, 180, 110)).toBe(0);
  // Undo removes the stroke, then the settings.
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().doc.grid)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('colour palettes: HLS triangle, RGB/HSV/CMYK slider tabs, several colour sets', async ({ page }) => {
  const errors = await boot(page);
  const color = () => page.evaluate(() => { const c = window.__madPaint.useStore.getState().colors; return c.active === 'main' ? c.main : c.sub; });
  await page.evaluate(() => window.__madPaint.actions.setDrawingColor('#ff0000'));
  // Color Wheel: switch to HLS; the middle of the triangle's left edge is 50 % grey.
  await page.getByRole('button', { name: 'HLS color space' }).click();
  const wheel = page.getByTestId('color-wheel');
  await expect(wheel).toHaveAttribute('data-space', 'hls');
  const box = (await wheel.boundingBox())!;
  const r = (box.width / 2) * (1 - 0.16) * 0.94;
  await page.mouse.click(box.x + box.width / 2 - r / 2 + 1, box.y + box.height / 2);
  const grey = await color();
  expect(grey).toMatch(/^#(7[c-f]|8[0-3])(7[c-f]|8[0-3])(7[c-f]|8[0-3])$/);
  await expect(page.locator('[data-testid=color-panel]').getByRole('spinbutton', { name: 'L' })).toHaveValue('50');
  // Back to HSV: the square again.
  await page.getByRole('button', { name: 'HSV color space' }).click();
  await expect(wheel).toHaveAttribute('data-space', 'hsv');

  // Color Slider: the CMYK tab sets black.
  await page.locator('[data-testid=color-panel] .palette-tab', { hasText: 'Color Slider' }).click();
  const sliders = page.getByTestId('color-sliders');
  await sliders.getByRole('tab', { name: 'CMYK' }).click();
  await page.evaluate(() => window.__madPaint.actions.setDrawingColor('#ffffff'));
  await sliders.getByRole('spinbutton', { name: 'K' }).fill('50');
  expect(await color()).toBe('#808080');
  await sliders.getByRole('tab', { name: 'HSV' }).click();
  await sliders.getByRole('spinbutton', { name: 'V' }).fill('100');
  expect(await color()).toBe('#ffffff');

  // Color sets: a new set, a colour added to it, the sets kept after a reload.
  const sets = page.getByTestId('color-set');
  await page.getByRole('button', { name: 'Edit color sets' }).click();
  const dlg = page.getByRole('dialog', { name: 'Edit color sets' });
  await dlg.getByRole('button', { name: 'Create new set' }).click();
  await dlg.getByRole('textbox', { name: 'Color set name' }).fill('Mine');
  await dlg.getByRole('textbox', { name: 'Color set name' }).press('Enter');
  await dlg.getByRole('button', { name: 'OK' }).click();
  await expect(sets.getByRole('combobox', { name: 'Color set' })).toHaveValue('1');
  await expect(sets.locator('.swatch')).toHaveCount(0);
  await page.evaluate(() => window.__madPaint.actions.setDrawingColor('#123456'));
  await sets.getByRole('button', { name: 'Add color' }).click();
  await expect(sets.locator('.swatch')).toHaveCount(1);
  await sets.getByRole('combobox', { name: 'Color set' }).selectOption({ label: 'Grays' });
  await expect(sets.locator('.swatch')).toHaveCount(16);
  await page.reload();
  await page.waitForFunction(() => window.__madPaint !== undefined);
  const names = await page.evaluate(() => window.__madPaint.useStore.getState().colorSets.sets.map((s: any) => s.name));
  expect(names).toContain('Mine');
  expect(await page.evaluate(() => window.__madPaint.useStore.getState().colorSets.sets.find((s: any) => s.name === 'Mine').colors)).toEqual(['#123456']);
  expect(errors).toEqual([]);
});

test('fill sub tools: drag over several areas, Enclose and fill, Lasso fill, Leftover pen', async ({ page }) => {
  const errors = await boot(page);
  // Line art on the bottom layer: three closed squares (outlines 2 px wide), colours on a new layer.
  await page.evaluate(() => {
    const a = window.__madPaint.actions;
    const boxes = [
      [40, 40, 120, 120],
      [160, 40, 240, 120],
      [280, 40, 300, 60],
    ];
    const outline = (i: number) => {
      const x = i % 400;
      const y = Math.floor(i / 400);
      return boxes.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x < x0 + 2 || x > x1 - 2 || y < y0 + 2 || y > y1 - 2));
    };
    a.setDrawingColor('#000000');
    a.setSelection({ width: 400, height: 300, data: new Uint8Array(400 * 300).map((_: number, i: number) => (outline(i) ? 255 : 0)) });
    a.fillWithColor();
    a.deselect();
    a.addRasterLayer();
    a.setDrawingColor('#ff0000');
    a.setTool('fill');
  });
  const colours = (x: number, y: number) => layerAlpha(page, x, y);
  // Refer other layers: dragging from one square into the next fills both in one step.
  await page.evaluate(() => window.__madPaint.actions.setSubTool('fill', 'fill-others'));
  await drag(page, [80, 80], [200, 80], 10);
  expect(await colours(80, 80)).toBe(255);
  expect(await colours(200, 80)).toBe(255);
  expect(await colours(140, 80)).toBe(255);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await colours(80, 80)).toBe(0);
  expect(await colours(200, 80)).toBe(0);

  // Enclose and fill: a lasso round the first square fills it, not the background.
  await page.evaluate(() => window.__madPaint.actions.setSubTool('fill', 'fill-enclose'));
  const lasso = async (pts: [number, number][]) => {
    const first = await docToScreen(page, ...pts[0]);
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const p of [...pts.slice(1), pts[0]]) {
      const q = await docToScreen(page, ...p);
      await page.mouse.move(q.x, q.y, { steps: 6 });
    }
    await page.mouse.up();
  };
  await lasso([
    [30, 30],
    [130, 30],
    [130, 130],
    [30, 130],
  ]);
  expect(await colours(80, 80)).toBe(255);
  expect(await colours(35, 35)).toBe(0);
  expect(await colours(200, 80)).toBe(0);
  // To darkest pixel: the colour reaches under the line.
  expect(await colours(41, 80)).toBe(255);
  await page.keyboard.press('ControlOrMeta+z');

  // Lasso fill: the lasso itself is filled.
  await page.evaluate(() => window.__madPaint.actions.setSubTool('fill', 'fill-lasso'));
  await lasso([
    [150, 150],
    [250, 150],
    [250, 250],
    [150, 250],
  ]);
  expect(await colours(200, 200)).toBe(255);
  expect(await colours(140, 200)).toBe(0);
  await page.keyboard.press('ControlOrMeta+z');

  // Leftover pen: brushing over the small square fills it.
  await page.evaluate(() => window.__madPaint.actions.setSubTool('fill', 'fill-leftover'));
  await drag(page, [285, 50], [296, 52], 6);
  expect(await colours(290, 50)).toBe(255);
  expect(await colours(270, 50)).toBe(0);
  expect(errors).toEqual([]);
});
