import { useEffect, useRef, useState } from 'react';
import { cmykToRgb, hexToRgb, hlsToHex, hsvToHex, rgbToCmyk, rgbToHex, rgbToHls, rgbToHsv, type HLS, type HSV, type RGB } from '../../model/color';
import * as actions from '../../store/actions';
import { drawingColor, useStore } from '../../store/store';

const RING = 0.16;

/** Inner shape of the wheel: the HSV square or the HLS triangle (pure hue on the right, white top left, black bottom left). */
interface Shape {
  draw(ctx: CanvasRenderingContext2D, hue: number): void;
  marker(): { x: number; y: number };
  pick(x: number, y: number): string;
  hits(x: number, y: number): boolean;
}

/**
 * Hue ring with a saturation/value square (HSV) or a lightness/saturation triangle (HLS) inside:
 * the drawing colour, or (with `value`) a colour of its own.
 */
export function ColorWheel({ size = 200, value, onChange, space: forced }: { size?: number; value?: string; onChange?: (hex: string) => void; space?: 'hsv' | 'hls' }) {
  const colors = useStore((s) => s.colors);
  const stored = useStore((s) => s.colorSpace);
  const space = forced ?? stored;
  const hex = value ?? drawingColor(colors);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Keep the hue (and saturation) while they are undefined (greys, black).
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(hexToRgb(hex)!));
  const [hls, setHls] = useState<HLS>(() => rgbToHls(hexToRgb(hex)!));
  const lastHex = useRef(hex);

  useEffect(() => {
    if (hex === lastHex.current) return;
    lastHex.current = hex;
    const rgb = hexToRgb(hex)!;
    setHsv((prev) => rgbToHsv(rgb, prev.h));
    setHls((prev) => rgbToHls(rgb, prev.h));
  }, [hex]);

  const outer = size / 2;
  const inner = outer * (1 - RING);
  const cx = size / 2;
  const hue = space === 'hsv' ? hsv.h : hls.h;

  const shape = (): Shape => {
    if (space === 'hsv') {
      const side = inner * Math.SQRT2 * 0.92;
      const x0 = cx - side / 2;
      return {
        draw(ctx, h) {
          ctx.fillStyle = hsvToHex({ h, s: 1, v: 1 });
          ctx.fillRect(x0, x0, side, side);
          const white = ctx.createLinearGradient(x0, 0, x0 + side, 0);
          white.addColorStop(0, '#fff');
          white.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = white;
          ctx.fillRect(x0, x0, side, side);
          const black = ctx.createLinearGradient(0, x0, 0, x0 + side);
          black.addColorStop(0, 'rgba(0,0,0,0)');
          black.addColorStop(1, '#000');
          ctx.fillStyle = black;
          ctx.fillRect(x0, x0, side, side);
        },
        marker: () => ({ x: x0 + hsv.s * side, y: x0 + (1 - hsv.v) * side }),
        pick(x, y) {
          const next = { ...hsv, s: Math.min(1, Math.max(0, (x - x0) / side)), v: Math.min(1, Math.max(0, 1 - (y - x0) / side)) };
          setHsv(next);
          return hsvToHex(next);
        },
        hits: (x, y) => Math.abs(x - cx) <= side / 2 + 6 && Math.abs(y - cx) <= side / 2 + 6,
      };
    }
    // Triangle inscribed in the ring: hue vertex on the right.
    const r = inner * 0.94;
    const left = cx - r / 2;
    const top = cx - (r * Math.sqrt(3)) / 2;
    const bottom = cx + (r * Math.sqrt(3)) / 2;
    const right = cx + r;
    const at = (l: number, sat: number) => ({ x: left + sat * (1 - Math.abs(2 * l - 1)) * (right - left), y: bottom - l * (bottom - top) });
    return {
      draw(ctx, h) {
        // Pixel by pixel (the triangle is small): each point's HLS colour.
        const x0 = Math.floor(left);
        const y0 = Math.floor(top);
        const w = Math.ceil(right) - x0;
        const hh = Math.ceil(bottom) - y0;
        const dpr = ctx.getTransform().a;
        const pw = Math.max(1, Math.round(w * dpr));
        const ph = Math.max(1, Math.round(hh * dpr));
        const img = ctx.createImageData(pw, ph);
        for (let py = 0; py < ph; py++) {
          const y = y0 + (py + 0.5) / dpr;
          const l = (bottom - y) / (bottom - top);
          if (l < 0 || l > 1) continue;
          const width = (1 - Math.abs(2 * l - 1)) * (right - left);
          for (let px = 0; px < pw; px++) {
            const x = x0 + (px + 0.5) / dpr;
            const sat = width > 0 ? (x - left) / width : 0;
            if (sat < 0 || sat > 1) continue;
            const rgb = hexToRgb(hlsToHex({ h, l, s: sat }))!;
            const o = (py * pw + px) * 4;
            img.data[o] = rgb.r;
            img.data[o + 1] = rgb.g;
            img.data[o + 2] = rgb.b;
            img.data[o + 3] = 255;
          }
        }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const tmp = document.createElement('canvas');
        tmp.width = pw;
        tmp.height = ph;
        tmp.getContext('2d')!.putImageData(img, 0, 0);
        ctx.drawImage(tmp, Math.round(x0 * dpr), Math.round(y0 * dpr));
        ctx.restore();
      },
      marker: () => at(hls.l, hls.s),
      pick(x, y) {
        const l = Math.min(1, Math.max(0, (bottom - y) / (bottom - top)));
        const width = (1 - Math.abs(2 * l - 1)) * (right - left);
        const sat = width > 0 ? Math.min(1, Math.max(0, (x - left) / width)) : hls.s;
        const next = { ...hls, l, s: sat };
        setHls(next);
        return hlsToHex(next);
      },
      hits: (x, y) => x >= left - 6 && x <= right + 6 && y >= top - 6 && y <= bottom + 6,
    };
  };

  useEffect(() => {
    const c = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    // Hue ring (red at the top, clockwise).
    const g = ctx.createConicGradient(-Math.PI / 2, cx, cx);
    for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, hsvToHex({ h: i * 30, s: 1, v: 1 }));
    ctx.beginPath();
    ctx.arc(cx, cx, outer - 1, 0, Math.PI * 2);
    ctx.arc(cx, cx, inner, 0, Math.PI * 2, true);
    ctx.fillStyle = g;
    ctx.fill();
    const sh = shape();
    sh.draw(ctx, hue);
    // Markers.
    const a = ((hue - 90) * Math.PI) / 180;
    const rm = (outer + inner) / 2;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * rm, cx + Math.sin(a) * rm, (outer - inner) / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
    const m = sh.marker();
    const rgb = hexToRgb(hex)!;
    ctx.strokeStyle = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 > 150 ? '#000' : '#fff';
    ctx.beginPath();
    ctx.arc(m.x, m.y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }, [hsv, hls, size, space, hex]);

  const emit = (out: string) => {
    lastHex.current = out;
    if (onChange) onChange(out);
    else actions.setDrawingColor(out);
  };

  const pick = (e: { clientX: number; clientY: number }, mode: 'ring' | 'inner') => {
    const r = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (mode === 'ring') {
      const h = ((Math.atan2(y - cx, x - cx) * 180) / Math.PI + 90 + 360) % 360;
      if (space === 'hsv') {
        const next = { ...hsv, h };
        setHsv(next);
        emit(hsvToHex(next));
      } else {
        const next = { ...hls, h };
        setHls(next);
        emit(hlsToHex(next));
      }
      return;
    }
    emit(shape().pick(x, y));
  };

  const onDown = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const d = Math.hypot(x - cx, y - cx);
    const mode = d >= inner - 2 ? 'ring' : 'inner';
    if (mode === 'inner' && !shape().hits(x, y)) return;
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

  return <canvas ref={canvasRef} className="color-wheel" style={{ width: size, height: size }} onPointerDown={onDown} data-testid="color-wheel" data-space={space} />;
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

