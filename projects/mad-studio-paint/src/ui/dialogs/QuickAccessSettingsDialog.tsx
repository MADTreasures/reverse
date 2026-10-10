/**
 * Quick Access Settings, like the reference's: a category (Menu commands, Options, Tool, Auto
 * Action, Drawing color) and its functions; Add puts the chosen one under the selected button of
 * the Quick Access palette (or at the end), Settings names the selected button, Delete removes it,
 * Add separator puts a separator under it, Restore default layout brings back the default sets.
 * The palette stays usable while it is open: a click selects a button, a drag moves it, and
 * functions can be dragged from the list onto it.
 */
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { hasItem, itemKey, type QuickItem } from '../../paint/quickAccess';
import { addQuickButton, addQuickSeparator, deleteQuickButton, renameQuickButton, restoreQuickDefaults, shownQuickSet, useQuickAccess } from '../../store/quickAccessStore';
import { useAutoActions } from '../../store/autoActionStore';
import { drawingColor, getState, useStore } from '../../store/store';
import { MENUS, type MenuItem as MenuEntry } from '../menus';
import { commandById } from '../commands';
import { closeDialog, toast } from '../overlays';
import { colorName, itemInfo, optionCommands, plainLabel, QUICK_ITEM_MIME, toolEntries } from '../quickItems';

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

export function QuickAccessSettingsDialog() {
  const [category, setCategory] = useState<Category>('menu');
  const [open, setOpen] = useState<Set<string>>(() => new Set(['Edit']));
  const [chosen, setChosen] = useState<QuickItem | null>(null);
  const [color, setColor] = useState(() => drawingColor(getState().colors));
  const [naming, setNaming] = useState<string | null>(null);
  const { set, selected } = useQuickAccess(useShallow((s) => ({ set: shownQuickSet(s), selected: s.selected })));
  // Sub tools and auto actions change the lists.
  useStore((s) => s.subTools);
  useAutoActions((s) => s.sets);
  const colors = useStore(useShallow((s) => [s.colors.main, s.colors.sub]));
  const item = category === 'color' ? ({ kind: 'color', color } as QuickItem) : chosen;
  const selectedItem = selected !== null ? set.items[selected] : undefined;
  const there = item ? hasItem(set, item) : false;
  const rows = rowsOf(category, open);
  const toggle = (key: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const add = (it: QuickItem | null) => {
    if (!it) return;
    if (!addQuickButton(it)) toast(`"${set.name}" has it already`);
  };

  return (
    <div className="modal qa-settings" role="dialog" aria-label="Quick Access Settings">
      <h2>Quick Access Settings</h2>
      <div className="qa-settings-body">
        <div className="qa-settings-left">
          <select
            className="prop-select"
            aria-label="Category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as Category);
              setChosen(null);
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
                <input type="color" aria-label="Drawing color to add" value={color} onChange={(e) => setColor(e.target.value)} />
              </label>
              <div className="qa-color-swatches">
                {colors.map((c, i) => (
                  <button key={i} className={`qa-swatch big ${c === color ? 'on' : ''}`} style={{ background: c }} title={i ? 'Sub color' : 'Main color'} aria-label={i ? 'Sub color' : 'Main color'} onClick={() => setColor(c)} />
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
                    className={`qa-func ${chosen && itemKey(chosen) === itemKey(r.item) ? 'on' : ''} ${hasItem(set, r.item) ? 'added' : ''}`}
                    role="treeitem"
                    aria-selected={Boolean(chosen && itemKey(chosen) === itemKey(r.item))}
                    aria-label={r.label}
                    style={{ paddingLeft: 20 + r.depth * 14 }}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData(QUICK_ITEM_MIME, JSON.stringify(r.item))}
                    onClick={() => setChosen(r.item)}
                    onDoubleClick={() => add(r.item)}
                  >
                    {r.label}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
        <div className="qa-settings-buttons">
          <button className="btn" onClick={closeDialog}>
            Close
          </button>
          <button className="btn primary" disabled={!item || there} title={there ? 'The set has it already' : ''} onClick={() => add(item)}>
            Add
          </button>
          <button className="btn" disabled={!selectedItem || selectedItem.kind === 'separator'} onClick={() => setNaming(selectedItem ? itemInfo(selectedItem).label : null)}>
            Settings…
          </button>
          <button className="btn" disabled={selected === null} onClick={() => deleteQuickButton()}>
            Delete
          </button>
          <button className="btn" onClick={addQuickSeparator}>
            Add separator
          </button>
          <button className="btn" onClick={restoreQuickDefaults}>
            Restore default layout
          </button>
        </div>
      </div>
      {naming !== null && selected !== null && (
        <form
          className="qa-naming"
          onSubmit={(e) => {
            e.preventDefault();
            renameQuickButton(selected, naming);
            setNaming(null);
          }}
        >
          <label htmlFor="qa-name">Name</label>
          <input id="qa-name" value={naming} maxLength={60} autoFocus onChange={(e) => setNaming(e.target.value)} />
          <button type="submit" className="btn small primary">
            OK
          </button>
          <button type="button" className="btn small" onClick={() => setNaming(null)}>
            Cancel
          </button>
        </form>
      )}
      <p className="muted">
        Adds to “{set.name}”{selectedItem ? `, under “${selectedItem.kind === 'separator' ? 'the separator' : itemInfo(selectedItem).label}”` : ''}. Click a button of the Quick Access palette to select it, drag buttons there to move them, or drag functions from this list onto it.
      </p>
    </div>
  );
}
