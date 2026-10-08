/**
 * Draws text layers: speech balloons (outlines first, then the insides, so balloons that overlap
 * merge into one shape) and text boxes on top, with the browser's font engine.
 */
import type { TextLayer } from '../model/types';
import { balloonBody, fontString, frameMatrix, layoutText, tailShapes, type Balloon, type Measure, type TextBox } from '../paint/text';
import type { Pt } from '../paint/rulers';
import { createCanvas, ctx2d, type Ctx } from './canvas';

type LetterSpaced = Ctx & { letterSpacing: string };

let measureCtx: LetterSpaced | null = null;

/** Text width measured by the browser (letter spacing included). */
export const measureText: Measure = (text, font, spacing) => {
  measureCtx ??= ctx2d(createCanvas(1, 1)) as LetterSpaced;
  measureCtx.font = font;
  measureCtx.letterSpacing = `${spacing}px`;
  return measureCtx.measureText(text).width;
};

/** A text box with its frame fitted to the text (boxes that do not wrap grow with their text). */
export function fitTextBox(t: TextBox): TextBox {
  if (t.wrap) return t;
  const l = layoutText(t, measureText);
  return { ...t, w: Math.max(1, l.w), h: Math.max(1, l.h) };
}

export function drawTextBox(ctx: Ctx, t: TextBox): void {
  const layout = layoutText(t, measureText);
  const c = ctx as LetterSpaced;
  c.save();
  c.transform(...frameMatrix(t));
  if (t.wrap) {
    // Text that does not fit in the frame is hidden.
    c.beginPath();
    c.rect(0, 0, t.w, t.h);
    c.clip();
  }
  c.font = fontString(t);
  c.letterSpacing = `${t.letterSpacing}px`;
  c.textBaseline = 'middle';
  c.textAlign = t.vertical ? 'center' : 'left';
  const paint = (fill: boolean) => {
    for (const r of layout.runs) {
      if (t.vertical) {
        c.save();
        c.translate(r.x, r.y);
        if (r.sideways) c.rotate(Math.PI / 2);
        if (fill) c.fillText(r.text, 0, 0);
        else c.strokeText(r.text, 0, 0);
        c.restore();
      } else if (fill) c.fillText(r.text, r.x, r.y);
      else c.strokeText(r.text, r.x, r.y);
    }
  };
  if (t.edge > 0) {
    c.strokeStyle = t.edgeColor;
    c.lineWidth = t.edge * 2;
    c.lineJoin = 'round';
    paint(false);
  }
  c.fillStyle = t.color;
  paint(true);
  if (t.underline || t.strike) {
    const lw = Math.max(1, t.size / 14);
    const cell = t.size + t.letterSpacing;
    for (const r of layout.runs) {
      if (t.vertical) {
        // Lines run beside vertical text (the underline on the right of the column).
        if (t.underline) c.fillRect(r.x + t.size * 0.55, r.y - cell / 2, lw, cell);
        if (t.strike) c.fillRect(r.x - lw / 2, r.y - cell / 2, lw, cell);
      } else if (r.w > 0) {
        if (t.underline) c.fillRect(r.x, r.y + t.size * 0.42, r.w, lw);
        if (t.strike) c.fillRect(r.x, r.y + t.size * 0.04 - lw / 2, r.w, lw);
      }
    }
  }
  c.restore();
}

function polygon(ctx: Ctx, pts: Pt[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

const shapesOf = (b: Balloon) => [balloonBody(b), ...b.tails.flatMap((t) => tailShapes(b, t))];

/**
 * Balloons: every outline is stroked twice as wide as set, then every inside is filled (or cleared),
 * which covers the inner half of the outlines and the lines between a body and its tails.
 */
export function drawBalloons(ctx: Ctx, balloons: Balloon[]): void {
  ctx.save();
  ctx.lineJoin = 'round';
  for (const b of balloons) {
    if (b.lineWidth <= 0) continue;
    ctx.lineWidth = b.lineWidth * 2;
    ctx.strokeStyle = b.lineColor;
    for (const s of shapesOf(b)) {
      polygon(ctx, s);
      ctx.stroke();
    }
  }
  for (const b of balloons) {
    ctx.globalCompositeOperation = b.fillColor ? 'source-over' : 'destination-out';
    ctx.fillStyle = b.fillColor ?? '#000';
    for (const s of shapesOf(b)) {
      polygon(ctx, s);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** The whole layer (without the object being edited, if any). */
export function renderTextLayer(ctx: Ctx, layer: Pick<TextLayer, 'texts' | 'balloons'>, hidden: string | null = null): void {
  drawBalloons(
    ctx,
    layer.balloons.filter((b) => b.id !== hidden),
  );
  for (const t of layer.texts) if (t.id !== hidden) drawTextBox(ctx, t);
}
