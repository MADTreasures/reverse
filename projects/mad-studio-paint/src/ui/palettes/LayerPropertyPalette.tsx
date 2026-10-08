/** Layer Property palette: effects of the selected layer (border effect, layer colour). */
import { findLayer } from '../../model/layers';
import type { Layer } from '../../model/types';
import { DEFAULT_BORDER, DEFAULT_LAYER_COLOR, type BorderEffect, type LayerColorEffect, type LayerEffects } from '../../paint/effects';
import * as actions from '../../store/actions';
import { useStore } from '../../store/store';
import { Icon } from '../controls/Icons';
import { PropSlider } from '../controls/PropSlider';

const supportsEffects = (l: Layer) => l.kind !== 'correction';

export function LayerPropertyPalette() {
  const layer = useStore((s) => findLayer(s.doc.layers, s.activeLayerId));
  if (!layer) return null;
  if (!supportsEffects(layer)) return <p className="palette-note">Correction layers have no effects.</p>;
  const fx: LayerEffects = layer.effects ?? {};
  const set = (next: LayerEffects, label: string) => actions.setLayerEffects(layer.id, next, label);
  const border = fx.border;
  const color = fx.layerColor;
  const setBorder = (patch: Partial<BorderEffect>, label = 'Border effect') => set({ ...fx, border: { ...(border ?? DEFAULT_BORDER), ...patch } }, label);
  const setColor = (patch: Partial<LayerColorEffect>, label = 'Layer color') => set({ ...fx, layerColor: { ...(color ?? DEFAULT_LAYER_COLOR), ...patch } }, label);

  return (
    <div className="layer-property" data-testid="layer-property">
      <div className="effect-toggles">
        <span className="effect-title">Effect</span>
        <button
          className={`icon-btn flag ${border?.enabled ? 'on' : ''}`}
          title="Border effect"
          aria-label="Border effect"
          aria-pressed={Boolean(border?.enabled)}
          onClick={() => setBorder({ enabled: !border?.enabled })}
        >
          <Icon name="borderEffect" size={16} />
        </button>
        <button
          className={`icon-btn flag ${color?.enabled ? 'on' : ''}`}
          title="Layer color"
          aria-label="Layer color"
          aria-pressed={Boolean(color?.enabled)}
          onClick={() => setColor({ enabled: !color?.enabled })}
        >
          <Icon name="layerColor" size={16} />
        </button>
      </div>
      {border?.enabled && (
        <section className="effect-section">
          <h4>Border effect</h4>
          <div className="segmented">
            <button className={border.kind === 'edge' ? 'on' : ''} onClick={() => setBorder({ kind: 'edge' })}>
              Edge
            </button>
            <button className={border.kind === 'watercolor' ? 'on' : ''} onClick={() => setBorder({ kind: 'watercolor' })}>
              Watercolor edge
            </button>
          </div>
          {border.kind === 'edge' ? (
            <>
              <PropSlider label="Thickness of edge" value={border.width} min={0.5} max={100} step={0.5} log decimals={1} unit="px" onChange={(v) => setBorder({ width: v })} testId="edge-width" />
              <label className="effect-color">
                Edge color <input type="color" value={border.color} onChange={(e) => setBorder({ color: e.target.value })} aria-label="Edge color" />
              </label>
            </>
          ) : (
            <>
              <PropSlider label="Range" value={border.range} min={0.5} max={100} step={0.5} log decimals={1} unit="px" onChange={(v) => setBorder({ range: v })} />
              <PropSlider label="Opacity" value={border.opacity} min={0} max={100} onChange={(v) => setBorder({ opacity: v })} />
              <PropSlider label="Darkness" value={border.darkness} min={0} max={100} onChange={(v) => setBorder({ darkness: v })} />
              <PropSlider label="Blurring width" value={border.blur} min={0} max={50} step={0.5} decimals={1} unit="px" onChange={(v) => setBorder({ blur: v })} />
            </>
          )}
        </section>
      )}
      {color?.enabled && (
        <section className="effect-section">
          <h4>Layer color</h4>
          <label className="effect-color">
            Layer color <input type="color" value={color.color} onChange={(e) => setColor({ color: e.target.value })} aria-label="Layer color value" />
          </label>
          <label className="effect-color">
            <input type="checkbox" checked={color.sub !== null} onChange={(e) => setColor({ sub: e.target.checked ? '#ffffff' : null })} /> Sub color
            {color.sub !== null && <input type="color" value={color.sub} onChange={(e) => setColor({ sub: e.target.value })} aria-label="Sub color value" />}
          </label>
        </section>
      )}
    </div>
  );
}
