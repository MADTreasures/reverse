/**
 * Settings of focus lines, speed lines and flashes, like the reference's categories: Destination
 * layer, Toning, Use radial / parallel line ruler, line and fill colour, Fill center, Drawing
 * interval (gap of line, disarray, grouping, maximum number of lines), Drawing position (length,
 * disarray, extend lines, reference position, gap from it, uneven reference position) and Starting
 * and ending. The sub tool's settings in Tool Settings, and with the Object tool those of the
 * selected lines of a focus / speed lines layer.
 */
import { useMemo } from 'react';
import { EMPTY_CONTENT } from '../../paint/objects';
import { DEFAULT_FOCUS_LINES, effectLinesGeometry, linePolygon, type EffectLines, type EffectLinesStyle, type ReferencePosition } from '../../paint/effectLines';
import type { EffectLinesSettings, LinesColor, SubTool } from '../../paint/tools';
import type { LinesLayer } from '../../model/types';
import * as actions from '../../store/actions';
import { useStore } from '../../store/store';
import { PropSlider } from '../controls/PropSlider';
import { openColorSettings } from '../dialogs/ColorSettingsDialog';

const POSITIONS: Record<'focus' | 'speed', [ReferencePosition, string][]> = {
  focus: [
    ['start', 'Inner side'],
    ['middle', 'Middle point'],
    ['end', 'Outer side'],
  ],
  speed: [
    ['start', 'Starting point'],
    ['middle', 'Middle point'],
    ['end', 'Ending point'],
  ],
};

