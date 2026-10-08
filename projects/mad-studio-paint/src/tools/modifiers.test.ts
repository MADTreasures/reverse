import { describe, expect, it } from 'vitest';
import { effectiveTool } from './modifiers';

const none = { shift: false, alt: false, mod: false, space: false };

describe('modifier keys', () => {
  it('Space turns any tool into navigation', () => {
    expect(effectiveTool('pen', { ...none, space: true })).toBe('hand');
    expect(effectiveTool('pen', { ...none, space: true, shift: true })).toBe('rotate');
    expect(effectiveTool('pen', { ...none, space: true, mod: true })).toBe('zoom');
    expect(effectiveTool('select', { ...none, space: true, alt: true })).toBe('zoomOut');
  });

  it('Option picks colours with drawing tools, ⌘⌥ changes the brush size', () => {
    expect(effectiveTool('brush', { ...none, alt: true })).toBe('eyedropper');
    expect(effectiveTool('fill', { ...none, alt: true })).toBe('eyedropper');
    expect(effectiveTool('pen', { ...none, alt: true, mod: true })).toBe('brushSize');
    expect(effectiveTool('fill', { ...none, alt: true, mod: true })).toBe('fill');
  });

  it('⌘ with drawing tools is the Object tool', () => {
    expect(effectiveTool('pen', { ...none, mod: true })).toBe('object');
    expect(effectiveTool('eraser', { ...none, mod: true })).toBe('object');
    expect(effectiveTool('fill', { ...none, mod: true })).toBe('object');
    expect(effectiveTool('select', { ...none, mod: true })).toBe('select');
  });

  it('keeps Option for selection subtraction and copying with the move tool', () => {
    expect(effectiveTool('select', { ...none, alt: true })).toBe('select');
    expect(effectiveTool('move', { ...none, alt: true })).toBe('move');
  });

  it('⌘⇧-click selects a layer, mouse buttons map to hand / eyedropper', () => {
    expect(effectiveTool('pen', { ...none, mod: true, shift: true })).toBe('pickLayer');
    expect(effectiveTool('pen', none, 1)).toBe('hand');
    expect(effectiveTool('pen', none, 2)).toBe('eyedropper');
    expect(effectiveTool('zoom', { ...none, alt: true })).toBe('zoomOut');
  });
});
