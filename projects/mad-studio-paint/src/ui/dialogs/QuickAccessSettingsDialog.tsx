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
import { hasItem, type QuickItem } from '../../paint/quickAccess';
import { addQuickButton, addQuickSeparator, deleteQuickButton, renameQuickButton, restoreQuickDefaults, shownQuickSet, useQuickAccess } from '../../store/quickAccessStore';
import { closeDialog, toast } from '../overlays';
import { itemInfo } from '../quickItems';
import { FunctionPicker } from './FunctionPicker';

export function QuickAccessSettingsDialog() {
  const [item, setItem] = useState<QuickItem | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const { set, selected } = useQuickAccess(useShallow((s) => ({ set: shownQuickSet(s), selected: s.selected })));
  const selectedItem = selected !== null ? set.items[selected] : undefined;
  const there = item ? hasItem(set, item) : false;
  const add = (it: QuickItem | null) => {
    if (!it) return;
    if (!addQuickButton(it)) toast(`"${set.name}" has it already`);
  };

  return (
    <div className="modal qa-settings" role="dialog" aria-label="Quick Access Settings">
      <h2>Quick Access Settings</h2>
      <div className="qa-settings-body">
        <FunctionPicker onChoose={setItem} onAdd={add} isAdded={(it) => hasItem(set, it)} />
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
