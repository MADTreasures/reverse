/**
 * Mixer routing (FL Studio: a track's route switches and send knobs, "Route to this track only",
 * "Sidechain to this track"). Sends take the track's output after its fader. A sidechain link is a
 * send whose level starts at 0 that also feeds the target's sidechain bus at unity, where effects
 * with a sidechain input (the compressor's Sidechain switch) listen to it. Both engines process the
 * tracks in `processingOrder()`.
 */
import type { MixerRoute, MixerTrack, Project } from './types';

/** Send level knob default (0.8 = unity, like the faders). */
export const DEFAULT_SEND = 0.8;
/** Level of a new sidechain link (FL Studio: "a send link with the send volume set to 0"). */
export const SIDECHAIN_SEND = 0;

/** Where a track sends its audio: its routes, or the master at unity when it has none set. */
export function trackRoutes(mixer: readonly MixerTrack[], index: number): MixerRoute[] {
  if (index <= 0) return [];
  return mixer[index]?.routes ?? [{ to: 0, level: DEFAULT_SEND }];
}

/** True when sending `from` → `to` would close a loop (a track can never feed itself). */
export function wouldCycle(mixer: readonly MixerTrack[], from: number, to: number): boolean {
  if (from === to) return true;
  // Is `from` reachable from `to`? Sidechain sends count too: the target has to wait for its source.
  const seen = new Set<number>();
  const stack = [to];
  while (stack.length) {
    const t = stack.pop()!;
    if (t === from) return true;
    if (seen.has(t)) continue;
    seen.add(t);
    for (const r of trackRoutes(mixer, t)) stack.push(r.to);
  }
  return false;
}

/**
 * Track indices in processing order: every track after all tracks that send to it, the master last.
 * Tracks keep their index order where routing does not force otherwise.
 */
export function processingOrder(mixer: readonly MixerTrack[]): number[] {
  const n = mixer.length;
  const incoming = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) for (const r of trackRoutes(mixer, i)) if (r.to >= 0 && r.to < n) incoming[r.to]++;
  const order: number[] = [];
  const done = new Array<boolean>(n).fill(false);
  // Kahn's algorithm, always taking the lowest ready index (stable and deterministic).
  for (let k = 0; k < n; k++) {
    let next = -1;
    for (let i = 1; i < n; i++) {
      if (!done[i] && incoming[i] === 0) {
        next = i;
        break;
      }
    }
    if (next < 0) break;
    done[next] = true;
    order.push(next);
    for (const r of trackRoutes(mixer, next)) if (r.to >= 0 && r.to < n) incoming[r.to]--;
  }
  // Anything left over (only possible with a corrupt cycle) is processed in index order.
  for (let i = 1; i < n; i++) if (!done[i]) order.push(i);
  if (n > 0) order.push(0);
  return order;
}

/**
 * Removes routes that point nowhere, at the track itself, twice to the same target or into a loop.
 * Tracks are checked in index order against the routes accepted so far, so of two routes closing a
 * loop the one on the lower track stays.
 */
export function sanitizeRoutes(mixer: MixerTrack[]): void {
  const accepted: MixerRoute[][] = mixer.map(() => []);
  const reaches = (from: number, goal: number): boolean => {
    const seen = new Set<number>();
    const stack = [from];
    while (stack.length) {
      const t = stack.pop()!;
      if (t === goal) return true;
      if (seen.has(t)) continue;
      seen.add(t);
      for (const r of accepted[t] ?? []) stack.push(r.to);
    }
    return false;
  };
  if (mixer.length > 0) delete mixer[0].routes;
  for (let i = 1; i < mixer.length; i++) {
    const t = mixer[i];
    for (const r of trackRoutes(mixer, i)) {
      if (!(r.to >= 0 && r.to < mixer.length) || r.to === i || accepted[i].some((k) => k.to === r.to)) continue;
      if (reaches(r.to, i)) continue;
      accepted[i].push({ to: r.to, level: Math.min(1, Math.max(0, r.level)), ...(r.sidechain ? { sidechain: true } : {}) });
    }
    const kept = accepted[i];
    if (kept.length === 1 && kept[0].to === 0 && kept[0].level === DEFAULT_SEND && !kept[0].sidechain) delete t.routes;
    else t.routes = kept;
  }
}

/** Tracks that send sidechain audio to `index`. */
export function sidechainSources(mixer: readonly MixerTrack[], index: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < mixer.length; i++) if (trackRoutes(mixer, i).some((r) => r.to === index && r.sidechain)) out.push(i);
  return out;
}

export function routesOf(project: Project, index: number): MixerRoute[] {
  return trackRoutes(project.mixer, index);
}

/** True when the route carries audio into the target's input (not just a sidechain key). */
export function carriesAudio(route: MixerRoute): boolean {
  return !route.sidechain || route.level > 0;
}

/**
 * Which tracks are heard: all when nothing is soloed; else the master, the soloed tracks and every track
 * a soloed track's audio passes through on its way to the master.
 */
export function audibleTracks(mixer: readonly MixerTrack[]): boolean[] {
  const soloed = mixer.map((t, i) => i > 0 && t.solo);
  if (!soloed.some(Boolean)) return mixer.map(() => true);
  const audible = soloed.slice();
  if (audible.length > 0) audible[0] = true;
  const stack = soloed.flatMap((s, i) => (s ? [i] : []));
  while (stack.length) {
    const t = stack.pop()!;
    for (const r of trackRoutes(mixer, t)) {
      if (!carriesAudio(r) || r.to < 0 || r.to >= mixer.length || audible[r.to]) continue;
      audible[r.to] = true;
      stack.push(r.to);
    }
  }
  return audible;
}

/** Tracks connected to `index` by routing, in both directions (FL Studio: Alt+click solo). */
export function routedNeighbours(mixer: readonly MixerTrack[], index: number): number[] {
  const out = new Set<number>();
  for (const r of trackRoutes(mixer, index)) if (r.to > 0) out.add(r.to);
  for (let i = 1; i < mixer.length; i++) if (trackRoutes(mixer, i).some((r) => r.to === index)) out.add(i);
  out.delete(index);
  return [...out].sort((a, b) => a - b);
}
