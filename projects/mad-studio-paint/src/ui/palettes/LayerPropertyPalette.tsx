/** Layer Property palette: effects of the selected layer (border effect, tone, layer colour). */
import { findLayer } from '../../model/layers';
import type { Layer } from '../../model/types';
import { DEFAULT_BORDER, DEFAULT_LAYER_COLOR, type BorderEffect, type LayerColorEffect, type LayerEffects } from '../../paint/effects';
import { defaultTone, DOT_SHAPES, type DotShape, type ToneEffect } from '../../paint/tone';
import * as actions from '../../store/actions';
import { getState, useStore } from '../../store/store';
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
  const tone = fx.tone;
  const setTone = (patch: Partial<ToneEffect>, label = 'Tone') => set({ ...fx, tone: { ...(tone ?? defaultTone(getState().doc.dpi)), ...patch } }, label);

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
          className={`icon-btn flag ${tone?.enabled ? 'on' : ''}`}
          title="Tone"
          aria-label="Tone"
          aria-pressed={Boolean(tone?.enabled)}
          onClick={() => setTone({ enabled: !tone?.enabled })}
        >
          <Icon name="tone" size={16} />
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
      {tone?.enabled && (
        <section className="effect-section" data-testid="tone-settings">
          <h4>Tone</h4>
          <PropSlider label="Frequency" value={tone.frequency} min={1} max={300} step={0.5} log decimals={1} unit="lpi" onChange={(v) => setTone({ frequency: v })} testId="tone-frequency" />
          <label className="effect-color">
            Density
            <select value={tone.density} aria-label="Tone density" onChange={(e) => setTone({ density: e.target.value as ToneEffect['density'] })}>
              <option value="color">Use color of image</option>
              <option value="brightness">Use brightness of image</option>
              <option value="fixed">Use specified density</option>
            </select>
          </label>
          {tone.density === 'fixed' && <PropSlider label="Density" value={tone.value} min={0} max={100} unit="%" onChange={(v) => setTone({ value: v })} />}
          <label className="effect-color">
            <input type="checkbox" checked={tone.reflectOpacity} onChange={(e) => setTone({ reflectOpacity: e.target.checked })} /> Reflect layer opacity
          </label>
          {tone.density !== 'fixed' && (
            <>
              <label className="effect-color">
                <input type="checkbox" checked={tone.posterize >= 2} onChange={(e) => setTone({ posterize: e.target.checked ? 4 : 0 })} /> Posterization
              </label>
              {tone.posterize >= 2 && <PropSlider label="Steps" value={tone.posterize} min={2} max={20} onChange={(v) => setTone({ posterize: v })} />}
            </>
          )}
          <label className="effect-color">
            Dot
            <select value={tone.shape} aria-label="Dot shape" onChange={(e) => setTone({ shape: e.target.value as DotShape })}>
              {DOT_SHAPES.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {tone.shape === 'noise' ? (
            <>
              <PropSlider label="Size" value={tone.noiseSize} min={1} max={50} unit="px" onChange={(v) => setTone({ noiseSize: v })} />
              <PropSlider label="Factor" value={tone.noiseFactor} min={0} max={100} onChange={(v) => setTone({ noiseFactor: v })} />
            </>
          ) : (
            <PropSlider label="Angle" value={tone.angle} min={-180} max={180} unit="°" onChange={(v) => setTone({ angle: v })} />
          )}
          <PropSlider label="Dot position X" value={tone.x} min={-100} max={100} unit="px" onChange={(v) => setTone({ x: v })} />
          <PropSlider label="Dot position Y" value={tone.y} min={-100} max={100} unit="px" onChange={(v) => setTone({ y: v })} />
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
