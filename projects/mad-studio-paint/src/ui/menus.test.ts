import { describe, expect, it } from 'vitest';
import { commandById } from './commands';
import { menuCommandIds } from './menus';
import { nativeMenuTemplate, type NativeMenuItem } from './nativeMenu';
import { DEFAULT_COMMAND_BARS } from '../store/commandBarStore';
import { defaultQuickSets } from '../paint/quickAccess';
import { defaultActionSets } from '../paint/autoActions';

describe('menus', () => {
  it('refer only to known commands', () => {
    const ids = menuCommandIds();
    expect(ids.length).toBeGreaterThan(50);
    for (const id of ids) expect(commandById(id), id).toBeDefined();
  });

  it('give the native menu the same items, submenus included', () => {
    const count = (items: NativeMenuItem[]): number => items.reduce((n, i) => n + (i.submenu ? count(i.submenu) : i.id ? 1 : 0), 0);
    expect(count(nativeMenuTemplate())).toBe(menuCommandIds().length);
    const layer = nativeMenuTemplate().find((m) => m.label === 'Layer')!;
    const masks = layer.submenu!.find((i) => i.label === 'Layer mask')!;
    expect(masks.submenu!.map((i) => i.id).filter(Boolean)).toContain('maskOutside');
    const file = nativeMenuTemplate().find((m) => m.label === 'File')!;
    expect(file.submenu!.find((i) => i.id === 'save')!.accelerator).toBe('CmdOrCtrl+S');
  });

  it('default Command Bars, Quick Access sets and auto actions use known commands', () => {
    const items = [...Object.values(DEFAULT_COMMAND_BARS).flat(), ...defaultQuickSets().flatMap((x) => x.items)];
    for (const it of items) if (it.kind === 'command') expect(commandById(it.id), it.id).toBeDefined();
    for (const a of defaultActionSets().flatMap((x) => x.actions)) for (const st of a.steps) if (st.op.kind === 'command') expect(commandById(st.op.id), st.op.id).toBeDefined();
  });
});
