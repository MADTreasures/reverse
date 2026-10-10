/**
 * Brush settings beyond the Tool Settings palette: the dynamics popover (pen pressure graph, tilt,
 * random) and the Advanced Tool Settings palette with all categories of a brush.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { deleteMaterial, importMaterial, materialList, materialPreview, materialsVersion, subscribeMaterials } from '../../engine/materials';
import type { MaterialInfo, MaterialKind } from '../../paint/materials';
import type { BrushSettings, SubTool } from '../../paint/tools';
import * as actions from '../../store/actions';
import { currentSubTool, setState, useStore } from '../../store/store';
import { CurveEditor } from '../controls/CurveEditor';
import { Icon } from '../controls/Icons';
import { PropSlider } from '../controls/PropSlider';

export type DynamicsKind = 'size' | 'density';

const setBrush = (sub: SubTool, patch: Partial<BrushSettings>) => actions.updateSubTool(sub.id, { brush: { ...sub.brush!, ...patch } });

/** True when a setting reacts to anything but its slider. */
export function dynamicsOn(b: BrushSettings, kind: DynamicsKind): boolean {
  return kind === 'size' ? b.sizePressure || b.sizeTilt || Boolean(b.sizeVelocity) || b.sizeRandom > 0 : b.opacityPressure || b.densityTilt || Boolean(b.densityVelocity) || b.densityRandom > 0;
}

/** Pen pressure (minimum value + graph), tilt and random for brush size or brush density. */
function DynamicsControls({ sub, kind }: { sub: SubTool; kind: DynamicsKind }) {
  const b = sub.brush!;
  const size = kind === 'size';
  const pressure = size ? b.sizePressure : b.opacityPressure;
  const min = size ? b.minSize : b.minDensity;
  const curve = size ? b.sizeCurve : b.densityCurve;
  const tilt = size ? b.sizeTilt : b.densityTilt;
  const velocity = Boolean(size ? b.sizeVelocity : b.densityVelocity);
  const random = size ? b.sizeRandom : b.densityRandom;
  return (
    <div className="dynamics" data-testid={`${kind}-dynamics`}>
      <label className="check">
        <input type="checkbox" checked={pressure} onChange={(e) => setBrush(sub, size ? { sizePressure: e.target.checked } : { opacityPressure: e.target.checked })} /> Pen pressure
      </label>
      {(pressure || velocity) && (
        <>
          <PropSlider
            label="Minimum value"
            value={Math.round(min * 100)}
            min={0}
            max={100}
            unit="%"
            onChange={(v) => setBrush(sub, size ? { minSize: v / 100 } : { minDensity: v / 100 })}
          />
          {pressure && (
            <CurveEditor
              label={`${size ? 'Brush size' : 'Brush density'} pressure graph`}
              testId={`${kind}-curve`}
              points={curve}
              onChange={(pts) => setBrush(sub, size ? { sizeCurve: pts } : { densityCurve: pts })}
            />
          )}
        </>
      )}
      <label className="check" title={size ? 'Leaning the pen widens the stroke' : 'Leaning the pen makes the stroke lighter'}>
        <input type="checkbox" checked={tilt} onChange={(e) => setBrush(sub, size ? { sizeTilt: e.target.checked } : { densityTilt: e.target.checked })} /> Tilt
      </label>
      <label className="check" title={size ? 'Faster strokes are thinner' : 'Faster strokes are lighter'}>
        <input type="checkbox" checked={velocity} onChange={(e) => setBrush(sub, size ? { sizeVelocity: e.target.checked } : { densityVelocity: e.target.checked })} /> Velocity
      </label>
      <PropSlider label="Random" value={Math.round(random * 100)} min={0} max={100} unit="%" onChange={(v) => setBrush(sub, size ? { sizeRandom: v / 100 } : { densityRandom: v / 100 })} />
    </div>
  );
}

/** Small window next to the dynamics button of Brush size / Brush density. */
export function DynamicsPopover({ kind, at, onClose }: { kind: DynamicsKind; at: { x: number; y: number }; onClose: () => void }) {
  const sub = useStore((s) => currentSubTool(s));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  if (!sub.brush) return null;
  const top = Math.min(at.y, window.innerHeight - 380);
  return (
    <div ref={ref} className="popover" style={{ left: at.x, top }} role="dialog" aria-label={kind === 'size' ? 'Brush size dynamics' : 'Brush density dynamics'}>
      <h4>{kind === 'size' ? 'Brush size' : 'Brush density'}</h4>
      <DynamicsControls sub={sub} kind={kind} />
    </div>
  );
}

