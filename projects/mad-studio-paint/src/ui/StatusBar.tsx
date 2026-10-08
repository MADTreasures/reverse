import { useStore } from '../store/store';
import { RotationControls, ZoomControls } from './controls/ViewControls';

/** Bottom strip of the canvas window: zoom and rotation controls, canvas size and hints. */
export function StatusBar() {
  const doc = useStore((s) => s.doc);
  const hint = useStore((s) => s.hint);
  const flipH = useStore((s) => s.view.flipH);
  const flipV = useStore((s) => s.view.flipV);
  return (
    <div className="status-bar" data-testid="status-bar">
      <ZoomControls compact />
      <span className="status-sep" />
      <RotationControls compact />
      {(flipH || flipV) && <span className="status-flip">{flipH ? 'Flipped ⇋' : ''}{flipV ? ' Flipped ⇵' : ''}</span>}
      <span className="status-size">
        {doc.width} × {doc.height} px · {doc.dpi} dpi
      </span>
      <span className="status-hint">{hint}</span>
    </div>
  );
}
