import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { closeDialog, closeMenu, useOverlays, type MenuItem } from './overlays';
import { ExportDialog } from './dialogs/ExportDialog';
import { AboutDialog, ShortcutsDialog } from './dialogs/InfoDialogs';

/** Context menus, modal dialogs and toast notifications. */
export function Overlays() {
  const menu = useOverlays((s) => s.menu);
  const dialog = useOverlays((s) => s.dialog);
  const toasts = useOverlays((s) => s.toasts);

  return (
    <>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} root />}
      {dialog && (
        <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeDialog()}>
          {dialog.kind === 'prompt' && <PromptDialog title={dialog.title} value={dialog.value} onDone={dialog.resolve} />}
          {dialog.kind === 'confirm' && (
            <div className="modal small" role="dialog" aria-label={dialog.title}>
              <h2>{dialog.title}</h2>
              <p>{dialog.message}</p>
              <div className="modal-actions">
                <button className="btn" onClick={() => dialog.resolve(false)}>
                  Cancel
                </button>
                <button className={`btn ${dialog.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => dialog.resolve(true)}>
                  {dialog.okLabel}
                </button>
              </div>
            </div>
          )}
          {dialog.kind === 'custom' && dialog.id === 'export' && <ExportDialog />}
          {dialog.kind === 'custom' && dialog.id === 'about' && <AboutDialog />}
          {dialog.kind === 'custom' && dialog.id === 'shortcuts' && <ShortcutsDialog />}
        </div>
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}

function PromptDialog({ title, value, onDone }: { title: string; value: string; onDone: (v: string | null) => void }) {
  const [text, setText] = useState(value);
  return (
    <form
      className="modal small"
      role="dialog"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault();
        onDone(text.trim() || null);
      }}
    >
      <h2>{title}</h2>
      <input
        type="text"
        autoFocus
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onDone(null);
        }}
      />
      <div className="modal-actions">
        <button type="button" className="btn" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button type="submit" className="btn primary">
          OK
        </button>
      </div>
    </form>
  );
}

function ContextMenu({ x, y, items, root = false }: { x: number; y: number; items: MenuItem[]; root?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = Math.max(4, Math.min(x, window.innerWidth - r.width - 4));
    const ny = Math.max(4, Math.min(y, window.innerHeight - r.height - 4));
    if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny });
    // Only re-measure when the requested position changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  useEffect(() => {
    if (!root) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.context-menu')) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', closeMenu);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', closeMenu);
    };
  }, [root]);

  return (
    <>
      <div className="context-menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu" onContextMenu={(e) => e.preventDefault()}>
        {items.map((item, i) =>
          item.separator ? (
            <div key={i} className="menu-sep" />
          ) : (
            <button
              key={i}
              role="menuitem"
              className={`menu-item ${item.danger ? 'danger' : ''} ${sub?.index === i ? 'open' : ''}`}
              disabled={item.disabled}
              onPointerEnter={(e) => {
                if (item.submenu) {
                  const r = e.currentTarget.getBoundingClientRect();
                  setSub({ index: i, x: r.right - 2, y: r.top - 4 });
                } else setSub(null);
              }}
              onClick={() => {
                if (item.submenu) return;
                closeMenu();
                item.onClick?.();
              }}
            >
              <span className="menu-check">{item.checked ? '✓' : ''}</span>
              {item.swatch && <span className="menu-swatch" style={{ background: item.swatch }} />}
              <span className="menu-label">{item.label}</span>
              {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
              {item.submenu && <span className="menu-arrow">›</span>}
            </button>
          ),
        )}
      </div>
      {sub && items[sub.index]?.submenu && <ContextMenu key={sub.index} x={sub.x} y={sub.y} items={items[sub.index].submenu!} />}
    </>
  );
}
