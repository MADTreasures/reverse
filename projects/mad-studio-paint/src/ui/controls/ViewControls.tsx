import * as actions from '../../store/actions';
import { useStore } from '../../store/store';
import { Icon } from './Icons';
import { Slider } from './Slider';

/** Zoom value + slider + −/+ + reset (Navigator and the canvas status strip). */
export function ZoomControls({ compact = false }: { compact?: boolean }) {
  const zoom = useStore((s) => s.view.zoom);
  return (
    <div className={`view-controls ${compact ? 'compact' : ''}`}>
      <Slider testId={compact ? 'status-zoom' : 'nav-zoom'} ariaLabel="Zoom (%)" value={Math.round(zoom * 1000) / 10} min={1} max={6400} log step={0.1} decimals={1} onChange={(v) => actions.zoomTo(v / 100)} />
      <button className="icon-btn" title="Zoom out" aria-label="Zoom out" onClick={() => actions.zoomStep(-1)}>
        <Icon name="zoomOut" size={15} />
      </button>
      <button className="icon-btn" title="Zoom in" aria-label="Zoom in" onClick={() => actions.zoomStep(1)}>
        <Icon name="zoomIn" size={15} />
      </button>
      <button className="icon-btn" title="Reset zoom (100%)" aria-label="Reset zoom" onClick={() => actions.actualPixels()}>
        <Icon name="actual" size={15} />
      </button>
      {!compact && (
        <button className="icon-btn" title="Fit to window" aria-label="Fit to window" onClick={() => actions.fitToWindow()}>
          <Icon name="fit" size={15} />
        </button>
      )}
    </div>
  );
}

/** Rotation value + slider + rotate left/right + reset (+ flips in the Navigator). */
export function RotationControls({ compact = false }: { compact?: boolean }) {
  const view = useStore((s) => s.view);
  return (
    <div className={`view-controls ${compact ? 'compact' : ''}`}>
      <Slider testId={compact ? 'status-rotation' : 'nav-rotation'} ariaLabel="Rotation (°)" value={view.rotation} min={-180} max={180} step={0.1} decimals={1} onChange={(v) => actions.setRotation(v)} />
      <button className="icon-btn" title="Rotate left" aria-label="Rotate left" onClick={() => actions.rotateView(-actions.rotationStep())}>
        <Icon name="rotateLeft" size={15} />
      </button>
      <button className="icon-btn" title="Rotate right" aria-label="Rotate right" onClick={() => actions.rotateView(actions.rotationStep())}>
        <Icon name="rotateRight" size={15} />
      </button>
      <button className="icon-btn" title="Reset rotation" aria-label="Reset rotation" onClick={() => actions.resetRotation()}>
        <Icon name="resetRotation" size={15} />
      </button>
      {!compact && (
        <>
          <button className={`icon-btn ${view.flipH ? 'on' : ''}`} title="Flip horizontal" aria-label="Flip view horizontally" aria-pressed={view.flipH} onClick={() => actions.flipView(true)}>
            <Icon name="flipH" size={15} />
          </button>
          <button className={`icon-btn ${view.flipV ? 'on' : ''}`} title="Flip vertical" aria-label="Flip view vertically" aria-pressed={view.flipV} onClick={() => actions.flipView(false)}>
            <Icon name="flipV" size={15} />
          </button>
        </>
      )}
    </div>
  );
}
