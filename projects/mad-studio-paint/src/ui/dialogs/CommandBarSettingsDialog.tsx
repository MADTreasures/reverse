/**
 * Command Bar Settings, like the reference's: a category (Menu commands, Options, Tool, Auto
 * Action, Drawing color) and its functions; Add puts the chosen one to the right of the selected
 * icon of the Command Bar (or at its end), Settings names the selected icon (its tooltip), Delete
 * removes it, Add separator puts a separator to its right, Restore default layout brings back the
 * workspace's default icons. The bar stays usable while it is open: a click selects an icon, a drag
 * moves it, and functions can be dragged from the list onto it.
 */
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { hasItem, type QuickItem } from '../../paint/quickAccess';
import { addCommandBarIcon, addCommandBarSeparator, commandBarItems, deleteCommandBarIcon, renameCommandBarIcon, restoreCommandBar, useCommandBar } from '../../store/commandBarStore';
import { useStore } from '../../store/store';
import { closeDialog, toast } from '../overlays';
import { itemInfo } from '../quickItems';
import { FunctionPicker } from './FunctionPicker';

export function CommandBarSettingsDialog() {
  const [item, setItem] = useState<QuickItem | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const workspace = useStore((s) => s.workspace);
  const { items, selected } = useCommandBar(useShallow((s) => ({ items: commandBarItems(workspace, s), selected: s.selected })));
  const bar = { id: 'bar', name: 'Command Bar', items };
  const selectedItem = selected !== null ? items[selected] : undefined;
  const there = item ? hasItem(bar, item) : false;
  const add = (it: QuickItem | null) => {
    if (it && !addCommandBarIcon(it)) toast('The Command Bar has it already');
  };

  return (
    <div className="modal qa-settings" role="dialog" aria-label="Command Bar Settings">
      <h2>Command Bar Settings</h2>
      <div className="qa-settings-body">
        <FunctionPicker onChoose={setItem} onAdd={add} isAdded={(it) => hasItem(bar, it)} />
        <div className="qa-settings-buttons">
          <button className="btn" onClick={closeDialog}>
            Close
          </button>
          <button className="btn primary" disabled={!item || there} title={there ? 'The Command Bar has it already' : ''} onClick={() => add(item)}>
            Add
          </button>
          <button className="btn" disabled={!selectedItem || selectedItem.kind === 'separator'} onClick={() => setNaming(selectedItem ? itemInfo(selectedItem).label : null)}>
            Settings…
          </button>
          <button className="btn" disabled={selected === null} onClick={() => deleteCommandBarIcon()}>
            Delete
          </button>
          <button className="btn" onClick={addCommandBarSeparator}>
            Add separator
          </button>
          <button className="btn" onClick={restoreCommandBar}>
            Restore default layout
          </button>
        </div>
      </div>
      {naming !== null && selected !== null && (
        <form
          className="qa-naming"
          onSubmit={(e) => {
            e.preventDefault();
            renameCommandBarIcon(selected, naming);
            setNaming(null);
          }}
        >
          <label htmlFor="cb-name">Name</label>
          <input id="cb-name" value={naming} maxLength={60} autoFocus onChange={(e) => setNaming(e.target.value)} />
          <button type="submit" className="btn small primary">
            OK
          </button>
          <button type="button" className="btn small" onClick={() => setNaming(null)}>
            Cancel
          </button>
        </form>
      )}
      <p className="muted">
        The Command Bar of the {workspace === 'classic' ? 'classic' : 'default'} workspace{selectedItem ? `; adds to the right of “${selectedItem.kind === 'separator' ? 'the separator' : itemInfo(selectedItem).label}”` : ''}. Click an icon of the Command Bar to select it, drag icons there to move them, or drag functions from this list onto it.
      </p>
    </div>
  );
}
