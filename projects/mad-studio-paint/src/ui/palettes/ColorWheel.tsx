import { useEffect, useRef, useState } from 'react';
import { hexToRgb, hsvToHex, rgbToHsv, type HSV } from '../../model/color';
import * as actions from '../../store/actions';
import { drawingColor, useStore } from '../../store/store';

const RING = 0.16;

/** Hue ring with a saturation/brightness square inside. */
export function ColorWheel({ size = 200 }: { size?: number }) {
  const colors = useStore((s) => s.colors);
  const hex = drawingColor(colors);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Keep the hue while the colour is grey (where it is undefined).
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(hexToRgb(hex)!));
  const lastHex = useRef(hex);

  useEffect(() => {
    if (hex === lastHex.current) return;
    lastHex.current = hex;
    setHsv((prev) => rgbToHsv(hexToRgb(hex)!, prev.h));
  }, [hex]);

  const outer = size / 2;
  const inner = outer * (1 - RING);
  const square = inner * Math.SQRT2 * 0.92;

  useEffect(() => {
    const c = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2;
    // Hue ring (red at the top, clockwise).
    const g = ctx.createConicGradient(-Math.PI / 2, cx, cx);
    for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, hsvToHex({ h: i * 30, s: 1, v: 1 }));
    ctx.beginPath();
    ctx.arc(cx, cx, outer - 1, 0, Math.PI * 2);
    ctx.arc(cx, cx, inner, 0, Math.PI * 2, true);
    ctx.fillStyle = g;
    ctx.fill();
    // Saturation (x) / brightness (y) square.
    const x0 = cx - square / 2;
    ctx.fillStyle = hsvToHex({ h: hsv.h, s: 1, v: 1 });
    ctx.fillRect(x0, x0, square, square);
    const white = ctx.createLinearGradient(x0, 0, x0 + square, 0);
    white.addColorStop(0, '#fff');
    white.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = white;
    ctx.fillRect(x0, x0, square, square);
    const black = ctx.createLinearGradient(0, x0, 0, x0 + square);
    black.addColorStop(0, 'rgba(0,0,0,0)');
    black.addColorStop(1, '#000');
    ctx.fillStyle = black;
    ctx.fillRect(x0, x0, square, square);
    // Markers.
    const a = ((hsv.h - 90) * Math.PI) / 180;
    const rm = (outer + inner) / 2;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * rm, cx + Math.sin(a) * rm, (outer - inner) / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
    const mx = x0 + hsv.s * square;
    const my = x0 + (1 - hsv.v) * square;
    ctx.strokeStyle = hsv.v > 0.55 && hsv.s < 0.5 ? '#000' : '#fff';
    ctx.beginPath();
    ctx.arc(mx, my, 5, 0, Math.PI * 2);
    ctx.stroke();
  }, [hsv, size, outer, inner, square]);

  const pick = (e: { clientX: number; clientY: number }, mode: 'ring' | 'square') => {
    const r = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left - size / 2;
    const y = e.clientY - r.top - size / 2;
    let next: HSV;
    if (mode === 'ring') {
      const h = ((Math.atan2(y, x) * 180) / Math.PI + 90 + 360) % 360;
      next = { ...hsv, h };
    } else {
      const s = Math.min(1, Math.max(0, (x + square / 2) / square));
      const v = Math.min(1, Math.max(0, 1 - (y + square / 2) / square));
      next = { ...hsv, s, v };
    }
    setHsv(next);
    const out = hsvToHex(next);
    lastHex.current = out;
    actions.setDrawingColor(out);
  };

  const onDown = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left - size / 2;
    const y = e.clientY - r.top - size / 2;
    const d = Math.hypot(x, y);
    const mode = d >= inner - 2 ? 'ring' : 'square';
    if (mode === 'square' && (Math.abs(x) > square / 2 + 6 || Math.abs(y) > square / 2 + 6)) return;
    e.preventDefault();
    pick(e, mode);
    const move = (ev: PointerEvent) => pick(ev, mode);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return <canvas ref={canvasRef} className="color-wheel" style={{ width: size, height: size }} onPointerDown={onDown} data-testid="color-wheel" />;
}

/** Main / sub / transparent colour icons (circles in the default workspace, squares in the classic one). */
export function ColorIcons() {
  const colors = useStore((s) => s.colors);
  const workspace = useStore((s) => s.workspace);
  return (
    <div className={`color-icons ${workspace}`} data-testid="color-icons">
      <div className="ci-stack">
        <button
          className={`ci sub ${colors.active === 'sub' && !colors.transparent ? 'active' : ''}`}
          style={{ background: colors.sub }}
          title="Sub color"
          aria-label="Sub color"
          onClick={() => actions.setActiveColorSlot('sub')}
        />
        <button
          className={`ci main ${colors.active === 'main' && !colors.transparent ? 'active' : ''}`}
          style={{ background: colors.main }}
          title="Main color"
          aria-label="Main color"
          onClick={() => actions.setActiveColorSlot('main')}
        />
      </div>
      <button className={`ci transparent ${colors.transparent ? 'active' : ''}`} title="Transparent color (C)" aria-label="Transparent color" onClick={() => actions.toggleTransparentColor()} />
    </div>
  );
}

