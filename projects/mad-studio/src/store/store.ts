import { create } from 'zustand';
import { createEmptyProject } from '../model/defaults';
import type { SnapId } from '../model/timing';
import type { Id, Project } from '../model/types';

export type ToolId = 'draw' | 'paint' | 'delete' | 'select';
export type PlayMode = 'pattern' | 'song';

/** Fixed windows plus dynamic ones: `channel:<channelId>` and `effect:<mixerIndex>:<slotId>`. */
export type WindowId = 'playlist' | 'channelRack' | 'pianoRoll' | 'mixer' | `channel:${string}` | `effect:${string}`;

export interface WindowState {
  open: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  maximized?: boolean;
}

export interface PianoRollView {
  snap: SnapId;
  pxPerTick: number;
  rowHeight: number;
  scrollTick: number;
  scrollY: number;
  tool: ToolId;
  /** Length (ticks) of newly drawn notes; follows the last edited note. */
  noteLength: number;
  ghostNotes: boolean;
}

export interface PlaylistView {
  snap: SnapId;
  pxPerTick: number;
  trackHeight: number;
  scrollTick: number;
  scrollY: number;
  tool: ToolId;
}

export interface UiState {
  selectedPatternId: Id;
  selectedChannelId: Id | null;
  pianoRollChannelId: Id | null;
  selectedMixerTrack: number;
  windows: Record<string, WindowState>;
  topZ: number;
  focusedWindow: string | null;
  browserOpen: boolean;
  browserWidth: number;
  pianoRoll: PianoRollView;
  playlist: PlaylistView;
  typingKeyboard: boolean;
  timeDisplay: 'bars' | 'clock';
  hint: string;
}

export interface TransportState {
  playing: boolean;
  mode: PlayMode;
  recording: boolean;
  metronome: boolean;
  /** Where song playback starts (ticks). */
  songStart: number;
}

export interface AppState {
  project: Project;
  past: Project[];
  future: Project[];
  /** Consecutive edits with the same key merge into one undo step (knob drags etc.). */
  coalesceKey: string | null;
  dirty: boolean;
  fileName: string | null;
  ui: UiState;
  transport: TransportState;
  /** Bumped whenever audio data in the sample pool changes. */
  sampleRevision: number;
  audioReady: boolean;
}

export const MAX_UNDO = 200;

export function defaultWindows(width = 1400, height = 820): Record<string, WindowState> {
  const w = Math.max(width, 900);
  const h = Math.max(height, 560);
  return {
    playlist: { open: true, x: 0, y: 0, w, h, z: 1, maximized: true },
    channelRack: { open: true, x: 36, y: 34, w: Math.min(780, w - 72), h: Math.min(440, h - 60), z: 3 },
    pianoRoll: { open: false, x: 70, y: 60, w: Math.min(980, w - 100), h: Math.min(520, h - 90), z: 2 },
    mixer: { open: false, x: 50, y: Math.max(40, h - 430), w: Math.min(1060, w - 80), h: 400, z: 2 },
  };
}

export function initialUi(project: Project): UiState {
  return {
    selectedPatternId: project.patterns[0]?.id ?? '',
    selectedChannelId: project.channels[0]?.id ?? null,
    pianoRollChannelId: project.channels[0]?.id ?? null,
    selectedMixerTrack: 0,
    windows: defaultWindows(),
    topZ: 3,
    focusedWindow: 'channelRack',
    browserOpen: true,
    browserWidth: 220,
    pianoRoll: {
      snap: 'step',
      pxPerTick: 0.9,
      rowHeight: 14,
      scrollTick: 0,
      scrollY: 14 * (127 - 84),
      tool: 'draw',
      noteLength: 24,
      ghostNotes: true,
    },
    playlist: { snap: 'beat', pxPerTick: 0.18, trackHeight: 44, scrollTick: 0, scrollY: 0, tool: 'draw' },
    typingKeyboard: false,
    timeDisplay: 'bars',
    hint: '',
  };
}

function initialState(): AppState {
  const project = createEmptyProject();
  return {
    project,
    past: [],
    future: [],
    coalesceKey: null,
    dirty: false,
    fileName: null,
    ui: initialUi(project),
    transport: { playing: false, mode: 'pattern', recording: false, metronome: false, songStart: 0 },
    sampleRevision: 0,
    audioReady: false,
  };
}

export const useStore = create<AppState>(() => initialState());

/** Resets the whole store; used by tests. */
export function resetStore(): void {
  useStore.setState(initialState(), true);
}
