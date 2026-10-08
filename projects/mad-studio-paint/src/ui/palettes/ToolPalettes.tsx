import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BRUSH_SIZE_PRESETS } from '../../store/actions';
import * as actions from '../../store/actions';
import { currentSubTool, drawingColor, getState, setState, useStore } from '../../store/store';
import { pxToPt, setTextStyle, setTextWrap, textToolStyle } from '../../store/textActions';
import { setFrameProps } from '../../store/frameActions';
import type { Balloon } from '../../paint/text';
import type { GradientEdge, GradientSpec } from '../../paint/gradient';
import { GradientBar } from '../controls/GradientBar';
import { openDialog } from '../overlays';
import { entryForTool, PALETTE_ENTRIES, PALETTE_LAYOUT, subToolsOf, toolInfo, type FillReference, type SubTool, type ToolId } from '../../paint/tools';
import { Icon } from '../controls/Icons';
import { PropSlider } from '../controls/PropSlider';
import { DynamicsPopover, dynamicsOn, type DynamicsKind } from './BrushSettingsPanels';
import { ColorIcons } from './ColorWheel';

/** Last tool used per palette button (for buttons that hold several tools). */
const lastTool = new Map<string, ToolId>();

/** Column of tool buttons in sections, with the colour icons at the bottom. */
export function ToolPalette() {
  const tool = useStore((s) => s.tool);
  const workspace = useStore((s) => s.workspace);
  const current = entryForTool(tool);
  lastTool.set(current.id, tool);
  return (
    <div className="tool-palette" role="toolbar" aria-label="Tools" data-testid="tool-palette">
      {PALETTE_LAYOUT[workspace].map((section, i) => (
        <div key={i} className="tool-section">
          {section.map((id) => {
            const e = PALETTE_ENTRIES.find((x) => x.id === id)!;
            const active = e.id === current.id;
            const keys = [...new Set(e.tools.map((t) => toolInfo(t).key))].join(', ');
            return (
              <button
                key={e.id}
                className={`tool-btn ${active ? 'active' : ''}`}
                title={`${e.label} (${keys})`}
                aria-label={e.label}
                aria-pressed={active}
                data-tool={e.tools[0]}
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
  const subTools = useStore((s) => s.subTools);
  const active = useStore((s) => currentSubTool(s));
  const entry = entryForTool(tool);
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
          <button key={s.id} className={`subtool ${s.id === active.id ? 'active' : ''} ${s.brush ? 'with-stroke' : ''}`} data-subtool={s.id} onClick={() => actions.setSubTool(tool, s.id)}>
            {s.brush && <StrokePreview sub={s} />}
            <span className="subtool-name">{s.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A tapering S-curve drawn with the brush's softness and opacity. */
function StrokePreview({ sub }: { sub: SubTool }) {
  const b = sub.brush!;
  const w = Math.max(1.2, Math.min(9, Math.sqrt(b.size) * 1.6));
  const soft = b.hardness < 0.5 || b.mode === 'blend';
  return (
    <svg className="stroke-preview" viewBox="0 0 160 22" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M6 15 C 40 2, 70 2, 82 11 S 125 21, 154 6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={w}
        opacity={b.mode === 'erase' ? 0.4 : Math.max(0.4, b.flow * b.opacity)}
        strokeDasharray={b.scatter > 0 ? '1 3' : b.texture === 'grain' ? '6 1.5' : undefined}
        style={soft ? { filter: 'blur(1.2px)' } : undefined}
      />
    </svg>
  );
}

const REFERENCE_LABELS: Record<FillReference, string> = {
  layer: 'Editing layer only',
  all: 'All layers',
  reference: 'Reference layers',
};

const AA_LEVELS = ['None', 'Weak', 'Medium', 'Strong'];

/** Settings of the selected sub tool. */
export function ToolProperty() {
  const sub = useStore((s) => currentSubTool(s));
  const advanced = useStore((s) => s.advancedToolSettings);
  const [more, setMore] = useState(false);
  const [dyn, setDyn] = useState<{ kind: DynamicsKind; at: { x: number; y: number } } | null>(null);
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
          <label className="check prop-check">
            <input type="checkbox" checked={f.contiguous} onChange={(e) => update({ fill: { ...f, contiguous: e.target.checked } })} />
            Follow adjacent pixels
          </label>
          <PropSlider testId="prop-tolerance" label="Color margin" value={f.tolerance} min={0} max={100} unit="%" onChange={(v) => update({ fill: { ...f, tolerance: v } })} />
          <PropSlider label="Area scaling" value={f.expand} min={-20} max={20} unit="px" onChange={(v) => update({ fill: { ...f, expand: v } })} />
          {more && (
            <label className="check prop-check">
              <input type="checkbox" checked={f.alphaOnly} onChange={(e) => update({ fill: { ...f, alphaOnly: e.target.checked } })} />
              Compare transparency only
            </label>
          )}
        </>
      )}
      {sub.tool === 'eraser' && b && <VectorEraserRow sub={sub} update={update} />}
      {sub.tool === 'object' && <ObjectLineSettings sub={sub} update={update} />}
      {sub.tool === 'text' && <TextSettings />}
      {sub.tool === 'balloon' && sub.balloon && <BalloonToolSettings sub={sub} update={update} />}
      {sub.tool === 'balloon' && sub.tail && <TailSettings sub={sub} update={update} />}
      {sub.tool === 'frame' && <FrameToolSettings sub={sub} update={update} />}
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
        <div className="prop-row column">
          <span className="prop-label">Special ruler</span>
          <div className="segmented wrap" role="radiogroup" aria-label="Special ruler">
            {(
              [
                ['parallel', 'Parallel line'],
                ['radial', 'Radial line'],
                ['concentric', 'Concentric circle'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="radio" aria-checked={sub.specialRuler === id} className={sub.specialRuler === id ? 'on' : ''} onClick={() => update({ specialRuler: id })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {sub.tool === 'gradient' && <GradientSettings sub={sub} update={update} />}
      {!b && !f && !['select', 'gradient', 'object', 'text', 'balloon', 'frame'].includes(sub.tool) && <div className="prop-note">{toolInfo(sub.tool).hint}</div>}
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
        {f && (
          <button className={`icon-btn ${more ? 'on' : ''}`} title="More fill settings" aria-label="Advanced tool settings" aria-pressed={more} onClick={() => setMore((m) => !m)}>
            <Icon name="wrench" size={15} />
          </button>
        )}
      </div>
      {dyn && b && <DynamicsPopover kind={dyn.kind} at={dyn.at} onClose={() => setDyn(null)} />}
    </div>
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
  const sub = useStore((s) => currentSubTool(s));
  if (!sub.brush) return <div className="prop-note">This tool has no brush size.</div>;
  return (
    <div className="brush-sizes" data-testid="brush-sizes">
      {BRUSH_SIZE_PRESETS.map((v) => (
        <button key={v} className={`size-btn ${Math.abs(sub.brush!.size - v) < 0.05 ? 'active' : ''}`} title={`${v} px`} onClick={() => actions.setBrushSize(v)}>
          <span className="dot" style={{ width: Math.max(1.5, Math.min(22, Math.sqrt(v) * 2)), height: Math.max(1.5, Math.min(22, Math.sqrt(v) * 2)) }} />
          <span className="size-label">{v}</span>
        </button>
      ))}
    </div>
  );
}
