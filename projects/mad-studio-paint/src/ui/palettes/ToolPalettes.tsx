import { QUICK_ITEM_MIME } from '../quickItems';
import { toolShortcuts } from '../commands';
import { formatShortcut } from '../shortcuts';
import { useShortcuts } from '../../store/shortcutStore';
import { isMac } from '../../platform/platform';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BRUSH_SIZE_PRESETS } from '../../store/actions';
import * as actions from '../../store/actions';
import * as anim from '../../store/animationActions';
import * as sound from '../../store/soundActions';
import * as light from '../../store/lightTableActions';
import { isCameraFolder, maskTrackId } from '../../model/animation';
import type { ImageLayer, Layer } from '../../model/types';
import { EMPTY_CONTENT } from '../../paint/objects';
import { TILING_DIRECTIONS, TILING_MODES, type ImagePlacement, type TilingDirection, type TilingMode } from '../../paint/imageMaterial';
import type { Interp, Placement, PlacementChannel } from '../../paint/keyframes';
import { currentSubTool, drawingColor, getState, setState, useStore } from '../../store/store';
import { pxToPt, setTextStyle, setTextWrap, textToolStyle } from '../../store/textActions';
import { setFrameProps } from '../../store/frameActions';
import type { Balloon } from '../../paint/text';
import type { GradientEdge, GradientSpec } from '../../paint/gradient';
import { GradientBar } from '../controls/GradientBar';
import { tipAlphaUrl } from '../../engine/materials';
import { openDialog } from '../overlays';
import { openColorSettings } from '../dialogs/ColorSettingsDialog';
import { entryForTool, isSpecialCurve, PALETTE_ENTRIES, PALETTE_LAYOUT, subToolsOf, toolInfo, usesLasso, type CorrectSettings, type FigureFill, type FillReference, type LiquifySettings, type SubTool, type ToolId } from '../../paint/tools';
import { LIQUIFY_MODES } from '../../paint/liquify';
import { EffectLinesPreview, EffectLinesToolSettings, LinesObjectSettings } from './EffectLinesSettings';
import { Icon } from '../controls/Icons';
import { PropSlider } from '../controls/PropSlider';
import { DynamicsPopover, dynamicsOn, type DynamicsKind } from './BrushSettingsPanels';
import { ColorIcons } from './ColorWheel';
import {
  cancelTransform,
  confirmTransform,
  flipTransform,
  REFERENCE_POINTS,
  resetTransform,
  setTransformMode,
  setTransformNumbers,
  setTransformPivot,
  setTransformPrefs,
  TRANSFORM_MODES,
  useTransformInfo,
  type ReferencePoint,
  type TransformInfo,
  type TransformMode,
} from '../../tools/transform';
import { INTERPOLATIONS, type Interpolation } from '../../paint/warp';
import { FILL_TARGETS, SCALING_MODES, type FillTarget, type ScalingMode } from '../../paint/fill';

/** Last tool used per palette button (for buttons that hold several tools). */
const lastTool = new Map<string, ToolId>();

/** Column of tool buttons in sections, with the colour icons at the bottom. */
export function ToolPalette() {
  const tool = useStore((s) => s.tool);
  // Shortcut Settings change the keys in the tooltips.
  useShortcuts((s) => s.overrides);
  const workspace = useStore((s) => s.workspace);
  const current = entryForTool(tool, workspace);
  lastTool.set(current.id, tool);
  return (
    <div className="tool-palette" role="toolbar" aria-label="Tools" data-testid="tool-palette">
      {PALETTE_LAYOUT[workspace].map((section, i) => (
        <div key={i} className="tool-section">
          {section.map((id) => {
            const e = PALETTE_ENTRIES.find((x) => x.id === id)!;
            const active = e.id === current.id;
            const keys = [...new Set(e.tools.flatMap((t) => toolShortcuts(t)).map((k) => formatShortcut(k, isMac)))].join(', ');
            return (
              <button
                key={e.id}
                className={`tool-btn ${active ? 'active' : ''}`}
                title={`${e.label} (${keys})`}
                aria-label={e.label}
                aria-pressed={active}
                data-tool={e.tools[0]}
                draggable
                // Tools can be dropped on the Quick Access palette.
                onDragStart={(ev) => ev.dataTransfer.setData(QUICK_ITEM_MIME, JSON.stringify({ kind: 'tool', tool: lastTool.get(e.id) ?? e.tools[0] }))}
                onClick={() => !active && actions.setTool(lastTool.get(e.id) ?? e.tools[0])}
              >
                <Icon name={e.icon} size={20} />
              </button>
            );
          })}
        </div>
      ))}
      <div className="tool-colors">
        <ColorIcons />
      </div>
    </div>
  );
}

