import { patternTimeline, songTimeline } from '../model/timeline';
import { secondsPerTick } from '../model/timing';
import type { Id, Project } from '../model/types';
import { ProjectGraph } from './graph';
import { samplePool, type SamplePool } from './samplePool';
import { swingOffsetTicks } from './scheduler';

export interface RenderOptions {
  mode: 'song' | 'pattern';
  patternId?: Id | null;
  sampleRate?: number;
  /** Seconds appended after the end for reverb/delay tails. */
  tail?: number;
  /** How many times a pattern is repeated (pattern mode). */
  loops?: number;
}

/** Renders the song or a pattern faster than real time with an OfflineAudioContext. */
export async function renderProject(project: Project, opts: RenderOptions, pool: SamplePool = samplePool): Promise<AudioBuffer> {
  const sampleRate = opts.sampleRate ?? 44100;
  const tail = opts.tail ?? 2;
  const loops = opts.mode === 'pattern' ? Math.max(1, opts.loops ?? 1) : 1;
  const tl = opts.mode === 'song' ? songTimeline(project) : patternTimeline(project, opts.patternId ?? null);
  const spt = secondsPerTick(project.bpm);
  const loopTicks = tl.end - tl.start;
  const duration = loopTicks * loops * spt + tail;
  const length = Math.max(1, Math.ceil(duration * sampleRate));

  // Buffers at another rate are resampled on playback, so existing factory sounds are reused.
  if (!pool.hasFactorySamples()) pool.ensureFactorySamples(sampleRate);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  const graph = new ProjectGraph(ctx, pool, { meters: false });
  graph.sync(project);

  const startOffset = 0.005;
  for (let loop = 0; loop < loops; loop++) {
    for (const ev of tl.events) {
      const tick = ev.tick - tl.start + loop * loopTicks + swingOffsetTicks(ev.tick, project.swing);
      graph.trigger(ev, startOffset + tick * spt, spt);
    }
  }

  const buffer = await ctx.startRendering();
  graph.dispose();
  return buffer;
}

export function bufferChannels(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
}
