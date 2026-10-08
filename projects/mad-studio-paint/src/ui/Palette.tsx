import { useState, type ReactNode } from 'react';

export interface PaletteTab {
  id: string;
  label: string;
  content: ReactNode;
}

/** A docked palette with tabs, like the panels of desktop illustration apps (`active` / `onSelect`: the tab is chosen elsewhere too). */
export function Palette({
  tabs,
  className = '',
  grow = false,
  testId,
  active: chosen,
  onSelect,
}: {
  tabs: PaletteTab[];
  className?: string;
  grow?: boolean;
  testId?: string;
  active?: string;
  onSelect?: (id: string) => void;
}) {
  const [own, setOwn] = useState(tabs[0].id);
  const [collapsed, setCollapsed] = useState(false);
  const active = chosen ?? own;
  const setActive = (id: string) => (onSelect ? onSelect(id) : setOwn(id));
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <section className={`palette ${grow ? 'grow' : ''} ${collapsed ? 'collapsed' : ''} ${className}`} data-testid={testId}>
      <header className="palette-tabs" onDoubleClick={() => setCollapsed((c) => !c)}>
        {tabs.map((t) => (
          <button key={t.id} className={`palette-tab ${t.id === tab.id ? 'active' : ''}`} onClick={() => setActive(t.id)}>
            {t.label}
          </button>
        ))}
      </header>
      {!collapsed && <div className="palette-body">{tab.content}</div>}
    </section>
  );
}
