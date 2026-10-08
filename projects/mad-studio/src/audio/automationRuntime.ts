import { produce } from 'immer';
import { create } from 'zustand';
import { compileAutomationLanes, laneValueAt, type AutomationLane } from '../model/automation';
import { applyTargetValue, describeTarget, fromNorm, targetValue, type TargetInfo } from '../model/automationTargets';
import type { Channel, Clip, PlaylistTrack, Project } from '../model/types';

/** Automated values in effect (target key → value in target units). Knobs display these. */
export const useAutomationOverlay = create<{ values: Record<string, number> }>(() => ({ values: {} }));

interface Override {
  value: number;
  /** Project value of the target when the override was set; a different value means the user moved it. */
  base: number | null;
}

export interface UnitLane {
  target: string;
  /** Absolute ticks and target units. */
  points: [number, number][];
}

/**
 * Evaluates the playlist's automation clips during song playback. Overrides behave like FL Studio:
 * a control follows its automation while the song plays and keeps the last automated value after
 * stopping, until the user moves it.
 */
export class AutomationRuntime {
  private cacheKey: { clips: Clip[]; tracks: PlaylistTrack[]; automation: Channel[] } | null = null;
  private lanes: AutomationLane[] = [];
  private infos = new Map<string, TargetInfo | null>();
  private infoProject: Project | null = null;
  private overrides = new Map<string, Override>();

  /** Compiled lanes (normalized values), cached while clips and automation channels are unchanged. */
  lanesOf(project: Project): AutomationLane[] {
    const automation = project.channels.filter((c) => c.kind === 'automation');
    const key = this.cacheKey;
    const same =
      key !== null &&
      key.clips === project.clips &&
      key.tracks === project.tracks &&
      key.automation.length === automation.length &&
      key.automation.every((c, i) => c === automation[i]);
    if (!same) {
      this.lanes = compileAutomationLanes(project);
      this.cacheKey = { clips: project.clips, tracks: project.tracks, automation };
    }
    return this.lanes;
  }

  private info(project: Project, target: string): TargetInfo | null {
    if (this.infoProject !== project) {
      this.infos.clear();
      this.infoProject = project;
    }
    let info = this.infos.get(target);
    if (info === undefined) {
      info = describeTarget(project, target);
      this.infos.set(target, info);
    }
    return info;
  }

  /** Lanes converted to target units (for the native engine). */
  unitLanes(project: Project): UnitLane[] {
    const out: UnitLane[] = [];
    for (const lane of this.lanesOf(project)) {
      const info = this.info(project, lane.target);
      if (!info) continue;
      out.push({ target: lane.target, points: lane.points.map(([t, v]) => [t, fromNorm(info, v)]) });
    }
    return out;
  }

  /** Evaluates every lane at `tick`; returns true when an override changed. */
  update(project: Project, tick: number): boolean {
    let changed = false;
    const live = new Set<string>();
    for (const lane of this.lanesOf(project)) {
      live.add(lane.target);
      const n = laneValueAt(lane, tick);
      if (n === null) continue;
      const info = this.info(project, lane.target);
      if (!info) continue;
      const value = fromNorm(info, n);
      const prev = this.overrides.get(lane.target);
      if (!prev || Math.abs(prev.value - value) > 1e-9) {
        this.overrides.set(lane.target, { value, base: targetValue(project, lane.target) });
        changed = true;
      }
    }
    for (const key of [...this.overrides.keys()]) {
      if (!live.has(key)) {
        this.overrides.delete(key);
        changed = true;
      }
    }
    if (changed) this.publish();
    return changed;
  }

  /** Drops overrides whose control the user changed since. Returns true when something was dropped. */
  reconcile(project: Project): boolean {
    let changed = false;
    for (const [key, o] of this.overrides) {
      const now = targetValue(project, key);
      if (now !== o.base) {
        this.overrides.delete(key);
        changed = true;
      }
    }
    if (changed) this.publish();
    return changed;
  }

  clear(): void {
    if (this.overrides.size === 0) return;
    this.overrides.clear();
    this.publish();
  }

  value(key: string): number | undefined {
    return this.overrides.get(key)?.value;
  }

  get size(): number {
    return this.overrides.size;
  }

  /** The project with automated values written in (what the browser engine plays). */
  apply(project: Project): Project {
    if (this.overrides.size === 0) return project;
    return produce(project, (d) => {
      for (const [key, o] of this.overrides) applyTargetValue(d, key, o.value);
    });
  }

  private publish(): void {
    const values: Record<string, number> = {};
    for (const [key, o] of this.overrides) values[key] = o.value;
    useAutomationOverlay.setState({ values });
  }
}
