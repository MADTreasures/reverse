import { laneValueAt } from '../model/automation';
import { describeTarget, fromNorm } from '../model/automationTargets';
import { patternTimeline, songTimeline } from '../model/timeline';
import { secondsPerTick } from '../model/timing';
import type { Id, Project } from '../model/types';
import { AutomationRuntime } from './automationRuntime';
import { ProjectGraph } from './graph';
import { samplePool, type SamplePool } from './samplePool';
import { swingOffsetTicks } from './scheduler';
import { loadWorklets } from './worklets';

export interface RenderOptions {
  mode: 'song' | 'pattern';
  patternId?: Id | null;
  sampleRate?: number;
  /** Seconds appended after the end for reverb/delay tails. */
  tail?: number;
  /** How many times a pattern is repeated (pattern mode). */
  loops?: number;
}

/** Seconds from tick 0 to every tick, following an automated tempo (song mode). */
class TempoMap {
  private readonly cum: Float64Array;
  constructor(
    private readonly end: number,
    private readonly sptAt: (tick: number) => number,
  ) {
    this.cum = new Float64Array(end + 2);
    for (let t = 0; t <= end; t++) this.cum[t + 1] = this.cum[t] + sptAt(t);
  }
  seconds(tick: number): number {
    const t = Math.max(0, tick);
    if (t >= this.end + 1) return this.cum[this.end + 1] + (t - this.end - 1) * this.sptAt(this.end);
    const i = Math.floor(t);
    return this.cum[i] + (t - i) * this.sptAt(i);
  }
  tickAt(seconds: number): number {
    let lo = 0;
    let hi = this.end + 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cum[mid] <= seconds) lo = mid;
      else hi = mid - 1;
    }
    return lo + (seconds - this.cum[lo]) / this.sptAt(lo);
  }
}

/** Renders the song or a pattern faster than real time with an OfflineAudioContext. */
export async function renderProject(project: Project, opts: RenderOptions, pool: SamplePool = samplePool): Promise<AudioBuffer> {
  const sampleRate = opts.sampleRate ?? 44100;
  const tail = opts.tail ?? 2;
  const loops = opts.mode === 'pattern' ? Math.max(1, opts.loops ?? 1) : 1;
  const tl = opts.mode === 'song' ? songTimeline(project) : patternTimeline(project, opts.patternId ?? null);
  const automation = new AutomationRuntime();
  const lanes = opts.mode === 'song' ? automation.lanesOf(project) : [];
  const bpmLane = lanes.find((l) => l.target === 'proj:bpm');
  const bpmInfo = bpmLane ? describeTarget(project, 'proj:bpm') : null;
  const swingLane = lanes.find((l) => l.target === 'proj:swing');
  const sptAt = (tick: number) => {
    const n = bpmLane && bpmInfo ? laneValueAt(bpmLane, tick) : null;
    return secondsPerTick(n === null || !bpmInfo ? project.bpm : fromNorm(bpmInfo, n));
  };
  const swingAt = (tick: number) => {
    const n = swingLane ? laneValueAt(swingLane, tick) : null;
    return n === null ? project.swing : n;
  };
  const tempo = new TempoMap(Math.ceil(tl.end), sptAt);
  const loopSeconds = tempo.seconds(tl.end) - tempo.seconds(tl.start);
  const duration = loopSeconds * loops + tail;
  const length = Math.max(1, Math.ceil(duration * sampleRate));

  // Buffers at another rate are resampled on playback, so existing factory sounds are reused.
  if (!pool.hasFactorySamples()) pool.ensureFactorySamples(sampleRate);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
  await loadWorklets(ctx);
  const graph = new ProjectGraph(ctx, pool, { meters: false });
  const startOffset = 0.005;
  const at = (tick: number) => startOffset + tempo.seconds(tick) - tempo.seconds(tl.start);

  if (lanes.length > 0) {
    // Step through the song with suspend points and apply the automated values at each one.
    automation.update(project, tl.start);
    graph.sync(automation.apply(project));
    const step = 512 / sampleRate;
    for (let t = step; t < loopSeconds + startOffset; t += step) {
      ctx
        .suspend(t)
        .then(() => {
          const tick = tempo.tickAt(Math.max(0, t - startOffset) + tempo.seconds(tl.start));
          if (automation.update(project, tick)) graph.sync(automation.apply(project));
          return ctx.resume();
        })
        .catch(() => undefined);
    }
  } else {
    graph.sync(project);
  }

  for (let loop = 0; loop < loops; loop++) {
    for (const ev of tl.events) {
      const tick = ev.tick + swingOffsetTicks(ev.tick, swingAt(ev.tick));
      graph.trigger(ev, at(tick) + loop * loopSeconds, sptAt(ev.tick));
    }
  }

  const buffer = await ctx.startRendering();
  graph.dispose();
  return buffer;
}

export function bufferChannels(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
}