// ------------------------------------------------------------------ Advanced Tool Settings

type Category = 'size' | 'ink' | 'aa' | 'tip' | 'spray' | 'stroke' | 'texture' | 'watercolor' | 'correction' | 'taper';

const CATEGORIES: { id: Category; label: string; paintOnly?: boolean }[] = [
  { id: 'size', label: 'Brush size' },
  { id: 'ink', label: 'Ink' },
  { id: 'aa', label: 'Anti-aliasing', paintOnly: true },
  { id: 'tip', label: 'Brush tip' },
  { id: 'spray', label: 'Spraying effect', paintOnly: true },
  { id: 'stroke', label: 'Stroke' },
  { id: 'texture', label: 'Texture', paintOnly: true },
  { id: 'watercolor', label: 'Watercolor edge', paintOnly: true },
  { id: 'correction', label: 'Correction', paintOnly: true },
  { id: 'taper', label: 'Starting and ending', paintOnly: true },
];

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
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

const previews = new Map<string, string>();
const previewOf = (m: MaterialInfo) => {
  const key = `${m.kind}:${m.id}`;
  let url = previews.get(key);
  if (url === undefined) previews.set(key, (url = materialPreview(m.id, m.kind)));
  return url;
};

/**
 * Thumbnails of the brush tips or paper textures to choose from, with a button to import an image
 * as a new one; imported ones can be deleted (⌥-click).
 */
function MaterialPicker({ kind, label, selected, onPick }: { kind: MaterialKind; label: string; selected: string[]; onPick: (id: string) => void }) {
  useSyncExternalStore(subscribeMaterials, materialsVersion);
  const list = materialList(kind);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="prop-row column">
      <span className="prop-label">{label}</span>
      <div className="material-grid" role="listbox" aria-label={label} aria-multiselectable={kind === 'tip'}>
        {list.map((m) => (
          <button
            key={m.id}
            role="option"
            aria-selected={selected.includes(m.id)}
            className={`material ${selected.includes(m.id) ? 'on' : ''}`}
            title={m.id.startsWith('img-') ? `${m.name} (⌥-click deletes it)` : m.name}
            aria-label={m.name}
            onClick={(e) => {
              if (e.altKey && m.id.startsWith('img-')) deleteMaterial(m.id);
              else onPick(m.id);
            }}
          >
            <img src={previewOf(m)} alt="" draggable={false} />
          </button>
        ))}
        <button className="material add" title="Import an image" aria-label={kind === 'tip' ? 'Import brush tip image' : 'Import texture image'} onClick={() => input.current?.click()}>
          +
        </button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          data-testid={`import-${kind}`}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const m = await importMaterial(f, f.name, kind);
            onPick(m.id);
          }}
        />
      </div>
    </div>
  );
}

