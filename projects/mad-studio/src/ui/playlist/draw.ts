import { samplePool } from '../../audio/samplePool';
import { CLIP_GAIN_MIN_DB, clipFades, clipGain, clipVariant, fadeShape, variantSampleId } from '../../model/clips';
import { keyRange, patternLength } from '../../model/patterns';
import { PPQ, ticksPerBar, ticksToSeconds } from '../../model/timing';
import type { AudioClip, Clip, Project } from '../../model/types';
import { drawCurve, type CurveView } from '../automation/curve';

export const TRACK_W = 150;
export const RULER_H = 24;

export interface PlaylistViewport {
  width: number;
  height: number;
  pxPerTick: number;
  trackHeight: number;
  scrollTick: number;
  scrollY: number;
}

export function xOfTick(v: PlaylistViewport, tick: number): number {
  return TRACK_W + (tick - v.scrollTick) * v.pxPerTick;
}

export function tickAtX(v: PlaylistViewport, x: number): number {
  return v.scrollTick + (x - TRACK_W) / v.pxPerTick;
}

export function yOfTrack(v: PlaylistViewport, index: number): number {
  return RULER_H + index * v.trackHeight - v.scrollY;
}

export function trackAtY(v: PlaylistViewport, y: number): number {
  return Math.floor((y - RULER_H + v.scrollY) / v.trackHeight);
}

export interface PlaylistScene {
  project: Project;
  selected: Set<string>;
  playhead: number | null;
  songStart: number;
  songEnd: number;
  rubber: { t0: number; t1: number; r0: number; r1: number } | null;
  dropHint: { tick: number; track: number } | null;
  /** Automation clip under the mouse (points and handles are shown) and the part being edited. */
  autoFocus: { clipId: string; point: number | null; handle: number | null } | null;
  /** Spacing of the finest grid lines (ticks), see gridLineTicks(). */
  lineTicks: number;
  /** Time selection (song playback loops inside it). */
  loop: { start: number; end: number } | null;
}

/** Width of the clip menu icon at the left of a clip's title bar (FL Studio opens the clip menu there). */
export const CLIP_ICON_W = 14;

/** Width of the mute LED area at the right of a track header. */
export const TRACK_LED_W = 24;

