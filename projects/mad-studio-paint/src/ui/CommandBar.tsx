import { useEffect, useState, type DragEvent } from 'react';
import { isElectron } from '../platform/platform';
import { useShallow } from 'zustand/react/shallow';
import { parseQuickItem } from '../paint/quickAccess';
import { useStore } from '../store/store';
import { useShortcuts } from '../store/shortcutStore';
import { useAutoActions } from '../store/autoActionStore';
import { addCommandBarIcon, commandBarItems, moveCommandBarIcon, selectCommandBarIcon, useCommandBar } from '../store/commandBarStore';
import { runCommand, shortcutLabel } from './commands';
import { Icon } from './controls/Icons';
import { openDialog, showMenu, toast, useOverlays } from './overlays';
import { initials, itemInfo, QUICK_ITEM_MIME, runQuickItem } from './quickItems';

/** Drag data: a Command Bar icon being moved (its index). */
const ICON_MIME = 'application/x-mad-command-icon';

/** The Mac app has no separate title bar: the document title sits at the end of the command bar. */
function WindowTitle() {
  const doc = useStore((s) => s.doc);
  const dirty = useStore((s) => s.dirty);
  const zoom = useStore((s) => s.view.zoom);
  return (
    <span className="window-title">
      {doc.name}
      {dirty ? '*' : ''} ({doc.width} x {doc.height}px {doc.dpi}dpi {Math.round(zoom * 1000) / 10}%)
    </span>
  );
}

/** File > Command Bar Settings (also from the bar's context menu). */
export const openCommandBarSettings = () => openDialog('commandBarSettings');

/**
 * The Command Bar under the menu bar, like the reference's: icons for commands, tools, auto actions
 * and drawing colours, set up per workspace in Command Bar Settings. While that is open a click
 * selects an icon and icons can be dragged; tools, sub tools, auto actions and functions can be
 * dropped on the bar.
 */
export function CommandBar() {
  // Icons show the current states.
  useStore(useShallow((s) => [s.canUndo, s.canRedo, s.selection, s.activeLayerId, s.doc, s.transforming, s.view.flipH, s.showSelectionBorder, s.snapRuler, s.snapSpecial, s.tool, s.selectedRuler, s.activeSub, s.subTools, s.colors]));
  useAutoActions(useShallow((s) => [s.sets, s.recording, s.playing]));
  useShortcuts((s) => s.overrides);
  const transforming = useStore((s) => s.transforming);
  const workspace = useStore((s) => s.workspace);
  const items = useCommandBar((s) => commandBarItems(workspace, s));
  const selected = useCommandBar((s) => s.selected);
  const editing = useOverlays((s) => s.dialog?.kind === 'custom' && s.dialog.id === 'commandBarSettings');
  const [dropAt, setDropAt] = useState<number | null>(null);
  useEffect(() => {
    if (!editing) selectCommandBarIcon(null);
  }, [editing]);

  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(QUICK_ITEM_MIME) || e.dataTransfer.types.includes(ICON_MIME);
  /** Before icon `i`, or after it on its right half. */
  const at = (e: DragEvent<HTMLElement>, i: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX > r.left + r.width / 2 ? i + 1 : i;
  };
  const drop = (e: DragEvent, index: number) => {
    setDropAt(null);
    if (!accepts(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes(ICON_MIME)) return moveCommandBarIcon(Number(e.dataTransfer.getData(ICON_MIME)), index);
    try {
      const item = parseQuickItem(JSON.parse(e.dataTransfer.getData(QUICK_ITEM_MIME)));
      if (item && !addCommandBarIcon(item, index)) toast('The Command Bar has it already');
    } catch {
      // Not a function.
    }
  };
  const common = (i: number) => ({
    draggable: editing,
    onDragStart: (e: DragEvent) => e.dataTransfer.setData(ICON_MIME, String(i)),
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropAt(at(e, i));
    },
    onDrop: (e: DragEvent<HTMLElement>) => drop(e, at(e, i)),
    onDragEnd: () => setDropAt(null),
  });

  return (
    <div
      className={`command-bar ${isElectron ? 'electron' : ''} ${editing ? 'editing' : ''}`}
      role="toolbar"
      aria-label="Command bar"
      onContextMenu={(e) => {
        e.preventDefault();
        showMenu({ x: e.clientX, y: e.clientY }, [{ label: 'Command Bar Settings…', onClick: openCommandBarSettings }]);
      }}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        setDropAt(items.length);
      }}
      onDragLeave={(e) => e.target === e.currentTarget && setDropAt(null)}
      onDrop={(e) => drop(e, items.length)}
    >
      <div className="cmd-items">
      {items.map((it, i) => {
        const mark = dropAt === i ? 'drop-before' : dropAt === items.length && i === items.length - 1 ? 'drop-after' : '';
        if (it.kind === 'separator')
          return <span key={`sep-${i}`} className={`cmd-sep ${selected === i ? 'sel' : ''} ${mark}`} role="separator" aria-label="Separator" onClick={() => editing && selectCommandBarIcon(i)} {...common(i)} />;
        const info = itemInfo(it);
        const sc = it.kind === 'command' ? shortcutLabel(it.id) : undefined;
        return (
          <button
            key={`${i}-${it.kind}`}
            className={`icon-btn cmd ${info.active ? 'on' : ''} ${selected === i ? 'sel' : ''} ${mark}`}
            title={sc ? `${info.label} (${sc})` : info.label}
            aria-label={info.label}
            aria-pressed={info.active || undefined}
            disabled={!editing && !info.enabled}
            onClick={() => (editing ? selectCommandBarIcon(i) : runQuickItem(it))}
            {...common(i)}
          >
            {info.swatch ? <span className="qa-swatch" style={{ background: info.swatch }} /> : info.icon ? <Icon name={info.icon} /> : <span className="qa-initials">{initials(info.label)}</span>}
          </button>
        );
      })}
      </div>
      {isElectron && <WindowTitle />}
      {transforming && (
        <div className="cmd-group transform-actions">
          <button className="btn primary small" onClick={() => void runCommand('confirmTransform')}>
            OK
          </button>
          <button className="btn small" onClick={() => void runCommand('cancelTransform')}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
