/**
 * The palette docks and floating palettes, like the reference's: each dock column holds palette
 * stacks (palettes stacked as tabs, the palette menu ≡ at the left of the title bar, a double click
 * minimises it); tabs are dragged to move palettes (see paletteDrag.ts); the edge under a palette
 * changes its height, a dock's edge next to the canvas its width, the double arrow on top hides the
 * dock. Floating palettes have their own title bar with menu, minimise and close.
 */
import { Fragment, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { DockColumn, DockSide, DockStack, FloatingPalette } from '../model/paletteLayout';
import type { PaletteId } from '../model/palettes';
import type { WorkspaceId } from '../paint/tools';
import { frontTab, hidePalette, setPaletteTab } from '../store/paletteActions';
import { changeFloating, raiseFloatingPalette, toggleDock, usePaletteLayout } from '../store/paletteLayoutStore';
import { useStore } from '../store/store';
import { showMenu } from './overlays';
import { beginColumnResize, beginFloatingMove, beginFloatingResize, beginStackResize, beginTabDrag, clickSuppressed, usePaletteDrag } from './paletteDrag';
import { paletteLabel, PALETTES } from './paletteRegistry';

/** The test ids and class names the stacks of the default layouts keep. */
const STACK_TEST_IDS: Record<string, string> = {
  subtool: 'subtool-panel',
  property: 'property-panel',
  brushsize: 'brushsize-panel',
  color: 'color-panel',
  classicColor: 'color-panel',
  colorSet: 'colorset-panel',
  navigator: 'navigator-panel',
  layerProperty: 'layer-property-panel',
  layer: 'layer-panel',
};

function stackClass(stack: DockStack, ws: WorkspaceId): string {
  if (stack.id === 'colorSet') return 'colorset-palette';
  if (stack.id === 'layerProperty') return 'layer-property-palette';
  if (ws === 'classic' && stack.id === 'subtool') return 'classic-subtool';
  if (stack.id === 'brushsize') return 'classic-sizes';
  return '';
}

function DockStackView({ stack, ws, grow }: { stack: DockStack; ws: WorkspaceId; grow: boolean }) {
  const hidden = useStore((s) => s.hiddenPalettes);
  const front = useStore((s) => frontTab(stack.id, stack.tabs, s));
  const [collapsed, setCollapsed] = useState(false);
  const spring = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLElement>(null);
  const shown = stack.tabs.filter((t) => !hidden.includes(t));
  if (!shown.length || !front) return null;
  const spec = PALETTES[front];
  const sized = stack.height !== undefined && !grow;
  return (
    <section
      ref={ref}
      className={`palette ${grow ? 'grow' : ''} ${sized ? 'sized' : ''} ${collapsed ? 'collapsed' : ''} ${stackClass(stack, ws)}`}
      style={sized && !collapsed ? { height: stack.height } : undefined}
      data-testid={STACK_TEST_IDS[stack.id]}
      data-dock-stack={stack.id}
    >
      <header className="palette-tabs" data-stack-tabs={stack.id} onDoubleClick={() => setCollapsed((c) => !c)}>
        {spec.menu && (
          <button
            className="palette-menu"
            title="Palette menu"
            aria-label={`${paletteLabel(front, ws)} palette menu`}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              const b = e.currentTarget.getBoundingClientRect();
              showMenu({ x: b.left, y: b.bottom + 2 }, spec.menu!());
            }}
          >
            ≡
          </button>
        )}
        {shown.map((t) => (
          <button
            key={t}
            className={`palette-tab ${t === front ? 'active' : ''}`}
            title={paletteLabel(t, ws)}
            data-palette-tab={t}
            onPointerDown={(e) => {
              const r = ref.current?.getBoundingClientRect();
              beginTabDrag(e, t, paletteLabel(t, ws), { w: r?.width ?? 250, h: Math.max(160, r?.height ?? 300) });
            }}
            onClick={() => !clickSuppressed() && setPaletteTab(stack.id, t)}
            // Dragging something over a tab opens it after a moment (e.g. a layer onto the Animation cels palette).
            onDragEnter={() => {
              if (spring.current) clearTimeout(spring.current);
              if (t !== front) spring.current = setTimeout(() => setPaletteTab(stack.id, t), 350);
            }}
            onDragLeave={() => spring.current && clearTimeout(spring.current)}
          >
            {paletteLabel(t, ws, stack.id)}
          </button>
        ))}
      </header>
      {!collapsed && <div className="palette-body">{spec.content(ws)}</div>}
    </section>
  );
}

