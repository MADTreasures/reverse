import { create } from 'zustand';

/** Text shown in the hint bar (hovered control, value while dragging). */
export const useHint = create<{ text: string }>(() => ({ text: '' }));

export function setHint(text: string): void {
  if (useHint.getState().text !== text) useHint.setState({ text });
}
