/**
 * Text tool and balloon tools: typing text on the canvas, editing it, and speech balloons with
 * tails. Text layers are named after their text, as in the reference.
 */
import { createTextLayer, findLayer, flatten, isEffectivelyLocked, isEffectivelyVisible, nextLayerName, nextRev, removeLayer } from '../model/layers';
import type { Id, TextLayer } from '../model/types';
import type { Pt } from '../paint/rulers';
import {
  balloonBody,
  balloonCenter,
  DEFAULT_TEXT_STYLE,
  hitTextBox,
  insidePolygon,
  newObjectId,
  type Balloon,
  type BalloonTail,
  type TextBox,
  type TextStyle,
} from '../paint/text';
import { textCenter } from '../paint/objects';
import { engine } from '../engine/engine';
import { fitTextBox } from '../engine/textRender';
import * as actions from './actions';
import { currentSubTool, drawingColor, getState, setState, type PaintState } from './store';

/** Points ↔ document pixels at the document resolution (text sizes are set in points). */
export const ptToPx = (pt: number, dpi: number) => (pt * dpi) / 72;
export const pxToPt = (px: number, dpi: number) => (px * 72) / dpi;

/** Settings of the selected Text sub tool (size in points). */
export function textToolStyle(s: PaintState = getState()): TextStyle {
  const sub = currentSubTool(s, 'text');
  return sub.textStyle ?? { ...DEFAULT_TEXT_STYLE, size: 24 };
}

/** Style for new text: the tool settings, in the drawing colour, at the document resolution. */
function newTextStyle(s: PaintState): TextStyle {
  const st = textToolStyle(s);
  return { ...st, size: ptToPx(st.size, s.doc.dpi), color: drawingColor(s.colors) };
}

/** Visible, unlocked text layers, the active one first. */
function textLayers(s: PaintState): TextLayer[] {
  const list = flatten(s.doc.layers).filter(
    (l): l is TextLayer => l.kind === 'text' && isEffectivelyVisible(s.doc.layers, l.id) && !isEffectivelyLocked(s.doc.layers, l.id),
  );
  return list.sort((a, b) => Number(b.id === s.activeLayerId) - Number(a.id === s.activeLayerId));
}

/** The text box under p (the active layer first), with a little tolerance. */
export function textAt(p: Pt, tolerance = 4): { layer: TextLayer; box: TextBox } | null {
  const s = getState();
  for (const layer of textLayers(s)) {
    for (let i = layer.texts.length - 1; i >= 0; i--) if (hitTextBox(layer.texts[i], p, tolerance / Math.max(0.01, s.view.zoom))) return { layer, box: layer.texts[i] };
  }
  return null;
}

/** The balloon under p (its body), the active layer first. */
export function balloonAt(p: Pt): { layer: TextLayer; balloon: Balloon } | null {
  const s = getState();
  for (const layer of textLayers(s)) {
    for (let i = layer.balloons.length - 1; i >= 0; i--) if (insidePolygon(balloonBody(layer.balloons[i]), p)) return { layer, balloon: layer.balloons[i] };
  }
  return null;
}

/** Layer name for a text: its first line. */
function nameFor(text: string): string {
  const line = text.split('\n').find((l) => l.trim() !== '')?.trim() ?? 'Text';
  return line.length > 32 ? `${line.slice(0, 31)}…` : line;
}

/**
 * Starts typing a new text box: at a click (the first line is centred on it vertically) or in a
 * dragged frame, where the text wraps. Text started in a balloon goes onto the balloon's layer.
 */
export function startNewText(at: Pt, frame: { x: number; y: number; w: number; h: number } | null): void {
  commitTextEdit();
  const s = getState();
  const style = newTextStyle(s);
  const inBalloon = balloonAt(at);
  const box: TextBox = fitTextBox({
    ...style,
    id: newObjectId('t'),
    x: frame ? frame.x : at.x,
    y: frame ? frame.y : at.y - (style.size * style.lineSpacing) / 2,
    angle: 0,
    w: frame ? Math.max(4, frame.w) : 1,
    h: frame ? Math.max(4, frame.h) : 1,
    wrap: frame !== null,
    text: '',
  });
  setState({ textEdit: { layerId: inBalloon?.layer.id ?? null, box, ...(inBalloon ? { balloonId: inBalloon.balloon.id } : {}) }, selectedObjects: [] });
}

/** Edits an existing text box on the canvas (Text tool click, Object tool double-click). */
export function editTextBox(layerId: Id, boxId: string): void {
  commitTextEdit();
  const s = getState();
  const layer = findLayer(s.doc.layers, layerId);
  const box = layer?.kind === 'text' ? layer.texts.find((t) => t.id === boxId) : null;
  if (!box) return;
  if (isEffectivelyLocked(s.doc.layers, layerId)) {
    setState({ hint: 'The layer is locked' });
    return;
  }
  actions.selectLayer(layerId);
  setState({ textEdit: { layerId, box }, selectedObjects: [] });
  engine.setHidden(boxId);
}

/** Changes the text or style of the text being edited (its frame keeps fitting the text). */
export function updateTextEdit(patch: Partial<TextBox>): void {
  const e = getState().textEdit;
  if (e) setState({ textEdit: { ...e, box: fitTextBox({ ...e.box, ...patch }) } });
}

/** Moves a box so that its centre is the balloon's centre (upright in the balloon's direction). */
function centreIn(box: TextBox, b: Balloon | undefined): TextBox {
  if (!b) return box;
  const c = balloonCenter(b);
  const cos = Math.cos(b.angle);
  const sin = Math.sin(b.angle);
  return { ...box, angle: b.angle, x: c.x - (cos * box.w) / 2 + (sin * box.h) / 2, y: c.y - (sin * box.w) / 2 - (cos * box.h) / 2 };
}

