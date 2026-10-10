import { useRef, useState, type ReactNode } from 'react';
import { setPaletteTab } from '../store/paletteActions';
import { useStore } from '../store/store';
import { showMenu, type MenuItem } from './overlays';

export interface PaletteTab {
  id: string;
  label: string;
  content: ReactNode;
  /** The palette menu (≡ in the title bar), when the palette has one. */
  menu?: () => MenuItem[];
}

/**
 * A docked palette with tabs, like the panels of desktop illustration apps. Tabs switched off in
 * the Window menu are left out (a stack without tabs is not shown). The tab in front is kept per
 * `stack`; `active` / `onSelect`: it is chosen elsewhere.
 */
export function Palette({
  tabs,
  className = '',
  grow = false,
  testId,
  active: chosen,
  onSelect,
  stack,
}: {
  tabs: PaletteTab[];
  className?: string;
  grow?: boolean;
  testId?: string;
  active?: string;
  onSelect?: (id: string) => void;
  stack?: string;
}) {
  const [own, setOwn] = useState(tabs[0].id);
  const [collapsed, setCollapsed] = useState(false);
  const spring = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hidden = useStore((s) => s.hiddenPalettes) as string[];
  const front = useStore((s) => (stack ? s.paletteTabs[stack] : undefined));
  const shown = tabs.filter((t) => !hidden.includes(t.id));
  const active = chosen ?? front ?? own;
  const setActive = (id: string) => (onSelect ? onSelect(id) : stack ? setPaletteTab(stack, id) : setOwn(id));
  if (!shown.length) return null;
  const tab = shown.find((t) => t.id === active) ?? shown[0];
  return (
    <section className={`palette ${grow ? 'grow' : ''} ${collapsed ? 'collapsed' : ''} ${className}`} data-testid={testId}>
      <header className="palette-tabs" onDoubleClick={() => setCollapsed((c) => !c)}>
        {tab.menu && (
          <button
            className="palette-menu"
            title="Palette menu"
            aria-label={`${tab.label} palette menu`}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              const b = e.currentTarget.getBoundingClientRect();
              showMenu({ x: b.left, y: b.bottom + 2 }, tab.menu!());
            }}
          >
            ≡
          </button>
        )}
        {shown.map((t) => (
          <button
            key={t.id}
            className={`palette-tab ${t.id === tab.id ? 'active' : ''}`}
            title={t.label}
            onClick={() => setActive(t.id)}
            // Dragging something over a tab opens it after a moment (e.g. a layer onto the Animation cels palette).
            onDragEnter={() => {
              if (spring.current) clearTimeout(spring.current);
              if (t.id !== tab.id) spring.current = setTimeout(() => setActive(t.id), 350);
            }}
            onDragLeave={() => spring.current && clearTimeout(spring.current)}
          >
            {t.label}
          </button>
        ))}
      </header>
      {!collapsed && <div className="palette-body">{tab.content}</div>}
    </section>
  );
}
