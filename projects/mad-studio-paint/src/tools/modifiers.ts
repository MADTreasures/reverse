/** Which tool a press uses, given the selected tool, modifier keys and mouse button. Pure, unit tested. */
import { BRUSH_TOOLS, type ToolId } from '../paint/tools';
import type { Modifiers } from './types';

export type EffectiveTool = ToolId | 'zoomOut' | 'brushSize' | 'pickLayer';

const DRAWING_TOOLS: ToolId[] = [...BRUSH_TOOLS, 'fill', 'gradient'];

export function effectiveTool(tool: ToolId, m: Modifiers, button = 0): EffectiveTool {
  if (m.space) {
    if (m.mod) return 'zoom';
    if (m.alt) return 'zoomOut';
    if (m.shift) return 'rotate';
    return 'hand';
  }
  if (button === 1) return 'hand';
  if (button === 2) return 'eyedropper';
  if (m.mod && m.shift) return 'pickLayer';
  if (DRAWING_TOOLS.includes(tool)) {
    if (m.mod && m.alt) return BRUSH_TOOLS.includes(tool) ? 'brushSize' : tool;
    if (m.alt) return 'eyedropper';
  }
  if (tool === 'zoom' && m.alt) return 'zoomOut';
  return tool;
}

export function cursorFor(t: EffectiveTool): string {
  switch (t) {
    case 'hand':
    case 'rotate':
      return 'grab';
    case 'zoom':
      return 'zoom-in';
    case 'zoomOut':
      return 'zoom-out';
    case 'move':
      return 'move';
    case 'brushSize':
      return 'ew-resize';
    case 'pickLayer':
    case 'selectLayer':
      return 'pointer';
    case 'object':
      return 'default';
    case 'ruler':
    case 'eyedropper':
    case 'select':
    case 'autoSelect':
    case 'fill':
    case 'gradient':
      return 'crosshair';
    default:
      return 'none';
  }
}
