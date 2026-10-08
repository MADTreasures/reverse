/**
 * Typing on the canvas: a text field laid over the text box with the view's zoom and rotation, so
 * the text appears where it will be drawn (system text input, so IME input works). Below it the
 * text launcher: Advanced Tool Settings, OK, Cancel. ⌘Enter confirms, Esc cancels.
 */
import { useEffect, useRef } from 'react';
import { fontString, frameMatrix } from '../../paint/text';
import { multiply, viewMatrix, apply as applyMatrix } from '../../paint/viewMath';
import { setState, useStore } from '../../store/store';
import { cancelTextEdit, commitTextEdit, updateTextEdit } from '../../store/textActions';
import { Icon } from '../controls/Icons';

export function TextEditor() {
  const edit = useStore((s) => s.textEdit);
  const view = useStore((s) => s.view);
  const viewport = useStore((s) => s.viewport);
  const width = useStore((s) => s.doc.width);
  const height = useStore((s) => s.doc.height);
  const tool = useStore((s) => s.tool);
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxId = edit?.box.id;

  // Focus the field when editing starts, with the caret at the end.
  useEffect(() => {
    const el = ref.current;
    if (!el || !boxId) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [boxId]);

  // Switching to another tool confirms the text.
  useEffect(() => {
    if (tool !== 'text' && tool !== 'object') commitTextEdit();
  }, [tool]);

  if (!edit) return null;
  const box = edit.box;
  const m = multiply(viewMatrix(view, viewport, { w: width, h: height }), frameMatrix(box));
  // A little room for the caret when the frame follows the text.
  const slack = box.wrap ? 0 : box.size;
  const below = [
    [0, box.h],
    [box.w, box.h],
  ].map(([x, y]) => applyMatrix(m, x, y));
  const launcher = { left: Math.min(Math.max((below[0].x + below[1].x) / 2, 90), viewport.w - 90), top: Math.min(Math.max(below[0].y, below[1].y) + 8, viewport.h - 40) };
  return (
    <>
      <textarea
        ref={ref}
        className="text-editor"
        data-testid="text-editor"
        aria-label="Text"
        spellCheck={false}
        value={box.text}
        wrap={box.wrap ? 'soft' : 'off'}
        onChange={(e) => updateTextEdit({ text: e.target.value })}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            cancelTextEdit();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commitTextEdit();
          }
        }}
        style={{
          transform: `matrix(${m.join(',')})`,
          width: box.w + slack,
          height: box.h + (box.vertical ? slack : 0),
          font: fontString(box),
          lineHeight: box.lineSpacing,
          letterSpacing: `${box.letterSpacing}px`,
          color: box.color,
          textAlign: box.align,
          writingMode: box.vertical ? 'vertical-rl' : 'horizontal-tb',
          whiteSpace: box.wrap ? 'pre-wrap' : 'pre',
          textDecoration: [box.underline ? 'underline' : '', box.strike ? 'line-through' : ''].join(' ').trim() || 'none',
          outlineWidth: `${1 / Math.max(0.01, view.zoom)}px`,
        }}
      />
      <div className="text-launcher" style={launcher} data-testid="text-launcher" onPointerDown={(e) => e.stopPropagation()}>
        <button className="icon-btn" title="Advanced Tool Settings" aria-label="Advanced tool settings" onClick={() => setState((s) => ({ advancedToolSettings: !s.advancedToolSettings }))}>
          <Icon name="wrench" size={15} />
        </button>
        <button className="icon-btn" title="OK (⌘Enter)" aria-label="Confirm text" onClick={commitTextEdit}>
          <Icon name="check" size={15} />
        </button>
        <button className="icon-btn" title="Cancel (Esc)" aria-label="Cancel text" onClick={cancelTextEdit}>
          <Icon name="close" size={15} />
        </button>
      </div>
    </>
  );
}
