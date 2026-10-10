/**
 * Quick Access palette, like the reference's: a search bar (results with where each function is
 * found, a history, right-click > Add to Quick Access), the set list (tabs or a pop-up) and the
 * buttons of the shown set – tools and sub tools, commands, drawing colours and auto actions, with
 * separators – as tiles or a list. While Quick Access Settings is open a click selects a button and
 * buttons can be dragged; otherwise Ctrl/⌘ + drag moves them. Tools, sub tools, auto actions and
 * functions of Quick Access Settings can be dropped on it.
 */
import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { itemKey, parseQuickItem, quickLayout, QUICK_VIEWS, searchFunctions, type QuickFunction, type QuickItem } from '../../paint/quickAccess';
import {
  addQuickButton,
  addQuickSeparator,
  clearSearchHistory,
  createQuickSet,
  deleteQuickButton,
  deleteShownQuickSet,
  moveQuickButton,
  moveQuickButtonToNewSet,
  moveQuickSetTab,
  rememberSearch,
  renameQuickButton,
  renameShownQuickSet,
  selectQuickButton,
  selectQuickSet,
  setQuickSetList,
  setQuickView,
  shownQuickSet,
  toggleQuickSearchBar,
  useQuickAccess,
} from '../../store/quickAccessStore';
import { useAutoActions } from '../../store/autoActionStore';
import { useStore } from '../../store/store';
import { shortcutLabel } from '../commands';
import { openDialog, promptDialog, showMenu, toast, useOverlays, type MenuItem } from '../overlays';
import { showPalette } from '../../store/paletteActions';
import { Icon } from '../controls/Icons';
import { allFunctions, initials, itemInfo, QUICK_BUTTON_MIME, QUICK_ITEM_MIME, QUICK_SET_MIME, runQuickItem } from '../quickItems';

/** Create set… / Delete set / Manage set… (palette menu and the set tabs' context menu). */
function setItems(id = useQuickAccess.getState().current): MenuItem[] {
  const s = useQuickAccess.getState();
  const set = s.sets.find((x) => x.id === id);
  return [
    {
      label: 'Create set…',
      onClick: async () => {
        const name = await promptDialog('Create set', `Set ${s.sets.length + 1}`);
        if (name) createQuickSet(name);
      },
    },
    { label: 'Delete set', disabled: s.sets.length <= 1, onClick: () => deleteShownQuickSet(id) },
    {
      label: 'Manage set…',
      onClick: async () => {
        const name = await promptDialog('Manage set', set?.name ?? '');
        if (name) renameShownQuickSet(name, id);
      },
    },
  ];
}

/** The palette menu (≡). */
export function quickAccessMenu(): MenuItem[] {
  const s = useQuickAccess.getState();
  return [
    ...setItems(),
    { separator: true },
    {
      label: 'How to display set lists',
      submenu: [
        { label: 'Button', checked: s.setList === 'buttons', onClick: () => setQuickSetList('buttons') },
        { label: 'Pop-up', checked: s.setList === 'popup', onClick: () => setQuickSetList('popup') },
      ],
    },
    { label: 'View', submenu: QUICK_VIEWS.map((v) => ({ label: v.label, checked: s.view === v.id, onClick: () => setQuickView(v.id) })) },
    { label: 'Show search bar', checked: s.searchShown, onClick: toggleQuickSearchBar },
    { separator: true },
    { label: 'Quick Access Settings…', onClick: () => openQuickAccessSettings() },
  ];
}

/** Quick Access Settings: shows the palette and opens the dialog. */
export function openQuickAccessSettings(): void {
  showPalette('quickAccess');
  openDialog('quickAccessSettings');
}

const isSettingsOpen = (d: ReturnType<typeof useOverlays.getState>['dialog']) => d?.kind === 'custom' && d.id === 'quickAccessSettings';