function CategoryBody({ sub, category }: { sub: SubTool; category: Category }): ReactNode {
  const b = sub.brush!;
  const set = (patch: Partial<BrushSettings>) => setBrush(sub, patch);
  switch (category) {
    case 'size':
      return (
        <>
          <PropSlider label="Brush Size" value={b.size} min={0.5} max={2000} log step={0.1} decimals={1} onChange={(v) => actions.setBrushSize(v)} />
          <DynamicsControls sub={sub} kind="size" />
        </>
      );
    case 'ink':
      return (
        <>
          {b.mode !== 'blend' && <PropSlider label="Opacity" value={Math.round(b.opacity * 100)} min={0} max={100} onChange={(v) => set({ opacity: v / 100 })} />}
          <PropSlider label={b.mode === 'blend' ? 'Strength' : 'Brush density'} value={Math.round(b.flow * 100)} min={1} max={100} onChange={(v) => set({ flow: v / 100 })} />
          <DynamicsControls sub={sub} kind="density" />
          {b.mode === 'paint' && (
            <>
              <Segmented
                label="Color mixing"
                value={b.mixing}
                options={[
                  ['none', 'Off'],
                  ['blend', 'Blend'],
                  ['running', 'Running color'],
                ]}
                onChange={(v) => set({ mixing: v })}
              />
              {b.mixing !== 'none' && (
                <>
                  <PropSlider label="Amount of paint" value={Math.round(b.paintAmount * 100)} min={0} max={100} onChange={(v) => set({ paintAmount: v / 100 })} />
                  <PropSlider label="Density of paint" value={Math.round(b.paintDensity * 100)} min={0} max={100} onChange={(v) => set({ paintDensity: v / 100 })} />
                  <PropSlider label="Color stretch" value={Math.round(b.colorStretch * 100)} min={0} max={100} onChange={(v) => set({ colorStretch: v / 100 })} />
                </>
              )}
            </>
          )}
        </>
      );
    case 'aa':
      return (
        <Segmented
          label="Anti-aliasing"
          value={String(b.antiAlias) as '0' | '1' | '2' | '3'}
          options={[
            ['0', 'None'],
            ['1', 'Weak'],
            ['2', 'Medium'],
            ['3', 'Strong'],
          ]}
          onChange={(v) => set({ antiAlias: Number(v) })}
        />
      );
    case 'tip':
      return (
        <>
          <Segmented
            label="Tip shape"
            value={b.tipShape}
            options={[
              ['circle', 'Circle'],
              ['material', 'Material'],
            ]}
            onChange={(v) => set({ tipShape: v, ...(v === 'material' && b.tipMaterials.length === 0 ? { tipMaterials: ['chalk'] } : {}) })}
          />
          {b.tipShape === 'material' ? (
            <>
              <MaterialPicker
                kind="tip"
                label="Brush tip (click to add or remove)"
                selected={b.tipMaterials}
                onPick={(id) => {
                  const on = b.tipMaterials.includes(id);
                  // At least one tip stays.
                  if (on && b.tipMaterials.length === 1) return;
                  set({ tipMaterials: on ? b.tipMaterials.filter((x) => x !== id) : [...b.tipMaterials, id].slice(0, 16) });
                }}
              />
              <Segmented
                label="Flip horizontal"
                value={b.flipH}
                options={[
                  ['off', 'Off'],
                  ['on', 'Flip'],
                  ['random', 'Random'],
                ]}
                onChange={(v) => set({ flipH: v })}
              />
              <Segmented
                label="Flip vertical"
                value={b.flipV}
                options={[
                  ['off', 'Off'],
                  ['on', 'Flip'],
                  ['random', 'Random'],
                ]}
                onChange={(v) => set({ flipV: v })}
              />
            </>
          ) : (
            <PropSlider label="Hardness" value={Math.round(b.hardness * 100)} min={0} max={100} onChange={(v) => set({ hardness: v / 100 })} />
          )}
          <PropSlider label="Thickness" value={Math.round(b.thickness * 100)} min={5} max={100} unit="%" onChange={(v) => set({ thickness: v / 100 })} />
          <PropSlider label="Angle" value={b.angle} min={0} max={360} unit="°" onChange={(v) => set({ angle: v })} />
          <Segmented
            label="Angle follows"
            value={b.angleSource}
            options={[
              ['fixed', 'Nothing'],
              ['line', 'Direction of line'],
              ['tilt', 'Direction of pen'],
            ]}
            onChange={(v) => set({ angleSource: v })}
          />
          <PropSlider label="Random angle" value={Math.round(b.angleRandom * 100)} min={0} max={100} unit="%" onChange={(v) => set({ angleRandom: v / 100 })} />
        </>
      );
    case 'spray':
      return <PropSlider label="Particle spread" value={Math.round(b.scatter * 100)} min={0} max={2000} unit="%" onChange={(v) => set({ scatter: v / 100 })} />;
    case 'stroke':
      return (
        <>
          <PropSlider label="Gap" value={Math.round(b.spacing * 100)} min={1} max={500} unit="%" onChange={(v) => set({ spacing: v / 100 })} />
          {b.tipShape === 'material' && b.tipMaterials.length > 1 && (
            <Segmented
              label="Repeat method"
              value={b.tipOrder}
              options={[
                ['repeat', 'Repeat'],
                ['reverse', 'Reverse'],
                ['stay', 'Do not repeat'],
                ['random', 'Random'],
                ['once', 'One time only'],
              ]}
              onChange={(v) => set({ tipOrder: v })}
            />
          )}
        </>
      );
    case 'texture':
      return (
        <>
          <MaterialPicker kind="texture" label="Paper texture (click again to remove)" selected={b.paper ? [b.paper] : []} onPick={(id) => set({ paper: b.paper === id ? '' : id })} />
          {b.paper && (
            <>
              <PropSlider label="Texture density" value={Math.round(b.paperDensity * 100)} min={0} max={100} onChange={(v) => set({ paperDensity: v / 100 })} />
              <PropSlider label="Scale ratio" value={b.paperScale} min={5} max={400} unit="%" onChange={(v) => set({ paperScale: v })} />
              <PropSlider label="Rotation angle" value={b.paperAngle} min={0} max={360} unit="°" onChange={(v) => set({ paperAngle: v })} />
              <PropSlider label="Brightness" value={b.paperBrightness} min={-100} max={100} onChange={(v) => set({ paperBrightness: v })} />
              <PropSlider label="Contrast" value={b.paperContrast} min={-100} max={100} onChange={(v) => set({ paperContrast: v })} />
              <label className="check">
                <input type="checkbox" checked={b.paperInvert} onChange={(e) => set({ paperInvert: e.target.checked })} /> Invert texture
              </label>
              <Segmented
                label="Texture mode"
                value={b.paperMode}
                options={[
                  ['subtract', 'Subtract'],
                  ['multiply', 'Multiply'],
                ]}
                onChange={(v) => set({ paperMode: v })}
              />
              <label className="check">
                <input type="checkbox" checked={b.paperPerDab} onChange={(e) => set({ paperPerDab: e.target.checked })} /> Apply by each plot
              </label>
            </>
          )}
          <Segmented
            label="Tip grain"
            value={b.texture}
            options={[
              ['none', 'None'],
              ['grain', 'Grain'],
            ]}
            onChange={(v) => set({ texture: v })}
          />
        </>
      );
    case 'watercolor':
      return (
        <>
          <label className="check">
            <input type="checkbox" checked={b.watercolorEdge} onChange={(e) => set({ watercolorEdge: e.target.checked })} /> Watercolor edge
          </label>
          {b.watercolorEdge && (
            <>
              <PropSlider label="Range" value={b.edgeRange} min={0.5} max={100} step={0.5} decimals={1} unit="px" onChange={(v) => set({ edgeRange: v })} />
              <PropSlider label="Opacity effect" value={Math.round(b.edgeOpacity * 100)} min={0} max={100} onChange={(v) => set({ edgeOpacity: v / 100 })} />
              <PropSlider label="Darkness effect" value={Math.round(b.edgeDarkness * 100)} min={0} max={100} onChange={(v) => set({ edgeDarkness: v / 100 })} />
            </>
          )}
        </>
      );
    case 'correction':
      return <PropSlider label="Stabilization" value={b.stabilization} min={0} max={100} onChange={(v) => set({ stabilization: v })} />;
    case 'taper':
      return (
        <>
          <PropSlider label="Starting" value={b.taperStart} min={0} max={500} unit="px" onChange={(v) => set({ taperStart: v })} testId="taper-start" />
          <PropSlider label="Ending" value={b.taperEnd} min={0} max={500} unit="px" onChange={(v) => set({ taperEnd: v })} testId="taper-end" />
          <label className="check">
            <input type="checkbox" checked={b.taperSize} onChange={(e) => set({ taperSize: e.target.checked })} /> Brush size
          </label>
          <label className="check">
            <input type="checkbox" checked={b.taperDensity} onChange={(e) => set({ taperDensity: e.target.checked })} /> Brush density
          </label>
        </>
      );
  }
}