function DockColumnView({ column, ws }: { column: DockColumn; ws: WorkspaceId }) {
  const hidden = useStore((s) => s.hiddenPalettes);
  const { lockHeight, fixWidth } = usePaletteLayout(useShallow((s) => ({ lockHeight: s.layouts[ws].lockHeight, fixWidth: s.layouts[ws].fixWidth })));
  const inner = column.side === 'left' ? 'right' : 'left';
  const arrow = (open: boolean) => (column.side === 'left' ? (open ? '«' : '»') : open ? '»' : '«');
  if (column.hidden)
    return (
      <div className="dock-column dock-hidden" data-dock-column={column.id}>
        <button className="dock-arrow" title="Show palette dock" aria-label="Show palette dock" onClick={() => toggleDock(column.id)}>
          {arrow(false)}
        </button>
      </div>
    );
  const visible = column.stacks.filter((s) => s.tabs.some((t) => !hidden.includes(t)));
  // The palette taking the height left is hidden: the last shown one without a fixed height takes it.
  const growId = visible.find((s) => s.grow)?.id ?? [...visible].reverse().find((s) => s.height === undefined)?.id ?? visible[visible.length - 1]?.id;
  return (
    <div className={`dock-column ${column.side}-column`} style={{ width: column.width }} data-dock-column={column.id}>
      <div className={`dock-head ${column.side}`}>
        <button className="dock-arrow" title="Hide palette dock" aria-label="Hide palette dock" onClick={() => toggleDock(column.id)}>
          {arrow(true)}
        </button>
      </div>
      {visible.map((stack, i) => (
        <Fragment key={stack.id}>
          <DockStackView stack={stack} ws={ws} grow={stack.id === growId} />
          {i < visible.length - 1 && !lockHeight && (
            <div className="dock-splitter" role="separator" aria-orientation="horizontal" aria-label={`Height of ${paletteLabel(frontTab(stack.id, stack.tabs) ?? stack.tabs[0], ws)}`} onPointerDown={(e) => beginStackResize(e, { ...column, stacks: visible.map((v) => ({ ...v, grow: v.id === growId || undefined })) }, i)} />
          )}
        </Fragment>
      ))}
      {!fixWidth && <div className={`dock-grip ${inner}`} role="separator" aria-orientation="vertical" aria-label="Palette dock width" onPointerDown={(e) => beginColumnResize(e, column)} />}
    </div>
  );
}

/** The dock columns on one side of the canvas. */
export function DockColumns({ side }: { side: DockSide }) {
  const ws = useStore((s) => s.workspace);
  const columns = usePaletteLayout((s) => s.layouts[ws].columns);
  return (
    <>
      {columns
        .filter((c) => c.side === side)
        .map((c) => (
          <DockColumnView key={c.id} column={c} ws={ws} />
        ))}
    </>
  );
}

function FloatingWindow({ f, ws }: { f: FloatingPalette; ws: WorkspaceId }) {
  const spec = PALETTES[f.id];
  const label = paletteLabel(f.id, ws);
  return (
    <section
      className={`palette floating-palette ${f.minimized ? 'collapsed' : ''}`}
      style={{ left: f.x, top: f.y, width: f.w, height: f.minimized ? undefined : f.h }}
      role="region"
      aria-label={`${label} palette`}
      data-floating-palette={f.id}
      onPointerDown={() => raiseFloatingPalette(f.id)}
    >
      <header className="floating-title" onPointerDown={(e) => (e.target as HTMLElement).closest('button') === null && beginFloatingMove(e, f.id, label, f)} onDoubleClick={() => changeFloating(f.id, { minimized: !f.minimized })}>
        {spec.menu && (
          <button
            className="palette-menu"
            title="Palette menu"
            aria-label={`${label} palette menu`}
            onClick={(e) => {
              const b = e.currentTarget.getBoundingClientRect();
              showMenu({ x: b.left, y: b.bottom + 2 }, spec.menu!());
            }}
          >
            ≡
          </button>
        )}
        <span className="floating-name">{label}</span>
        <button className="floating-btn" title={f.minimized ? 'Restore' : 'Minimize'} aria-label={f.minimized ? `Restore ${label}` : `Minimize ${label}`} onClick={() => changeFloating(f.id, { minimized: !f.minimized })}>
          {f.minimized ? '▢' : '–'}
        </button>
        <button className="floating-btn" title="Close" aria-label={`Close ${label}`} onClick={() => hidePalette(f.id)}>
          ×
        </button>
      </header>
      {!f.minimized && (
        <>
          <div className="palette-body">{spec.content(ws)}</div>
          <div className="floating-resize" aria-label={`Size of ${label}`} onPointerDown={(e) => beginFloatingResize(e, f.id, f)} />
        </>
      )}
    </section>
  );
}

/** The floating palettes (the last one in front). */
export function FloatingPalettes() {
  const ws = useStore((s) => s.workspace);
  const floating = usePaletteLayout((s) => s.layouts[ws].floating);
  const hidden = useStore((s) => s.hiddenPalettes);
  return (
    <div className="floating-layer">
      {floating
        .filter((f) => !hidden.includes(f.id as PaletteId))
        .map((f) => (
          <FloatingWindow key={f.id} f={f} ws={ws} />
        ))}
    </div>
  );
}

/** While a palette is dragged: the red line or frame where it goes, and its outline at the pointer. */
export function PaletteDragOverlay() {
  const drag = usePaletteDrag((s) => s.drag);
  if (!drag) return null;
  return (
    <div className="palette-drag-layer">
      {drag.frame && <div className="drop-frame" style={{ left: drag.frame.x, top: drag.frame.y, width: drag.frame.w, height: drag.frame.h }} />}
      {drag.indicator && <div className="drop-indicator" style={{ left: drag.indicator.x, top: drag.indicator.y, width: drag.indicator.w, height: drag.indicator.h }} />}
      {!drag.floating && (
        <div className="palette-ghost" style={{ left: drag.x + 8, top: drag.y + 8 }}>
          {drag.label}
        </div>
      )}
    </div>
  );
}
