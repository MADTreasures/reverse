import { useState, type ReactNode } from 'react';

export interface PaletteTab {
  id: string;
  label: string;
  content: ReactNode;
}

/** A docked palette with tabs, like the panels of desktop illustration apps. */
export function Palette({ tabs, className = '', grow = false, testId }: { tabs: PaletteTab[]; className?: string; grow?: boolean; testId?: string }) {
  const [active, setActive] = useState(tabs[0].id);
  const [collapsed, setCollapsed] = useState(false);
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