/** Advanced Tool Settings palette: floating, movable, all settings of the current brush by category. */
export function AdvancedToolSettings() {
  const open = useStore((s) => s.advancedToolSettings);
  const sub = useStore((s) => currentSubTool(s));
  const [category, setCategory] = useState<Category>('size');
  const [pos, setPos] = useState({ x: 330, y: 120 });
  if (!open || !sub.brush) return null;
  const paint = sub.brush.mode === 'paint';
  const cats = CATEGORIES.filter((c) => paint || !c.paintOnly);
  const active = cats.some((c) => c.id === category) ? category : 'size';

  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const start = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const move = (ev: PointerEvent) => setPos({ x: Math.max(0, ev.clientX - start.x), y: Math.max(0, ev.clientY - start.y) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section className="floating-palette advanced-settings" style={{ left: pos.x, top: pos.y }} role="dialog" aria-label="Advanced Tool Settings">
      <header onPointerDown={drag}>
        <span>Advanced Tool Settings · {sub.name}</span>
        <button className="icon-btn" aria-label="Close" onPointerDown={(e) => e.stopPropagation()} onClick={() => setState({ advancedToolSettings: false })}>
          ×
        </button>
      </header>
      <div className="advanced-body">
        <nav className="advanced-categories">
          {cats.map((c) => (
            <button key={c.id} className={c.id === active ? 'on' : ''} onClick={() => setCategory(c.id)}>
              {c.label}
            </button>
          ))}
        </nav>
        <div className="advanced-settings-body tool-property">
          <CategoryBody sub={sub} category={active} />
        </div>
      </div>
      <footer>
        <button className="icon-btn" title="Reset to the default settings" aria-label="Reset sub tool" onClick={() => actions.resetSubTool(sub.id)}>
          <Icon name="resetRotation" size={15} />
        </button>
      </footer>
    </section>
  );
}
