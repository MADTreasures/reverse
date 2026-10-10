/** What each palette shows: its name (per workspace), its contents and its palette menu (≡). */
import type { ReactNode } from 'react';
import type { PaletteId } from '../model/palettes';
import type { WorkspaceId } from '../paint/tools';
import type { MenuItem } from './overlays';
import { ColorSet } from './palettes/ColorSet';
import { ColorHistory, ColorSliders, ColorWheelPanel } from './palettes/ColorWheel';
import { ApproximateColor, approximateMenu, IntermediateColor, intermediateMenu } from './palettes/ColorGrids';
import { SearchLayer } from './palettes/SearchLayer';
import { SubView, subViewMenu } from './palettes/SubView';
import { HistoryPalette } from './palettes/HistoryPalette';
import { LayerActionBar, LayerFlagBar, LayerList, LayerPropertyBar } from './palettes/LayerPalette';
import { LayerPropertyPalette } from './palettes/LayerPropertyPalette';
import { Navigator } from './palettes/Navigator';
import { BrushSizePalette, SubToolPalette, ToolProperty } from './palettes/ToolPalettes';
import { AnimationCelsPalette } from './palettes/AnimationCelsPalette';
import { QuickAccessPalette, quickAccessMenu } from './palettes/QuickAccessPalette';
import { AutoActionPalette, autoActionMenu } from './palettes/AutoActionPalette';

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

interface PaletteSpec {
  label: string;
  /** The name in a crowded stack (the classic workspace's colour palettes). */
  short?: string;
  /** Names of the default workspace (Ver. 5) where they differ. */
  current?: string;
  content: (ws: WorkspaceId) => ReactNode;
  menu?: () => MenuItem[];
}

export const PALETTES: Record<PaletteId, PaletteSpec> = {
  subTool: { label: 'Sub Tool', current: 'Tool Group', content: () => <SubToolPalette /> },
  toolProperty: { label: 'Tool Property', current: 'Tool Settings', content: () => <ToolProperty /> },
  brushSize: { label: 'Brush Size', content: () => <BrushSizePalette /> },
  colorWheel: { label: 'Color Wheel', content: (ws) => <ColorWheelPanel size={ws === 'classic' ? 150 : 176} /> },
  colorSlider: { label: 'Color Slider', short: 'Slider', content: () => <ColorSliders /> },
  colorSet: { label: 'Color Set', short: 'Set', content: () => <ColorSet /> },
  colorHistory: { label: 'Color History', short: 'History', content: () => <ColorHistory /> },
  intermediateColor: { label: 'Intermediate Color', short: 'Intermediate', content: () => <IntermediateColor />, menu: intermediateMenu },
  approximateColor: { label: 'Approximate Color', short: 'Approximate', content: () => <ApproximateColor />, menu: approximateMenu },
  quickAccess: { label: 'Quick Access', content: () => <QuickAccessPalette />, menu: quickAccessMenu },
  navigator: { label: 'Navigator', content: () => <Navigator /> },
  subView: { label: 'Sub View', content: () => <SubView />, menu: subViewMenu },
  layerProperty: { label: 'Layer Property', content: () => <LayerPropertyPalette /> },
  autoAction: { label: 'Auto Action', content: () => <AutoActionPalette />, menu: autoActionMenu },
  layer: { label: 'Layer', content: () => <LayerPaletteBody /> },
  searchLayer: { label: 'Search Layer', content: () => <SearchLayer /> },
  history: { label: 'History', content: () => <HistoryPalette /> },
  animationCels: { label: 'Animation cels', content: () => <AnimationCelsPalette /> },
};

/** A palette's name in a workspace (shorter in the classic workspace's colour stack). */
export function paletteLabel(id: PaletteId, ws: WorkspaceId, stackId?: string): string {
  const p = PALETTES[id];
  if (stackId === 'classicColor' && p.short) return p.short;
  return ws === 'default' && p.current ? p.current : p.label;
}