/** Colour wheel palette: wheel, colour icons, the H/S/V (or H/L/S, or R/G/B) values and the HSV/HLS switch. */
export function ColorWheelPanel({ size = 180 }: { size?: number }) {
  const hex = useStore((s) => drawingColor(s.colors));
  const space = useStore((s) => s.colorSpace);
  const [showRgb, setShowRgb] = useState(false);
  const rgb = hexToRgb(hex)!;
  const hsv = rgbToHsv(rgb);
  const hls = rgbToHls(rgb);
  const fields: [string, number, number, (v: number) => string][] = showRgb
    ? [
        ['R', rgb.r, 255, (v) => rgbToHex({ ...rgb, r: v })],
        ['G', rgb.g, 255, (v) => rgbToHex({ ...rgb, g: v })],
        ['B', rgb.b, 255, (v) => rgbToHex({ ...rgb, b: v })],
      ]
    : space === 'hsv'
      ? [
          ['H', Math.round(hsv.h), 359, (v) => hsvToHex({ ...hsv, h: v % 360 })],
          ['S', Math.round(hsv.s * 100), 100, (v) => hsvToHex({ ...hsv, s: v / 100 })],
          ['V', Math.round(hsv.v * 100), 100, (v) => hsvToHex({ ...hsv, v: v / 100 })],
        ]
      : [
          ['H', Math.round(hls.h), 359, (v) => hlsToHex({ ...hls, h: v % 360 })],
          ['L', Math.round(hls.l * 100), 100, (v) => hlsToHex({ ...hls, l: v / 100 })],
          ['S', Math.round(hls.s * 100), 100, (v) => hlsToHex({ ...hls, s: v / 100 })],
        ];
  return (
    <div className="color-panel">
      <ColorWheel size={size} />
      <div className="wheel-footer">
        <ColorIcons />
        <div className="hsv-values" title="Click the letters to switch between these values and RGB">
          {fields.map(([label, v, max, to]) => (
            <label key={label}>
              <span className="value-name" onClick={() => setShowRgb((x) => !x)}>
                {label}
              </span>
              <input type="number" min={0} max={max} aria-label={label} value={v} onChange={(e) => actions.setDrawingColor(to(Math.min(max, Math.max(0, Number(e.target.value) || 0))))} onKeyDown={(e) => e.stopPropagation()} />
            </label>
          ))}
          <button
            className="icon-btn space-switch"
            title={space === 'hsv' ? 'Switch to the HLS color space' : 'Switch to the HSV color space'}
            aria-label={space === 'hsv' ? 'HLS color space' : 'HSV color space'}
            onClick={() => actions.setColorSpace(space === 'hsv' ? 'hls' : 'hsv')}
          >
            {space === 'hsv' ? '▷' : '□'}
          </button>
        </div>
      </div>
      <HexInput value={hex} />
    </div>
  );
}

