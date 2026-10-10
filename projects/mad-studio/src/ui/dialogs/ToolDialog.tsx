import { useEffect, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { defaultToolValues, findTool, type ToolContext, type ToolParam, type ToolValues } from '../../model/noteTools';
import type { Note } from '../../model/types';
import { commitPreview, previewNotes } from '../../store/actions';
import { useStore } from '../../store/store';
import { Knob } from '../controls/Knob';
import { closeDialog } from '../overlays';

/** Last used values per tool (FL Studio keeps a tool's settings for the session). */
const remembered = new Map<string, ToolValues>();

function ParamControl({ param, value, onChange }: { param: ToolParam; value: ToolValues[string]; onChange: (v: ToolValues[string]) => void }) {
  if (param.kind === 'number') {
    return (
      <Knob
        size={34}
        label={param.label}
        showLabel
        value={typeof value === 'number' ? value : param.def}
        min={param.min}
        max={param.max}
        integer={param.integer}
        bipolar={param.bipolar}
        defaultValue={param.def}
        format={param.format}
        onChange={(v) => onChange(param.integer ? Math.round(v) : v)}
      />
    );
  }
  if (param.kind === 'bool') {
    return (
      <label className="tool-bool">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        {param.label}
      </label>
    );
  }
  return (
    <label className="tool-choice">
      <span>{param.label}</span>
      <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {param.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * A piano roll tool with parameters. Every change re-applies the tool to the notes as they were when
 * the dialog opened, so the result is visible (and audible while playing) right away; Accept records
 * one undo step, Cancel or Esc restores the notes.
 */
export function ToolDialog({ toolId, patternId, channelId, selected, ctx }: { toolId: string; patternId: string; channelId: string; selected: string[]; ctx: ToolContext }) {
  const tool = findTool(toolId);
  const before = useRef(useStore.getState().project);
  const original = useRef<Note[]>(before.current.patterns.find((p) => p.id === patternId)?.notes[channelId] ?? []);
  const accepted = useRef(false);
  const [values, setValues] = useState<ToolValues>(() => (tool ? { ...defaultToolValues(tool, ctx), ...remembered.get(toolId) } : {}));

  useEffect(() => {
    if (!tool) return;
    previewNotes(patternId, channelId, tool.apply(original.current, new Set(selected), values, ctx));
  }, [tool, patternId, channelId, selected, values, ctx]);

  // Closing without Accept (Cancel, Esc, a click outside) restores the notes.
  useEffect(
    () => () => {
      if (!accepted.current) previewNotes(patternId, channelId, original.current);
    },
    [patternId, channelId],
  );

  if (!tool) return null;
  const set = (key: string, v: ToolValues[string]) =>
    setValues((old) => {
      const next = { ...old, [key]: v };
      remembered.set(toolId, next);
      return next;
    });
  const numbers = tool.params.filter((p) => p.kind === 'number');
  const others = tool.params.filter((p) => p.kind !== 'number');

  return (
    <form
      className="modal small tool-dialog"
      role="dialog"
      aria-label={tool.label.replace('…', '')}
      onSubmit={(e) => {
        e.preventDefault();
        accepted.current = true;
        commitPreview(before.current, `piano roll ${tool.label.replace('…', '').toLowerCase()}`);
        closeDialog();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') closeDialog();
        // Space plays and stops, to listen to the preview (not while a checkbox or list has the focus).
        if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
          e.preventDefault();
          engine.togglePlay();
        }
      }}
    >
      <h2>{tool.label.replace('…', '')}</h2>
      <p className="tool-description">
        {tool.description} {selected.length ? `${selected.length} selected note${selected.length === 1 ? '' : 's'}.` : 'All notes of the channel (nothing selected).'}
      </p>
      {others.length > 0 && (
        <div className="tool-options">
          {others.map((p) => (
            <ParamControl key={p.key} param={p} value={values[p.key]} onChange={(v) => set(p.key, v)} />
          ))}
        </div>
      )}
      {numbers.length > 0 && (
        <div className="tool-knobs">
          {numbers.map((p) => (
            <ParamControl key={p.key} param={p} value={values[p.key]} onChange={(v) => set(p.key, v)} />
          ))}
        </div>
      )}
      <div className="modal-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            remembered.delete(toolId);
            setValues(defaultToolValues(tool, ctx));
          }}
        >
          Reset
        </button>
        <button type="button" className="btn" onClick={() => closeDialog()}>
          Cancel
        </button>
        <button type="submit" className="btn primary">
          Accept
        </button>
      </div>
    </form>
  );
}
