import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

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
  await drag(page, [50, 50], [250, 150]);
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
  // ⌘T, drag inside the box, Enter.
  await page.keyboard.press('ControlOrMeta+t');
  await drag(page, [160, 170], [160, 190], 6);
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

  // File > Export (single layer) as .psd, output as background: one opaque layer.
  await page.evaluate(() => window.__madPaint.runCommand('export'));
  const ex = page.getByRole('dialog', { name: 'Export' });
  await ex.getByLabel('Format').selectOption('psd');
  await ex.getByLabel('Output as background').check();
  await expect(ex.getByText('Transparent background')).toHaveCount(0);
  const [flat] = await Promise.all([page.waitForEvent('download'), ex.getByRole('button', { name: 'Export' }).click()]);
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
  await expect(ex.getByTestId('export-playback')).toHaveText('1.00 s · 4 images');
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
      return track ? { enabled: track.keys.enabled, frames: track.keys.frames.map((k: any) => [k.frame, Math.round(k.x), k.interp]) } : null;
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
  await page.evaluate(() => {
    const m = window.__madPaint;
    m.runCommand('newCameraFolder');
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
    return { camera: cam.keys.frames.map((k: any) => [k.frame, k.x, k.scaleX]), a: cam.children[0].keys.frames.map((k: any) => [k.frame, Math.round(k.x), k.interp]) };
  });
  expect(back).toEqual({ camera: [[1, -100, 0.5]], a: [[1, 0, 'hold'], [8, 200, 'linear']] });
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
