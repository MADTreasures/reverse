/**
 * Text boxes ↔ Photoshop text layers: the text, font (CSS family ↔ PostScript name), size, bold
 * and italic, underline and strikethrough, colour, alignment, line and letter spacing, position and
 * rotation; frames that wrap become paragraph (box) text, the others point text. Pure.
 */
import type { LayerTextData } from 'ag-psd';
import { DEFAULT_TEXT_STYLE, newObjectId, type TextBox } from '../paint/text';
import { colorHex, psdColor } from './psdStyles';

/** CSS families and the PostScript names Photoshop knows them by (regular weight). */
const POSTSCRIPT: [string, string][] = [
  ['sans-serif', 'ArialMT'],
  ['serif', 'TimesNewRomanPSMT'],
  ['monospace', 'CourierNewPSMT'],
  ['Arial', 'ArialMT'],
  ['Helvetica', 'Helvetica'],
  ['Helvetica Neue', 'HelveticaNeue'],
  ['Avenir Next', 'AvenirNext-Regular'],
  ['Futura', 'Futura-Medium'],
  ['Gill Sans', 'GillSans'],
  ['Georgia', 'Georgia'],
  ['Times New Roman', 'TimesNewRomanPSMT'],
  ['Menlo', 'Menlo-Regular'],
  ['Courier New', 'CourierNewPSMT'],
  ['Comic Sans MS', 'ComicSansMS'],
  ['Chalkboard SE', 'ChalkboardSE-Regular'],
  ['Marker Felt', 'MarkerFelt-Thin'],
  ['Hiragino Sans', 'HiraginoSans-W3'],
  ['Hiragino Mincho ProN', 'HiraMinProN-W3'],
  ['Hiragino Maru Gothic ProN', 'HiraMaruProN-W4'],
  ['Verdana', 'Verdana'],
  ['Trebuchet MS', 'TrebuchetMS'],
];

