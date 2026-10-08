import { useEffect, useState } from 'react';
import { handleDroppedFiles } from './io/documentIO';
import { isElectron } from './platform/platform';
import { useStore } from './store/store';
import { CanvasView } from './ui/canvas/CanvasView';
import { CommandBar } from './ui/CommandBar';
import { MenuBar } from './ui/MenuBar';
import { OverlayHost } from './ui/OverlayHost';
import { Palette } from './ui/Palette';
import { ColorSet } from './ui/palettes/ColorSet';
import { ColorHistory, ColorSliders, ColorWheelPanel } from './ui/palettes/ColorWheel';
import { HistoryPalette } from './ui/palettes/HistoryPalette';
import { LayerActionBar, LayerFlagBar, LayerList, LayerPropertyBar } from './ui/palettes/LayerPalette';
import { AdvancedToolSettings } from './ui/palettes/BrushSettingsPanels';
import { LayerPropertyPalette } from './ui/palettes/LayerPropertyPalette';
import { Navigator } from './ui/palettes/Navigator';
import { ToolSliders } from './ui/palettes/ToolSliders';
import { BrushSizePalette, SubToolPalette, ToolPalette, ToolProperty } from './ui/palettes/ToolPalettes';
import { StatusBar } from './ui/StatusBar';

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
          tabs={[
            { id: 'wheel', label: 'Color Wheel', content: <ColorWheelPanel size={176} /> },
            { id: 'slider', label: 'Color Slider', content: <ColorSliders /> },
          ]}
        />
        <Palette
          className="colorset-palette"
          testId="colorset-panel"
          tabs={[
            { id: 'set', label: 'Color Set', content: <ColorSet /> },
            { id: 'history', label: 'Color History', content: <ColorHistory /> },
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
          tabs={[
            { id: 'wheel', label: 'Color Wheel', content: <ColorWheelPanel size={150} /> },
            { id: 'slider', label: 'Slider', content: <ColorSliders /> },
            { id: 'set', label: 'Set', content: <ColorSet /> },
            { id: 'history', label: 'History', content: <ColorHistory /> },
          ]}
        />
      </div>
    </aside>
  );
}

function RightDock() {
  return (
    <aside className="dock dock-right">
      <div className="dock-column right-column">
        <Palette testId="navigator-panel" tabs={[{ id: 'nav', label: 'Navigator', content: <Navigator /> }]} />
        <Palette testId="layer-property-panel" className="layer-property-palette" tabs={[{ id: 'lprop', label: 'Layer Property', content: <LayerPropertyPalette /> }]} />
        <Palette
          grow
          testId="layer-panel"
          tabs={[
            { id: 'layer', label: 'Layer', content: <LayerPaletteBody /> },
            { id: 'history', label: 'History', content: <HistoryPalette /> },
          ]}
        />
      </div>
    </aside>
  );
}

export function App() {
  const hidden = useStore((s) => s.palettesHidden);
  const menuHidden = useStore((s) => s.menuHidden);
  const workspace = useStore((s) => s.workspace);
  const name = useStore((s) => s.doc.name);
  const dirty = useStore((s) => s.dirty);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        setDragOver(true);
      }
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setDragOver(false);
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
          <StatusBar />
        </main>
        {!hidden && <RightDock />}
      </div>
      {dragOver && <div className="drop-hint">Drop on the canvas to open · drop images on the Layer palette to add them as layers</div>}
      <AdvancedToolSettings />
      <OverlayHost />
    </div>
  );
}