/** OK: the typed text goes into its layer (a new text layer for new text). Empty text is removed. */
export function commitTextEdit(): void {
  const e = getState().textEdit;
  if (!e) return;
  setState({ textEdit: null });
  engine.setHidden(null);
  let box = fitTextBox(e.box);
  const empty = box.text.trim() === '';
  const s = getState();
  const layer = e.layerId ? findLayer(s.doc.layers, e.layerId) : null;
  if (layer?.kind === 'text') {
    const old = layer.texts.find((t) => t.id === box.id);
    if (empty && !old) return;
    if (!old && e.balloonId) box = centreIn(box, layer.balloons.find((b) => b.id === e.balloonId));
    if (old && !empty && old.text === box.text && JSON.stringify(old) === JSON.stringify(box)) return;
    const texts = empty ? layer.texts.filter((t) => t.id !== box.id) : old ? layer.texts.map((t) => (t.id === box.id ? box : t)) : [...layer.texts, box];
    actions.changeDoc(old ? (empty ? 'Delete text' : 'Edit text') : 'Text', (doc) => {
      const l = findLayer(doc.layers, layer.id);
      if (l?.kind !== 'text') return;
      // A layer left without text or balloons is removed.
      if (texts.length === 0 && l.balloons.length === 0) {
        removeLayer(doc.layers, l.id);
        return;
      }
      l.texts = texts;
      l.rev = nextRev();
      // Text layers are named after their text (unless renamed); balloon layers keep their name.
      if (old && !empty && l.balloons.length === 0 && l.name === nameFor(old.text)) l.name = nameFor(box.text);
      return l.id;
    });
    return;
  }
  if (empty) return;
  const created = createTextLayer(nameFor(box.text), { texts: [box] });
  actions.changeDoc('Text', (doc, st) => {
    actions.insertNew(doc, created, st.activeLayerId);
    return created.id;
  });
}

/** Cancel: the text is left as it was. */
export function cancelTextEdit(): void {
  if (!getState().textEdit) return;
  setState({ textEdit: null });
  engine.setHidden(null);
}

/** Text settings changed in Tool Settings: the text being edited, the selected text, and new text. */
export function setTextStyle(patch: Partial<TextStyle>): void {
  const s = getState();
  const toPx = (p: Partial<TextStyle>): Partial<TextBox> => (p.size !== undefined ? { ...p, size: ptToPx(p.size, s.doc.dpi) } : p);
  if (s.textEdit) updateTextEdit(toPx(patch));
  else if (actions.selectedTextObjects(s)?.texts.length) actions.updateSelectedTexts((t) => ({ ...t, ...toPx(patch) }), 'Text settings', `text:${Object.keys(patch).join(',')}`);
  const sub = currentSubTool(s, 'text');
  // The colour of new text follows the drawing colour.
  const { color: _color, ...rest } = patch;
  if (Object.keys(rest).length) actions.updateSubTool(sub.id, { textStyle: { ...textToolStyle(s), ...rest } });
}

/** "Wrap text at frame" for the text being edited or the selected text. */
export function setTextWrap(wrap: boolean): void {
  const s = getState();
  if (s.textEdit) updateTextEdit({ wrap });
  else if (actions.selectedTextObjects(s)?.texts.length) actions.updateSelectedTexts((t) => ({ ...t, wrap }), 'Wrap text at frame');
}

// ------------------------------------------------------------------ balloons

/**
 * Adds a balloon: to the active text layer, to the text layer whose text it covers (that layer
 * becomes a balloon layer), or to a new balloon layer.
 */
export function addBalloon(b: Balloon): void {
  commitTextEdit();
  const s = getState();
  const body = balloonBody(b);
  const active = actions.activeLayer(s);
  const target =
    (active?.kind === 'text' && !isEffectivelyLocked(s.doc.layers, active.id) ? active : null) ??
    textLayers(s).find((l) => l.texts.some((t) => insidePolygon(body, textCenter(t)))) ??
    null;
  if (target) {
    actions.changeDoc('Balloon', (doc) => {
      const l = findLayer(doc.layers, target.id);
      if (l?.kind !== 'text') return;
      l.balloons = [...l.balloons, b];
      // A balloon drawn over a single text box takes it in, centred.
      const covered = l.texts.filter((t) => insidePolygon(body, textCenter(t)));
      if (covered.length === 1) l.texts = l.texts.map((t) => (t === covered[0] ? centreIn(t, b) : t));
      l.rev = nextRev();
      return l.id;
    });
    return;
  }
  const created = createTextLayer(nextLayerName(s.doc, 'Balloon'), { balloons: [b] });
  actions.changeDoc('Balloon', (doc, st) => {
    actions.insertNew(doc, created, st.activeLayerId);
    return created.id;
  });
}

/** Adds a tail to a balloon (balloon tail tools). */
export function addBalloonTail(layerId: Id, balloonId: string, tail: Omit<BalloonTail, 'id'>): void {
  actions.changeDoc('Balloon tail', (doc) => {
    const l = findLayer(doc.layers, layerId);
    if (l?.kind !== 'text') return;
    l.balloons = l.balloons.map((b) => (b.id === balloonId ? { ...b, tails: [...b.tails, { ...tail, id: newObjectId('q') }] } : b));
    l.rev = nextRev();
    return l.id;
  });
}
