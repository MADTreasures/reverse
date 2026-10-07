import { firstEventAtOrAfter, type SequencedEvent, type Timeline } from '../model/timeline';
import { PPQ, TICKS_PER_STEP, secondsPerTick } from '../model/timing';

export interface SchedulerHost {
  /** Current audio clock time in seconds. */
  now(): number;
  timeline(): Timeline;
  bpm(): number;
  swing(): number;
  beatsPerBar(): number;
  onEvent(ev: SequencedEvent, time: number, secondsPerTick: number): void;
  onBeat?(beat: number, barStart: boolean, time: number): void;
}

interface Segment {
  time: number;
  tick: number;
  spt: number;
}

/** Delay applied to notes on every second 16th step (swing 1 = half a step). */
export function swingOffsetTicks(tick: number, swing: number): number {
  if (swing <= 0) return 0;
  return tick % (TICKS_PER_STEP * 2) === TICKS_PER_STEP ? swing * TICKS_PER_STEP * 0.5 : 0;
}

/**
 * Look-ahead sequencer ("two clocks" technique): a coarse timer calls pump(),
 * which schedules every event that falls into the next `lookahead` seconds
 * with sample-accurate Web Audio timestamps. Tempo changes and loop wraps
 * start new segments so the playhead position can be reconstructed.
 */
export class Scheduler {
  lookahead = 0.12;
  private running = false;
  private cursor = 0;
  private anchorTime = 0;
  private anchorTick = 0;
  private spt = 0;
  private segments: Segment[] = [];

  constructor(private readonly host: SchedulerHost) {}

  get playing(): boolean {
    return this.running;
  }

  start(fromTick: number, startTime: number): void {
    const tl = this.host.timeline();
    const tick = fromTick >= tl.end || fromTick < tl.start ? tl.start : fromTick;
    this.running = true;
    this.spt = secondsPerTick(this.host.bpm());
    this.anchorTime = startTime;
    this.anchorTick = tick;
    this.cursor = tick;
    this.segments = [{ time: startTime, tick, spt: this.spt }];
    this.pump();
  }

  stop(): void {
    this.running = false;
    this.segments = [];
  }

  /** Jumps to another position while playing. */
  relocate(tick: number, time: number): void {
    if (!this.running) return;
    this.anchorTime = time;
    this.anchorTick = tick;
    this.cursor = tick;
    this.segments.push({ time, tick, spt: this.spt });
  }

  pump(): void {
    if (!this.running) return;
    const host = this.host;
    const now = host.now();
    const horizon = now + this.lookahead;

    const spt = secondsPerTick(host.bpm());
    if (spt !== this.spt) {
      // Re-anchor at the scheduling frontier; everything before it already used the old tempo.
      const frontier = this.anchorTime + (this.cursor - this.anchorTick) * this.spt;
      this.anchorTime = frontier;
      this.anchorTick = this.cursor;
      this.spt = spt;
      this.segments.push({ time: frontier, tick: this.cursor, spt });
    }

    const tl = host.timeline();
    const swing = host.swing();
    const beatsPerBar = host.beatsPerBar();

    for (let guard = 0; guard < 64; guard++) {
      if (this.cursor >= tl.end || this.cursor < tl.start) this.wrap(tl);
      const frontierTime = this.anchorTime + (this.cursor - this.anchorTick) * this.spt;
      if (frontierTime >= horizon) break;
      const horizonTick = this.anchorTick + (horizon - this.anchorTime) / this.spt;
      const segEnd = Math.min(horizonTick, tl.end);

      for (let i = firstEventAtOrAfter(tl.events, this.cursor); i < tl.events.length; i++) {
        const ev = tl.events[i];
        if (ev.tick >= segEnd) break;
        const tick = ev.tick + swingOffsetTicks(ev.tick, swing);
        host.onEvent(ev, this.anchorTime + (tick - this.anchorTick) * this.spt, this.spt);
      }

      if (host.onBeat) {
        const firstBeat = Math.ceil(this.cursor / PPQ);
        for (let b = firstBeat; b * PPQ < segEnd; b++) {
          host.onBeat(b, b % beatsPerBar === 0, this.anchorTime + (b * PPQ - this.anchorTick) * this.spt);
        }
      }

      this.cursor = segEnd;
      if (segEnd < tl.end) break;
    }
    this.prune(now);
  }

  /** Restarts at the loop start; wraps at the frontier so a shrunken loop never schedules into the past. */
  private wrap(tl: Timeline): void {
    const wrapTime = this.anchorTime + (this.cursor - this.anchorTick) * this.spt;
    this.anchorTime = wrapTime;
    this.anchorTick = tl.start;
    this.cursor = tl.start;
    this.segments.push({ time: wrapTime, tick: tl.start, spt: this.spt });
  }

  /** Song/pattern position (ticks) audible at audio time `time`. */
  positionAt(time: number): number | null {
    if (!this.running || this.segments.length === 0) return null;
    let seg = this.segments[0];
    for (const s of this.segments) {
      if (s.time <= time) seg = s;
      else break;
    }
    return Math.max(seg.tick, seg.tick + (time - seg.time) / seg.spt);
  }

  private prune(now: number): void {
    // Keep the newest segment that started before `now - 1s` and everything after it.
    let keepFrom = 0;
    for (let i = 0; i < this.segments.length; i++) if (this.segments[i].time <= now - 1) keepFrom = i;
    if (keepFrom > 0) this.segments = this.segments.slice(keepFrom);
  }
}
