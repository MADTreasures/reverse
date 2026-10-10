/**
 * Layer Property palette: effects of the selected layer (border effect, tone, layer colour), its
 * layer styles and expression color; with its mask selected, the mask expression.
 */
import { findLayer } from '../../model/layers';
import type { Layer } from '../../model/types';
import { DEFAULT_BORDER, DEFAULT_EXPRESSION, DEFAULT_LAYER_COLOR, type BorderEffect, type ExpressionEffect, type LayerColorEffect, type LayerEffects } from '../../paint/effects';
import { DEFAULT_GLOW, DEFAULT_SHADOW, type GlowStyle, type ShadowStyle } from '../../paint/styles';
import { showMenu } from '../overlays';
import { defaultTone, DOT_SHAPES, type DotShape, type ToneEffect } from '../../paint/tone';
import * as actions from '../../store/actions';
import { getState, useStore } from '../../store/store';
import { Icon } from '../controls/Icons';
import { PropSlider } from '../controls/PropSlider';

const supportsEffects = (l: Layer) => l.kind !== 'correction' && l.kind !== 'audio';

export function LayerPropertyPalette() {
  const layer = useStore((s) => findLayer(s.doc.layers, s.activeLayerId));
  const maskSelected = useStore((s) => s.maskEditing);
  if (!layer) return null;
  if (maskSelected && layer.mask) return <MaskExpression layer={layer} />;
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
      <LayerStyles fx={fx} set={set} />
      {layer.kind !== 'folder' && <ExpressionColor fx={fx} set={set} />}
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

/**
 * Expression color: Color, Gray or Monochrome (colour and alpha thresholds, Reflect layer opacity,
 * which of black and white show). It only changes how the layer shows: Color brings the colours back.
 */
function ExpressionColor({ fx, set }: { fx: LayerEffects; set: (next: LayerEffects, label: string) => void }) {
  const e = fx.expression;
  const up = (patch: Partial<ExpressionEffect>, label = 'Expression color') => set({ ...fx, expression: { ...(e ?? DEFAULT_EXPRESSION), ...patch } }, label);
  return (
    <section className="effect-section" data-testid="expression-color">
      <label className="effect-color">
        Expression color
        <select
          aria-label="Expression color"
          value={e?.mode ?? 'color'}
          onChange={(ev) => {
            const v = ev.target.value;
            if (v === 'color') {
              const { expression: _x, ...rest } = fx;
              set(rest, 'Expression color');
            } else up({ mode: v as ExpressionEffect['mode'] });
          }}
        >
          <option value="color">Color</option>
          <option value="gray">Gray</option>
          <option value="mono">Monochrome</option>
        </select>
      </label>
      {e?.mode === 'mono' && (
        <>
          <PropSlider label="Color threshold" value={e.colorThreshold} min={1} max={255} onChange={(v) => up({ colorThreshold: v })} />
          <PropSlider label="Alpha threshold" value={e.alphaThreshold} min={1} max={255} onChange={(v) => up({ alphaThreshold: v })} />
          <label className="effect-color">
            <input type="checkbox" checked={e.reflectOpacity} onChange={(ev) => up({ reflectOpacity: ev.target.checked })} /> Reflect layer opacity
          </label>
          <span className="effect-color">
            <label>
              <input type="checkbox" checked={e.black} onChange={(ev) => up({ black: ev.target.checked })} /> Black
            </label>
            <label>
              <input type="checkbox" checked={e.white} onChange={(ev) => up({ white: ev.target.checked })} /> White
            </label>
          </span>
        </>
      )}
    </section>
  );
}

/** With the layer mask selected: Mask expression (Show gradients, Threshold). */
function MaskExpression({ layer }: { layer: Layer }) {
  const mask = layer.mask!;
  const gradients = mask.gradients !== false;
  return (
    <div className="layer-property" data-testid="layer-property">
      <section className="effect-section" data-testid="mask-expression">
        <h4>Mask expression</h4>
        <label className="effect-color">
          Show gradients
          <select aria-label="Show gradients" value={gradients ? 'yes' : 'no'} onChange={(e) => actions.setMaskExpression(layer.id, { gradients: e.target.value === 'yes' })}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        {!gradients && <PropSlider label="Threshold" value={mask.threshold ?? 128} min={1} max={255} onChange={(v) => actions.setMaskExpression(layer.id, { threshold: v }, `mask:threshold:${layer.id}`)} />}
      </section>
    </div>
  );
}

type ShadowKey = 'dropShadow' | 'innerShadow';
type GlowKey = 'outerGlow' | 'innerGlow';
const STYLE_NAMES: Record<ShadowKey | GlowKey, string> = { dropShadow: 'Drop shadow', innerShadow: 'Inner shadow', outerGlow: 'Outer glow', innerGlow: 'Inner glow' };
const KEPT_NAMES: Record<string, string> = {
  bevel: 'Bevel and emboss',
  satin: 'Satin',
  gradientOverlay: 'Gradient overlay',
  extraStrokes: 'More strokes',
  extraFills: 'More colour overlays',
  extraDropShadows: 'More drop shadows',
  extraInnerShadows: 'More inner shadows',
};

/** Layer styles (as in Photoshop documents): shadows and glows, and the styles kept for Photoshop. */
function LayerStyles({ fx, set }: { fx: LayerEffects; set: (next: LayerEffects, label: string) => void }) {
  const shadows: ShadowKey[] = ['dropShadow', 'innerShadow'];
  const glows: GlowKey[] = ['outerGlow', 'innerGlow'];
  const missing = ([...shadows, ...glows] as (ShadowKey | GlowKey)[]).filter((k) => !fx[k]);
  const remove = (key: ShadowKey | GlowKey | 'kept', label: string) => {
    const next = { ...fx };
    delete next[key];
    set(next, label);
  };
  const header = (key: ShadowKey | GlowKey, style: ShadowStyle | GlowStyle) => (
    <div className="style-head">
      <label className="effect-color">
        <input type="checkbox" checked={style.enabled} onChange={(e) => set({ ...fx, [key]: { ...style, enabled: e.target.checked } }, STYLE_NAMES[key])} /> {STYLE_NAMES[key]}
      </label>
      <button className="icon-btn" title={`Remove ${STYLE_NAMES[key].toLowerCase()}`} aria-label={`Remove ${STYLE_NAMES[key].toLowerCase()}`} onClick={() => remove(key, `Remove ${STYLE_NAMES[key].toLowerCase()}`)}>
        <Icon name="trash" size={14} />
      </button>
    </div>
  );
  const kept = Object.keys(fx.kept ?? {});
  return (
    <section className="effect-section layer-styles" data-testid="layer-styles">
      <div className="style-head">
        <h4>Layer style</h4>
        {missing.length > 0 && (
          <button
            className="btn small"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              showMenu(
                { x: r.left, y: r.bottom + 2 },
                missing.map((k) => ({
                  label: STYLE_NAMES[k],
                  onClick: () => set({ ...fx, [k]: k === 'dropShadow' || k === 'innerShadow' ? { ...DEFAULT_SHADOW } : { ...DEFAULT_GLOW } }, `Add ${STYLE_NAMES[k].toLowerCase()}`),
                })),
              );
            }}
          >
            Add…
          </button>
        )}
      </div>
      {shadows.map((key) => {
        const st = fx[key];
        if (!st) return null;
        const up = (patch: Partial<ShadowStyle>) => set({ ...fx, [key]: { ...st, ...patch } }, STYLE_NAMES[key]);
        return (
          <div key={key} className="style-block" data-testid={`style-${key}`}>
            {header(key, st)}
            {st.enabled && (
              <>
                <label className="effect-color">
                  Color <input type="color" value={st.color} onChange={(e) => up({ color: e.target.value })} aria-label={`${STYLE_NAMES[key]} color`} />
                </label>
                <PropSlider label="Opacity" value={st.opacity} min={0} max={100} unit="%" onChange={(v) => up({ opacity: v })} />
                <PropSlider label="Angle" value={st.angle} min={-180} max={180} unit="°" onChange={(v) => up({ angle: v })} />
                <PropSlider label="Distance" value={st.distance} min={0} max={200} unit="px" onChange={(v) => up({ distance: v })} />
                <PropSlider label="Size" value={st.size} min={0} max={100} unit="px" onChange={(v) => up({ size: v })} />
                <PropSlider label={key === 'dropShadow' ? 'Spread' : 'Choke'} value={st.spread} min={0} max={100} unit="%" onChange={(v) => up({ spread: v })} />
              </>
            )}
          </div>
        );
      })}
      {glows.map((key) => {
        const st = fx[key];
        if (!st) return null;
        const up = (patch: Partial<GlowStyle>) => set({ ...fx, [key]: { ...st, ...patch } }, STYLE_NAMES[key]);
        return (
          <div key={key} className="style-block" data-testid={`style-${key}`}>
            {header(key, st)}
            {st.enabled && (
              <>
                <label className="effect-color">
                  Color <input type="color" value={st.color} onChange={(e) => up({ color: e.target.value })} aria-label={`${STYLE_NAMES[key]} color`} />
                </label>
                <PropSlider label="Opacity" value={st.opacity} min={0} max={100} unit="%" onChange={(v) => up({ opacity: v })} />
                <PropSlider label="Size" value={st.size} min={0} max={100} unit="px" onChange={(v) => up({ size: v })} />
                <PropSlider label={key === 'outerGlow' ? 'Spread' : 'Choke'} value={st.spread} min={0} max={100} unit="%" onChange={(v) => up({ spread: v })} />
              </>
            )}
          </div>
        );
      })}
      {kept.length > 0 && (
        <div className="style-head kept-styles">
          <span className="palette-note">Kept for Photoshop (not shown): {kept.map((k) => KEPT_NAMES[k] ?? k).join(', ')}</span>
          <button className="icon-btn" title="Remove the kept styles" aria-label="Remove kept styles" onClick={() => remove('kept', 'Remove kept styles')}>
            <Icon name="trash" size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
