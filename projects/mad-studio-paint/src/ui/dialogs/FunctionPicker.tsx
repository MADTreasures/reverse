/**
 * The category and function list of Quick Access Settings and Command Bar Settings, like the
 * reference's: Menu commands (as the menu tree), Options, Tool (tools and sub tools), Auto Action
 * and Drawing color (a colour to pick). Functions are chosen with a click, added with a double
 * click, and can be dragged onto the palette or bar being set up.
 */
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { itemKey, type QuickItem } from '../../paint/quickAccess';
import { useAutoActions } from '../../store/autoActionStore';
import { drawingColor, getState, useStore } from '../../store/store';
import { commandById } from '../commands';
import { MENUS, type MenuItem as MenuEntry } from '../menus';
import { colorName, optionCommands, plainLabel, QUICK_ITEM_MIME, toolEntries } from '../quickItems';

type Category = 'menu' | 'options' | 'tool' | 'action' | 'color';

const CATEGORIES: [Category, string][] = [
  ['menu', 'Menu commands'],
  ['options', 'Options'],
  ['tool', 'Tool'],
  ['action', 'Auto Action'],
  ['color', 'Drawing color'],
];

/** A row of the function list: a group that opens, or a function. */
type Row = { kind: 'group'; key: string; label: string; depth: number } | { kind: 'item'; item: QuickItem; label: string; depth: number };

function menuRows(open: Set<string>): Row[] {
  const rows: Row[] = [];
  const walk = (items: MenuEntry[], path: string, depth: number) => {
    for (const i of items) {
      if (typeof i !== 'string') {
        const key = `${path}/${i.label}`;
        rows.push({ kind: 'group', key, label: i.label, depth });
        if (open.has(key)) walk(i.items, key, depth + 1);
      } else if (i !== '-') {
        const c = commandById(i);
        if (c) rows.push({ kind: 'item', item: { kind: 'command', id: i }, label: plainLabel(c.label), depth });
      }
    }
  };
  for (const m of MENUS) {
    rows.push({ kind: 'group', key: m.label, label: m.label, depth: 0 });
    if (open.has(m.label)) walk(m.items, m.label, 1);
  }
  return rows;
}

function rowsOf(category: Category, open: Set<string>): Row[] {
  if (category === 'menu') return menuRows(open);
  if (category === 'options') return optionCommands().map((id) => ({ kind: 'item', item: { kind: 'command', id }, label: plainLabel(commandById(id)!.label), depth: 0 }));
  if (category === 'tool')
    return toolEntries().flatMap((t): Row[] => [
      { kind: 'group', key: t.tool, label: t.label, depth: 0 },
      ...(open.has(t.tool) ? [{ kind: 'item', item: { kind: 'tool', tool: t.tool }, label: `${t.label} (tool)`, depth: 1 } as Row, ...t.subs.map((s): Row => ({ kind: 'item', item: { kind: 'tool', tool: t.tool, sub: s.id }, label: s.group ? `${s.name} – ${s.group}` : s.name, depth: 1 }))] : []),
    ]);
  if (category === 'action')
    return useAutoActions.getState().sets.flatMap((set): Row[] => [
      { kind: 'group', key: set.id, label: set.name, depth: 0 },
      ...(open.has(set.id) ? set.actions.map((a): Row => ({ kind: 'item', item: { kind: 'action', id: a.id }, label: a.name, depth: 1 })) : []),
    ]);
  return [];
}

export function FunctionPicker({ onChoose, onAdd, isAdded }: { onChoose: (item: QuickItem | null) => void; onAdd: (item: QuickItem) => void; isAdded: (item: QuickItem) => boolean }) {
  const [category, setCategory] = useState<Category>('menu');
  const [open, setOpen] = useState<Set<string>>(() => new Set(['Edit']));
  const [chosen, setChosen] = useState<QuickItem | null>(null);
  const [color, setColor] = useState(() => drawingColor(getState().colors));
  // Sub tools and auto actions change the lists.
  useStore((s) => s.subTools);
  useAutoActions((s) => s.sets);
  const colors = useStore(useShallow((s) => [s.colors.main, s.colors.sub]));
  const rows = rowsOf(category, open);
  const choose = (item: QuickItem | null) => {
    setChosen(item);
    onChoose(item);
  };
  const pickColor = (c: string) => {
    setColor(c);
    onChoose({ kind: 'color', color: c.toLowerCase() });
  };
  const toggle = (key: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  return (
    <div className="qa-settings-left">
      <select
        className="prop-select"
        aria-label="Category"
        value={category}
        onChange={(e) => {
          const c = e.target.value as Category;
          setCategory(c);
          if (c === 'color') pickColor(color);
          else choose(null);
        }}
      >
        {CATEGORIES.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      {category === 'color' ? (
        <div className="qa-color-pick">
          <label className="check">
            Color
            <input type="color" aria-label="Drawing color to add" value={color} onChange={(e) => pickColor(e.target.value)} />
          </label>
          <div className="qa-color-swatches">
            {colors.map((c, i) => (
              <button key={i} className={`qa-swatch big ${c === color ? 'on' : ''}`} style={{ background: c }} title={i ? 'Sub color' : 'Main color'} aria-label={i ? 'Sub color' : 'Main color'} onClick={() => pickColor(c)} />
            ))}
          </div>
          <span className="muted">{colorName(color)}</span>
        </div>
      ) : (
        <div key={category} className="qa-func-list" role="tree" aria-label="Functions">
          {rows.map((r, n) =>
            r.kind === 'group' ? (
              <div key={`g-${r.key}`} className="qa-func group" role="treeitem" aria-expanded={open.has(r.key)} aria-label={r.label} style={{ paddingLeft: 6 + r.depth * 14 }} onClick={() => toggle(r.key)}>
                <span className="twist">{open.has(r.key) ? '▾' : '▸'}</span>
                {r.label}
              </div>
            ) : (
              <div
                key={`i-${itemKey(r.item)}-${n}`}
                className={`qa-func ${chosen && itemKey(chosen) === itemKey(r.item) ? 'on' : ''} ${isAdded(r.item) ? 'added' : ''}`}
                role="treeitem"
                aria-selected={Boolean(chosen && itemKey(chosen) === itemKey(r.item))}
                aria-label={r.label}
                style={{ paddingLeft: 20 + r.depth * 14 }}
                draggable
                onDragStart={(e) => e.dataTransfer.setData(QUICK_ITEM_MIME, JSON.stringify(r.item))}
                onClick={() => choose(r.item)}
                onDoubleClick={() => onAdd(r.item)}
              >
                {r.label}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
