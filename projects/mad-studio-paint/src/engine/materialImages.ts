/**
 * The pictures of this program's own materials, drawn by code (no image files): seamless colour
 * patterns and textures, backgrounds, black-and-white patterns and decorations, plus the
 * thumbnails of every material (tones, focus / speed lines, frame templates and balloons drawn
 * from their settings). Registered materials bring their own image.
 */
import { createCanvas, ctx2d } from './canvas';
import { seededRandom } from '../paint/stroke';
import type { Material } from '../paint/materialLibrary';
import { DEFAULT_FOCUS_LINES, drawEffectLines, type EffectLines } from '../paint/effectLines';
import { EFFECT_LINE_TOOLS } from '../paint/tools';
import { FRAME_TEMPLATES, templatePanels } from '../paint/frameTemplates';
import { balloonBody } from '../paint/text';

type Ctx = CanvasRenderingContext2D;

/** Seamless value noise (0..1) of a w × h tile with cells of `cell` px (w and h multiples of it), `octaves` finer layers. */
function tileNoise(w: number, h: number, cell: number, seed: number, octaves = 1): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++, cell = Math.max(1, cell / 2), amp /= 2) {
    const gw = Math.max(1, Math.round(w / cell));
    const gh = Math.max(1, Math.round(h / cell));
    const rng = seededRandom(seed + o * 101);
    const grid = Float32Array.from({ length: gw * gh }, () => rng());
    const at = (x: number, y: number) => grid[(((y % gh) + gh) % gh) * gw + (((x % gw) + gw) % gw)];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * gw;
        const fy = (y / h) * gh;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const s = (t: number) => t * t * (3 - 2 * t);
        const tx = s(fx - x0);
        const ty = s(fy - y0);
        const v = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
        out[y * w + x] += v * amp;
      }
    total += amp;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Fills a canvas from a function of the noise value (and position) giving RGB(A). */
function shade(c: HTMLCanvasElement, noise: Float32Array, f: (n: number, x: number, y: number) => [number, number, number, number?]): void {
  const ctx = ctx2d(c);
  const img = ctx.createImageData(c.width, c.height);
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const i = y * c.width + x;
      const [r, g, b, a = 255] = f(noise[i], x, y);
      img.data.set([r, g, b, a], i * 4);
    }
  ctx.putImageData(img, 0, 0);
}

/** Draws `draw` at (x, y) and at the copies one tile away, so shapes crossing an edge come back on the other side. */
function wrapped(w: number, h: number, x: number, y: number, draw: (x: number, y: number) => void): void {
  for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) draw(x + dx, y + dy);
}

function star(ctx: Ctx, x: number, y: number, r: number, points = 5, inner = 0.45, turn = -Math.PI / 2): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = turn + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function heart(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 1.1, y - s * 0.3, x - s * 0.5, y - s * 1.05, x, y - s * 0.45);
  ctx.bezierCurveTo(x + s * 0.5, y - s * 1.05, x + s * 1.1, y - s * 0.3, x, y + s * 0.35);
  ctx.closePath();
}

