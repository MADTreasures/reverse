import { findPattern, patternLength } from '../model/patterns';
import { gridLineTicks, snapTicks } from '../model/timing';
import type { AppState } from './store';

/** Snap size (ticks) of the piano roll, resolving "Main", "Line" and "Cell" (FL Studio). */
export function pianoRollSnap(s: AppState): number {
  const bpb = s.project.beatsPerBar;
  return snapTicks(s.ui.pianoRoll.snap, bpb, gridLineTicks(s.ui.pianoRoll.pxPerTick, bpb), s.ui.mainSnap);
}

/** Snap size (ticks) of the playlist. */
export function playlistSnap(s: AppState): number {
  const bpb = s.project.beatsPerBar;
  return snapTicks(s.ui.playlist.snap, bpb, gridLineTicks(s.ui.playlist.pxPerTick, bpb), s.ui.mainSnap);
}

/** Where pattern playback starts: the piano roll's position marker, if it lies inside the pattern. */
export function patternStartTick(s: AppState): number {
  const start = s.transport.patternStart;
  const pattern = findPattern(s.project, s.ui.selectedPatternId);
  if (!pattern || start <= 0) return 0;
  return start < patternLength(pattern, s.project.beatsPerBar) ? start : 0;
}
