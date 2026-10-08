/**
 * The native (Electron) menu is built from the same MENUS and COMMANDS as the in-window menu bar:
 * the renderer sends this plain template to the main process, which adds the platform roles.
 */
import { commandById } from './commands';
import { MENUS, type MenuItem } from './menus';
import { toAccelerator } from './shortcuts';

export interface NativeMenuItem {
  /** Command id, sent back as the menu action. */
  id?: string;
  label?: string;
  accelerator?: string;
  separator?: true;
  submenu?: NativeMenuItem[];
}

function convert(items: MenuItem[]): NativeMenuItem[] {
  return items.flatMap((item): NativeMenuItem[] => {
    if (item === '-') return [{ separator: true }];
    if (typeof item !== 'string') return [{ label: item.label, submenu: convert(item.items) }];
    const c = commandById(item);
    if (!c) return [];
    const key = c.keys?.[0];
    return [{ id: c.id, label: c.label, ...(key ? { accelerator: toAccelerator(key) } : {}) }];
  });
}

export function nativeMenuTemplate(): NativeMenuItem[] {
  return MENUS.map((m) => ({ label: m.label, submenu: convert(m.items) }));
}