/** Sub tools of the selected tool, with group buttons on top and a stroke preview per entry. */
export function SubToolPalette() {
  const tool = useStore((s) => s.tool);
  const workspace = useStore((s) => s.workspace);
  const subTools = useStore((s) => s.subTools);
  const active = useStore((s) => currentSubTool(s));
  const entry = entryForTool(tool, workspace);
  const list = subToolsOf(subTools, tool);
  const groups = [...new Set(list.map((s) => s.group).filter((g): g is string => Boolean(g)))];
  const group = active.group ?? groups[0];
  const shown = groups.length > 1 ? list.filter((s) => s.group === group) : list;
  return (
    <div className="subtool-palette" data-testid="subtool-palette">
      <div className="subtool-groups">
        {entry.tools.length > 1
          ? entry.tools.map((t) => (
              <button key={t} className={`group-btn ${t === tool ? 'active' : ''}`} onClick={() => actions.setTool(t)}>
                <Icon name={t} size={14} />
                {toolInfo(t).label}
              </button>
            ))
          : (groups.length > 1 ? groups : [toolInfo(tool).label]).map((g) => (
              <button
                key={g}
                className={`group-btn ${g === (groups.length > 1 ? group : g) ? 'active' : ''}`}
                onClick={() => {
                  const first = list.find((s) => s.group === g);
                  if (first) actions.setSubTool(tool, first.id);
                }}
              >
                <Icon name={tool} size={14} />
                {g}
              </button>
            ))}
      </div>
      <div className="subtool-list">
        {shown.map((s) => (
          <button
            key={s.id}
            className={`subtool ${s.id === active.id ? 'active' : ''} ${s.brush || s.effectLines ? 'with-stroke' : ''}`}
            data-subtool={s.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(QUICK_ITEM_MIME, JSON.stringify({ kind: 'tool', tool, sub: s.id }))}
            onClick={() => actions.setSubTool(tool, s.id)}
          >
            {s.brush && <StrokePreview sub={s} />}
            {s.effectLines && <EffectLinesPreview style={s.effectLines.style} />}
            <span className="subtool-name">{s.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Points along the preview's S-curve (two cubic pieces). */
function previewPoints(n: number): { x: number; y: number; a: number }[] {
  const pieces = [
    [6, 15, 40, 2, 70, 2, 82, 11],
    [82, 11, 94, 20, 125, 21, 154, 6],
  ];
  const at = (q: number[], t: number) => {
    const u = 1 - t;
    const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return { x: k[0] * q[0] + k[1] * q[2] + k[2] * q[4] + k[3] * q[6], y: k[0] * q[1] + k[1] * q[3] + k[2] * q[5] + k[3] * q[7] };
  };
  return Array.from({ length: n }, (_, i) => {
    const f = (i + 0.5) / n;
    const q = pieces[f < 0.5 ? 0 : 1];
    const t = f < 0.5 ? f * 2 : f * 2 - 1;
    const p = at(q, t);
    const r = at(q, Math.min(1, t + 0.01));
    return { ...p, a: (Math.atan2(r.y - p.y, r.x - p.x) * 180) / Math.PI };
  });
}

/** A tapering S-curve drawn with the brush's softness and opacity (image tips: stamped along it). */
function StrokePreview({ sub }: { sub: SubTool }) {
  const b = sub.brush!;
  const w = Math.max(1.2, Math.min(9, Math.sqrt(b.size) * 1.6));
  const soft = b.hardness < 0.5 || b.mode === 'blend';
  if (b.tipShape === 'material' && b.tipMaterials.length) {
    const size = Math.max(8, Math.min(18, Math.sqrt(b.size) * 2.6));
    const n = Math.max(5, Math.min(16, Math.round(150 / (size * Math.max(0.35, Math.min(2, b.spacing))))));
    const id = `tipmask-${sub.id}`;
    return (
      <svg className="stroke-preview" viewBox="0 0 160 22" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <mask id={id} style={{ maskType: 'alpha' }}>
            {previewPoints(n).map((p, i) => (
              <image
                key={i}
                href={tipAlphaUrl(b.tipMaterials[i % b.tipMaterials.length])}
                x={p.x - size / 2}
                y={p.y - size / 2}
                width={size}
                height={size}
                transform={b.angleSource === 'line' ? `rotate(${p.a} ${p.x} ${p.y})` : undefined}
              />
            ))}
          </mask>
        </defs>
        <rect width="160" height="22" fill="currentColor" mask={`url(#${id})`} opacity={Math.max(0.5, b.flow * b.opacity)} />
      </svg>
    );
  }
  return (
    <svg className="stroke-preview" viewBox="0 0 160 22" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M6 15 C 40 2, 70 2, 82 11 S 125 21, 154 6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={w}
        opacity={b.mode === 'erase' ? 0.4 : Math.max(0.4, b.flow * b.opacity)}
        strokeDasharray={b.scatter > 0 ? '1 3' : b.texture === 'grain' || b.paper ? '6 1.5' : undefined}
        style={soft ? { filter: 'blur(1.2px)' } : undefined}
      />
    </svg>
  );
}

const REFERENCE_LABELS: Record<FillReference, string> = {
  layer: 'Editing layer only',
  all: 'All layers',
  reference: 'Reference layers',
  folder: 'Layer in folder',
};

const AA_LEVELS = ['None', 'Weak', 'Medium', 'Strong'];

/** Settings of the selected sub tool (or of the transform in progress). */
export function ToolProperty() {
  const sub = useStore((s) => currentSubTool(s));
  const advanced = useStore((s) => s.advancedToolSettings);
  const linesLayer = useStore((s) => actions.activeLayer(s)?.kind === 'lines');
  const transform = useTransformInfo((s) => s.info);
  const [more, setMore] = useState(false);
  const [dyn, setDyn] = useState<{ kind: DynamicsKind; at: { x: number; y: number } } | null>(null);
  if (transform) return <TransformSettings info={transform} />;
  const openDynamics = (kind: DynamicsKind) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setDyn({ kind, at: { x: r.right + 6, y: r.top - 8 } });
  };
  const update = (patch: Partial<SubTool>) => actions.updateSubTool(sub.id, patch);
  const b = sub.brush;
  const f = sub.fill;
  return (
    <div className="tool-property" data-testid="tool-property">
      <div className="prop-title">
        <span className="prop-tool-name">{sub.name}</span>
      </div>
      {b && (
        <>
          <PropSlider
            testId="prop-size"
            label="Brush Size"
            value={b.size}
            min={0.5}
            max={2000}
            log
            step={0.1}
            decimals={1}
            onChange={(v) => actions.setBrushSize(v)}
            pressure={dynamicsOn(b, 'size')}
            onPressure={openDynamics('size')}
          />
          {b.mode !== 'blend' && (
            <PropSlider
              testId="prop-opacity"
              label="Opacity"
              value={Math.round(b.opacity * 100)}
              min={0}
              max={100}
              onChange={(v) => update({ brush: { ...b, opacity: v / 100 } })}
            />
          )}
          {b.mode !== 'blend' && (
            <div className="prop-row aa-row">
              <span className="prop-label">Anti-aliasing</span>
              <div className="aa-buttons" role="radiogroup" aria-label="Anti-aliasing">
                {AA_LEVELS.map((label, level) => (
                  <button
                    key={label}
                    role="radio"
                    aria-checked={b.antiAlias === level}
                    title={label}
                    className={`aa-btn level-${level} ${b.antiAlias === level ? 'on' : ''}`}
                    onClick={() => update({ brush: { ...b, antiAlias: level } })}
                  >
                    <span />
                  </button>
                ))}
              </div>
            </div>
          )}
          {sub.tool !== 'figure' && b.mode !== 'blend' && (
            <PropSlider testId="prop-stabilization" label="Stabilization" value={b.stabilization} min={0} max={100} onChange={(v) => update({ brush: { ...b, stabilization: v } })} />
          )}
          <PropSlider
            label={b.mode === 'blend' ? 'Strength' : 'Brush density'}
            value={Math.round(b.flow * 100)}
            min={1}
            max={100}
            onChange={(v) => update({ brush: { ...b, flow: v / 100 } })}
            pressure={dynamicsOn(b, 'density')}
            onPressure={openDynamics('density')}
          />
        </>
      )}
      {sub.liquify && <LiquifyToolSettings l={sub.liquify} update={(patch) => update({ liquify: { ...sub.liquify!, ...patch } })} />}
      {sub.effectLines && <EffectLinesToolSettings sub={sub} more={more} />}
      {usesLasso(sub) && (
        <div className="prop-row column">
          <label className="check prop-check" title="The lasso snaps to the lines of the reference layer (else of the editing layer)">
            <input type="checkbox" checked={Boolean(sub.magnet)} onChange={(e) => update({ magnet: e.target.checked ? 3 : 0 })} />
            Magnetic lasso
          </label>
          {Boolean(sub.magnet) && <PropSlider testId="prop-magnet" label="Magnet strength" value={sub.magnet ?? 3} min={1} max={5} onChange={(v) => update({ magnet: v })} />}
        </div>
      )}
      {f && (
        <>
          <div className="prop-row">
            <span className="prop-label">Multiple referencing</span>
            <select className="prop-select" value={f.reference} aria-label="Multiple referencing" onChange={(e) => update({ fill: { ...f, reference: e.target.value as FillReference } })}>
              {(Object.keys(REFERENCE_LABELS) as FillReference[]).map((k) => (
                <option key={k} value={k}>
                  {REFERENCE_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          {(!f.mode || f.mode === 'click') && (
            <label className="check prop-check">
              <input type="checkbox" checked={f.contiguous} onChange={(e) => update({ fill: { ...f, contiguous: e.target.checked } })} />
              Follow adjacent pixels
            </label>
          )}
          {f.mode === 'leftover' && <PropSlider label="Brush Size" value={f.size ?? 30} min={2} max={500} log onChange={(v) => update({ fill: { ...f, size: v } })} />}
          {(f.mode === 'enclose' || f.mode === 'leftover') && (
            <div className="prop-row">
              <span className="prop-label">Target color</span>
              <select className="prop-select" aria-label="Target color" value={f.target ?? 'transparent'} onChange={(e) => update({ fill: { ...f, target: e.target.value as FillTarget } })}>
                {FILL_TARGETS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <PropSlider testId="prop-tolerance" label="Color margin" value={f.tolerance} min={0} max={100} unit="%" onChange={(v) => update({ fill: { ...f, tolerance: v } })} />
          <PropSlider label="Area scaling" value={f.expand} min={-20} max={20} unit="px" onChange={(v) => update({ fill: { ...f, expand: v } })} />
          {f.expand !== 0 && (
            <div className="prop-row">
              <span className="prop-label">Scaling mode</span>
              <select className="prop-select" aria-label="Scaling mode" value={f.scaling ?? 'round'} onChange={(e) => update({ fill: { ...f, scaling: e.target.value as ScalingMode } })}>
                {SCALING_MODES.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {more && (
            <label className="check prop-check">
              <input type="checkbox" checked={f.alphaOnly} onChange={(e) => update({ fill: { ...f, alphaOnly: e.target.checked } })} />
              Compare transparency only
            </label>
          )}
        </>
      )}
      {sub.tool === 'eraser' && b && <VectorEraserRow sub={sub} update={update} />}
      {sub.tool === 'figure' && sub.figureShape === 'polygon' && (
        <PropSlider label="Number of corners" value={sub.figureCorners ?? 5} min={3} max={100} onChange={(v) => update({ figureCorners: v })} />
      )}
      {sub.tool === 'figure' && (sub.figureShape === 'rect' || sub.figureShape === 'polygon') && (
        <PropSlider label="Roundness of corner" value={sub.figureRound ?? 0} min={0} max={100} unit="%" onChange={(v) => update({ figureRound: v })} />
      )}
      {sub.tool === 'figure' && (sub.figureShape === 'rect' || sub.figureShape === 'ellipse' || sub.figureShape === 'polygon') && (
        <div className="prop-row">
          <span className="prop-label">Line/Fill</span>
          <select className="prop-select" aria-label="Line/Fill" value={sub.figureFill ?? 'line'} onChange={(e) => update({ figureFill: e.target.value as FigureFill })}>
            <option value="line">Create line</option>
            <option value="fill">Create fill</option>
            <option value="both">Create both line and fill</option>
          </select>
        </div>
      )}
      {sub.tool === 'object' && <ObjectSettings sub={sub} update={update} more={more} />}
      {sub.tool === 'lightTable' && <LightTableSettings />}
      {sub.tool === 'text' && <TextSettings />}
      {sub.tool === 'balloon' && sub.balloon && <BalloonToolSettings sub={sub} update={update} />}
      {sub.tool === 'balloon' && sub.tail && <TailSettings sub={sub} update={update} />}
      {sub.tool === 'frame' && <FrameToolSettings sub={sub} update={update} />}
      {sub.tool === 'correct' && sub.correct && <CorrectToolSettings c={sub.correct} update={(patch) => update({ correct: { ...sub.correct!, ...patch } })} />}
      {sub.tool === 'select' && <SelectionModeRow />}
      {sub.tool === 'ruler' && sub.rulerKind === 'symmetry' && (
        <>
          <PropSlider label="Number of lines" value={sub.symmetryLines ?? 2} min={2} max={32} onChange={(v) => update({ symmetryLines: v })} />
          <label className="check prop-check">
            <input type="checkbox" checked={sub.symmetryMirror ?? true} onChange={(e) => update({ symmetryMirror: e.target.checked })} />
            Line symmetry
          </label>
        </>
      )}
      {sub.tool === 'ruler' && sub.rulerKind === 'special' && (
        <Segmented
          label="Special ruler"
          value={sub.specialRuler ?? 'parallel'}
          options={[
            ['parallel', 'Parallel line'],
            ['parallelCurve', 'Parallel curve'],
            ['multiCurve', 'Multiple curve'],
            ['radial', 'Radial line'],
            ['radialCurve', 'Radial curve'],
            ['concentric', 'Concentric circle'],
          ]}
          onChange={(specialRuler) => update({ specialRuler })}
        />
      )}
      {sub.tool === 'ruler' && (sub.rulerKind === 'curve' || (sub.rulerKind === 'special' && isSpecialCurve(sub.specialRuler))) && (
        <Segmented
          label="Curve"
          value={sub.curveType ?? 'spline'}
          options={[
            ['polyline', 'Polyline'],
            ['spline', 'Spline'],
            ['quadratic', 'Quadratic Bezier'],
            ['cubic', 'Cubic Bezier'],
          ]}
          onChange={(curveType) => update({ curveType })}
        />
      )}
      {sub.tool === 'ruler' && sub.rulerKind === 'figure' && (
        <>
          <Segmented
            label="Figure"
            value={sub.rulerFigure ?? 'ellipse'}
            options={[
              ['rect', 'Rectangle'],
              ['ellipse', 'Ellipse'],
              ['polygon', 'Polygon'],
            ]}
            onChange={(rulerFigure) => update({ rulerFigure })}
          />
          {sub.rulerFigure === 'polygon' && <PropSlider label="Number of corners" value={sub.polygonCorners ?? 6} min={3} max={32} onChange={(v) => update({ polygonCorners: v })} />}
        </>
      )}
      {sub.tool === 'gradient' && <GradientSettings sub={sub} update={update} />}
      {!b && !f && !['select', 'gradient', 'object', 'text', 'balloon', 'frame', 'correct', 'liquify', 'flash', 'focusLines', 'speedLines'].includes(sub.tool) && <div className="prop-note">{toolInfo(sub.tool).hint}</div>}
      <div className="prop-footer">
        <button className="icon-btn" title="Reset to the default settings" aria-label="Reset sub tool" onClick={() => actions.resetSubTool(sub.id)}>
          <Icon name="resetRotation" size={15} />
        </button>
        {b && (
          <button
            className={`icon-btn ${advanced ? 'on' : ''}`}
            title="Advanced Tool Settings"
            aria-label="Advanced tool settings"
            aria-pressed={advanced}
            onClick={() => setState((s) => ({ advancedToolSettings: !s.advancedToolSettings }))}
          >
            <Icon name="wrench" size={15} />
          </button>
        )}
        {(f || sub.effectLines || (sub.tool === 'object' && linesLayer)) && (
          <button className={`icon-btn ${more ? 'on' : ''}`} title="More settings" aria-label="Advanced tool settings" aria-pressed={more} onClick={() => setMore((m) => !m)}>
            <Icon name="wrench" size={15} />
          </button>
        )}
      </div>
      {dyn && b && <DynamicsPopover kind={dyn.kind} at={dyn.at} onClose={() => setDyn(null)} />}
    </div>
  );
}

/** Liquify tool: Brush size, the mode (icons, like the reference), Strength, Hardness, Anti-aliasing and Only refer to editing area. */
function LiquifyToolSettings({ l, update }: { l: LiquifySettings; update: (patch: Partial<LiquifySettings>) => void }) {
  const current = LIQUIFY_MODES.find(([id]) => id === l.mode)?.[1] ?? '';
  return (
    <>
      <PropSlider testId="prop-size" label="Brush Size" value={l.size} min={0.5} max={2000} log step={0.1} decimals={1} onChange={(v) => actions.setBrushSize(v)} />
      <div className="prop-row column">
        <span className="prop-label">
          Mode <span className="prop-value-note">{current}</span>
        </span>
        <div className="segmented icons" role="radiogroup" aria-label="Liquify mode">
          {LIQUIFY_MODES.map(([id, label]) => (
            <button key={id} role="radio" aria-checked={l.mode === id} aria-label={label} title={label} className={l.mode === id ? 'on' : ''} onClick={() => update({ mode: id })}>
              <Icon name={`liquify-${id}`} size={16} />
            </button>
          ))}
        </div>
      </div>
      <PropSlider testId="prop-liquify-strength" label="Strength" value={l.strength} min={1} max={100} onChange={(v) => update({ strength: v })} />
      <PropSlider testId="prop-liquify-hardness" label="Hardness" value={l.hardness} min={0} max={100} onChange={(v) => update({ hardness: v })} />
      <PropSlider label="Stabilization" value={l.stabilization} min={0} max={100} onChange={(v) => update({ stabilization: v })} />
      <label className="check prop-check">
        <input type="checkbox" checked={l.antiAlias} onChange={(e) => update({ antiAlias: e.target.checked })} />
        Anti-aliasing
      </label>
      <label className="check prop-check" title="With a selection, the colours come only from inside it">
        <input type="checkbox" checked={l.onlyArea} onChange={(e) => update({ onlyArea: e.target.checked })} />
        Only refer to editing area
      </label>
    </>
  );
}

/** Erasers on vector layers: what a touch erases. */
function VectorEraserRow({ sub, update }: { sub: SubTool; update: (patch: Partial<SubTool>) => void }) {
  const mode = sub.vectorErase ?? 'touched';
  const modes = [
    ['touched', 'Touched area'],
    ['intersection', 'Up to intersection'],
    ['whole', 'Whole line'],
  ] as const;
  return (
    <div className="prop-row column">
      <span className="prop-label">Vector eraser</span>
      <div className="segmented wrap" role="radiogroup" aria-label="Vector eraser">
        {modes.map(([id, label]) => (
          <button key={id} role="radio" aria-checked={mode === id} className={mode === id ? 'on' : ''} onClick={() => update({ vectorErase: id })}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'intersection' && (
        <label className="check prop-check">
          <input type="checkbox" checked={sub.vectorReferAll ?? false} onChange={(e) => update({ vectorReferAll: e.target.checked })} />
          Refer all layers
        </label>
      )}
    </div>
  );
}

/**
 * Light table tool: the selected light table layer's position, scale and angle as numbers, flips
 * and reset (it turns and scales about the middle of the canvas).
 */
function LightTableSettings() {
  const l = useStore((s) => light.shownLightLayers(s)?.layers.find((x) => x.id === s.lightSelection) ?? null);
  const span = useStore((s) => Math.max(s.doc.width, s.doc.height) * 2);
  if (!l) return <div className="prop-note">Select a light table layer in the Animation cels palette.</div>;
  const set = (patch: Partial<typeof l>, label: string, key: string) => light.updateLight(l.id, (x) => ({ ...x, ...patch }), label, `light:${key}:${l.id}`);
  return (
    <>
      <PropSlider label="Position X" unit="px" value={round2(l.x)} min={-span} max={span} step={1} decimals={1} onChange={(v) => set({ x: v }, 'Move light table layer', 'x')} />
      <PropSlider label="Position Y" unit="px" value={round2(l.y)} min={-span} max={span} step={1} decimals={1} onChange={(v) => set({ y: v }, 'Move light table layer', 'y')} />
      <PropSlider label="Scale ratio" unit="%" value={round2(l.scale * 100)} min={1} max={1000} log step={0.1} decimals={1} onChange={(v) => set({ scale: v / 100 }, 'Scale light table layer', 'scale')} />
      <PropSlider label="Rotation angle" unit="°" value={round2(l.rotation)} min={-360} max={360} step={1} decimals={1} onChange={(v) => set({ rotation: v }, 'Rotate light table layer', 'rotate')} />
      <div className="prop-row">
        <button className={`btn small ${l.flipH ? 'on' : ''}`} aria-pressed={l.flipH} onClick={() => light.flipLight('h')}>
          Flip horizontal
        </button>
        <button className={`btn small ${l.flipV ? 'on' : ''}`} aria-pressed={l.flipV} onClick={() => light.flipLight('v')}>
          Flip vertical
        </button>
        <button className="btn small" onClick={light.resetLightPosition}>
          Reset
        </button>
      </div>
    </>
  );
}

/** Object tool: a track's keyframe placement (keyframes on, or a 2D camera folder), else the selected objects. */
function ObjectSettings({ sub, update, more }: { sub: SubTool; update: (patch: Partial<SubTool>) => void; more: boolean }) {
  const audio = useStore((s) => (s.doc.timeline ? sound.activeSoundTrack(s) : null));
  const keyed = useStore((s) => (s.doc.timeline?.enabled && !s.editKeyed ? anim.keyTrack(s) : null));
  const fill = useStore((s) => {
    const l = actions.activeLayer(s);
    return l?.kind === 'fill' && !s.maskEditing ? l : null;
  });
  const lines = useStore((s) => {
    const l = actions.activeLayer(s);
    return l?.kind === 'lines' && !s.maskEditing ? l : null;
  });
  const image = useStore((s) => {
    const l = actions.activeLayer(s);
    return l?.kind === 'image' && !s.maskEditing ? l : null;
  });
  if (audio) return <AudioTrackSettings />;
  if (lines && !keyed) return <LinesObjectSettings layer={lines} more={more} />;
  if (image && !keyed) return <ImageObjectSettings layer={image} />;
  if (fill && !keyed)
    return (
      <>
        <div className="prop-row">
          <span className="prop-label">Fill color</span>
          <button
            className="fill-swatch"
            aria-label="Fill color"
            title="Change the fill layer's colour (a colour picked in the colour palettes does too)"
            style={{ background: fill.color }}
            onClick={() => openColorSettings(fill.color, (c) => actions.setFillColor(fill.id, c))}
          />
        </div>
        <div className="prop-note">A colour picked in the Color Wheel, Color Slider or Color Set palette becomes the fill colour.</div>
      </>
    );
  return keyed ? <KeyframeSettings track={keyed} /> : <ObjectLineSettings sub={sub} update={update} />;
}

/** Object tool on an image material layer: Image material (scale ratio, rotation, interpolation, flips) and Tiling. */
function ImageObjectSettings({ layer }: { layer: ImageLayer }) {
  const p = layer.placement;
  const change = (patch: Partial<ImagePlacement>, label: string, key?: string) =>
    actions.setLayerContent(layer.id, { ...EMPTY_CONTENT, image: { ...p, ...patch } }, label, key ? `image:${layer.id}:${key}` : undefined);
  const scale = Math.round(Math.abs(p.sx) * 1000) / 10;
  return (
    <>
      <div className="prop-section">Image material</div>
      <PropSlider
        testId="prop-image-scale"
        label="Scale ratio"
        value={scale}
        min={1}
        max={1000}
        log
        step={0.1}
        decimals={1}
        unit="%"
        onChange={(v) => {
          const k = v / 100 / Math.max(1e-6, Math.abs(p.sx));
          change({ sx: p.sx * k, sy: p.sy * k }, 'Scale ratio', 'scale');
        }}
      />
      <PropSlider
        testId="prop-image-rotation"
        label="Rotation angle"
        value={Math.round(((((p.rotation * 180) / Math.PI + 540) % 360) - 180) * 10) / 10}
        min={-180}
        max={180}
        step={0.5}
        decimals={1}
        unit="°"
        onChange={(v) => change({ rotation: (v * Math.PI) / 180 }, 'Rotation angle', 'rotation')}
      />
      <div className="prop-row">
        <span className="prop-label">Interpolation method</span>
        <select className="prop-select" aria-label="Interpolation method" value={p.hardEdges ? 'hard' : 'smooth'} onChange={(e) => change({ hardEdges: e.target.value === 'hard' }, 'Interpolation method')}>
          <option value="smooth">Smooth edges (bilinear)</option>
          <option value="hard">Hard edges (nearest neighbor)</option>
        </select>
      </div>
      <div className="prop-row">
        <button className="btn small" onClick={() => change({ sx: -p.sx }, 'Flip horizontal')}>
          Flip horizontal
        </button>
        <button className="btn small" onClick={() => change({ sy: -p.sy }, 'Flip vertical')}>
          Flip vertical
        </button>
      </div>
      <div className="prop-section">Tiling</div>
      <label className="check prop-check">
        <input type="checkbox" checked={p.tiling !== null} onChange={(e) => change({ tiling: e.target.checked ? 'repeat' : null }, 'Tiling')} />
        Tiling
      </label>
      {p.tiling && (
        <>
          <div className="prop-row">
            <span className="prop-label">Repetition</span>
            <select className="prop-select" aria-label="Repetition" value={p.tiling} onChange={(e) => change({ tiling: e.target.value as TilingMode }, 'Tiling')}>
              {TILING_MODES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="prop-row">
            <span className="prop-label">Tiling direction</span>
            <select className="prop-select" aria-label="Tiling direction" value={p.tilingDirection} onChange={(e) => change({ tilingDirection: e.target.value as TilingDirection }, 'Tiling direction')}>
              {TILING_DIRECTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </>
  );
}

/** Object tool on an audio track: its volume at the current frame (with volume keyframes: a keyframe there). */
function AudioTrackSettings() {
  const track = useStore((s) => sound.activeSoundTrack(s));
  const volume = useStore((s) => sound.volumeNow(s));
  const frame = useStore((s) => s.frame);
  if (!track) return null;
  const atKey = track.keys.frames.some((k) => k.frame === frame);
  return (
    <>
      <div className="prop-note" data-testid="audio-info">
        Audio layer {track.name} · frame {frame}
        {atKey ? ' (keyframe)' : track.keys.frames.length ? '' : ' · no volume keyframes'}
      </div>
      <PropSlider label="Volume" unit="%" value={Math.round(volume * 100)} min={0} max={100} onChange={(v) => sound.setVolumeNow(v / 100)} />
      <label className="check prop-check">
        <input type="checkbox" checked={!track.visible} onChange={(e) => sound.setSoundTrack(track.id, { visible: !e.target.checked }, e.target.checked ? 'Mute audio layer' : 'Unmute audio layer')} />
        Mute
      </label>
      <div className="prop-row">
        <button className="btn small" onClick={() => anim.addKeyframe()}>
          Add keyframe
        </button>
        <button className="btn small" onClick={() => sound.deleteSoundTrack(track.id)}>
          Delete audio layer
        </button>
      </div>
      <div className="prop-note">With volume keyframes the volume changes between them (Timeline palette: Add keyframe, interpolation).</div>
    </>
  );
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The placement of a track at the current frame; a change records a keyframe there. */
function KeyframeSettings({ track }: { track: Layer }) {
  const frame = useStore((s) => s.frame);
  const { width, height } = useStore(useShallow((s) => ({ width: s.doc.width, height: s.doc.height })));
  const cameraView = useStore((s) => s.cameraView);
  // With the track's layer mask selected, the settings place the mask.
  const mask = useStore((s) => anim.maskKeyed(s)?.id === track.id);
  const id = mask ? maskTrackId(track.id) : track.id;
  const keys = mask ? (track.mask?.keys ?? []) : (track.keys?.frames ?? []);
  const interp = useStore((s) => keys.find((k) => k.frame === s.frame)?.interp ?? s.keyInterp);
  const [keepAspect, setKeepAspect] = useState(true);
  const p = mask ? anim.maskPlacementNow(track, frame) : anim.placementNow(track, frame);
  const camera = isCameraFolder(track);
  const atKey = keys.some((k) => k.frame === frame);
  // A change records the properties it sets.
  const set = (patch: Partial<Placement>, what: string) => anim.setKeyframe(id, frame, { ...p, ...patch }, `Keyframe: ${what}`, `key:${id}:${frame}:${what}`, false, Object.keys(patch) as PlacementChannel[]);
  const span = Math.max(width, height) * 2;
  return (
    <>
      <div className="prop-note" data-testid="keyframe-info">
        {camera ? '2D camera folder' : mask ? `Mask of ${track.name}` : 'Keyframes'} · frame {frame}
        {atKey ? ' (keyframe)' : ''}
      </div>
      {camera && (
        <Segmented
          label="2D camera"
          value={cameraView ? 'view' : 'guides'}
          options={[
            ['guides', 'Show field guides'],
            ['view', "Show camera's field of view"],
          ]}
          onChange={(v) => {
            if ((v === 'view') !== cameraView) anim.toggleCameraView();
          }}
        />
      )}
      <PropSlider label="Position X" unit="px" value={round2(p.x)} min={-span} max={span} step={1} decimals={1} onChange={(v) => set({ x: v }, 'position')} />
      <PropSlider label="Position Y" unit="px" value={round2(p.y)} min={-span} max={span} step={1} decimals={1} onChange={(v) => set({ y: v }, 'position')} />
      <PropSlider
        label="Scale ratio W"
        unit="%"
        value={round2(p.scaleX * 100)}
        min={1}
        max={1000}
        log
        step={0.1}
        decimals={1}
        onChange={(v) => set(keepAspect ? { scaleX: v / 100, scaleY: (p.scaleY / p.scaleX) * (v / 100) } : { scaleX: v / 100 }, 'scale')}
      />
      <PropSlider
        label="Scale ratio H"
        unit="%"
        value={round2(p.scaleY * 100)}
        min={1}
        max={1000}
        log
        step={0.1}
        decimals={1}
        onChange={(v) => set(keepAspect ? { scaleY: v / 100, scaleX: (p.scaleX / p.scaleY) * (v / 100) } : { scaleY: v / 100 }, 'scale')}
      />
      <label className="check prop-check">
        <input type="checkbox" checked={keepAspect} onChange={(e) => setKeepAspect(e.target.checked)} />
        Keep aspect ratio
      </label>
      <PropSlider label="Rotate" unit="°" value={round2(p.rotation)} min={-360} max={360} step={1} decimals={1} onChange={(v) => set({ rotation: v }, 'rotate')} />
      <PropSlider label="Center of rotation X" unit="px" value={round2(p.pivotX)} min={-width} max={width * 2} step={1} onChange={(v) => set({ pivotX: v }, 'center')} />
      <PropSlider label="Center of rotation Y" unit="px" value={round2(p.pivotY)} min={-height} max={height * 2} step={1} onChange={(v) => set({ pivotY: v }, 'center')} />
      {!mask && <PropSlider label="Opacity" unit="%" value={Math.round(p.opacity * 100)} min={0} max={100} onChange={(v) => set({ opacity: v / 100 }, 'opacity')} />}
      <Segmented
        label="Keyframe interpolation"
        value={interp}
        options={[
          ['hold', 'Hold'],
          ['linear', 'Linear'],
          ['smooth', 'Smooth'],
        ]}
        onChange={(v) => anim.setKeyInterp(v as Interp)}
      />
      <div className="prop-row">
        <button className="btn small" onClick={() => set({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, 'reset')}>
          Reset
        </button>
      </div>
      <div className="prop-note">
        {camera
          ? 'Drag the camera frame on the canvas: inside to move, a corner to zoom, the round handle to turn. Each change makes a keyframe at the current frame.'
          : 'Drag the box on the canvas: inside to move, a corner to scale, the round handle to rotate, the centre point to move the centre of rotation. Each change makes a keyframe at the current frame.'}
      </div>
    </>
  );
}

/** Object tool: colour, width and opacity of the selected vector lines. */
function ObjectLineSettings({ sub, update }: { sub: SubTool; update: (patch: Partial<SubTool>) => void }) {
  // Line objects never change in place, so a shallow comparison keeps this stable.
  const lines = useStore(useShallow((s) => actions.selectedVectorLines(s)?.lines ?? []));
  const first = lines[0];
  const change = (fn: Parameters<typeof actions.updateSelectedLines>[0], label: string, key?: string) => actions.updateSelectedLines(fn, label, key);
  const texts = useStore(useShallow((s) => actions.selectedTextObjects(s)?.texts ?? []));
  const balloons = useStore(useShallow((s) => actions.selectedTextObjects(s)?.balloons ?? []));
  const frame = useStore((s) => {
    const sel = actions.selectedObjectsOf(s);
    return sel && sel.layer.kind === 'folder' ? sel.layer : null;
  });
  const gradientLayer = useStore((s) => actions.activeLayer(s)?.kind === 'gradient');
  return (
    <>
      {gradientLayer && <GradientSettings sub={null} update={update} />}
      {texts.length > 0 && <TextSettings />}
      {balloons.length > 0 && <BalloonObjectSettings balloons={balloons} />}
      {frame && <FrameObjectSettings folder={frame} />}
      {first ? (
        <>
          <div className="prop-row">
            <span className="prop-label">Line color</span>
            <span className="line-color-row">
              <input
                type="color"
                className="line-color"
                aria-label="Line color"
                value={first.color}
                onChange={(e) => {
                  const color = e.target.value;
                  change((l) => ({ ...l, color }), 'Line color', 'lines:color');
                }}
              />
              <button
                className="btn small"
                title="Give the selected lines the drawing color"
                aria-label="Use drawing color"
                onClick={() => {
                  const color = drawingColor(getState().colors);
                  change((l) => ({ ...l, color }), 'Line color');
                }}
              >
                Drawing color
              </button>
            </span>
          </div>
          <PropSlider
            testId="line-size"
            label="Brush Size"
            value={first.brush.size}
            min={0.5}
            max={2000}
            log
            step={0.1}
            decimals={1}
            onChange={(v) => change((l) => ({ ...l, brush: { ...l.brush, size: v } }), 'Line width', 'lines:size')}
          />
          <PropSlider
            label="Opacity"
            value={Math.round(first.brush.opacity * 100)}
            min={0}
            max={100}
            onChange={(v) => change((l) => ({ ...l, brush: { ...l.brush, opacity: v / 100 } }), 'Line opacity', 'lines:opacity')}
          />
          <div className="prop-note">
            {lines.length} line{lines.length === 1 ? '' : 's'} selected · Delete removes {lines.length === 1 ? 'it' : 'them'}
          </div>
        </>
      ) : (
        texts.length + balloons.length === 0 && !frame && !gradientLayer && <div className="prop-note">{toolInfo('object').hint}</div>
      )}
      <label className="check prop-check">
        <input type="checkbox" checked={sub.scaleLineWidth !== false} onChange={(e) => update({ scaleLineWidth: e.target.checked })} />
        Adjust line thickness when scaling
      </label>
    </>
  );
}

/** Fonts offered in the list (any installed font can be typed in). */
const FONTS = [
  'sans-serif',
  'serif',
  'monospace',
  'Helvetica Neue',
  'Arial',
  'Avenir Next',
  'Futura',
  'Gill Sans',
  'Georgia',
  'Times New Roman',
  'Menlo',
  'Courier New',
  'Comic Sans MS',
  'Chalkboard SE',
  'Marker Felt',
  'Hiragino Sans',
  'Hiragino Mincho ProN',
  'Hiragino Maru Gothic ProN',
];

/**
 * Text settings: of the text being typed, else of the selected text, else of the Text tool (for new
 * text). Sizes are shown in points at the document resolution.
 */
function TextSettings() {
  const st = useStore(
    useShallow((s) => {
      const box = s.textEdit?.box ?? actions.selectedTextObjects(s)?.texts[0] ?? null;
      const style = box ?? textToolStyle(s);
      return {
        font: style.font,
        size: box ? pxToPt(box.size, s.doc.dpi) : style.size,
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        strike: style.strike,
        align: style.align,
        vertical: style.vertical,
        color: box?.color ?? null,
        lineSpacing: style.lineSpacing,
        letterSpacing: style.letterSpacing,
        edge: style.edge,
        edgeColor: style.edgeColor,
        wrap: box ? box.wrap : null,
      };
    }),
  );
  const set = setTextStyle;
  const toggles = [
    ['bold', 'B', 'Bold'],
    ['italic', 'I', 'Italic'],
    ['underline', 'U', 'Underline'],
    ['strike', 'S', 'Strikethrough'],
  ] as const;
  return (
    <>
      <div className="prop-row">
        <span className="prop-label">Font</span>
        <input className="prop-input" list="font-families" aria-label="Font" value={st.font} onChange={(e) => e.target.value.trim() && set({ font: e.target.value })} />
        <datalist id="font-families">
          {FONTS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </div>
      <PropSlider testId="text-size" label="Size" unit="pt" value={Math.round(st.size * 10) / 10} min={1} max={500} log step={0.5} decimals={1} onChange={(v) => set({ size: v })} />
      <div className="prop-row">
        <span className="prop-label">Style</span>
        <div className="segmented" role="group" aria-label="Font style">
          {toggles.map(([key, letter, label]) => (
            <button key={key} className={`style-${key} ${st[key] ? 'on' : ''}`} aria-pressed={st[key]} title={label} aria-label={label} onClick={() => set({ [key]: !st[key] })}>
              {letter}
            </button>
          ))}
        </div>
      </div>
      <div className="prop-row">
        <span className="prop-label">Justify</span>
        <div className="segmented" role="radiogroup" aria-label="Justify">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a} role="radio" aria-checked={st.align === a} className={st.align === a ? 'on' : ''} onClick={() => set({ align: a })}>
              {a === 'left' ? 'Left' : a === 'center' ? 'Center' : 'Right'}
            </button>
          ))}
        </div>
      </div>
      <div className="prop-row">
        <span className="prop-label">Direction</span>
        <div className="segmented" role="radiogroup" aria-label="Text direction">
          <button role="radio" aria-checked={!st.vertical} className={!st.vertical ? 'on' : ''} onClick={() => set({ vertical: false })}>
            Horizontal
          </button>
          <button role="radio" aria-checked={st.vertical} className={st.vertical ? 'on' : ''} onClick={() => set({ vertical: true })}>
            Vertical
          </button>
        </div>
      </div>
      {st.color !== null ? (
        <div className="prop-row">
          <span className="prop-label">Text color</span>
          <span className="line-color-row">
            <input type="color" className="line-color" aria-label="Text color" value={st.color} onChange={(e) => set({ color: e.target.value })} />
            <button className="btn small" title="Give the text the drawing color" onClick={() => set({ color: drawingColor(getState().colors) })}>
              Drawing color
            </button>
          </span>
        </div>
      ) : (
        <div className="prop-note">New text uses the drawing color.</div>
      )}
      {st.wrap !== null && (
        <label className="check prop-check">
          <input type="checkbox" checked={st.wrap} onChange={(e) => setTextWrap(e.target.checked)} />
          Wrap text at frame
        </label>
      )}
      <PropSlider label="Line spacing" unit="%" value={Math.round(st.lineSpacing * 100)} min={50} max={300} onChange={(v) => set({ lineSpacing: v / 100 })} />
      <PropSlider label="Letter spacing" unit="px" value={st.letterSpacing} min={-20} max={100} onChange={(v) => set({ letterSpacing: v })} />
      <div className="prop-row">
        <span className="prop-label">Edge</span>
        <span className="line-color-row">
          <input type="color" className="line-color" aria-label="Edge color" value={st.edgeColor} onChange={(e) => set({ edgeColor: e.target.value })} />
        </span>
      </div>
      <PropSlider label="Edge width" unit="px" value={st.edge} min={0} max={50} step={0.5} decimals={1} onChange={(v) => set({ edge: v })} />
    </>
  );
}

const EDGES: [GradientEdge, string][] = [
  ['none', 'Do not repeat'],
  ['repeat', 'Repeat'],
  ['reverse', 'Reverse'],
  ['clear', 'Do not draw'],
];

/** Gradient settings: of the selected gradient layer, else of the Gradient tool. */
function GradientSettings({ sub, update }: { sub: SubTool | null; update: (patch: Partial<SubTool>) => void }) {
  const layer = useStore((s) => {
    const l = actions.activeLayer(s);
    return l?.kind === 'gradient' && !s.maskEditing ? l : null;
  });
  const [main, subColor] = useStore(useShallow((s) => [s.colors.main, s.colors.sub]));
  const spec = layer ? layer.gradient : sub?.gradient;
  if (!spec) return null;
  const set = (patch: Partial<GradientSpec> & { layer?: boolean }, key?: string) => {
    if (layer) actions.setGradientFill(layer.id, patch, 'Edit gradient', key);
    else if (sub?.gradient) update({ gradient: { ...sub.gradient, ...patch } });
  };
  return (
    <>
      {layer && <div className="prop-note">Gradient layer: drag on the canvas with the Gradient tool, or the handles with the Object tool, to change its direction.</div>}
      <GradientBar stops={spec.stops} main={main} sub={subColor} onChange={(stops) => set({ stops }, 'gradient:stops')} />
      <div className="prop-row">
        <span className="prop-label" />
        <button className="btn small" onClick={() => openDialog('gradient')}>
          Advanced settings…
        </button>
      </div>
      <div className="prop-row">
        <span className="prop-label">Shape</span>
        <div className="segmented" role="radiogroup" aria-label="Gradient shape">
          {(
            [
              ['line', 'Line'],
              ['circle', 'Circle'],
              ['ellipse', 'Ellipse'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="radio" aria-checked={spec.shape === id} className={spec.shape === id ? 'on' : ''} onClick={() => set({ shape: id })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="prop-row">
        <span className="prop-label">Edge process</span>
        <select className="prop-select" aria-label="Edge process" value={spec.edge} onChange={(e) => set({ edge: e.target.value as GradientEdge })}>
          {EDGES.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <label className="check prop-check">
        <input type="checkbox" checked={spec.dither} onChange={(e) => set({ dither: e.target.checked })} />
        Dithering
      </label>
      {!layer && sub?.gradient && (
        <label className="check prop-check">
          <input type="checkbox" checked={sub.gradient.layer} onChange={(e) => set({ layer: e.target.checked })} />
          Create gradient layer
        </label>
      )}
    </>
  );
}

/** Frame tools: border width; dividing: gutters and folders. */
/** Correct line tools: the settings of each kind. */
function CorrectToolSettings({ c, update }: { c: CorrectSettings; update: (patch: Partial<CorrectSettings>) => void }) {
  const check = (label: string, key: 'fixEnds' | 'pressure' | 'addPoint' | 'connect' | 'anyProps' | 'smoothCorners' | 'wholeLine' | 'atLeast1') => (
    <label className="check prop-check">
      <input type="checkbox" checked={c[key]} onChange={(e) => update({ [key]: e.target.checked })} />
      {label}
    </label>
  );
  const size = <PropSlider label="Brush Size" unit="px" value={c.size} min={1} max={500} onChange={(v) => update({ size: v })} />;
  const gap = c.connect && <PropSlider label="Connect gap" unit="px" value={c.connectGap} min={1} max={200} onChange={(v) => update({ connectGap: v })} />;
  switch (c.kind) {
    case 'controlPoint':
      return (
        <>
          <Segmented
            label="Mode"
            value={c.mode}
            options={[
              ['move', 'Move control point'],
              ['add', 'Add control point'],
              ['delete', 'Delete control point'],
              ['corner', 'Switch corner'],
              ['width', 'Adjust line width'],
              ['opacity', 'Adjust opacity'],
              ['split', 'Split line'],
            ]}
            onChange={(mode) => update({ mode })}
          />
          <div className="prop-note">{CONTROL_POINT_NOTES[c.mode]}</div>
        </>
      );
    case 'pinch':
      return (
        <>
          {check('Fix end', 'fixEnds')}
          <PropSlider label="Pinch level" unit="%" value={c.pinchLevel} min={1} max={100} onChange={(v) => update({ pinchLevel: v })} />
          {check('Pen pressure', 'pressure')}
          <PropSlider label="Effect range" unit="px" value={c.range} min={1} max={200} onChange={(v) => update({ range: v })} />
          {check('Add control point', 'addPoint')}
          {check('Connect lines', 'connect')}
          {gap}
        </>
      );
    case 'simplify':
      return (
        <>
          <PropSlider label="Simplify" value={c.simplify} min={0} max={100} onChange={(v) => update({ simplify: v })} />
          {check('Smooth corner', 'smoothCorners')}
          {check('Process whole line', 'wholeLine')}
          <Segmented
            label="Convert curve"
            value={c.convert}
            options={[
              ['keep', 'Keep'],
              ['polyline', 'Straight line'],
              ['spline', 'Spline'],
            ]}
            onChange={(convert) => update({ convert })}
          />
          {check('Connect lines', 'connect')}
          {gap}
          <PropSlider label="Delete short lines" unit="px" value={c.deleteShort} min={0} max={200} onChange={(v) => update({ deleteShort: v })} />
          {size}
        </>
      );
    case 'connect':
      return (
        <>
          <PropSlider label="Connect lines" unit="px" value={c.connectGap} min={1} max={200} onChange={(v) => update({ connectGap: v })} />
          {check('Connect lines with different properties', 'anyProps')}
          {size}
        </>
      );
    case 'width':
      return (
        <>
          <Segmented
            label="Adjust"
            value={c.widthMode}
            options={[
              ['thicken', 'Thicken'],
              ['narrow', 'Narrow'],
              ['scaleUp', 'Scale up width'],
              ['scaleDown', 'Scale down width'],
            ]}
            onChange={(widthMode) => update({ widthMode })}
          />
          <PropSlider label="Amount" unit={c.widthMode === 'thicken' || c.widthMode === 'narrow' ? 'px' : '%'} value={c.widthAmount} min={0.1} max={c.widthMode === 'thicken' || c.widthMode === 'narrow' ? 50 : 100} step={0.1} decimals={1} onChange={(v) => update({ widthAmount: v })} />
          {c.widthMode === 'narrow' && check('At least 1 pixel', 'atLeast1')}
          {check('Process whole line', 'wholeLine')}
          {size}
        </>
      );
    case 'redraw':
      return (
        <>
          {check('Fix end', 'fixEnds')}
          {check('Connect lines', 'connect')}
          {gap}
          <PropSlider label="Simplify" value={c.simplify} min={0} max={100} onChange={(v) => update({ simplify: v })} />
          <PropSlider label="Stabilization" value={c.stabilization} min={0} max={30} onChange={(v) => update({ stabilization: v })} />
          <div className="prop-note">Draw over a line to draw that part of it again.</div>
        </>
      );
    case 'redrawWidth':
      return (
        <>
          {size}
          <div className="prop-note">Trace a line: the pen pressure sets its width.</div>
        </>
      );
  }
}

const CONTROL_POINT_NOTES: Record<CorrectSettings['mode'], string> = {
  move: 'Drag a control point to move it.',
  add: 'Click the line to add a control point (and drag it).',
  delete: 'Click a control point to delete it.',
  corner: 'Click a control point to switch it between curve and corner.',
  width: 'Drag a control point right to thicken the line around it, left to thin it.',
  opacity: 'Drag a control point right to make the line more opaque around it, left more transparent.',
  split: 'Click a control point to split the line there.',
};

/** A labelled row of choices (a radio group of buttons). */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="prop-row column">
      <span className="prop-label">{label}</span>
      <div className="segmented wrap" role="radiogroup" aria-label={label}>
        {options.map(([id, text]) => (
          <button key={id} role="radio" aria-checked={value === id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function FrameToolSettings({ sub, update }: { sub: SubTool; update: (patch: Partial<SubTool>) => void }) {
  if (sub.frameShape === 'divide') {
    return (
      <>
        <PropSlider label="Gutter top/bottom" unit="mm" value={sub.gutterTopBottom ?? 4} min={0} max={30} step={0.5} decimals={1} onChange={(v) => update({ gutterTopBottom: v })} />
        <PropSlider label="Gutter left/right" unit="mm" value={sub.gutterLeftRight ?? 2} min={0} max={30} step={0.5} decimals={1} onChange={(v) => update({ gutterLeftRight: v })} />
        <label className="check prop-check">
          <input type="checkbox" checked={sub.divideFolder !== false} onChange={(e) => update({ divideFolder: e.target.checked })} />
          Divide folder (new frame border folder)
        </label>
        <div className="prop-note">Drag across a frame to divide it (⇧: in 45° steps).</div>
      </>
    );
  }
  return (
    <>
      <PropSlider label="Brush Size" unit="px" value={sub.frameLine ?? 5} min={0} max={100} step={0.5} decimals={1} onChange={(v) => update({ frameLine: v })} />
      <div className="prop-note">{sub.frameShape === 'polyline' ? 'Click the corners; double-click, Enter or the first corner closes the frame.' : 'Drag to make a frame; its edges snap to the canvas and other frames.'}</div>
    </>
  );
}

/** Object tool with a frame selected: the border of its frame border folder. */
function FrameObjectSettings({ folder }: { folder: actions.FrameFolder }) {
  const f = folder.frame;
  return (
    <>
      <PropSlider label="Brush Size" unit="px" value={f.lineWidth} min={0} max={100} step={0.5} decimals={1} onChange={(v) => setFrameProps(folder.id, { lineWidth: v }, 'frame:line')} />
      <div className="prop-row">
        <span className="prop-label">Line color</span>
        <input type="color" className="line-color" aria-label="Frame color" value={f.color} onChange={(e) => setFrameProps(folder.id, { color: e.target.value }, 'frame:color')} />
      </div>
      <label className="check prop-check">
        <input type="checkbox" checked={f.draw} onChange={(e) => setFrameProps(folder.id, { draw: e.target.checked })} />
        Draw border
      </label>
    </>
  );
}

/** Balloon tools: outline width and whether the balloon is filled. */
function BalloonToolSettings({ sub, update }: { sub: SubTool; update: (patch: Partial<SubTool>) => void }) {
  const bl = sub.balloon!;
  return (
    <>
      <PropSlider label="Line width" unit="px" value={bl.lineWidth} min={0} max={50} step={0.5} decimals={1} onChange={(v) => update({ balloon: { ...bl, lineWidth: v } })} />
      <label className="check prop-check">
        <input type="checkbox" checked={bl.fill} onChange={(e) => update({ balloon: { ...bl, fill: e.target.checked } })} />
        Fill (sub color)
      </label>
      <div className="prop-note">Line in the main color · drag from inside a balloon with a balloon tail tool to add a tail.</div>
    </>
  );
}

/** Balloon tail tools: width and bend. */
function TailSettings({ sub, update }: { sub: SubTool; update: (patch: Partial<SubTool>) => void }) {
  const t = sub.tail!;
  return (
    <>
      <PropSlider label="Width of tail" unit="px" value={t.width} min={2} max={300} onChange={(v) => update({ tail: { ...t, width: v } })} />
      {t.kind === 'pointed' && <PropSlider label="How to bend" unit="%" value={Math.round(t.bend * 100)} min={-100} max={100} onChange={(v) => update({ tail: { ...t, bend: v / 100 } })} />}
    </>
  );
}

/** Object tool with balloons selected: outline width and colours. */
function BalloonObjectSettings({ balloons }: { balloons: Balloon[] }) {
  const first = balloons[0];
  const change = (fn: (b: Balloon) => Balloon, label: string, key?: string) => actions.updateSelectedBalloons(fn, label, key);
  return (
    <>
      <PropSlider label="Line width" unit="px" value={first.lineWidth} min={0} max={50} step={0.5} decimals={1} onChange={(v) => change((b) => ({ ...b, lineWidth: v }), 'Balloon line width', 'balloon:line')} />
      <div className="prop-row">
        <span className="prop-label">Line color</span>
        <input type="color" className="line-color" aria-label="Balloon line color" value={first.lineColor} onChange={(e) => change((b) => ({ ...b, lineColor: e.target.value }), 'Balloon color', 'balloon:color')} />
      </div>
      <div className="prop-row">
        <span className="prop-label">Fill color</span>
        <span className="line-color-row">
          <input
            type="color"
            className="line-color"
            aria-label="Balloon fill color"
            value={first.fillColor ?? '#ffffff'}
            disabled={first.fillColor === null}
            onChange={(e) => change((b) => ({ ...b, fillColor: e.target.value }), 'Balloon color', 'balloon:fill')}
          />
          <label className="check">
            <input type="checkbox" checked={first.fillColor !== null} onChange={(e) => change((b) => ({ ...b, fillColor: e.target.checked ? '#ffffff' : null }), 'Balloon fill')} />
            Fill
          </label>
        </span>
      </div>
    </>
  );
}

function SelectionModeRow() {
  const op = useStore((s) => s.selectionOp);
  const modes = [
    ['replace', 'New selection'],
    ['add', 'Add selection'],
    ['subtract', 'Delete selection'],
    ['intersect', 'Select from selection'],
  ] as const;
  return (
    <div className="prop-row column">
      <span className="prop-label">Selection mode</span>
      <div className="segmented wrap">
        {modes.map(([id, label]) => (
          <button key={id} className={op === id ? 'on' : ''} onClick={() => useStore.setState({ selectionOp: id })}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Preset brush sizes as dots. */
export function BrushSizePalette() {
  const size = useStore((s) => actions.brushSizeOf(currentSubTool(s)));
  if (size === null) return <div className="prop-note">This tool has no brush size.</div>;
  return (
    <div className="brush-sizes" data-testid="brush-sizes">
      {BRUSH_SIZE_PRESETS.map((v) => (
        <button key={v} className={`size-btn ${Math.abs(size - v) < 0.05 ? 'active' : ''}`} title={`${v} px`} onClick={() => actions.setBrushSize(v)}>
          <span className="dot" style={{ width: Math.max(1.5, Math.min(22, Math.sqrt(v) * 2)), height: Math.max(1.5, Math.min(22, Math.sqrt(v) * 2)) }} />
          <span className="size-label">{v}</span>
        </button>
      ))}
    </div>
  );
}

/** Tool Property while transforming ("Editing transformation settings"), like the reference. */
function TransformSettings({ info }: { info: TransformInfo }) {
  const affineMode = info.mode === 'scaleRotate' || info.mode === 'scale' || info.mode === 'rotate';
  const numbers = (patch: { x?: number; y?: number; angle?: number }) => {
    if (!info.scale || info.angle === null) return;
    let x = patch.x ?? info.scale.x;
    let y = patch.y ?? info.scale.y;
    // Keep aspect ratio: the other value follows.
    if (info.keepAspect && patch.x !== undefined && info.scale.x !== 0) y = info.scale.y * (x / info.scale.x);
    else if (info.keepAspect && patch.y !== undefined && info.scale.y !== 0) x = info.scale.x * (y / info.scale.y);
    setTransformNumbers(x, y, patch.angle ?? info.angle);
  };
  return (
    <div className="tool-property transform-settings" data-testid="transform-settings">
      <div className="prop-title">
        <span className="prop-tool-name">Editing transformation settings</span>
      </div>
      <div className="transform-buttons">
        <button className="icon-btn" title="Reset transformation" aria-label="Reset transformation" onClick={resetTransform}>
          <Icon name="resetRotation" />
        </button>
        <button className="icon-btn" title="Flip horizontal" aria-label="Flip horizontal" onClick={() => flipTransform(true)}>
          <Icon name="flipH" />
        </button>
        <button className="icon-btn" title="Flip vertical" aria-label="Flip vertical" onClick={() => flipTransform(false)}>
          <Icon name="flipV" />
        </button>
        <button className="icon-btn" title="Confirm transformation" aria-label="Confirm transformation" onClick={confirmTransform}>
          <Icon name="check" />
        </button>
        <button className="icon-btn" title="Cancel transformation" aria-label="Cancel transformation" onClick={cancelTransform}>
          <Icon name="close" />
        </button>
      </div>
      <div className="prop-row">
        <span className="prop-label">Mode</span>
        <select className="prop-select" aria-label="Transformation mode" value={info.mode} onChange={(e) => setTransformMode(e.target.value as TransformMode)}>
          {TRANSFORM_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="prop-row">
        <span className="prop-label">Reference point</span>
        <select className="prop-select" aria-label="Reference point" value={info.reference} onChange={(e) => setTransformPrefs({ reference: e.target.value as ReferencePoint })}>
          {REFERENCE_POINTS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <PropSlider label="Position X" value={Math.round(info.pivot.x)} min={-8000} max={16000} onChange={(v) => setTransformPivot(v, info.pivot.y)} />
      <PropSlider label="Position Y" value={Math.round(info.pivot.y)} min={-8000} max={16000} onChange={(v) => setTransformPivot(info.pivot.x, v)} />
      <label className="check prop-check">
        <input type="checkbox" checked={info.scaleWidth} onChange={(e) => setTransformPrefs({ scaleWidth: e.target.checked })} /> Change vector width
      </label>
      <label className="check prop-check">
        <input type="checkbox" checked={info.keepOriginal} onChange={(e) => setTransformPrefs({ keepOriginal: e.target.checked })} /> Keep original image
      </label>
      {affineMode && info.scale && info.angle !== null && (
        <>
          <PropSlider label="Scale ratio W" value={Number(info.scale.x.toFixed(1))} min={-1000} max={1000} step={0.1} decimals={1} unit="%" onChange={(v) => numbers({ x: v || 0.1 })} />
          <PropSlider label="Scale ratio H" value={Number(info.scale.y.toFixed(1))} min={-1000} max={1000} step={0.1} decimals={1} unit="%" onChange={(v) => numbers({ y: v || 0.1 })} />
        </>
      )}
      {(info.mode === 'scaleRotate' || info.mode === 'scale') && (
        <label className="check prop-check">
          <input type="checkbox" checked={info.keepAspect} onChange={(e) => setTransformPrefs({ keepAspect: e.target.checked })} /> Keep aspect ratio
        </label>
      )}
      {affineMode && info.scale && info.angle !== null && (
        <PropSlider label="Rotation angle" value={Number(info.angle.toFixed(1))} min={-180} max={180} step={0.1} decimals={1} onChange={(v) => numbers({ angle: v })} />
      )}
      {info.mode === 'mesh' && (
        <>
          <PropSlider label="Number of horizontal lattice points" value={info.latticeX} min={2} max={16} onChange={(v) => setTransformPrefs({ latticeX: v })} />
          <PropSlider label="Number of vertical lattice points" value={info.latticeY} min={2} max={16} onChange={(v) => setTransformPrefs({ latticeY: v })} />
        </>
      )}
      <div className="prop-row">
        <span className="prop-label">Interpolation method</span>
        <select className="prop-select" aria-label="Interpolation method" value={info.interpolation} onChange={(e) => setTransformPrefs({ interpolation: e.target.value as Interpolation })}>
          {INTERPOLATIONS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