type SliderTab = 'rgb' | 'hsv' | 'cmyk';

interface Channel {
  label: string;
  value: number;
  max: number;
  unit: string;
  /** CSS gradient of the bar. */
  bar: string;
  to: (v: number) => string;
}

const css = (c: RGB) => `rgb(${c.r},${c.g},${c.b})`;
const SPECTRUM = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((h) => hsvToHex({ h, s: 1, v: 1 })).join(', ')})`;

/** Color Slider palette: RGB, HSV (or HLS) and CMYK sliders on tabs at the left, like the reference. */
export function ColorSliders() {
  const hex = useStore((s) => drawingColor(s.colors));
  const space = useStore((s) => s.colorSpace);
  const [tab, setTab] = useState<SliderTab>('rgb');
  const rgb = hexToRgb(hex)!;
  let channels: Channel[];
  if (tab === 'rgb') {
    channels = (['r', 'g', 'b'] as const).map((k) => ({
      label: k.toUpperCase(),
      value: rgb[k],
      max: 255,
      unit: '',
      bar: `linear-gradient(to right, ${css({ ...rgb, [k]: 0 })}, ${css({ ...rgb, [k]: 255 })})`,
      to: (v: number) => rgbToHex({ ...rgb, [k]: v }),
    }));
  } else if (tab === 'hsv' && space === 'hsv') {
    const hsv = rgbToHsv(rgb);
    channels = [
      { label: 'H', value: Math.round(hsv.h), max: 359, unit: '°', bar: SPECTRUM, to: (v) => hsvToHex({ ...hsv, h: v }) },
      { label: 'S', value: Math.round(hsv.s * 100), max: 100, unit: '%', bar: `linear-gradient(to right, ${hsvToHex({ ...hsv, s: 0 })}, ${hsvToHex({ ...hsv, s: 1 })})`, to: (v) => hsvToHex({ ...hsv, s: v / 100 }) },
      { label: 'V', value: Math.round(hsv.v * 100), max: 100, unit: '%', bar: `linear-gradient(to right, #000, ${hsvToHex({ ...hsv, v: 1 })})`, to: (v) => hsvToHex({ ...hsv, v: v / 100 }) },
    ];
  } else if (tab === 'hsv') {
    const hls = rgbToHls(rgb);
    channels = [
      { label: 'H', value: Math.round(hls.h), max: 359, unit: '°', bar: SPECTRUM, to: (v) => hlsToHex({ ...hls, h: v }) },
      { label: 'L', value: Math.round(hls.l * 100), max: 100, unit: '%', bar: `linear-gradient(to right, #000, ${hlsToHex({ ...hls, l: 0.5 })}, #fff)`, to: (v) => hlsToHex({ ...hls, l: v / 100 }) },
      { label: 'S', value: Math.round(hls.s * 100), max: 100, unit: '%', bar: `linear-gradient(to right, ${hlsToHex({ ...hls, s: 0 })}, ${hlsToHex({ ...hls, s: 1 })})`, to: (v) => hlsToHex({ ...hls, s: v / 100 }) },
    ];
  } else {
    const cmyk = rgbToCmyk(rgb);
    channels = (['c', 'm', 'y', 'k'] as const).map((k) => ({
      label: k.toUpperCase(),
      value: Math.round(cmyk[k] * 100),
      max: 100,
      unit: '%',
      bar: `linear-gradient(to right, ${css(cmykToRgb({ ...cmyk, [k]: 0 }))}, ${css(cmykToRgb({ ...cmyk, [k]: 1 }))})`,
      to: (v: number) => rgbToHex(cmykToRgb({ ...cmyk, [k]: v / 100 })),
    }));
  }
  const tabs: [SliderTab, string][] = [
    ['rgb', 'RGB'],
    ['hsv', space === 'hsv' ? 'HSV' : 'HLS'],
    ['cmyk', 'CMYK'],
  ];
  return (
    <div className="color-sliders" data-testid="color-sliders">
      <div className="slider-body">
        <div className="slider-tabs" role="tablist" aria-label="Color space">
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`slider-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="slider-rows">
          {channels.map((c) => (
            <div key={c.label} className="rgb-row">
              <span className="rgb-label">{c.label}</span>
              <div
                className="rgb-bar"
                style={{ background: c.bar }}
                onPointerDown={(e) => {
                  const el = e.currentTarget;
                  const go = (ev: { clientX: number }) => {
                    const r = el.getBoundingClientRect();
                    actions.setDrawingColor(c.to(Math.round(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * c.max)));
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
                <span className="rgb-caret" style={{ left: `${(c.value / c.max) * 100}%` }} />
              </div>
              <input
                type="number"
                min={0}
                max={c.max}
                value={c.value}
                onChange={(e) => actions.setDrawingColor(c.to(Math.min(c.max, Math.max(0, Number(e.target.value) || 0))))}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label={c.label}
              />
              <span className="slider-unit">{c.unit}</span>
            </div>
          ))}
        </div>
      </div>
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
