/**
 * File > Shortcut Settings, like the reference's: a category (Menu commands, Options, Tools, Auto
 * Actions), the list of its functions with their shortcuts, an information box, and Edit shortcut
 * (press the keys; Enter or a click confirms, Esc cancels), Add shortcut, Delete shortcut and Reset.
 * OK keeps the changes. A shortcut set on a function leaves the one that had it (tools can share).
 */
import { useEffect, useState } from 'react';
import { addShortcut, deleteShortcut, effectiveShortcuts, isToolTarget, isValidShortcut, replaceShortcut, targetsOf, type ShortcutMap, type ShortcutTarget } from '../../model/shortcutMap';
import { TOOLS } from '../../paint/tools';
import { isMac } from '../../platform/platform';
import { setShortcutOverrides, useShortcuts } from '../../store/shortcutStore';
import { useAutoActions } from '../../store/autoActionStore';
import { commandById, DEFAULT_SHORTCUTS } from '../commands';
import { MENUS, type MenuItem as MenuEntry } from '../menus';
import { closeDialog, setKeyCapture } from '../overlays';
import { optionCommands, plainLabel } from '../quickItems';
import { eventToShortcut, formatShortcut } from '../shortcuts';

type Category = 'menu' | 'options' | 'tools' | 'actions';

const CATEGORIES: [Category, string][] = [
  ['menu', 'Menu commands'],
  ['options', 'Options'],
  ['tools', 'Tools'],
  ['actions', 'Auto Actions'],
];

type Row = { kind: 'group'; key: string; label: string; depth: number } | { kind: 'item'; target: ShortcutTarget; label: string; depth: number };

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
        if (c) rows.push({ kind: 'item', target: `command:${i}`, label: plainLabel(c.label), depth });
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
  if (category === 'options') return optionCommands().map((id): Row => ({ kind: 'item', target: `command:${id}`, label: plainLabel(commandById(id)!.label), depth: 0 }));
  if (category === 'tools') return TOOLS.map((t): Row => ({ kind: 'item', target: `tool:${t.id}`, label: t.label, depth: 0 }));
  return useAutoActions.getState().sets.flatMap((set): Row[] => [
    { kind: 'group', key: set.id, label: set.name, depth: 0 },
    ...(open.has(set.id) ? set.actions.map((a): Row => ({ kind: 'item', target: `action:${a.id}`, label: a.name, depth: 1 })) : []),
  ]);
}

/** A function's name as the information box shows it. */
export function targetName(target: ShortcutTarget): string {
  const [kind, id] = [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)];
  if (kind === 'command') return plainLabel(commandById(id)?.label ?? id);
  if (kind === 'tool') return `${TOOLS.find((t) => t.id === id)?.label ?? id} (tool)`;
  const a = useAutoActions.getState().sets.flatMap((s) => s.actions).find((x) => x.id === id);
  return `${a?.name ?? id} (auto action)`;
}

const show = (keys: string[]) => keys.map((k) => formatShortcut(k, isMac)).join(', ');

