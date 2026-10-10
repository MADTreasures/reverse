/**
 * Stems for the export's "Split mixer tracks" (FL Studio: one file per mixer track, rendered without
 * the master): which inserts get a file and the project each of them is rendered from.
 */
import { parseTargetKey } from './automationTargets';
import { DEFAULT_SEND, carriesAudio, trackRoutes } from './routing';
import type { Project } from './types';

/**
 * Mixer inserts that carry audio: channels play into them, or tracks that do send audio to them.
 * Muted inserts are left out, like in FL Studio.
 */
export function stemTracks(project: Project): number[] {
  const fed = project.mixer.map(() => false);
  const stack: number[] = [];
  const feed = (t: number) => {
    if (t <= 0 || t >= fed.length || fed[t]) return;
    fed[t] = true;
    stack.push(t);
  };
  for (const c of project.channels) if (c.kind !== 'automation') feed(c.mixerTrack);
  while (stack.length) {
    const t = stack.pop()!;
    for (const r of trackRoutes(project.mixer, t)) if (carriesAudio(r)) feed(r.to);
  }
  return fed.flatMap((f, i) => (f && !project.mixer[i].muted ? [i] : []));
}

/** Inserts whose audio reaches `track` (the track itself included). */
function feedersOf(project: Project, track: number): Set<number> {
  const feeds = new Set([track]);
  for (let grew = true; grew; ) {
    grew = false;
    for (let i = 1; i < project.mixer.length; i++) {
      if (!feeds.has(i) && trackRoutes(project.mixer, i).some((r) => carriesAudio(r) && feeds.has(r.to))) {
        feeds.add(i);
        grew = true;
      }
    }
  }
  return feeds;
}

/**
 * The project a stem is rendered from: only `track`'s own output (after its effects and fader) reaches
 * the master, which passes it on unprocessed (effects bypassed, fader at unity). The tracks feeding it
 * keep feeding it, sidechain keys still reach their effects, everything else is silent; automation
 * of the master does not apply.
 */
export function stemProject(project: Project, track: number): Project {
  const feeds = feedersOf(project, track);
  const mixer = project.mixer.map((t, i) => {
    if (i === 0) return { ...t, volume: DEFAULT_SEND, pan: 0, muted: false, solo: false, effects: t.effects.map((e) => ({ ...e, enabled: false })) };
    if (i === track) return { ...t, solo: false, routes: [{ to: 0, level: DEFAULT_SEND }] };
    return { ...t, solo: false, routes: trackRoutes(project.mixer, i).filter((r) => r.to > 0 && feeds.has(r.to)) };
  });
  // Channels playing straight into the master are muted; automation of the master is left out.
  const masterSlots = new Set(project.mixer[0]?.effects.map((e) => e.id) ?? []);
  const onMaster = (target: string | null) => {
    const p = target ? parseTargetKey(target) : null;
    if (!p) return false;
    if (p.scope === 'mx') return p.owner === '0';
    if (p.scope === 'fx') return masterSlots.has(p.owner);
    return p.scope === 'plug' && p.owner.startsWith('fx:') && masterSlots.has(p.owner.slice(3));
  };
  const dropped = new Set(project.channels.filter((c) => c.kind === 'automation' && onMaster(c.automation.target)).map((c) => c.id));
  const channels = project.channels
    .filter((c) => !dropped.has(c.id))
    .map((c) => (c.kind !== 'automation' && c.mixerTrack === 0 ? { ...c, muted: true } : c));
  const clips = dropped.size ? project.clips.filter((c) => !(c.kind === 'automation' && dropped.has(c.channelId))) : project.clips;
  return { ...project, mixer, channels, clips };
}
