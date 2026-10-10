import { useState } from 'react';
import { hexToRgb, rgbToHls, rgbToHsv } from '../../model/color';
import { addStandardSet, createSet, deleteSet, duplicateSet, editColors, moveSet, renameSet, STANDARD_SETS, type ColorSets } from '../../paint/colorSets';
import * as actions from '../../store/actions';
import { drawingColor, getState, useStore } from '../../store/store';
import { Icon } from '../controls/Icons';
import { closeDialog, openDialog } from '../overlays';

/** The first standard set (kept for callers that want a plain list). */
export const DEFAULT_COLOR_SET: string[] = STANDARD_SETS[0].colors;

/**
 * Color Set palette: the set chosen at the top (the wrench edits the sets), a grid of colours –
 * click to use, ⌥-click to replace with the drawing colour – and replace / add / delete below.
 */
export function ColorSet() {
  const cs = useStore((s) => s.colorSets);
  const space = useStore((s) => s.colorSpace);
  const [selected, setSelected] = useState<number | null>(null);
  const [readout, setReadout] = useState<'rgb' | 'space'>('rgb');
  const current = useStore((s) => drawingColor(s.colors));
  const set = cs.sets[cs.current];
  const save = (next: ColorSets) => actions.setColorSets(next);
  const shown = selected !== null && set.colors[selected] ? set.colors[selected] : current;
  const rgb = hexToRgb(shown)!;
  const replace = (i: number) => save(editColors(cs, (colors) => colors.map((c, k) => (k === i ? current : c))));
  return (
    <div className="color-set" data-testid="color-set">
      <div className="color-set-bar">
        <select
          className="prop-select"
          aria-label="Color set"
          value={cs.current}
          onChange={(e) => {
            setSelected(null);
            save({ ...cs, current: Number(e.target.value) });
          }}
        >
          {cs.sets.map((s, i) => (
            <option key={i} value={i}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="icon-btn" title="Edit color sets" aria-label="Edit color sets" onClick={() => openDialog('colorSets')}>
          <Icon name="wrench" size={14} />
        </button>
      </div>
      <div className="color-set-grid">
        {set.colors.map((c, i) => {
          const v = hexToRgb(c)!;
          return (
            <button
              key={i}
              className={`swatch ${selected === i ? 'selected' : ''}`}
              style={{ background: c }}
              title={`${c}  R ${v.r} G ${v.g} B ${v.b}`}
              aria-label={c}
              onClick={(e) => {
                setSelected(i);
                // ⌥-click: replace the tile with the drawing colour.
                if (e.altKey) replace(i);
                else actions.setDrawingColor(c);
              }}
            />
          );
        })}
      </div>
      <div className="color-set-footer">
        <button className="rgb-readout" title="Click to switch between RGB and HSV/HLS values" onClick={() => setReadout((r) => (r === 'rgb' ? 'space' : 'rgb'))}>
          {readout === 'rgb' ? (
            <>
              <i style={{ background: '#d33' }} />
              {rgb.r} <i style={{ background: '#3a3' }} />
              {rgb.g} <i style={{ background: '#36d' }} />
              {rgb.b}
            </>
          ) : space === 'hsv' ? (
            (() => {
              const v = rgbToHsv(rgb);
              return `H ${Math.round(v.h)} S ${Math.round(v.s * 100)} V ${Math.round(v.v * 100)}`;
            })()
          ) : (
            (() => {
              const v = rgbToHls(rgb);
              return `H ${Math.round(v.h)} L ${Math.round(v.l * 100)} S ${Math.round(v.s * 100)}`;
            })()
          )}
        </button>
        <span className="spacer" />
        <button className="icon-btn" title="Replace the selected color with the drawing color" aria-label="Replace color" disabled={selected === null} onClick={() => selected !== null && replace(selected)}>
          <Icon name="swap" size={14} />
        </button>
        <button
          className="icon-btn"
          title="Add the drawing color"
          aria-label="Add color"
          onClick={() =>
            // The new tile goes in front of the selected one (at the end without a selection).
            save(editColors(cs, (colors) => (selected === null ? [...colors, current] : [...colors.slice(0, selected), current, ...colors.slice(selected)])))
          }
        >
          <Icon name="newLayer" size={14} />
        </button>
        <button
          className="icon-btn"
          title="Delete the selected color"
          aria-label="Delete color"
          disabled={selected === null}
          onClick={() => {
            if (selected === null) return;
            save(editColors(cs, (colors) => colors.filter((_, i) => i !== selected)));
            setSelected(null);
          }}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  );
}

/** Edit color sets: the list of sets with create, add standard, duplicate, delete, rename (also by double click) and reorder (drag). */
export function ColorSetsDialog() {
  const [cs, setCs] = useState<ColorSets>(() => getState().colorSets);
  const [drag, setDrag] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <form
      className="modal color-sets-dialog"
      role="dialog"
      aria-label="Edit color sets"
      onSubmit={(e) => {
        e.preventDefault();
        if (editing !== null) {
          setEditing(null);
          return;
        }
        actions.setColorSets(cs);
        closeDialog();
      }}
    >
      <h2>Edit color sets</h2>
      <div className="grid-settings-body">
        <ul className="color-set-list" role="listbox" aria-label="Color sets">
          {cs.sets.map((s, i) => (
            <li
              key={i}
              role="option"
              aria-selected={i === cs.current}
              className={i === cs.current ? 'selected' : ''}
              draggable={editing === null}
              onClick={() => setCs((c) => ({ ...c, current: i }))}
              onDoubleClick={() => setEditing(i)}
              onDragStart={() => setDrag(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (drag !== null) setCs((c) => moveSet(c, drag, i));
                setDrag(null);
              }}
            >
              {editing === i ? (
                <input
                  className="set-name-input"
                  aria-label="Color set name"
                  autoFocus
                  defaultValue={s.name}
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => {
                    setCs((c) => renameSet(c, i, e.target.value));
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setCs((c) => renameSet(c, i, (e.target as HTMLInputElement).value));
                      setEditing(null);
                    } else if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <span className="set-name">{s.name}</span>
              )}
              <span className="set-count">{s.colors.length}</span>
              <span className="set-grip" aria-hidden>
                ≡
              </span>
            </li>
          ))}
        </ul>
        <div className="filter-side">
          <button type="submit" className="btn primary">
            OK
          </button>
          <button type="button" className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <span className="side-gap" />
          <button
            type="button"
            className="btn"
            onClick={() => {
              const next = createSet(cs, 'New color set');
              setCs(next);
              setEditing(next.current);
            }}
          >
            Create new set
          </button>
          <button type="button" className="btn" onClick={() => setCs((c) => addStandardSet(c))}>
            Add standard set
          </button>
          <button type="button" className="btn" onClick={() => setCs((c) => duplicateSet(c))}>
            Duplicate set
          </button>
          <button type="button" className="btn" disabled={cs.sets.length <= 1} onClick={() => setCs((c) => deleteSet(c))}>
            Delete
          </button>
          <button type="button" className="btn" onClick={() => setEditing(cs.current)}>
            Rename
          </button>
        </div>
      </div>
    </form>
  );
}