const Check = ({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) => (
  <label className="check prop-check" title={title}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    {label}
  </label>
);

/** A setting that is on or off with a value when on (Disarray, Grouping, …): 0 is off. */
function OptionalSlider({ label, value, on, min, max, unit, onChange }: { label: string; value: number; on: number; min: number; max: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <>
      <Check label={label} checked={value > 0} onChange={(c) => onChange(c ? on : 0)} />
      {value > 0 && <PropSlider label={label} value={value} min={min} max={max} unit={unit} onChange={onChange} />}
    </>
  );
}

/** Drawing interval, Drawing position, brush size and Starting and ending (`more`: all of them). */
function LineFields({ e, update, more }: { e: EffectLinesStyle; update: (patch: Partial<EffectLinesStyle>) => void; more: boolean }) {
  const focus = e.kind === 'focus';
  const angleGap = focus && e.gapMode === 'angle';
  return (
    <>
      <PropSlider testId="prop-lines-width" label="Brush Size" value={e.width} min={0.2} max={500} log step={0.1} decimals={1} onChange={(width) => update({ width })} />
      <div className="prop-section">Drawing interval</div>
      <PropSlider
        testId="prop-lines-gap"
        label={angleGap ? 'Gap of line (angle)' : 'Gap of line (distance)'}
        value={e.gap}
        min={angleGap ? 0.1 : 0.5}
        max={angleGap ? 45 : 500}
        log
        step={0.1}
        decimals={1}
        unit={angleGap ? '°' : 'px'}
        onChange={(gap) => update({ gap })}
      />
      {focus && more && (
        <div className="prop-row">
          <span className="prop-label">Gap of line</span>
          <select className="prop-select" aria-label="Gap of line" value={e.gapMode} onChange={(ev) => update({ gapMode: ev.target.value as EffectLinesStyle['gapMode'], gap: ev.target.value === 'angle' ? 3 : 10 })}>
            <option value="angle">Angle</option>
            <option value="distance">Distance</option>
          </select>
        </div>
      )}
      {more && <OptionalSlider label="Disarray (gap)" value={e.gapDisarray} on={50} min={1} max={100} unit="%" onChange={(gapDisarray) => update({ gapDisarray })} />}
      {more && (
        <>
          <Check label="Grouping" checked={e.grouping > 0} onChange={(c) => update({ grouping: c ? 4 : 0 })} />
          {e.grouping > 0 && (
            <>
              <PropSlider label="Lines per group" value={e.grouping} min={1} max={100} onChange={(grouping) => update({ grouping })} />
              <OptionalSlider label="Disarray (groups)" value={e.groupDisarray} on={50} min={1} max={100} unit="%" onChange={(groupDisarray) => update({ groupDisarray })} />
              <PropSlider label="Gap" value={e.groupGap} min={0} max={50} step={0.5} decimals={1} onChange={(groupGap) => update({ groupGap })} />
            </>
          )}
        </>
      )}
      {!focus && more && <PropSlider label="Maximum number of lines" value={e.maxLines} min={1} max={2000} log onChange={(maxLines) => update({ maxLines })} />}
      <div className="prop-section">Drawing position</div>
      {!e.extend && <PropSlider testId="prop-lines-length" label="Length" value={e.length} min={1} max={5000} log onChange={(length) => update({ length })} />}
      {more && !e.extend && <OptionalSlider label="Disarray (length)" value={e.lengthDisarray} on={50} min={1} max={100} unit="%" onChange={(lengthDisarray) => update({ lengthDisarray })} />}
      <Check label="Extend lines" checked={e.extend} onChange={(extend) => update({ extend })} title="The lines go on past the edge of the canvas" />
      <div className="prop-row">
        <span className="prop-label">Reference position</span>
        <select className="prop-select" aria-label="Reference position" value={e.refPos} onChange={(ev) => update({ refPos: ev.target.value as ReferencePosition })}>
          {POSITIONS[e.kind].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {more && <OptionalSlider label="Gap from reference position" value={e.refGap} on={30} min={1} max={1000} unit="%" onChange={(refGap) => update({ refGap })} />}
      {more && focus && (
        <>
          <Check label="Uneven reference position" checked={e.unevenCount > 0} onChange={(c) => update({ unevenCount: c ? 24 : 0 })} />
          {e.unevenCount > 0 && (
            <>
              <PropSlider label="Number" value={e.unevenCount} min={1} max={200} onChange={(unevenCount) => update({ unevenCount })} />
              <PropSlider label="Height" value={e.unevenHeight} min={0} max={1000} log={false} onChange={(unevenHeight) => update({ unevenHeight })} />
            </>
          )}
        </>
      )}
      {more && (
        <>
          <div className="prop-section">Starting and ending</div>
          <PropSlider label={focus ? 'Thin out (inside)' : 'Thin out (start)'} value={e.taperStart} min={0} max={100} unit="%" onChange={(taperStart) => update({ taperStart })} />
          <PropSlider label={focus ? 'Thin out (outside)' : 'Thin out (end)'} value={e.taperEnd} min={0} max={100} unit="%" onChange={(taperEnd) => update({ taperEnd })} />
          <OptionalSlider label="Disarray (width)" value={e.widthDisarray} on={50} min={1} max={100} unit="%" onChange={(widthDisarray) => update({ widthDisarray })} />
          <Check label="Dotted lines" checked={e.dotted} onChange={(dotted) => update({ dotted })} />
        </>
      )}
    </>
  );
}

/** Main colour, sub colour or a user colour (a swatch: click it to choose it). */
function ColorChoice({ label, choice, user, onChoice, onUser }: { label: string; choice: LinesColor; user: string; onChoice: (c: LinesColor) => void; onUser: (hex: string) => void }) {
  const colors = useStore((s) => s.colors);
  const options: [LinesColor, string, string][] = [
    ['main', 'Main color', colors.main],
    ['sub', 'Sub color', colors.sub],
    ['user', 'User color', user],
  ];
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <div className="segmented color-choice" role="radiogroup" aria-label={label}>
        {options.map(([id, name, color]) => (
          <button
            key={id}
            role="radio"
            aria-checked={choice === id}
            aria-label={`${label}: ${name}`}
            title={id === 'user' ? `${name} (click again to choose it)` : name}
            className={choice === id ? 'on' : ''}
            onClick={() => (id === 'user' && choice === 'user' ? openColorSettings(user, onUser) : onChoice(id))}
          >
            <span className="color-chip" style={{ background: color }} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Tool Settings of a flash, focus lines or speed lines sub tool. */
export function EffectLinesToolSettings({ sub, more }: { sub: SubTool; more: boolean }) {
  const o = sub.effectLines!;
  const update = (patch: Partial<EffectLinesSettings>) => actions.updateSubTool(sub.id, { effectLines: { ...o, ...patch } });
  const style = (patch: Partial<EffectLinesStyle>) => update({ style: { ...o.style, ...patch } });
  const focus = o.style.kind === 'focus';
  const what = focus ? 'focus lines' : 'speed lines';
  return (
    <>
      <div className="prop-row">
        <span className="prop-label">Destination layer</span>
        <select className="prop-select" aria-label="Destination layer" value={o.destination} onChange={(e) => update({ destination: e.target.value as EffectLinesSettings['destination'] })}>
          <option value="editing">Draw on editing layer</option>
          <option value="new">Always create {what} layer</option>
          <option value="lines">Draw on {what} layer</option>
        </select>
      </div>
      {o.destination !== 'editing' && <Check label="Toning" checked={o.toning} onChange={(toning) => update({ toning })} title={`New ${what} layers get the Tone effect (grey lines)`} />}
      <Check label={focus ? 'Use radial line ruler for center' : 'Use parallel line ruler for angle'} checked={o.useRuler} onChange={(useRuler) => update({ useRuler })} />
      {!focus && <PropSlider label="Angle" value={o.style.angle} min={-180} max={180} step={0.5} decimals={1} unit="°" onChange={(angle) => style({ angle })} />}
      <ColorChoice label="Line color" choice={o.lineColor} user={o.userLineColor} onChoice={(lineColor) => update({ lineColor })} onUser={(userLineColor) => update({ userLineColor, lineColor: 'user' })} />
      {focus && (
        <>
          <Check label="Fill center" checked={o.style.fill} onChange={(fill) => style({ fill })} />
          {o.style.fill && (
            <>
              <PropSlider label="Fill opacity" value={o.style.fillOpacity} min={0} max={100} unit="%" onChange={(fillOpacity) => style({ fillOpacity })} />
              <ColorChoice label="Fill color" choice={o.fillColor} user={o.userFillColor} onChoice={(fillColor) => update({ fillColor })} onUser={(userFillColor) => update({ userFillColor, fillColor: 'user' })} />
            </>
          )}
        </>
      )}
      <LineFields e={o.style} update={style} more={more} />
    </>
  );
}

/** Object tool on a focus / speed lines layer: the selected lines' settings (else the last lines'). */
export function LinesObjectSettings({ layer, more }: { layer: LinesLayer; more: boolean }) {
  const selected = useStore((s) => s.selectedObjects);
  const item = layer.items.find((e) => selected.includes(e.id)) ?? layer.items[layer.items.length - 1];
  if (!item) return <div className="prop-note">This layer has no lines.</div>;
  const focus = item.kind === 'focus';
  const change = (patch: Partial<EffectLines>, key: string) =>
    actions.setLayerContent(layer.id, { ...EMPTY_CONTENT, lines: layer.items.map((e) => (e.id === item.id ? { ...e, ...patch } : e)) }, focus ? 'Edit focus lines' : 'Edit speed lines', `lines:${item.id}:${key}`);
  const swatch = (label: string, color: string, key: 'color' | 'fillColor') => (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <button className="fill-swatch" aria-label={label} style={{ background: color }} onClick={() => openColorSettings(color, (c) => change({ [key]: c }, key))} />
    </div>
  );
  return (
    <>
      <div className="prop-section">{focus ? 'Focus lines' : 'Speed lines'}</div>
      {swatch('Main color', item.color, 'color')}
      {focus && (
        <>
          {swatch('Sub color', item.fillColor, 'fillColor')}
          <Check label="Fill center" checked={item.fill} onChange={(fill) => change({ fill }, 'fill')} />
          {item.fill && <PropSlider label="Fill opacity" value={item.fillOpacity} min={0} max={100} unit="%" onChange={(fillOpacity) => change({ fillOpacity }, 'fillOpacity')} />}
        </>
      )}
      {!focus && <PropSlider label="Angle" value={item.angle} min={-180} max={180} step={0.5} decimals={1} unit="°" onChange={(angle) => change({ angle }, 'angle')} />}
      <LineFields e={item} update={(patch) => change(patch, Object.keys(patch).join(','))} more={more} />
      <button className="btn small" title="Other random lines with the same settings" onClick={() => change({ seed: (item.seed * 48271 + 11) % 0x7fffffff }, 'seed')}>
        Shuffle lines
      </button>
    </>
  );
}

/** A small picture of the lines a sub tool draws (Sub Tool palette). */
export function EffectLinesPreview({ style }: { style: EffectLinesStyle }) {
  const d = useMemo(() => {
    const W = 160;
    const H = 22;
    // A fixed seed, sizes scaled down to the strip.
    const k = 0.18;
    const focus = style.kind === 'focus';
    const e: EffectLines = {
      ...DEFAULT_FOCUS_LINES,
      ...style,
      id: 'preview',
      seed: 3,
      cx: focus ? 4 : 80,
      cy: 11,
      fx: 0,
      fy: 0,
      rx: focus ? 6 : 10,
      ry: focus ? 6 : 0,
      rotation: focus ? 0 : Math.PI / 2,
      width: Math.max(0.6, style.width * k),
      length: style.length * k * 2,
      gap: focus || style.gapMode === 'angle' ? style.gap : Math.max(1.2, style.gap * k),
      unevenHeight: style.unevenHeight * k,
      color: '#000',
      fillColor: '#fff',
    };
    const g = effectLinesGeometry(e, { x: 0, y: 0, w: W, h: H });
    return g.lines
      .slice(0, 400)
      .map((l) => linePolygon(l, e.taperStart, e.taperEnd))
      .filter((pts) => pts.length > 2)
      .map((pts) => `M${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}Z`)
      .join('');
  }, [style]);
  return (
    <svg className="stroke-preview" viewBox="0 0 160 22" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path d={d} fill="currentColor" />
    </svg>
  );
}
