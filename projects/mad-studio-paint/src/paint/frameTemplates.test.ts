import { describe, expect, it } from 'vitest';
import { area, insidePanel, polygonBounds } from './frames';
import { FRAME_TEMPLATES, sanitizeTemplate, templateFromPanels, templatePanels } from './frameTemplates';

const page = { x: 40, y: 50, w: 700, h: 1000 };
const counts: Record<string, number> = { single: 1, rows2: 2, rows3: 3, yonkoma: 4, grid4: 4, grid6: 6, 'wide-two': 3, 'two-wide': 3, staggered: 6, slanted: 3, splash: 4, tall: 4 };

describe('frame templates', () => {
  it('make the expected frames inside the page, with gutters between them', () => {
    for (const t of FRAME_TEMPLATES) {
      const panels = templatePanels(t, page, 6, 12);
      expect(panels.length, t.id).toBe(counts[t.id]);
      for (const p of panels) {
        const b = polygonBounds(p);
        expect(b.x).toBeGreaterThanOrEqual(page.x - 1e-6);
        expect(b.y).toBeGreaterThanOrEqual(page.y - 1e-6);
        expect(b.x + b.w).toBeLessThanOrEqual(page.x + page.w + 1e-6);
        expect(b.y + b.h).toBeLessThanOrEqual(page.y + page.h + 1e-6);
      }
      // The gutters take some of the page; frames never overlap.
      const total = panels.reduce((n, p) => n + Math.abs(area(p)), 0);
      if (panels.length > 1) expect(total).toBeLessThan(page.w * page.h);
      for (let i = 0; i < panels.length; i++)
        for (let j = i + 1; j < panels.length; j++) for (const q of panels[j]) expect(insidePanel(panels[i], { x: q.x + 0.01, y: q.y + 0.01 }) && insidePanel(panels[i], { x: q.x - 0.01, y: q.y - 0.01 }), `${t.id} ${i}/${j}`).toBe(false);
    }
  });

  it('lists frames in reading order and keeps the gutter widths', () => {
    const [a, b, c, d] = templatePanels(FRAME_TEMPLATES.find((t) => t.id === 'grid4')!, page, 6, 12);
    const [ba, bb, bc] = [a, b, c].map(polygonBounds);
    expect(ba.x).toBeLessThan(bb.x);
    expect(bc.y).toBeGreaterThan(ba.y);
    expect(bb.x - (ba.x + ba.w)).toBeCloseTo(6);
    expect(bc.y - (ba.y + ba.h)).toBeCloseTo(12);
    expect(polygonBounds(d).x).toBeGreaterThan(bc.x);
  });

  it('registers frames as a template that scales with the canvas', () => {
    const own = templateFromPanels('Mine', [[{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 220 }]], { w: 200, h: 400 });
    expect(own.panels).toEqual([
      [
        [0.05, 0.05],
        [0.55, 0.05],
        [0.55, 0.55],
      ],
    ]);
    const scaled = templatePanels(own, page, 6, 12, { w: 400, h: 800 })[0].map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]);
    expect(scaled).toEqual([
      [20, 40],
      [220, 40],
      [220, 440],
    ]);
    expect(sanitizeTemplate(JSON.parse(JSON.stringify(own)))).toEqual(own);
    expect(sanitizeTemplate({ panels: [[[0, 0], [1, 'x']]] })).toBeNull();
  });
});