/** Colour wheel palette: wheel, colour icons and H/S/V values. */
export function ColorWheelPanel({ size = 180 }: { size?: number }) {
  const hex = useStore((s) => drawingColor(s.colors));
  const hsv = rgbToHsv(hexToRgb(hex)!);
  const set = (patch: Partial<HSV>) => actions.setDrawingColor(hsvToHex({ ...hsv, ...patch }));
  return (
    <div className="color-panel">
      <ColorWheel size={size} />
      <div className="wheel-footer">
        <ColorIcons />
        <div className="hsv-values">
          <label>
            H
            <input type="number" min={0} max={359} value={Math.round(hsv.h)} onChange={(e) => set({ h: Number(e.target.value) % 360 })} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <label>
            S
            <input type="number" min={0} max={100} value={Math.round(hsv.s * 100)} onChange={(e) => set({ s: Math.min(100, Math.max(0, Number(e.target.value))) / 100 })} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <label>
            V
            <input type="number" min={0} max={100} value={Math.round(hsv.v * 100)} onChange={(e) => set({ v: Math.min(100, Math.max(0, Number(e.target.value))) / 100 })} onKeyDown={(e) => e.stopPropagation()} />
          </label>
        </div>
      </div>
      <HexInput value={hex} />
    </div>
  );
}

/** RGB sliders. */
export function ColorSliders() {
  const hex = useStore((s) => drawingColor(s.colors));
  const rgb = hexToRgb(hex)!;
  const channels = [
    ['R', 'r', '#ff0000'],
    ['G', 'g', '#00ff00'],
    ['B', 'b', '#0000ff'],
  ] as const;
  const set = (key: 'r' | 'g' | 'b', v: number) => {
    const next = { ...rgb, [key]: Math.max(0, Math.min(255, Math.round(v))) };
    actions.setDrawingColor(`#${[next.r, next.g, next.b].map((x) => x.toString(16).padStart(2, '0')).join('')}`);
  };
  return (
    <div className="color-sliders" data-testid="color-sliders">
      {channels.map(([label, key]) => {
        const from = { ...rgb, [key]: 0 };
        const to = { ...rgb, [key]: 255 };
        const css = (c: { r: number; g: number; b: number }) => `rgb(${c.r},${c.g},${c.b})`;
        return (
          <div key={key} className="rgb-row">
            <span className="rgb-label">{label}</span>
            <div
              className="rgb-bar"
              style={{ background: `linear-gradient(to right, ${css(from)}, ${css(to)})` }}
              onPointerDown={(e) => {
                const el = e.currentTarget;
                const go = (ev: { clientX: number }) => {
                  const r = el.getBoundingClientRect();
                  set(key, ((ev.clientX - r.left) / r.width) * 255);
                };
                go(e);
                const move = (ev: PointerEvent) => go(ev);
                const up = () => {
                  window.removeEventListener('pointermove', move);
                  window.removeEventListener('pointerup', up);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
              }}
            >
              <span className="rgb-caret" style={{ left: `${(rgb[key] / 255) * 100}%` }} />
            </div>
            <input type="number" min={0} max={255} value={rgb[key]} onChange={(e) => set(key, Number(e.target.value))} onKeyDown={(e) => e.stopPropagation()} aria-label={label} />
          </div>
        );
      })}
      <ColorIcons />
    </div>
  );
}

/** Main / sub / transparent colour chips. */
export function ColorChips() {
  const colors = useStore((s) => s.colors);
  return (
    <div className="color-chips">
      <div className="chip-stack">
        <button
          className={`chip sub ${colors.active === 'sub' && !colors.transparent ? 'active' : ''}`}
          style={{ background: colors.sub }}
          title="Sub color"
          aria-label="Sub color"
          onClick={() => actions.setActiveColorSlot('sub')}
        />
        <button
          className={`chip main ${colors.active === 'main' && !colors.transparent ? 'active' : ''}`}
          style={{ background: colors.main }}
          title="Main color"
          aria-label="Main color"
          onClick={() => actions.setActiveColorSlot('main')}
        />
      </div>
      <button
        className={`chip transparent ${colors.transparent ? 'active' : ''}`}
        title="Transparent color (C)"
        aria-label="Transparent color"
        onClick={() => actions.toggleTransparentColor()}
      />
      <button className="chip-swap" title="Swap main and sub color (X)" aria-label="Swap colors" onClick={() => actions.swapColors()}>
        ⇄
      </button>
      <HexInput value={drawingColor(colors)} />
    </div>
  );
}

/** Colour code field: edits locally, applies on Enter or when leaving the field. */
function HexInput({ value }: { value: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const apply = () => {
    const rgb = hexToRgb(text);
    if (rgb) actions.setDrawingColor(`#${[rgb.r, rgb.g, rgb.b].map((x) => x.toString(16).padStart(2, '0')).join('')}`);
    else setText(value);
  };
  return (
    <input
      className="hex-input"
      aria-label="Color code"
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') apply();
      }}
    />
  );
}

export function ColorHistory() {
  const history = useStore((s) => s.colors.history);
  return (
    <div className="color-history" data-testid="color-history">
      {history.length === 0 && <div className="empty-note">Colors you draw with appear here.</div>}
      {history.map((c) => (
        <button key={c} className="swatch" style={{ background: c }} title={c} aria-label={c} onClick={() => actions.setDrawingColor(c)} />
      ))}
    </div>
  );
}