/** "Add to Quick Access ▸ (sets)". */
function addToQuickAccessMenu(item: QuickItem): MenuItem[] {
  const s = useQuickAccess.getState();
  return [
    {
      label: 'Add to Quick Access',
      submenu: s.sets.map((set) => ({
        label: set.name,
        onClick: () => {
          if (addQuickButton(item, set.id)) toast(`Added to "${set.name}"`);
          else toast(`"${set.name}" has it already`);
        },
      })),
    },
  ];
}

function SearchBar() {
  const [query, setQuery] = useState('');
  const history = useQuickAccess((s) => s.history);
  // The functions as they are when searching (sub tools and auto actions change).
  const all = useMemo<QuickFunction[]>(() => (query.trim() ? allFunctions() : []), [query]);
  const results = searchFunctions(all, query, 60);
  const run = (f: QuickFunction) => {
    if (!itemInfo(f.item).enabled) return;
    rememberSearch(query);
    runQuickItem(f.item);
  };
  return (
    <div className="qa-search">
      <div className="qa-search-row">
        <button
          className="icon-btn"
          title="Search history"
          aria-label="Search history"
          onClick={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            showMenu({ x: b.left, y: b.bottom + 2 }, [
              ...(history.length ? history.map((h) => ({ label: h, onClick: () => setQuery(h) })) : [{ label: 'No history', disabled: true }]),
              { separator: true },
              { label: 'Delete history', disabled: !history.length, onClick: clearSearchHistory },
            ]);
          }}
        >
          <Icon name="zoom" size={14} />
        </button>
        <input
          className="qa-search-input"
          type="text"
          placeholder="Search"
          aria-label="Search functions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
            if (e.key === 'Enter') {
              const first = results.find((f) => itemInfo(f.item).enabled);
              if (first) run(first);
            }
            e.stopPropagation();
          }}
        />
        {query && (
          <button className="icon-btn" title="Hide search results" aria-label="Hide search results" onClick={() => setQuery('')}>
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      {query.trim() && (
        <div className="qa-results" role="listbox" aria-label="Search results">
          {results.length === 0 && <div className="qa-result none">No functions found</div>}
          {results.map((f) => {
            const info = itemInfo(f.item);
            return (
              <div
                key={`${itemKey(f.item)}|${f.where}`}
                className={`qa-result ${info.enabled ? '' : 'faded'}`}
                role="option"
                aria-selected={false}
                aria-disabled={!info.enabled}
                aria-label={f.name}
                draggable
                onDragStart={(e) => e.dataTransfer.setData(QUICK_ITEM_MIME, JSON.stringify(f.item))}
                onClick={() => run(f)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  showMenu({ x: e.clientX, y: e.clientY }, addToQuickAccessMenu(f.item));
                }}
              >
                <span className="qa-result-name">{f.name}</span>
                <span className="qa-result-where">({f.where})</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** What a drag over the buttons or the set tabs carries. */
function dragged(e: DragEvent): { button?: { set: string; index: number }; item?: QuickItem; set?: string } | null {
  const t = e.dataTransfer.types;
  if (t.includes(QUICK_BUTTON_MIME)) {
    try {
      const b = JSON.parse(e.dataTransfer.getData(QUICK_BUTTON_MIME)) as { set: string; index: number };
      return typeof b?.index === 'number' ? { button: b } : null;
    } catch {
      return null;
    }
  }
  if (t.includes(QUICK_ITEM_MIME)) {
    try {
      const item = parseQuickItem(JSON.parse(e.dataTransfer.getData(QUICK_ITEM_MIME)));
      return item ? { item } : null;
    } catch {
      return null;
    }
  }
  if (t.includes(QUICK_SET_MIME)) return { set: e.dataTransfer.getData(QUICK_SET_MIME) };
  return null;
}

const accepts = (e: DragEvent, ...types: string[]) => types.some((t) => e.dataTransfer.types.includes(t));

function SetList() {
  const { sets, current, setList } = useQuickAccess(useShallow((s) => ({ sets: s.sets, current: s.current, setList: s.setList })));
  const settingsOpen = useOverlays((s) => isSettingsOpen(s.dialog));
  if (setList === 'popup')
    return (
      <div className="qa-set-row">
        <select className="prop-select" aria-label="Quick Access set" value={current} onChange={(e) => selectQuickSet(e.target.value)}>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
    );
  const drop = (e: DragEvent, setId: string | null, index: number) => {
    const d = dragged(e);
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    if (d.set) moveQuickSetTab(d.set, index);
    else if (d.button) {
      if (setId) moveQuickButton(d.button.index, 0, setId);
      else moveQuickButtonToNewSet(d.button.index);
    } else if (d.item && setId && !addQuickButton(d.item, setId)) toast('The set has it already');
  };
  return (
    <div
      className="qa-set-tabs"
      role="tablist"
      aria-label="Quick Access sets"
      onDragOver={(e) => accepts(e, QUICK_BUTTON_MIME, QUICK_SET_MIME) && e.preventDefault()}
      // Dropped past the last tab: a set is moved to the end, a button makes a new set.
      onDrop={(e) => drop(e, null, sets.length)}
    >
      {sets.map((s, i) => (
        <button
          key={s.id}
          className={`qa-set-tab ${s.id === current ? 'active' : ''}`}
          role="tab"
          aria-selected={s.id === current}
          draggable
          onDragStart={(e) => {
            // Ctrl/⌘ + drag moves a set (any drag while Quick Access Settings is open).
            if (!settingsOpen && !(e.ctrlKey || e.metaKey)) return e.preventDefault();
            e.dataTransfer.setData(QUICK_SET_MIME, s.id);
          }}
          onDragOver={(e) => accepts(e, QUICK_BUTTON_MIME, QUICK_ITEM_MIME, QUICK_SET_MIME) && e.preventDefault()}
          onDrop={(e) => drop(e, s.id, i)}
          onClick={() => selectQuickSet(s.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            showMenu({ x: e.clientX, y: e.clientY }, setItems(s.id));
          }}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}

export function QuickAccessPalette() {
  const { set, view, selected, searchShown } = useQuickAccess(useShallow((s) => ({ set: shownQuickSet(s), view: s.view, selected: s.selected, searchShown: s.searchShown })));
  // Buttons show the current tool, colour and command states.
  useStore(useShallow((s) => [s.tool, s.activeSub, s.subTools, s.colors, s.canUndo, s.canRedo, s.selection, s.activeLayerId, s.doc, s.transforming, s.view.flipH, s.maskEditing, s.hiddenPalettes]));
  useAutoActions(useShallow((s) => [s.sets, s.recording, s.playing]));
  const settingsOpen = useOverlays((s) => isSettingsOpen(s.dialog));
  const [dropAt, setDropAt] = useState<number | null>(null);
  useEffect(() => {
    if (!settingsOpen) selectQuickButton(null);
  }, [settingsOpen]);
  const layout = quickLayout(view);
  const style: CSSProperties = layout.columns
    ? { gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, ...(layout.list ? { gridAutoRows: layout.size } : {}) }
    : layout.list
      ? { gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gridAutoRows: layout.size }
      : { gridTemplateColumns: `repeat(auto-fill, ${layout.size}px)` };

  /** Where a drop on button `i` puts it: before it, or after it on its right / lower half. */
  const dropIndex = (e: DragEvent<HTMLElement>, i: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    return layout.list && layout.columns === 1 ? (e.clientY > r.top + r.height / 2 ? i + 1 : i) : e.clientX > r.left + r.width / 2 ? i + 1 : i;
  };
  const drop = (e: DragEvent, at: number) => {
    setDropAt(null);
    const d = dragged(e);
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    if (d.button) {
      if (d.button.set === set.id) moveQuickButton(d.button.index, at);
    } else if (d.item && !addQuickButton(d.item, set.id, at)) toast('The set has it already');
  };

  return (
    <div className={`quick-access-palette ${settingsOpen ? 'editing' : ''}`} data-testid="quick-access-palette">
      {searchShown && <SearchBar />}
      <SetList />
      <div
        className={`qa-buttons ${layout.list ? 'list' : 'tiles'} ${layout.names ? '' : 'no-names'} ${layout.columns ? 'fixed' : ''}`}
        style={style}
        role="toolbar"
        aria-label="Quick Access buttons"
        onDragOver={(e) => {
          if (!accepts(e, QUICK_BUTTON_MIME, QUICK_ITEM_MIME)) return;
          e.preventDefault();
          if (e.target === e.currentTarget) setDropAt(set.items.length);
        }}
        onDragLeave={(e) => e.target === e.currentTarget && setDropAt(null)}
        onDrop={(e) => drop(e, set.items.length)}
      >
        {set.items.map((it, i) => {
          const mark = dropAt === i ? 'drop-before' : dropAt === i + 1 && i === set.items.length - 1 ? 'drop-after' : '';
          const common = {
            draggable: true,
            onDragStart: (e: DragEvent) => {
              if (!settingsOpen && !(e.ctrlKey || e.metaKey)) return e.preventDefault();
              e.dataTransfer.setData(QUICK_BUTTON_MIME, JSON.stringify({ set: set.id, index: i }));
              e.dataTransfer.effectAllowed = 'move';
            },
            onDragOver: (e: DragEvent<HTMLElement>) => {
              if (!accepts(e, QUICK_BUTTON_MIME, QUICK_ITEM_MIME)) return;
              e.preventDefault();
              e.stopPropagation();
              setDropAt(dropIndex(e, i));
            },
            onDrop: (e: DragEvent<HTMLElement>) => drop(e, dropIndex(e, i)),
            onDragEnd: () => setDropAt(null),
          };
          if (it.kind === 'separator')
            return (
              <div
                key={`sep-${i}`}
                className={`qa-sep ${selected === i ? 'sel' : ''} ${mark}`}
                role="separator"
                aria-label="Separator"
                onClick={() => settingsOpen && selectQuickButton(i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  showMenu({ x: e.clientX, y: e.clientY }, [{ label: 'Delete', onClick: () => deleteQuickButton(i) }]);
                }}
                {...common}
              />
            );
          const info = itemInfo(it);
          const sc = it.kind === 'command' ? shortcutLabel(it.id) : undefined;
          return (
            <button
              key={`${itemKey(it)}-${i}`}
              className={`qa-btn ${info.active ? 'on' : ''} ${info.enabled ? '' : 'off'} ${selected === i ? 'sel' : ''} ${info.missing ? 'missing' : ''} ${mark}`}
              title={sc ? `${info.label} (${sc})` : info.label}
              aria-label={info.label}
              aria-pressed={info.active}
              // While Quick Access Settings is open every button can be selected.
              aria-disabled={!settingsOpen && !info.enabled}
              data-kind={it.kind}
              onClick={() => (settingsOpen ? selectQuickButton(i) : runQuickItem(it))}
              onContextMenu={(e) => {
                e.preventDefault();
                selectQuickButton(settingsOpen ? i : null);
                showMenu({ x: e.clientX, y: e.clientY }, [
                  {
                    label: 'Settings…',
                    onClick: async () => {
                      const name = await promptDialog('Name settings', info.label);
                      if (name !== null) renameQuickButton(i, name);
                    },
                  },
                  {
                    label: 'Add separator',
                    onClick: () => {
                      selectQuickButton(i);
                      addQuickSeparator();
                    },
                  },
                  { label: 'Delete', onClick: () => deleteQuickButton(i) },
                  { separator: true },
                  { label: 'Quick Access Settings…', onClick: openQuickAccessSettings },
                ]);
              }}
              {...common}
            >
              <span className="qa-icon">{info.swatch ? <span className="qa-swatch" style={{ background: info.swatch }} /> : info.icon ? <Icon name={info.icon} size={layout.list ? 15 : 18} /> : <span className="qa-initials">{initials(info.label)}</span>}</span>
              {layout.names && <span className="qa-name">{info.label}</span>}
            </button>
          );
        })}
        {set.items.length === 0 && <div className="prop-note">No buttons yet: add them in Quick Access Settings, or drop tools, sub tools and auto actions here.</div>}
      </div>
    </div>
  );
}
