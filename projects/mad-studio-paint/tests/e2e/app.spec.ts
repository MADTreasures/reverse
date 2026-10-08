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