/** The PostScript name for a CSS font family (first family of a list; unknown ones without spaces). */
export function postScriptName(css: string): string {
  const first = css.split(',')[0].trim().replace(/^["']|["']$/g, '');
  const known = POSTSCRIPT.find(([family]) => family.toLowerCase() === first.toLowerCase());
  return known ? known[1] : first.replace(/\s+/g, '') || 'ArialMT';
}

/** A CSS family (and weight/style) for a PostScript name. */
export function fontFromPostScript(name: string | undefined): { family: string; bold: boolean; italic: boolean } {
  if (!name) return { family: DEFAULT_TEXT_STYLE.font, bold: false, italic: false };
  const bold = /bold|black|heavy|-W[6-9]\b|semibold|demi/i.test(name);
  const italic = /italic|oblique/i.test(name);
  const known = POSTSCRIPT.find(([family, ps]) => ps === name && !/^(sans-serif|serif|monospace)$/.test(family));
  if (known) return { family: known[0], bold, italic };
  // Base name: before the style suffix, without "MT" / "PS" markers, words split at capitals.
  const base = name
    .split('-')[0]
    .replace(/PSMT$|MT$|PS$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  const again = POSTSCRIPT.find(([family]) => family.replace(/\s+/g, '').toLowerCase() === base.replace(/\s+/g, '').toLowerCase());
  return { family: again ? again[0] : base || DEFAULT_TEXT_STYLE.font, bold, italic };
}

/** Where the first line's baseline lies below the top of the frame (an estimate for usual fonts). */
export const firstBaseline = (t: Pick<TextBox, 'size' | 'lineSpacing'>) => (t.size * t.lineSpacing) / 2 + t.size * 0.33;

const rotate = (angle: number, x: number, y: number) => ({ x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) });

/** A Photoshop text layer's text data for a (horizontal) text box. */
export function toPsdText(t: TextBox): LayerTextData {
  const cos = Math.cos(t.angle);
  const sin = Math.sin(t.angle);
  // Point text hangs from the baseline of its first line, at the side it is aligned to.
  const anchor = t.wrap ? { x: 0, y: 0 } : { x: t.align === 'center' ? t.w / 2 : t.align === 'right' ? t.w : 0, y: firstBaseline(t) };
  const at = rotate(t.angle, anchor.x, anchor.y);
  return {
    text: t.text.replace(/\n/g, '\r'),
    transform: [cos, sin, -sin, cos, t.x + at.x, t.y + at.y],
    antiAlias: 'smooth',
    orientation: 'horizontal',
    shapeType: t.wrap ? 'box' : 'point',
    ...(t.wrap ? { boxBounds: [0, 0, t.w, t.h] } : {}),
    style: {
      font: { name: postScriptName(t.font) },
      fontSize: t.size,
      fauxBold: t.bold,
      fauxItalic: t.italic,
      underline: t.underline,
      strikethrough: t.strike,
      autoLeading: false,
      leading: t.size * t.lineSpacing,
      tracking: t.size > 0 ? Math.round((t.letterSpacing / t.size) * 1000) : 0,
      fillColor: psdColor(t.color),
    },
    paragraphStyle: { justification: t.align },
  };
}

/**
 * A text box for a Photoshop text layer. `fit` sizes a frame that does not wrap to its text (the
 * browser measures it); without it, the frame keeps a rough size.
 */
export function fromPsdText(d: LayerTextData, fit?: (t: TextBox) => TextBox): TextBox {
  const style = d.style ?? {};
  const first = d.styleRuns?.[0]?.style ?? {};
  const s = { ...style, ...first };
  const m = d.transform && d.transform.length >= 6 && d.transform.every(Number.isFinite) ? d.transform : [1, 0, 0, 1, 0, 0];
  // Rotation alone keeps the size (up to rounding).
  const raw = Math.hypot(m[0], m[1]) || 1;
  const scale = Math.abs(raw - 1) < 1e-6 ? 1 : raw;
  const angle = Math.atan2(m[1], m[0]);
  const font = fontFromPostScript(s.font?.name);
  const size = Math.min(5000, Math.max(0.5, (s.fontSize ?? 24) * scale));
  const justification = d.paragraphStyle?.justification ?? d.paragraphStyleRuns?.[0]?.style.justification;
  const align: TextBox['align'] = justification === 'center' || justification === 'justify-center' ? 'center' : justification === 'right' || justification === 'justify-right' ? 'right' : 'left';
  const leading = s.autoLeading === false && s.leading ? (s.leading * scale) / size : 1.2;
  const box = d.shapeType === 'box' && d.boxBounds?.length === 4 ? d.boxBounds : null;
  const base: TextBox = {
    ...DEFAULT_TEXT_STYLE,
    id: newObjectId('t'),
    font: font.family,
    size,
    bold: Boolean(s.fauxBold) || font.bold,
    italic: Boolean(s.fauxItalic) || font.italic,
    underline: Boolean(s.underline),
    strike: Boolean(s.strikethrough),
    align,
    vertical: d.orientation === 'vertical',
    color: s.fillColor ? colorHex(s.fillColor) : '#000000',
    lineSpacing: Math.min(5, Math.max(0.5, leading)),
    letterSpacing: Math.min(1000, Math.max(-100, ((s.tracking ?? 0) / 1000) * size)),
    x: m[4],
    y: m[5],
    angle,
    w: 10,
    h: 10,
    wrap: Boolean(box),
    text: (d.text ?? '').replace(/\r\n?/g, '\n').slice(0, 100000),
  };
  if (box) {
    const at = rotate(angle, box[0] * scale, box[1] * scale);
    return { ...base, x: m[4] + at.x, y: m[5] + at.y, w: Math.max(1, (box[2] - box[0]) * scale), h: Math.max(1, (box[3] - box[1]) * scale) };
  }
  // Point text: the frame's top left lies above the baseline, before the aligned side.
  const sized = fit ? fit(base) : { ...base, w: Math.max(1, base.text.length * size * 0.55), h: size * base.lineSpacing };
  const anchor = { x: align === 'center' ? sized.w / 2 : align === 'right' ? sized.w : 0, y: firstBaseline(sized) };
  const at = rotate(angle, anchor.x, anchor.y);
  return { ...sized, x: m[4] - at.x, y: m[5] - at.y };
}

/** A Photoshop layer name for a text: its first line, shortened. */
export const textLayerName = (t: Pick<TextBox, 'text'>) => t.text.split('\n')[0].trim().slice(0, 40) || 'Text';
