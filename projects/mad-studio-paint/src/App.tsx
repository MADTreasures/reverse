import { MaterialStrip } from './ui/palettes/MaterialPalette';
import { applyMaterial, MATERIAL_MIME, useMaterials } from './store/materialActions';
import { apply as applyMatrix, invert } from './paint/viewMath';
import { controller } from './tools/controller';
import { useEffect, useState } from 'react';
import { handleDroppedFiles } from './io/documentIO';
import { isElectron } from './platform/platform';
import { setState, useStore } from './store/store';
import { CanvasView } from './ui/canvas/CanvasView';
import { CommandBar } from './ui/CommandBar';
import { MenuBar } from './ui/MenuBar';
import { OverlayHost } from './ui/OverlayHost';
import { Palette } from './ui/Palette';
import { ColorSet } from './ui/palettes/ColorSet';
import { ColorHistory, ColorSliders, ColorWheelPanel } from './ui/palettes/ColorWheel';
import { ApproximateColor, approximateMenu, IntermediateColor, intermediateMenu } from './ui/palettes/ColorGrids';
import { SearchLayer } from './ui/palettes/SearchLayer';
import { SubView, subViewMenu } from './ui/palettes/SubView';
import { HistoryPalette } from './ui/palettes/HistoryPalette';
import { LayerActionBar, LayerFlagBar, LayerList, LayerPropertyBar } from './ui/palettes/LayerPalette';
import { AdvancedToolSettings } from './ui/palettes/BrushSettingsPanels';
import { LayerPropertyPalette } from './ui/palettes/LayerPropertyPalette';
import { Navigator } from './ui/palettes/Navigator';
import { ToolSliders } from './ui/palettes/ToolSliders';
import { BrushSizePalette, SubToolPalette, ToolPalette, ToolProperty } from './ui/palettes/ToolPalettes';
import { StatusBar } from './ui/StatusBar';
import { TimelinePalette } from './ui/palettes/TimelinePalette';
import { AnimationCelsPalette } from './ui/palettes/AnimationCelsPalette';

function LayerPaletteBody() {
  return (
    <div className="layer-palette">
      <LayerPropertyBar />
      <LayerFlagBar />
      <LayerActionBar />
      <LayerList />
    </div>
  );
}

/** Left dock of the current default workspace: tool palette, tool group/settings, colours, tool sliders. */
function DefaultLeftDock() {
  return (
    <aside className="dock dock-left" data-workspace="default">
      <ToolPalette />
      <div className="dock-column left-column">
        <Palette
          grow
          testId="subtool-panel"
          tabs={[
            { id: 'group', label: 'Tool Group', content: <SubToolPalette /> },
            { id: 'settings', label: 'Tool Settings', content: <ToolProperty /> },
          ]}
        />
        <Palette
          testId="color-panel"
          stack="color"
          tabs={[
            { id: 'colorWheel', label: 'Color Wheel', content: <ColorWheelPanel size={176} /> },
            { id: 'colorSlider', label: 'Color Slider', content: <ColorSliders /> },
          ]}
        />
        <Palette
          className="colorset-palette"
          testId="colorset-panel"
          stack="colorSet"
          tabs={[
            { id: 'colorSet', label: 'Color Set', content: <ColorSet /> },
            { id: 'colorHistory', label: 'Color History', content: <ColorHistory /> },
            { id: 'intermediateColor', label: 'Intermediate Color', content: <IntermediateColor />, menu: intermediateMenu },
            { id: 'approximateColor', label: 'Approximate Color', content: <ApproximateColor />, menu: approximateMenu },
          ]}
        />
      </div>
      <ToolSliders />
    </aside>
  );
}

/** Left dock of the classic workspace: sub tool, tool property, brush size and colour palettes stacked. */
function ClassicLeftDock() {
  return (
    <aside className="dock dock-left" data-workspace="classic">
      <ToolPalette />
      <div className="dock-column left-column">
        <Palette testId="subtool-panel" className="classic-subtool" tabs={[{ id: 'sub', label: 'Sub Tool', content: <SubToolPalette /> }]} />
        <Palette grow testId="property-panel" tabs={[{ id: 'prop', label: 'Tool Property', content: <ToolProperty /> }]} />
        <Palette className="classic-sizes" testId="brushsize-panel" tabs={[{ id: 'size', label: 'Brush Size', content: <BrushSizePalette /> }]} />
        <Palette
          testId="color-panel"
          stack="classicColor"
          tabs={[
            { id: 'colorWheel', label: 'Color Wheel', content: <ColorWheelPanel size={150} /> },
            { id: 'colorSlider', label: 'Slider', content: <ColorSliders /> },
            { id: 'colorSet', label: 'Set', content: <ColorSet /> },
            { id: 'colorHistory', label: 'History', content: <ColorHistory /> },
            { id: 'intermediateColor', label: 'Intermediate', content: <IntermediateColor />, menu: intermediateMenu },
            { id: 'approximateColor', label: 'Approximate', content: <ApproximateColor />, menu: approximateMenu },
          ]}
        />
      </div>
    </aside>
  );
}

function RightDock() {
  const tab = useStore((s) => s.layerDockTab);
  return (
    <aside className="dock dock-right">
      <div className="dock-column right-column">
        <Palette
          testId="navigator-panel"
          stack="navigator"
          tabs={[
            { id: 'navigator', label: 'Navigator', content: <Navigator /> },
            { id: 'subView', label: 'Sub View', content: <SubView />, menu: subViewMenu },
          ]}
        />
        <Palette testId="layer-property-panel" className="layer-property-palette" tabs={[{ id: 'layerProperty', label: 'Layer Property', content: <LayerPropertyPalette /> }]} />
        <Palette
          grow
          testId="layer-panel"
          active={tab}
          onSelect={(id) => setState({ layerDockTab: id as typeof tab })}
          tabs={[
            { id: 'layer', label: 'Layer', content: <LayerPaletteBody /> },
            { id: 'searchLayer', label: 'Search Layer', content: <SearchLayer /> },
            { id: 'history', label: 'History', content: <HistoryPalette /> },
            { id: 'animationCels', label: 'Animation cels', content: <AnimationCelsPalette /> },
          ]}
        />
      </div>
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
        {!hidden && (workspace === 'classic' ? <ClassicLeftDock /> : <DefaultLeftDock />)}
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
      <AdvancedToolSettings />
      <OverlayHost />
    </div>
  );
}
