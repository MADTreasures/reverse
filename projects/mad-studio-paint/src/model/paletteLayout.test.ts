import { describe, expect, it } from 'vitest';
import { defaultLayout, ensurePalette, locate, movePalette, raiseFloating, removePalette, sanitizeLayout, setColumnWidth, setStackHeight, toggleColumnHidden, updateFloating, type PaletteLayout } from './paletteLayout';

const tabsOf = (l: PaletteLayout) => l.columns.map((c) => c.stacks.map((s) => s.tabs.join(',')));
const growOf = (l: PaletteLayout) => l.columns.map((c) => c.stacks.findIndex((s) => s.grow));

describe('palette layout', () => {
  it('lays out the docks of each workspace like the reference', () => {
    expect(tabsOf(defaultLayout('default'))).toEqual([
      ['subTool,toolProperty', 'colorWheel,colorSlider', 'colorSet,colorHistory,intermediateColor,approximateColor,quickAccess'],
      ['navigator,subView', 'layerProperty,autoAction', 'layer,searchLayer,history,animationCels'],
    ]);
    expect(tabsOf(defaultLayout('classic'))[0]).toEqual(['subTool', 'toolProperty', 'brushSize', 'colorWheel,colorSlider,colorSet,colorHistory,intermediateColor,approximateColor,quickAccess']);
    expect(growOf(defaultLayout('default'))).toEqual([0, 2]);
    expect(growOf(defaultLayout('classic'))).toEqual([1, 2]);
  });

  it('stacks a palette with others, before a tab or reordered in its own stack', () => {
    let l = defaultLayout('default');
    l = movePalette(l, 'history', { kind: 'tab', stack: 'navigator', index: 1 });
    expect(tabsOf(l)[1]).toEqual(['navigator,history,subView', 'layerProperty,autoAction', 'layer,searchLayer,animationCels']);
    // Dropped after Sub View in its own stack (index 3 before the move).
    l = movePalette(l, 'history', { kind: 'tab', stack: 'navigator', index: 3 });
    expect(tabsOf(l)[1][0]).toBe('navigator,subView,history');
    expect(locate(l, 'history')).toMatchObject({ stack: { id: 'navigator' }, index: 2 });
  });

  it('puts a palette above or below others, into a new dock column, or floating; empty stacks and docks go', () => {
    let l = defaultLayout('default');
    l = movePalette(l, 'colorHistory', { kind: 'stack', column: 'right', index: 1 });
    expect(tabsOf(l)[1]).toEqual(['navigator,subView', 'colorHistory', 'layerProperty,autoAction', 'layer,searchLayer,history,animationCels']);
    // The Layer stack still takes the height left.
    expect(growOf(l)[1]).toBe(3);
    l = movePalette(l, 'colorHistory', { kind: 'column', column: 'right', after: true });
    expect(l.columns.map((c) => c.side)).toEqual(['left', 'right', 'right']);
    expect(tabsOf(l)[2]).toEqual(['colorHistory']);
    l = movePalette(l, 'colorHistory', { kind: 'float', x: 400, y: 200, w: 240, h: 180 });
    expect(l.columns).toHaveLength(2);
    expect(l.floating).toEqual([{ id: 'colorHistory', x: 400, y: 200, w: 240, h: 180 }]);
    // Docked again from floating: as a stack with the floating height.
    l = movePalette(l, 'colorHistory', { kind: 'stack', column: 'left', index: 3 });
    expect(l.floating).toEqual([]);
    expect(l.columns[0].stacks[3]).toMatchObject({ tabs: ['colorHistory'], height: 180 });
    // A palette alone in its stack dropped right above itself stays.
    expect(movePalette(l, 'colorHistory', { kind: 'stack', column: 'left', index: 3 })).toBe(l);
    // The last palette of a column leaves: the column goes.
    let r = defaultLayout('default');
    for (const id of ['navigator', 'subView', 'layerProperty', 'autoAction', 'layer', 'searchLayer', 'history', 'animationCels'] as const) r = removePalette(r, id);
    expect(r.columns.map((c) => c.id)).toEqual(['left']);
  });

  it('changes heights and widths unless locked, hides docks, moves floating palettes', () => {
    let l = defaultLayout('default');
    l = setStackHeight(l, 'navigator', 30);
    expect(l.columns[1].stacks[0].height).toBe(48);
    l = setColumnWidth(l, 'left', 900);
    expect(l.columns[0].width).toBe(520);
    const locked = { ...l, lockHeight: true, fixWidth: true };
    expect(setStackHeight(locked, 'navigator', 300)).toBe(locked);
    expect(setColumnWidth(locked, 'left', 300)).toBe(locked);
    l = toggleColumnHidden(l, 'right');
    expect(l.columns[1].hidden).toBe(true);
    l = movePalette(l, 'history', { kind: 'float', x: 10, y: 20, w: 100, h: 50 });
    l = movePalette(l, 'subView', { kind: 'float', x: 30, y: 40, w: 300, h: 300 });
    expect(l.floating[0]).toMatchObject({ w: 160, h: 80 });
    l = updateFloating(l, 'history', { x: 50, minimized: true });
    expect(l.floating[0]).toMatchObject({ id: 'history', x: 50, minimized: true });
    expect(raiseFloating(l, 'history').floating.map((f) => f.id)).toEqual(['subView', 'history']);
  });

  it('puts a palette back where its workspace has it (or floating), and reads saved layouts safely', () => {
    let l = removePalette(defaultLayout('default'), 'quickAccess');
    l = ensurePalette(l, 'quickAccess', 'default');
    expect(tabsOf(l)[0][2]).toBe('colorSet,colorHistory,intermediateColor,approximateColor,quickAccess');
    // Brush Size has no place in the default workspace: it floats.
    expect(ensurePalette(l, 'brushSize', 'default').floating.map((f) => f.id)).toEqual(['brushSize']);
    const saved = sanitizeLayout(
      {
        columns: [
          { id: 'left', side: 'left', width: 9999, stacks: [{ id: 'a', tabs: ['layer', 'layer', 'bogus'], height: 'x' }] },
          { id: 'left', side: 'up', stacks: [{ id: 'a', tabs: ['history'], height: 120 }] },
          'junk',
        ],
        floating: [{ id: 'history', x: 1, y: 2, w: 3, h: 4 }, { id: 'navigator', x: 10, y: 20, w: 300, h: 200 }],
        lockHeight: true,
      },
      'default',
    );
    expect(saved.columns[0]).toMatchObject({ id: 'left', width: 520, stacks: [{ id: 'a', tabs: ['layer'] }] });
    // Repeated ids get new ones; repeated palettes are left out.
    expect(saved.columns[1].id).not.toBe('left');
    expect(saved.columns[1].stacks[0]).toMatchObject({ tabs: ['history'], height: 120 });
    expect(saved.floating.map((f) => f.id)).toContain('navigator');
    expect(saved.floating.some((f) => f.id === 'history')).toBe(false);
    expect(saved.lockHeight).toBe(true);
    // Palettes missing from the saved layout come back (floating when their stack is gone).
    for (const id of ['subTool', 'colorWheel', 'quickAccess', 'animationCels'] as const) expect(locate(saved, id)).not.toBeNull();
    expect(sanitizeLayout('junk', 'classic')).toEqual(defaultLayout('classic'));
  });
});