export function ShortcutSettingsDialog() {
  const [category, setCategory] = useState<Category>('menu');
  const [open, setOpen] = useState<Set<string>>(() => new Set(['File', 'Edit']));
  const [draft, setDraft] = useState<ShortcutMap>(() => useShortcuts.getState().overrides);
  const [chosen, setChosen] = useState<ShortcutTarget | null>(null);
  /** Edit shortcut / Add shortcut in progress: the keys pressed so far. */
  const [capture, setCapture] = useState<{ mode: 'edit' | 'add'; keys: string | null } | null>(null);
  const [note, setNote] = useState('');
  const map = effectiveShortcuts(DEFAULT_SHORTCUTS, draft);
  const rows = rowsOf(category, open);
  const keys = chosen ? (map[chosen] ?? []) : [];

  const commit = (c = capture) => {
    if (!c || !chosen) return setCapture(null);
    setCapture(null);
    if (!c.keys) return;
    const r = c.mode === 'add' ? addShortcut(DEFAULT_SHORTCUTS, draft, chosen, c.keys) : replaceShortcut(DEFAULT_SHORTCUTS, draft, chosen, keys[0] ?? null, c.keys);
    setDraft(r.overrides);
    setNote(r.moved.length ? `${formatShortcut(c.keys, isMac)} was taken from ${r.moved.map(targetName).join(', ')}.` : '');
  };

  // While capturing, keys go to the shortcut (Esc cancels, Enter confirms); nothing else gets them.
  useEffect(() => {
    if (!capture) return;
    setKeyCapture(true);
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (['Shift', 'Alt', 'Meta', 'Control', 'CapsLock'].includes(e.key)) return;
      if (e.key === 'Escape') return setCapture(null);
      if (e.key === 'Enter' && capture.keys) return commit(capture);
      const s = eventToShortcut({ key: e.key, code: e.code, shift: e.shiftKey, alt: e.altKey, mod: isMac ? e.metaKey : e.ctrlKey });
      if (isValidShortcut(s)) setCapture({ ...capture, keys: s });
    };
    window.addEventListener('keydown', down, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      setKeyCapture(false);
    };
  });

  const toggle = (key: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const pending = capture?.keys ? targetsOf(map, capture.keys).filter((t) => t !== chosen && !(isToolTarget(t) && chosen && isToolTarget(chosen))) : [];

  return (
    <div className="modal shortcut-settings" role="dialog" aria-label="Shortcut Settings" onPointerDown={(e) => capture && !(e.target as HTMLElement).closest('.capture-keep') && commit()}>
      <h2>Shortcut Settings</h2>
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
          <div key={category} className="qa-func-list shortcut-list" role="tree" aria-label="Shortcuts">
            {rows.map((r, n) =>
              r.kind === 'group' ? (
                <div key={`g-${r.key}`} className="qa-func group" role="treeitem" aria-expanded={open.has(r.key)} aria-label={r.label} style={{ paddingLeft: 6 + r.depth * 14 }} onClick={() => toggle(r.key)}>
                  <span className="twist">{open.has(r.key) ? '▾' : '▸'}</span>
                  {r.label}
                </div>
              ) : (
                <div
                  key={`i-${r.target}-${n}`}
                  className={`qa-func shortcut-row ${chosen === r.target ? 'on' : ''}`}
                  role="treeitem"
                  aria-selected={chosen === r.target}
                  aria-label={r.label}
                  style={{ paddingLeft: 20 + r.depth * 14 }}
                  onClick={() => {
                    setChosen(r.target);
                    setNote('');
                  }}
                  onDoubleClick={() => setCapture({ mode: 'edit', keys: null })}
                >
                  <span className="shortcut-name">{r.label}</span>
                  <span className="shortcut-keys">{chosen === r.target && capture ? (capture.keys ? formatShortcut(capture.keys, isMac) : 'Press keys…') : show(map[r.target] ?? [])}</span>
                </div>
              ),
            )}
          </div>
          <div className="shortcut-info" role="status" aria-label="Information">
            {!chosen && 'Select a function to set its shortcut.'}
            {chosen && !capture && (keys.length ? `${targetName(chosen)}: ${show(keys)}` : `${targetName(chosen)}: no shortcut`)}
            {chosen && capture && (capture.keys ? `${formatShortcut(capture.keys, isMac)}${pending.length ? ` – used by ${pending.map(targetName).join(', ')}; it moves here` : ''}. Enter or a click sets it, Esc cancels.` : 'Press the keys for the shortcut (Esc cancels).')}
            {chosen && !capture && note && <div className="muted">{note}</div>}
          </div>
        </div>
        <div className="qa-settings-buttons capture-keep">
          <button className="btn" disabled={!chosen} onClick={() => (capture ? commit() : setCapture({ mode: 'edit', keys: null }))}>
            Edit shortcut
          </button>
          <button className="btn" disabled={!chosen} onClick={() => (capture ? commit() : setCapture({ mode: 'add', keys: null }))}>
            Add shortcut
          </button>
          <button
            className="btn"
            disabled={!chosen || !keys.length}
            onClick={() => {
              if (!chosen) return;
              setDraft(deleteShortcut(DEFAULT_SHORTCUTS, draft, chosen, keys[keys.length - 1]));
              setNote('');
            }}
          >
            Delete shortcut
          </button>
          <button
            className="btn"
            onClick={() => {
              setDraft({});
              setNote('All shortcuts are back to their defaults.');
            }}
          >
            Reset
          </button>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={() => {
            setShortcutOverrides(draft);
            closeDialog();
          }}
        >
          OK
        </button>
      </div>
      <p className="muted">Tools can share a shortcut: pressing it again switches between them. Esc cannot be a shortcut.</p>
    </div>
  );
}