const PATTERNS: Record<string, () => HTMLCanvasElement> = {
  'pat-check': () => {
    const c = createCanvas(64, 64);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#fff4f6';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#f2a7b8';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillRect(32, 32, 32, 32);
    return c;
  },
  'pat-gingham': () => {
    const c = createCanvas(48, 48);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 48, 48);
    ctx.fillStyle = 'rgba(64, 120, 200, 0.45)';
    ctx.fillRect(0, 0, 24, 48);
    ctx.fillRect(0, 0, 48, 24);
    return c;
  },
  'pat-stripes': () => {
    const c = createCanvas(120, 8);
    const ctx = ctx2d(c);
    const bands: [number, string][] = [
      [18, '#2f4858'],
      [6, '#f6ae2d'],
      [14, '#86bbd8'],
      [4, '#ffffff'],
      [22, '#33658a'],
      [8, '#f26419'],
      [12, '#f6ae2d'],
      [6, '#ffffff'],
      [30, '#86bbd8'],
    ];
    let x = 0;
    for (const [w, color] of bands) {
      ctx.fillStyle = color;
      ctx.fillRect(x, 0, w, 8);
      x += w;
    }
    return c;
  },
  'pat-diagonal': () => {
    const c = createCanvas(48, 48);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#fff6d5';
    ctx.fillRect(0, 0, 48, 48);
    ctx.strokeStyle = '#7aa95c';
    ctx.lineWidth = 9;
    for (let k = -48; k <= 96; k += 24) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k - 48, 48);
      ctx.stroke();
    }
    return c;
  },
  'pat-polka': () => {
    const c = createCanvas(64, 64);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#1f6f8b';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#ffffff';
    for (const [x, y] of [
      [16, 16],
      [48, 48],
    ])
      wrapped(64, 64, x, y, (px, py) => {
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fill();
      });
    return c;
  },
  'pat-argyle': () => {
    const c = createCanvas(80, 120);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#e9e1cc';
    ctx.fillRect(0, 0, 80, 120);
    const diamond = (x: number, y: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y - 30);
      ctx.lineTo(x + 20, y);
      ctx.lineTo(x, y + 30);
      ctx.lineTo(x - 20, y);
      ctx.closePath();
      ctx.fill();
    };
    for (const [x, y, color] of [
      [20, 30, '#7b2d26'],
      [60, 90, '#7b2d26'],
      [60, 30, '#244c5a'],
      [20, 90, '#244c5a'],
    ] as const)
      wrapped(80, 120, x, y, (px, py) => diamond(px, py, color));
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.moveTo(k * 40 - 40, -60);
      ctx.lineTo(k * 40 + 120, 180);
      ctx.moveTo(k * 40 + 120, -60);
      ctx.lineTo(k * 40 - 40, 180);
      ctx.stroke();
    }
    return c;
  },
  'pat-tartan': () => {
    const c = createCanvas(96, 96);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#7d1d1d';
    ctx.fillRect(0, 0, 96, 96);
    const bands: [number, number, string][] = [
      [0, 24, 'rgba(20, 40, 30, 0.55)'],
      [40, 8, 'rgba(20, 30, 70, 0.55)'],
      [60, 3, 'rgba(240, 220, 120, 0.7)'],
      [72, 14, 'rgba(20, 40, 30, 0.55)'],
    ];
    for (const [p, w, color] of bands) {
      ctx.fillStyle = color;
      ctx.fillRect(p, 0, w, 96);
      ctx.fillRect(0, p, 96, w);
    }
    return c;
  },
  'pat-herringbone': () => {
    const c = createCanvas(48, 48);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#5a4634';
    ctx.fillRect(0, 0, 48, 48);
    ctx.strokeStyle = '#a88a64';
    ctx.lineWidth = 5;
    for (let y = -24; y <= 72; y += 12) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(24, y + 12);
      ctx.lineTo(48, y);
      ctx.stroke();
    }
    return c;
  },
  'pat-brick': () => {
    const c = createCanvas(96, 64);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#d9d2c5';
    ctx.fillRect(0, 0, 96, 64);
    const rng = seededRandom(7);
    for (let row = 0; row < 2; row++)
      for (let k = -1; k < 3; k++) {
        const x = k * 48 + (row ? 24 : 0);
        const shadeR = 150 + Math.round(rng() * 40);
        ctx.fillStyle = `rgb(${shadeR}, ${60 + Math.round(rng() * 25)}, ${45 + Math.round(rng() * 20)})`;
        ctx.fillRect(x + 2, row * 32 + 2, 44, 28);
      }
    return c;
  },
  'pat-waves': () => {
    const c = createCanvas(64, 32);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#1d3f72';
    ctx.fillRect(0, 0, 64, 32);
    ctx.strokeStyle = '#e8f1ff';
    ctx.lineWidth = 2;
    const fan = (x: number, y: number) => {
      ctx.fillStyle = '#1d3f72';
      ctx.beginPath();
      ctx.arc(x, y, 32, Math.PI, 0);
      ctx.fill();
      for (let r = 30; r > 2; r -= 6) {
        ctx.beginPath();
        ctx.arc(x, y, r, Math.PI, 0);
        ctx.stroke();
      }
    };
    // Rows of fans, each row half a fan lower and across.
    for (const y of [0, 32, 64]) for (const x of [0, 64]) fan(x, y);
    for (const y of [16, 48]) for (const x of [32]) fan(x, y);
    return c;
  },
  'pat-honeycomb': () => {
    const r = 14;
    const w = 3 * r;
    const h = Math.round(Math.sqrt(3) * r);
    const c = createCanvas(w, h);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#f7c948';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b07d10';
    ctx.lineWidth = 2;
    const hex = (x: number, y: number) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        if (i === 0) ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
        else ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
      }
      ctx.closePath();
      ctx.stroke();
    };
    for (const [x, y] of [
      [0, 0],
      [1.5 * r, h / 2],
    ])
      wrapped(w, h, x, y, hex);
    return c;
  },
  'pat-stars': () => {
    const c = createCanvas(64, 64);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#20264a';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#ffd84d';
    for (const [x, y, r] of [
      [16, 18, 9],
      [48, 50, 9],
      [50, 14, 4],
      [14, 50, 4],
    ])
      wrapped(64, 64, x, y, (px, py) => {
        star(ctx, px, py, r);
        ctx.fill();
      });
    return c;
  },
  'pat-hearts': () => {
    const c = createCanvas(64, 64);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#ffe3ec';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#e94b7a';
    for (const [x, y] of [
      [16, 20],
      [48, 52],
    ])
      wrapped(64, 64, x, y, (px, py) => {
        heart(ctx, px, py, 10);
        ctx.fill();
      });
    return c;
  },
  'pat-chevron': () => {
    const c = createCanvas(48, 32);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 48, 32);
    ctx.strokeStyle = '#2a9d8f';
    ctx.lineWidth = 7;
    ctx.lineJoin = 'miter';
    for (const y of [-16, 0, 16, 32]) {
      ctx.beginPath();
      ctx.moveTo(-24, y + 8);
      ctx.lineTo(0, y - 4);
      ctx.lineTo(24, y + 8);
      ctx.lineTo(48, y - 4);
      ctx.lineTo(72, y + 8);
      ctx.stroke();
    }
    return c;
  },
  'pat-scales': () => {
    const c = createCanvas(48, 24);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#0f5e5a';
    ctx.fillRect(0, 0, 48, 24);
    const scale = (x: number, y: number) => {
      ctx.fillStyle = '#3fb7a8';
      ctx.strokeStyle = '#0b3d3a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    for (const y of [-12, 12, 36]) for (const x of [0, 24, 48]) scale(x, y);
    for (const y of [0, 24]) for (const x of [12, 36]) scale(x, y);
    return c;
  },
  'pat-hemp': () => {
    const a = 40;
    const w = a;
    const h = Math.round(a * Math.sqrt(3));
    const c = createCanvas(w, h);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#21407a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#d7e3ff';
    ctx.lineWidth = 1.2;
    const rowH = (a * Math.sqrt(3)) / 2;
    // Triangles of the lattice, each with lines from its middle to its corners.
    for (let j = -2; j <= 3; j++)
      for (let i = -2; i <= 3; i++) {
        const x0 = i * a + (j % 2 ? a / 2 : 0);
        const y0 = j * rowH;
        for (const tri of [
          [
            [x0, y0],
            [x0 + a, y0],
            [x0 + a / 2, y0 + rowH],
          ],
          [
            [x0 + a, y0],
            [x0 + a / 2, y0 + rowH],
            [x0 + (3 * a) / 2, y0 + rowH],
          ],
        ]) {
          const mx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
          const my = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
          ctx.beginPath();
          ctx.moveTo(tri[0][0], tri[0][1]);
          ctx.lineTo(tri[1][0], tri[1][1]);
          ctx.lineTo(tri[2][0], tri[2][1]);
          ctx.closePath();
          for (const [x, y] of tri) {
            ctx.moveTo(mx, my);
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
    return c;
  },
  // Textures.
  'tex-paper': () => {
    const c = createCanvas(256, 256);
    const n = tileNoise(256, 256, 32, 11, 4);
    shade(c, n, (v) => {
      const k = 236 + (v - 0.5) * 30;
      return [k + 6, k + 2, k - 8];
    });
    return c;
  },
  'tex-canvas': () => {
    const c = createCanvas(128, 128);
    const n = tileNoise(128, 128, 16, 21, 3);
    shade(c, n, (v, x, y) => {
      const weave = (Math.sin((x * Math.PI * 2) / 4) + Math.sin((y * Math.PI * 2) / 4)) * 6;
      const k = 214 + weave + (v - 0.5) * 24;
      return [k, k - 6, k - 18];
    });
    return c;
  },
  'tex-watercolor': () => {
    const c = createCanvas(256, 256);
    const n = tileNoise(256, 256, 64, 31, 5);
    shade(c, n, (v) => {
      const k = 246 - Math.max(0, v - 0.45) * 60;
      return [k, k + 2, k + 6];
    });
    return c;
  },
  'tex-wood': () => {
    const c = createCanvas(256, 256);
    const n = tileNoise(256, 256, 64, 41, 3);
    shade(c, n, (v, _x, y) => {
      const ring = Math.sin(((y / 256) * 12 + v * 2.2) * Math.PI * 2);
      const k = 0.55 + ring * 0.12 + (v - 0.5) * 0.2;
      return [Math.round(205 * k + 40), Math.round(140 * k + 25), Math.round(80 * k + 10)];
    });
    return c;
  },
  'tex-stone': () => {
    const c = createCanvas(256, 256);
    const n = tileNoise(256, 256, 64, 51, 6);
    const rng = seededRandom(52);
    shade(c, n, (v) => {
      const speck = rng() < 0.02 ? -40 : 0;
      const k = 120 + (v - 0.5) * 120 + speck;
      return [k, k, k + 4];
    });
    return c;
  },
  'tex-denim': () => {
    const c = createCanvas(64, 64);
    const n = tileNoise(64, 64, 8, 61, 3);
    shade(c, n, (v, x, y) => {
      const twill = Math.sin((((x + y) % 8) / 8) * Math.PI * 2) * 0.12;
      const k = 0.55 + twill + (v - 0.5) * 0.3;
      return [Math.round(40 * k + 20), Math.round(80 * k + 30), Math.round(150 * k + 50)];
    });
    return c;
  },
  // Monochromatic patterns: black on transparent.
  'mono-check': () => {
    const c = createCanvas(32, 32);
    const ctx = ctx2d(c);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillRect(16, 16, 16, 16);
    return c;
  },
  'mono-stripes': () => {
    const c = createCanvas(8, 16);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 8, 6);
    return c;
  },
  'mono-dots': () => {
    const c = createCanvas(24, 24);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#000';
    for (const [x, y] of [
      [6, 6],
      [18, 18],
    ])
      wrapped(24, 24, x, y, (px, py) => {
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
    return c;
  },
  'mono-hatching': () => {
    const c = createCanvas(24, 24);
    const ctx = ctx2d(c);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.3;
    for (let k = -24; k <= 48; k += 8) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k + 24, 24);
      ctx.moveTo(k, 24);
      ctx.lineTo(k + 24, 0);
      ctx.stroke();
    }
    return c;
  },
  'mono-sand': () => {
    const c = createCanvas(128, 128);
    const rng = seededRandom(71);
    const n = tileNoise(128, 128, 32, 72, 2);
    shade(c, n, (v) => [0, 0, 0, rng() < 0.12 + v * 0.18 ? 200 : 0]);
    return c;
  },
  'mono-scales': () => {
    const c = createCanvas(32, 16);
    const ctx = ctx2d(c);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.2;
    const scale = (x: number, y: number) => {
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI);
      ctx.stroke();
    };
    for (const y of [-8, 8, 24]) for (const x of [0, 16, 32]) scale(x, y);
    for (const y of [0, 16]) for (const x of [8, 24]) scale(x, y);
    return c;
  },
};

const PICTURES: Record<string, () => HTMLCanvasElement> = {
  'bg-sky': () => {
    const c = createCanvas(800, 600);
    const ctx = ctx2d(c);
    const g = ctx.createLinearGradient(0, 0, 0, 600);
    g.addColorStop(0, '#4f9ef0');
    g.addColorStop(1, '#d9eeff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 800, 600);
    const clouds = createCanvas(200, 150);
    const n = tileNoise(200, 150, 50, 81, 4);
    shade(clouds, n, (v, _x, y) => [255, 255, 255, Math.max(0, Math.min(255, (v - 0.5 - (y / 150) * 0.12) * 900))]);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(clouds, 0, 0, 800, 600);
    return c;
  },
  'bg-sunset': () => {
    const c = createCanvas(800, 600);
    const ctx = ctx2d(c);
    const g = ctx.createLinearGradient(0, 0, 0, 600);
    g.addColorStop(0, '#2b2d6e');
    g.addColorStop(0.55, '#f46b45');
    g.addColorStop(1, '#fbd786');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 800, 600);
    const sun = ctx.createRadialGradient(400, 470, 10, 400, 470, 160);
    sun.addColorStop(0, 'rgba(255, 245, 200, 1)');
    sun.addColorStop(0.35, 'rgba(255, 220, 150, 0.8)');
    sun.addColorStop(1, 'rgba(255, 200, 120, 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, 800, 600);
    return c;
  },
  'bg-night': () => {
    const c = createCanvas(800, 600);
    const ctx = ctx2d(c);
    const g = ctx.createLinearGradient(0, 0, 0, 600);
    g.addColorStop(0, '#070b26');
    g.addColorStop(1, '#22306f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 800, 600);
    const rng = seededRandom(91);
    for (let i = 0; i < 420; i++) {
      const x = rng() * 800;
      const y = rng() * 600;
      const r = rng() < 0.92 ? 0.6 + rng() * 0.9 : 1.5 + rng() * 1.5;
      ctx.fillStyle = `rgba(255, 255, ${200 + Math.round(rng() * 55)}, ${0.5 + rng() * 0.5})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return c;
  },
  'bg-bokeh': () => {
    const c = createCanvas(800, 600);
    const ctx = ctx2d(c);
    const g = ctx.createLinearGradient(0, 0, 800, 600);
    g.addColorStop(0, '#1b1030');
    g.addColorStop(1, '#3d1f2b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 800, 600);
    const rng = seededRandom(101);
    const colors = ['255, 190, 90', '255, 120, 140', '170, 140, 255', '120, 220, 255'];
    for (let i = 0; i < 70; i++) {
      const x = rng() * 800;
      const y = rng() * 600;
      const r = 12 + rng() * 48;
      const col = colors[Math.floor(rng() * colors.length)];
      const b = ctx.createRadialGradient(x, y, 0, x, y, r);
      b.addColorStop(0, `rgba(${col}, ${0.25 + rng() * 0.25})`);
      b.addColorStop(0.85, `rgba(${col}, ${0.15 + rng() * 0.2})`);
      b.addColorStop(1, `rgba(${col}, 0)`);
      ctx.fillStyle = b;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return c;
  },
  'bg-glitter': () => {
    const c = createCanvas(800, 600);
    const ctx = ctx2d(c);
    const g = ctx.createLinearGradient(0, 0, 0, 600);
    g.addColorStop(0, '#fff3f8');
    g.addColorStop(1, '#ffd6e8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 800, 600);
    const rng = seededRandom(111);
    for (let i = 0; i < 90; i++) {
      const x = rng() * 800;
      const y = rng() * 600;
      const r = 4 + rng() * 14;
      ctx.fillStyle = `rgba(255, ${200 + Math.round(rng() * 55)}, ${120 + Math.round(rng() * 100)}, ${0.6 + rng() * 0.4})`;
      star(ctx, x, y, r, 4, 0.22, 0);
      ctx.fill();
    }
    return c;
  },
  'bg-light': () => {
    const c = createCanvas(800, 600);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#fff8e8';
    ctx.fillRect(0, 0, 800, 600);
    const rng = seededRandom(121);
    for (let i = 0; i < 18; i++) {
      const x = rng() * 800;
      const y = rng() * 600;
      const r = 80 + rng() * 220;
      const b = ctx.createRadialGradient(x, y, 0, x, y, r);
      b.addColorStop(0, `rgba(255, ${210 + Math.round(rng() * 40)}, ${140 + Math.round(rng() * 80)}, 0.35)`);
      b.addColorStop(1, 'rgba(255, 240, 200, 0)');
      ctx.fillStyle = b;
      ctx.fillRect(0, 0, 800, 600);
    }
    return c;
  },
  // Decorations: one picture on transparent.
  'img-star': () => {
    const c = createCanvas(256, 256);
    const ctx = ctx2d(c);
    star(ctx, 128, 136, 110);
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#e08e0b';
    ctx.stroke();
    return c;
  },
  'img-heart': () => {
    const c = createCanvas(256, 256);
    const ctx = ctx2d(c);
    heart(ctx, 128, 150, 110);
    const g = ctx.createRadialGradient(100, 90, 10, 128, 128, 140);
    g.addColorStop(0, '#ff8fab');
    g.addColorStop(1, '#d6204e');
    ctx.fillStyle = g;
    ctx.fill();
    return c;
  },
  'img-flower': () => {
    const c = createCanvas(256, 256);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#ff9ec7';
    ctx.strokeStyle = '#d95d93';
    ctx.lineWidth = 4;
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
      ctx.beginPath();
      ctx.ellipse(128 + Math.cos(a) * 62, 128 + Math.sin(a) * 62, 52, 36, a, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(128, 128, 34, 0, Math.PI * 2);
    ctx.fill();
    return c;
  },
  'img-leaf': () => {
    const c = createCanvas(256, 256);
    const ctx = ctx2d(c);
    ctx.beginPath();
    ctx.moveTo(40, 216);
    ctx.bezierCurveTo(40, 90, 120, 30, 220, 36);
    ctx.bezierCurveTo(226, 140, 160, 216, 40, 216);
    ctx.closePath();
    ctx.fillStyle = '#5fa84a';
    ctx.fill();
    ctx.strokeStyle = '#2f6b25';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(40, 216);
    ctx.quadraticCurveTo(120, 140, 214, 44);
    ctx.lineWidth = 3;
    ctx.stroke();
    return c;
  },
  'img-sparkle': () => {
    const c = createCanvas(256, 256);
    const ctx = ctx2d(c);
    const glow = ctx.createRadialGradient(128, 128, 0, 128, 128, 120);
    glow.addColorStop(0, 'rgba(255, 250, 220, 0.9)');
    glow.addColorStop(1, 'rgba(255, 240, 180, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 256, 256);
    star(ctx, 128, 128, 120, 4, 0.16, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    return c;
  },
  'img-cloud': () => {
    const c = createCanvas(256, 160);
    const ctx = ctx2d(c);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#b8c6d8';
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (const [x, y, r] of [
      [70, 100, 44],
      [118, 72, 56],
      [176, 88, 46],
      [204, 112, 32],
      [44, 118, 26],
    ]) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.fill();
    ctx.fillRect(44, 112, 170, 30);
    return c;
  },
};

const cache = new Map<string, HTMLCanvasElement>();

/** The image of a built-in image material (drawn once), or null when it has none. */
export function builtInImage(id: string): HTMLCanvasElement | null {
  const known = cache.get(id);
  if (known) return known;
  const draw = PATTERNS[id] ?? PICTURES[id];
  if (!draw) return null;
  const c = draw();
  cache.set(id, c);
  return c;
}

/** Whether a built-in image material has a picture drawn by code. */
export const hasBuiltInImage = (id: string): boolean => id in PATTERNS || id in PICTURES;

const thumbs = new Map<string, string>();

/** A square thumbnail (data URL) of a material; `own` images come from `ownImage`. */
export function materialThumbnail(m: Material, ownImage?: HTMLCanvasElement | null, size = 96): string {
  const key = `${m.id}:${size}`;
  const known = thumbs.get(key);
  if (known && !m.own) return known;
  const c = createCanvas(size, size);
  const ctx = ctx2d(c);
  const spec = m.spec;
  if (spec.kind === 'image') {
    const img = m.own ? (ownImage ?? null) : builtInImage(m.id);
    if (img) {
      if (spec.tiled) {
        // A few copies of the tile.
        const k = Math.max(size / Math.max(img.width, img.height) / 1.5, Math.min(1, (size * 0.5) / img.width));
        const tile = createCanvas(Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
        ctx2d(tile).drawImage(img, 0, 0, tile.width, tile.height);
        const p = ctx.createPattern(tile, 'repeat');
        if (p) {
          ctx.fillStyle = p;
          ctx.fillRect(0, 0, size, size);
        }
      } else {
        const k = Math.min(size / img.width, size / img.height);
        const w = img.width * k;
        const h = img.height * k;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      }
    }
  } else if (spec.kind === 'tone') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    const step = 8;
    const rng = seededRandom(5);
    const area = spec.value / 100;
    for (let y = step / 2; y < size; y += step)
      for (let x = step / 2; x < size; x += step) {
        if (spec.shape === 'noise') {
          for (let k = 0; k < 4; k++) if (rng() < area) ctx.fillRect(x - step / 2 + rng() * step, y - step / 2 + rng() * step, 1.5, 1.5);
        } else if (spec.shape === 'line') ctx.fillRect(x - step / 2, y - (step * area) / 2, step, step * area);
        else if (spec.shape === 'square' || spec.shape === 'lozenge') {
          const s = step * Math.sqrt(area);
          ctx.save();
          ctx.translate(x, y);
          if (spec.shape === 'lozenge') ctx.rotate(Math.PI / 4);
          ctx.fillRect(-s / 2, -s / 2, s, s);
          ctx.restore();
        } else if (spec.shape === 'cross') {
          const t = (step * area) / 2;
          ctx.fillRect(x - step / 2, y - t / 2, step, t);
          ctx.fillRect(x - t / 2, y - step / 2, t, step);
        } else {
          ctx.beginPath();
          ctx.arc(x, y, step * Math.sqrt(area / Math.PI), 0, Math.PI * 2);
          ctx.fill();
        }
      }
  } else if (spec.kind === 'lines') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    const t = EFFECT_LINE_TOOLS.find((x) => x.id === spec.subTool)?.effectLines;
    if (t) {
      const focus = t.style.kind === 'focus';
      const k = size / 400;
      const e: EffectLines = {
        ...DEFAULT_FOCUS_LINES,
        ...t.style,
        id: 'thumb',
        seed: 9,
        cx: size / 2,
        cy: size / 2,
        fx: 0,
        fy: 0,
        rx: focus ? size * 0.22 : size * 0.4,
        ry: focus ? size * 0.16 : 0,
        rotation: focus ? 0 : Math.PI / 2,
        width: Math.max(0.5, t.style.width * k * 1.6),
        length: t.style.length * k * 1.6,
        gap: focus && t.style.gapMode === 'angle' ? t.style.gap : Math.max(1, t.style.gap * k * 1.6),
        unevenHeight: t.style.unevenHeight * k,
        color: '#000000',
        fillColor: '#ffffff',
      };
      drawEffectLines(ctx, e, { x: 0, y: 0, w: size, h: size });
    }
  } else if (spec.kind === 'frame') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    const t = FRAME_TEMPLATES.find((x) => x.id === spec.template);
    if (t) {
      const w = size * 0.7;
      const page = { x: (size - w) / 2, y: 6, w, h: size - 12 };
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5;
      for (const poly of templatePanels(t, page, 2, 3)) {
        ctx.beginPath();
        poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.closePath();
        ctx.stroke();
      }
    }
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    const body = balloonBody({ id: 't', shape: spec.shape, x: size * 0.12, y: size * 0.18, w: size * 0.76, h: size * 0.56, angle: 0, lineWidth: 2, lineColor: '#000', fillColor: '#fff', tails: [] });
    ctx.beginPath();
    body.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  const url = c.toDataURL();
  if (!m.own) thumbs.set(key, url);
  return url;
}
