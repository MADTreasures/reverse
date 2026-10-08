import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/store';
import { commandById, isEnabled, runCommand, shortcutLabel } from './commands';
import { MENUS } from './menus';

/** In-window menu bar for the browser build (the Electron app uses the native macOS menu). */
export function MenuBar() {
  const [open, setOpen] = useState<number | null>(null);
  // Re-render for enabled/checked state.
  useStore(useShallow((s) => [s.canUndo, s.canRedo, s.selection, s.activeLayerId, s.doc, s.view, s.transforming, s.palettesHidden]));

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
          {open === i && (
            <div className="menu-dropdown" role="menu">
              {m.items.map((id, k) => {
                if (id === '-') return <div key={k} className="menu-sep" />;
                const c = commandById(id)!;
                const enabled = isEnabled(c);
                const checked = c.checked?.();
                return (
                  <button
                    key={id}
                    role="menuitem"
                    className="menu-item"
                    disabled={!enabled}
                    data-command={id}
                    onClick={() => {
                      setOpen(null);
                      void runCommand(id);
                    }}
                  >
                    <span className="menu-check">{checked ? '✓' : ''}</span>
                    <span className="menu-label">{c.label}</span>
                    <span className="menu-shortcut">{shortcutLabel(id) ?? ''}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
