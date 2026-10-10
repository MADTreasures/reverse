import { MaterialStrip } from './ui/palettes/MaterialPalette';
import { applyMaterial, MATERIAL_MIME, useMaterials } from './store/materialActions';
import { apply as applyMatrix, invert } from './paint/viewMath';
import { controller } from './tools/controller';
import { useEffect, useRef, useState } from 'react';
import { handleDroppedFiles } from './io/documentIO';
import { isElectron } from './platform/platform';
import { useStore } from './store/store';
import { CanvasView } from './ui/canvas/CanvasView';
import { CommandBar } from './ui/CommandBar';
import { MenuBar } from './ui/MenuBar';
import { OverlayHost } from './ui/OverlayHost';
import { AdvancedToolSettings } from './ui/palettes/BrushSettingsPanels';
import { ToolSliders } from './ui/palettes/ToolSliders';
import { ToolPalette } from './ui/palettes/ToolPalettes';
import { DockColumns, FloatingPalettes, PaletteDragOverlay } from './ui/Docks';
import { StatusBar } from './ui/StatusBar';
import { TimelinePalette } from './ui/palettes/TimelinePalette';

/** Left of the canvas: the Tool palette, the left palette docks and (default workspace) the Tool sliders. */
function LeftDock() {
  const workspace = useStore((s) => s.workspace);
  const ref = useRef<HTMLElement>(null);
  // The command bar lines its icons up with the canvas.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.querySelector<HTMLElement>('.app')?.style.setProperty('--left-dock', `${el.offsetWidth}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <aside ref={ref} className="dock dock-left" data-workspace={workspace}>
      <ToolPalette />
      <DockColumns side="left" />
      {workspace === 'default' && <ToolSliders />}
    </aside>
  );
}

function RightDock() {
  return (
    <aside className="dock dock-right">
      <DockColumns side="right" />
    </aside>
  );
}

/** A point of the window (client px) on the document. */
function clientToDoc(x: number, y: number): { x: number; y: number } | undefined {
  const canvas = document.querySelector('[data-testid=paint-canvas]');
  if (!canvas) return undefined;
  const r = canvas.getBoundingClientRect();
  return applyMatrix(invert(controller.view.matrix), x - r.left, y - r.top);
}

export function App() {
  const hidden = useStore((s) => s.palettesHidden);
  const menuHidden = useStore((s) => s.menuHidden);
  const workspace = useStore((s) => s.workspace);
  const name = useStore((s) => s.doc.name);
  const dirty = useStore((s) => s.dirty);
  const timelineShown = useStore((s) => s.timelineShown);
  const stripShown = useMaterials((s) => s.stripShown);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        setDragOver(true);
      } else if (e.dataTransfer?.types.includes(MATERIAL_MIME) && e.target instanceof Element && e.target.closest('.canvas-window, [data-testid=layer-panel]')) {
        // Materials can be dropped on the canvas or the Layer palette.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragOver(false);
    };
    const drop = (e: DragEvent) => {
      setDragOver(false);
      const material = e.dataTransfer?.getData(MATERIAL_MIME);
      if (material) {
        e.preventDefault();
        const onCanvas = e.target instanceof Element && e.target.closest('.canvas-window') !== null;
        applyMaterial(material, onCanvas ? clientToDoc(e.clientX, e.clientY) : undefined);
        return;
      }
      // The Sub View palette takes dropped images as reference images itself.
      if (!e.dataTransfer?.files.length || e.defaultPrevented) return;
      e.preventDefault();
      const onLayers = e.target instanceof Element && e.target.closest('[data-testid=layer-panel]') !== null;
      void handleDroppedFiles([...e.dataTransfer.files], onLayers);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <div className={`app ws-${workspace} ${hidden ? 'palettes-hidden' : ''} ${isElectron ? 'is-electron' : ''}`}>
      {!isElectron && !menuHidden && <MenuBar />}
      {!menuHidden && <CommandBar />}
      <div className="workspace">
        {!hidden && <LeftDock />}
        <main className="canvas-window">
          <div className="canvas-tabs">
            <span className="canvas-tab active" title={name}>
              {name}
              {dirty ? '*' : ''}
            </span>
          </div>
          <CanvasView />
          {timelineShown && !hidden && <TimelinePalette />}
          <StatusBar />
        </main>
        {!hidden && <RightDock />}
        {!hidden && stripShown && <MaterialStrip />}
      </div>
      {dragOver && <div className="drop-hint">Drop on the canvas to open · drop images on the Layer palette to add them as layers</div>}
      {!hidden && <FloatingPalettes />}
      <PaletteDragOverlay />
      <AdvancedToolSettings />
      <OverlayHost />
    </div>
  );
}
