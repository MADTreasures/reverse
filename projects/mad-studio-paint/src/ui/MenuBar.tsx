import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/store';
import { commandById, isEnabled, runCommand, shortcutLabel } from './commands';
import { MENUS, type MenuItem } from './menus';

/** In-window menu bar for the browser build (the Electron app uses the native macOS menu). */
export function MenuBar() {
  const [open, setOpen] = useState<number | null>(null);
  // Re-render for enabled/checked state.
  useStore(useShallow((s) => [s.canUndo, s.canRedo, s.selection, s.activeLayerId, s.doc, s.view, s.transforming, s.palettesHidden, s.maskEditing, s.showMaskArea]));

  useEffect(() => {
    if (open === null) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.menubar')) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <nav className="menubar" aria-label="Main menu">
      <span className="brand" title="MAD Studio Paint">
        MAD<b>Paint</b>
      </span>
      {MENUS.map((m, i) => (
        <div key={m.label} className="menu-root">
          <button
            className={`menu-title ${open === i ? 'open' : ''}`}
            onPointerDown={(e) => {
              e.preventDefault();
              setOpen(open === i ? null : i);
            }}
            onPointerEnter={() => open !== null && setOpen(i)}
          >
            {m.label}
          </button>
          {open === i && <MenuItems items={m.items} onDone={() => setOpen(null)} />}
        </div>
      ))}
    </nav>
  );
}

/** A dropdown; submenus open to the right while hovered. */
function MenuItems({ items, onDone, sub }: { items: MenuItem[]; onDone: () => void; sub?: boolean }) {
  return (
    <div className={`menu-dropdown ${sub ? 'sub' : ''}`} role="menu">
      {items.map((item, k) => {
        if (item === '-') return <div key={k} className="menu-sep" />;
        if (typeof item !== 'string') {
          return (
            <div key={item.label} className="menu-sub">
              <button role="menuitem" className="menu-item" aria-haspopup="menu">
                <span className="menu-check" />
                <span className="menu-label">{item.label}</span>
                <span className="menu-shortcut">▸</span>
              </button>
              <MenuItems items={item.items} onDone={onDone} sub />
            </div>
          );
        }
        const c = commandById(item)!;
        const enabled = isEnabled(c);
        const checked = c.checked?.();
        return (
          <button
            key={item}
            role="menuitem"
            className="menu-item"
            disabled={!enabled}
            data-command={item}
            onClick={() => {
              onDone();
              void runCommand(item);
            }}
          >
            <span className="menu-check">{checked ? '✓' : ''}</span>
            <span className="menu-label">{c.label}</span>
            <span className="menu-shortcut">{shortcutLabel(item) ?? ''}</span>
          </button>
        );
      })}
    </div>
  );
}