/** Curve area of an automation clip drawn at (x, y) with height h (below the 14 px title). */
export function automationClipView(v: PlaylistViewport, clip: Clip, x: number, y: number, h: number): CurveView {
  return { x, y: y + 15, w: clip.length * v.pxPerTick, h: Math.max(4, h - 17), tick0: clip.offset, pxPerTick: v.pxPerTick, visibleTicks: clip.length };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawPatternClip(ctx: CanvasRenderingContext2D, v: PlaylistViewport, project: Project, clip: Extract<Clip, { kind: 'pattern' }>, x: number, y: number, w: number, h: number): string {
  const pattern = project.patterns.find((p) => p.id === clip.patternId);
  if (!pattern) return 'missing pattern';
  const range = keyRange(pattern);
  const period = patternLength(pattern, project.beatsPerBar);
  if (range && h > 20) {
    const [lo, hi] = range;
    const span = Math.max(1, hi - lo);
    const top = y + 15;
    const bodyH = h - 19;
    ctx.fillStyle = '#10151acc';
    for (const [channelId, notes] of Object.entries(pattern.notes)) {
      if (!project.channels.some((c) => c.id === channelId)) continue;
      for (const n of notes) {
        if (n.muted) continue;
        for (let k = Math.max(0, Math.floor((clip.offset - n.start) / period)); ; k++) {
          const src = n.start + k * period;
          if (src >= clip.offset + clip.length) break;
          if (src < clip.offset) continue;
          const nx = x + (src - clip.offset) * v.pxPerTick;
          if (nx > x + w) break;
          const ny = top + (1 - (n.key - lo) / span) * Math.max(1, bodyH - 3);
          ctx.fillRect(nx, ny, Math.max(1.5, Math.min(n.length * v.pxPerTick, x + w - nx) - 0.5), 2);
        }
      }
    }
  }
  return pattern.name;
}

/** Positions of an audio clip's fade, tension and gain handles (FL Studio), or null when the clip is too small. */
export interface AudioClipHandles {
  left: number;
  right: number;
  top: number;
  bottom: number;
  fadeInX: number;
  fadeOutX: number;
  fadeInTension: { x: number; y: number } | null;
  fadeOutTension: { x: number; y: number } | null;
  gain: { x: number; y: number };
}

export function audioClipHandles(v: PlaylistViewport, clip: AudioClip, x: number, y: number, h: number): AudioClipHandles | null {
  const w = clip.length * v.pxPerTick;
  if (h < 30 || w < 24) return null;
  const top = y + 15;
  const bottom = y + h - 2;
  const { fadeIn, fadeOut } = clipFades(clip);
  const fadeInX = x + fadeIn * v.pxPerTick;
  const fadeOutX = x + w - fadeOut * v.pxPerTick;
  const tensionAt = (x0: number, x1: number, tension: number) => ({ x: (x0 + x1) / 2, y: bottom - fadeShape(0.5, tension) * (bottom - top) });
  return {
    left: x,
    right: x + w,
    top,
    bottom,
    fadeInX,
    fadeOutX,
    fadeInTension: fadeIn * v.pxPerTick >= 10 ? tensionAt(x, fadeInX, clip.fadeInTension ?? 0) : null,
    fadeOutTension: fadeOut * v.pxPerTick >= 10 ? tensionAt(x + w, fadeOutX, clip.fadeOutTension ?? 0) : null,
    gain: { x: x + w / 2, y: bottom },
  };
}

/** The buffer an audio clip plays: its pitch/stretch/reverse variant once computed, else the source. */
export function audioClipBuffer(project: Project, clip: AudioClip): AudioBuffer | null {
  const channel = project.channels.find((c) => c.id === clip.channelId);
  if (!channel || channel.kind !== 'sampler' || !channel.sampler.sampleId) return null;
  const variant = clipVariant(clip);
  const entry = (variant ? samplePool.get(variantSampleId(channel.sampler.sampleId, variant)) : undefined) ?? samplePool.get(channel.sampler.sampleId);
  return entry?.buffer ?? null;
}

function drawAudioClip(ctx: CanvasRenderingContext2D, v: PlaylistViewport, project: Project, clip: AudioClip, x: number, y: number, w: number, h: number): string {
  const channel = project.channels.find((c) => c.id === clip.channelId);
  if (!channel || channel.kind !== 'sampler' || !channel.sampler.sampleId) return 'missing sample';
  const variant = clipVariant(clip);
  const variantId = variant ? variantSampleId(channel.sampler.sampleId, variant) : null;
  const entry = (variantId ? samplePool.get(variantId) : undefined) ?? samplePool.get(channel.sampler.sampleId);
  const baseName = project.samples[channel.sampler.sampleId]?.name ?? channel.name;
  const tags = [
    clip.pitch || clip.fine ? `${(clip.pitch ?? 0) >= 0 ? '+' : ''}${clip.pitch ?? 0}${clip.fine ? `.${String(Math.abs(clip.fine)).padStart(2, '0')}` : ''} st` : '',
    clip.stretch && clip.stretch !== 1 ? `×${clip.stretch.toFixed(2)}` : '',
    clip.reverse ? 'rev' : '',
  ].filter(Boolean);
  const name = tags.length ? `${baseName} (${tags.join(', ')})` : baseName;
  if (!entry || h <= 20) return name;
  const secondsPerPx = ticksToSeconds(1, project.bpm) / v.pxPerTick;
  const duration = entry.buffer.duration;
  const buckets = 2048;
  const peaks = samplePool.peaks(entry.id, buckets);
  if (!peaks) return name;
  const mid = y + 15 + (h - 17) / 2;
  const amp = (h - 19) / 2;
  const offsetSec = ticksToSeconds(clip.offset, project.bpm);
  const gain = clipGain(clip.gain);
  const { fadeIn, fadeOut } = clipFades(clip);
  const fadeInPx = fadeIn * v.pxPerTick;
  const fadeOutPx = fadeOut * v.pxPerTick;
  // The waveform shows the clip's gain and fades.
  const envelope = (px: number) => {
    let g = gain;
    if (fadeInPx > 0 && px < fadeInPx) g *= fadeShape(px / fadeInPx, clip.fadeInTension ?? 0);
    if (fadeOutPx > 0 && px > w - fadeOutPx) g *= fadeShape((w - px) / fadeOutPx, clip.fadeOutTension ?? 0);
    return Math.min(1.5, g);
  };
  ctx.fillStyle = '#10151add';
  const startPx = Math.max(0, TRACK_W - x);
  for (let px = startPx; px < w && x + px < v.width; px++) {
    const t = offsetSec + px * secondsPerPx;
    if (t >= duration) break;
    const b = Math.min(buckets - 1, Math.floor((t / duration) * buckets));
    const e = envelope(px);
    const lo = peaks[b * 2] * e;
    const hi = peaks[b * 2 + 1] * e;
    ctx.fillRect(x + px, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
  }

  // Fade curves and the handles (FL Studio: triangles on the upper edge, circles for the tension,
  // the semi-circle on the lower edge for the gain).
  const hd = audioClipHandles(v, clip, x, y, h);
  if (!hd) return name;
  ctx.save();
  ctx.beginPath();
  ctx.rect(Math.max(TRACK_W, x), y, w, h);
  ctx.clip();
  const height = hd.bottom - hd.top;
  ctx.strokeStyle = '#ffffffcc';
  ctx.lineWidth = 1;
  if (fadeInPx > 0) {
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const px = (i / 24) * fadeInPx;
      const yy = hd.bottom - fadeShape(i / 24, clip.fadeInTension ?? 0) * height;
      if (i === 0) ctx.moveTo(x + px, yy);
      else ctx.lineTo(x + px, yy);
    }
    ctx.stroke();
  }
  if (fadeOutPx > 0) {
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const px = w - fadeOutPx + (i / 24) * fadeOutPx;
      const yy = hd.bottom - fadeShape(1 - i / 24, clip.fadeOutTension ?? 0) * height;
      if (i === 0) ctx.moveTo(x + px, yy);
      else ctx.lineTo(x + px, yy);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#f2f5f7';
  for (const [hx, dir] of [
    [hd.fadeInX, 1],
    [hd.fadeOutX, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(hx, hd.top);
    ctx.lineTo(hx + dir * 7, hd.top);
    ctx.lineTo(hx, hd.top + 7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = '#f2f5f7';
  for (const t of [hd.fadeInTension, hd.fadeOutTension]) {
    if (!t) continue;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(hd.gain.x, hd.gain.y, 5, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  if (clip.gain) {
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(clip.gain <= CLIP_GAIN_MIN_DB ? '-∞ dB' : `${clip.gain > 0 ? '+' : ''}${clip.gain.toFixed(1)} dB`, hd.gain.x, hd.gain.y - 8);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  return name;
}

function drawAutomationClip(
  ctx: CanvasRenderingContext2D,
  v: PlaylistViewport,
  s: PlaylistScene,
  clip: Extract<Clip, { kind: 'automation' }>,
  x: number,
  y: number,
  h: number,
): string {
  const ch = s.project.channels.find((c) => c.id === clip.channelId);
  if (!ch || ch.kind !== 'automation') return 'missing automation';
  // Small curve glyph before the name, like FL Studio's automation icon.
  const gx = Math.max(x, TRACK_W) + 5;
  ctx.strokeStyle = '#0d1114';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(gx, y + 11);
  ctx.lineTo(gx + 7, y + 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(gx, y + 11, 1.6, 0, Math.PI * 2);
  ctx.arc(gx + 7, y + 4, 1.6, 0, Math.PI * 2);
  ctx.fillStyle = '#0d1114';
  ctx.fill();
  if (h > 20) {
    const focus = s.autoFocus?.clipId === clip.id ? s.autoFocus : null;
    const edit = focus !== null || s.selected.has(clip.id);
    drawCurve(ctx, automationClipView(v, clip, x, y, h), ch.automation, {
      color: '#fff1f1',
      fill: 'rgba(255, 255, 255, 0.10)',
      lineWidth: 1.4,
      showPoints: edit && v.pxPerTick * clip.length > 30,
      showHandles: edit && v.pxPerTick * clip.length > 60,
      activePoint: focus?.point ?? null,
      activeHandle: focus?.handle ?? null,
    });
  }
  return ch.automation.target ? ch.name : `${ch.name} (unlinked)`;
}

export function drawPlaylist(ctx: CanvasRenderingContext2D, v: PlaylistViewport, s: PlaylistScene): void {
  const { width, height, pxPerTick, trackHeight } = v;
  const { project } = s;
  ctx.clearRect(0, 0, width, height);

  // --- tracks background
  const firstTrack = Math.max(0, trackAtY(v, RULER_H));
  const lastTrack = Math.min(project.tracks.length - 1, trackAtY(v, height));
  ctx.save();
  ctx.beginPath();
  ctx.rect(TRACK_W, RULER_H, width - TRACK_W, height - RULER_H);
  ctx.clip();
  for (let i = firstTrack; i <= lastTrack; i++) {
    const y = yOfTrack(v, i);
    ctx.fillStyle = i % 2 === 0 ? '#293842' : '#26343e';
    ctx.fillRect(TRACK_W, y, width - TRACK_W, trackHeight);
    ctx.fillStyle = '#1c262d';
    ctx.fillRect(TRACK_W, y + trackHeight - 1, width - TRACK_W, 1);
  }
  const below = yOfTrack(v, project.tracks.length);
  if (below < height) {
    ctx.fillStyle = '#212c33';
    ctx.fillRect(TRACK_W, below, width - TRACK_W, height - below);
  }

  // --- grid lines (finer as you zoom in, like FL Studio's "Line" snap)
  const bar = ticksPerBar(project.beatsPerBar);
  const endTick = tickAtX(v, width);
  const line = s.lineTicks;
  for (let t = Math.max(0, Math.floor(v.scrollTick / line) * line); t <= endTick; t += line) {
    const x = Math.round(xOfTick(v, t)) + 0.5;
    ctx.strokeStyle = t % bar === 0 ? '#ffffff30' : t % PPQ === 0 ? '#ffffff10' : '#ffffff08';
    ctx.beginPath();
    ctx.moveTo(x, RULER_H);
    ctx.lineTo(x, Math.min(height, below));
    ctx.stroke();
  }

  // --- time selection
  if (s.loop) {
    const lx0 = Math.max(TRACK_W, xOfTick(v, s.loop.start));
    const lx1 = Math.min(width, xOfTick(v, s.loop.end));
    if (lx1 > lx0) {
      ctx.fillStyle = '#ffffff0d';
      ctx.fillRect(lx0, RULER_H, lx1 - lx0, Math.min(height, below) - RULER_H);
    }
  }

  // --- song end
  const endX = xOfTick(v, s.songEnd);
  if (endX > TRACK_W && endX < width && project.clips.length) {
    ctx.fillStyle = '#00000040';
    ctx.fillRect(endX, RULER_H, width - endX, Math.min(height, below) - RULER_H);
  }

  // --- clips
  const trackIndex = new Map(project.tracks.map((t, i) => [t.id, i]));
  for (const clip of project.clips) {
    const ti = trackIndex.get(clip.trackId);
    if (ti === undefined || ti < firstTrack || ti > lastTrack) continue;
    const x = xOfTick(v, clip.start);
    const w = Math.max(3, clip.length * pxPerTick);
    if (x > width || x + w < TRACK_W) continue;
    const y = yOfTrack(v, ti) + 1;
    const h = trackHeight - 3;
    const muted = project.tracks[ti].muted || clip.muted === true;
    const color =
      clip.kind === 'pattern'
        ? (project.patterns.find((p) => p.id === clip.patternId)?.color ?? '#777')
        : (project.channels.find((c) => c.id === clip.channelId)?.color ?? '#777');
    const selected = s.selected.has(clip.id);
    ctx.globalAlpha = muted ? 0.35 : 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h, 3);
    ctx.fillStyle = color;
    ctx.globalAlpha *= 0.78;
    ctx.fill();
    ctx.globalAlpha = muted ? 0.35 : 1;
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#00000038';
    ctx.fillRect(x, y, w, 14);
    const label =
      clip.kind === 'pattern'
        ? drawPatternClip(ctx, v, project, clip, x, y, w, h)
        : clip.kind === 'audio'
          ? drawAudioClip(ctx, v, project, clip, x, y, w, h)
          : drawAutomationClip(ctx, v, s, clip, x, y, h);
    ctx.fillStyle = '#0d1114';
    if (clip.kind !== 'automation') {
      // Clip menu icon: three short bars, like the menu icon in FL Studio's clip titles.
      const ix = Math.max(x, TRACK_W) + 4;
      for (let i = 0; i < 3; i++) ctx.fillRect(ix, y + 4 + i * 2.5, 6, 1.2);
    }
    ctx.font = '600 10px -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, Math.max(x, TRACK_W) + 16, y + 7.5);
    ctx.restore();
    ctx.strokeStyle = selected ? '#ffffff' : '#0b0e10';
    ctx.lineWidth = selected ? 1.6 : 1;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h, 3);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  }

  // --- drop target preview
  if (s.dropHint && s.dropHint.track >= 0 && s.dropHint.track < project.tracks.length) {
    const x = xOfTick(v, s.dropHint.tick);
    const y = yOfTrack(v, s.dropHint.track);
    ctx.strokeStyle = '#ff9b3d';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x + 0.5, y + 1.5, Math.max(30, bar * pxPerTick * 0.5), trackHeight - 4);
    ctx.setLineDash([]);
  }

  // --- rubber band
  if (s.rubber) {
    const x0 = xOfTick(v, Math.min(s.rubber.t0, s.rubber.t1));
    const x1 = xOfTick(v, Math.max(s.rubber.t0, s.rubber.t1));
    const y0 = yOfTrack(v, Math.min(s.rubber.r0, s.rubber.r1));
    const y1 = yOfTrack(v, Math.max(s.rubber.r0, s.rubber.r1) + 1);
    ctx.fillStyle = '#5cb4ff22';
    ctx.strokeStyle = '#5cb4ff';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
  }
  ctx.restore();

  // --- ruler
  ctx.fillStyle = '#3b464d';
  ctx.fillRect(TRACK_W, 0, width - TRACK_W, RULER_H);
  ctx.fillStyle = '#1f282e';
  ctx.fillRect(TRACK_W, RULER_H - 1, width - TRACK_W, 1);
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  if (s.loop) {
    const lx0 = Math.max(TRACK_W, xOfTick(v, s.loop.start));
    const lx1 = Math.min(width, xOfTick(v, s.loop.end));
    if (lx1 > lx0) {
      ctx.fillStyle = '#e0705a99';
      ctx.fillRect(lx0, 0, lx1 - lx0, RULER_H - 1);
    }
  }
  const barPx = bar * pxPerTick;
  const every = barPx < 26 ? Math.ceil(26 / barPx) : 1;
  for (let t = Math.floor(v.scrollTick / bar) * bar; t <= endTick; t += bar) {
    const x = Math.round(xOfTick(v, t)) + 0.5;
    if (x < TRACK_W) continue;
    const index = t / bar;
    if (index % every !== 0) continue;
    ctx.fillStyle = '#e6ebee';
    ctx.fillText(String(index + 1), x + 4, 9);
    ctx.fillStyle = '#ffffff40';
    ctx.fillRect(x, RULER_H - 8, 1, 7);
  }

  // --- song start marker
  const sx = xOfTick(v, s.songStart);
  if (sx >= TRACK_W && sx <= width) {
    ctx.fillStyle = '#7cc35b';
    ctx.beginPath();
    ctx.moveTo(sx, RULER_H - 1);
    ctx.lineTo(sx - 5, RULER_H - 9);
    ctx.lineTo(sx + 5, RULER_H - 9);
    ctx.fill();
  }

  // --- track headers
  const used = new Set(project.clips.map((c) => c.trackId));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, RULER_H, TRACK_W, height - RULER_H);
  ctx.clip();
  for (let i = firstTrack; i <= lastTrack; i++) {
    const t = project.tracks[i];
    const y = yOfTrack(v, i);
    ctx.fillStyle = i % 2 === 0 ? '#4c575e' : '#48535a';
    ctx.fillRect(0, y, TRACK_W - 1, trackHeight);
    ctx.fillStyle = '#2b343a';
    ctx.fillRect(0, y + trackHeight - 1, TRACK_W, 1);
    // mute LED at the right, as in FL Studio
    ctx.beginPath();
    ctx.arc(TRACK_W - TRACK_LED_W / 2, y + trackHeight / 2, 5, 0, Math.PI * 2);
    ctx.fillStyle = t.muted ? '#2b3a26' : '#8fe06a';
    ctx.fill();
    ctx.strokeStyle = '#0a0d0f';
    ctx.stroke();
    // Tracks without clips have dimmed names.
    ctx.fillStyle = t.muted ? '#8e9aa2' : used.has(t.id) ? '#eaeef1' : '#9aa6ae';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.name, 10, y + trackHeight / 2, TRACK_W - TRACK_LED_W - 14);
  }
  ctx.restore();
  ctx.fillStyle = '#1f282e';
  ctx.fillRect(TRACK_W - 1, 0, 1, height);
  ctx.fillStyle = '#3b464d';
  ctx.fillRect(0, 0, TRACK_W - 1, RULER_H);

  // --- playhead
  if (s.playhead !== null) {
    const x = Math.round(xOfTick(v, s.playhead)) + 0.5;
    if (x >= TRACK_W && x <= width) {
      ctx.strokeStyle = '#ff9b3d';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }
}
