import { useMemo } from 'react';
import { maskBounds } from '../../paint/mask';
import { apply as applyMatrix, viewMatrix } from '../../paint/viewMath';
import * as actions from '../../store/actions';
import { copyAndPaste, cutAndPaste } from '../../store/clipboard';
import { useStore } from '../../store/store';
import { controller } from '../../tools/controller';
import { startTransform } from '../../tools/transform';
import { Icon } from '../controls/Icons';
import { promptDialog } from '../overlays';

async function grow(sign: 1 | -1): Promise<void> {
  const v = await promptDialog(sign > 0 ? 'Expand selected area by (px)' : 'Shrink selected area by (px)', '4');
  const n = Math.round(Number(v));
  if (v !== null && Number.isFinite(n) && n > 0) actions.growSelection(sign * n);
}

/** Floating command bar under the current selection. */
export function SelectionLauncher() {
  const selection = useStore((s) => s.selection);
  const view = useStore((s) => s.view);
  const viewport = useStore((s) => s.viewport);
  const doc = useStore((s) => s.doc);
  const transforming = useStore((s) => s.transforming);
  const show = useStore((s) => s.showSelectionLauncher);
  const bounds = useMemo(() => (selection ? maskBounds(selection) : null), [selection]);
  if (!bounds || transforming || !show || controller.busy) return null;
  const m = viewMatrix(view, viewport, { w: doc.width, h: doc.height });
  const corners = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.w, bounds.y],
    [bounds.x + bounds.w, bounds.y + bounds.h],
    [bounds.x, bounds.y + bounds.h],
  ].map(([x, y]) => applyMatrix(m, x, y));
  const cx = corners.reduce((a, c) => a + c.x, 0) / 4;
  const bottom = Math.max(...corners.map((c) => c.y));
  const left = Math.min(Math.max(cx, 200), viewport.w - 200);
  const top = Math.min(bottom + 10, viewport.h - 44);
  const buttons: [string, string, () => void][] = [
    ['deselect', 'Deselect', () => actions.deselect()],
    ['crop', 'Crop', () => actions.cropCanvas(bounds)],
    ['invertSelection', 'Invert selected area', () => actions.invertSelection()],
    ['expand', 'Expand selected area', () => void grow(1)],
    ['shrink', 'Shrink selected area', () => void grow(-1)],
    ['clear', 'Clear', () => actions.clearLayer()],
    ['clearOutside', 'Clear outside selection', () => actions.clearOutsideSelection()],
    ['cutPaste', 'Cut and paste', () => void cutAndPaste()],
    ['copyPaste', 'Copy and paste', () => void copyAndPaste()],
    ['transform', 'Scale up/Scale down/Rotate', () => void startTransform()],
    ['fillCommand', 'Fill', () => actions.fillWithColor()],
  ];
  return (
    <div className="selection-launcher" style={{ left, top }} data-testid="selection-launcher" onPointerDown={(e) => e.stopPropagation()}>
      {buttons.map(([icon, label, run]) => (
        <button key={icon} className="icon-btn" title={label} aria-label={label} onClick={run}>
          <Icon name={icon} size={17} />
        </button>
      ))}
    </div>
  );
}
