import { create } from 'zustand';
import { DEFAULT_VELOCITY, createEmptyProject } from '../model/defaults';
import type { NotePropKey, NoteStyle } from '../model/notes';
import type { SnapId } from '../model/timing';
import type { Id, Project } from '../model/types';

export type ToolId = 'draw' | 'paint' | 'delete' | 'mute' | 'slice' | 'select';
/** Kind of newly drawn notes (FL Studio: slide toggle, portamento notes). */
export type NoteType = 'normal' | 'slide' | 'porta';
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
  /** Length (ticks) of newly drawn notes; follows the last clicked or edited note (FL Studio). */
  noteLength: number;
  /** Velocity of newly drawn notes; follows the last clicked note. */
  noteVelocity: number;
  /** Pan, release, fine pitch and Mod X/Y of newly drawn notes; follow the last clicked note. */
  noteStyle: NoteStyle;
  /** Colour group of newly drawn notes (FL Studio: the piano roll's colour selector). */
  noteColor: number;
  noteType: NoteType;
  /** Note property shown and edited in the event lane under the notes. */
  lane: NotePropKey;
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

/** Channel rack filter (FL Studio's channel group menu). */
export type RackFilter = 'all' | 'instruments' | 'audio' | 'automation';

/** What the playlist draw tool places (FL Studio's picker panel selection). */
export interface PlaylistPick {
  kind: 'pattern' | 'audio' | 'automation';
  /** Pattern id or channel id. */
  id: Id;
}

/** Recording filter (right-click on the record button). */
export interface RecordFilter {
  notes: boolean;
  audio: boolean;
  automation: boolean;
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
  /** FL Studio's main snap in the toolbar; editors set to "Main" follow it. */
  mainSnap: SnapId;
  typingKeyboard: boolean;
  timeDisplay: 'bars' | 'clock';
  hint: string;
  rackFilter: RackFilter;
  /** Picker selection; null = the selected pattern. */
  playlistPick: PlaylistPick | null;
  /** Kinds shown in the playlist picker panel. */
  pickerShow: { pattern: boolean; audio: boolean; automation: boolean };
  /** Last automatable control the user moved (FL: Tools › Last tweaked). */
  lastTweaked: string | null;
}

export interface TransportState {
  playing: boolean;
  mode: PlayMode;
  recording: boolean;
  metronome: boolean;
  /** Where song playback starts (ticks). */
  songStart: number;
  /** Where pattern playback starts (ticks into the pattern; set from the piano roll's ruler). */
  patternStart: number;
  /** Time selection in the playlist (FL Studio: right-drag in the ruler); song playback loops inside it. */
  loop: { start: number; end: number } | null;
  /** Metronome count-in before recording (FL: recording precount, Ctrl+P). */
  precount: boolean;
  recordFilter: RecordFilter;
  /** Input monitoring for armed tracks (FL: Mixer › Disk recording › Monitor external input). */
  monitoring: 'off' | 'armed' | 'on';
  /** Remove the device latency from recordings. */
  latencyCompensation: boolean;
  /** Unarm all tracks after a recording (FL: Auto-unarm). */
  autoUnarm: boolean;
  /** With recording armed, the first live note starts playback (FL: Options › Start on input, Ctrl+I). */
  startOnInput: boolean;
}

export interface AppState {
  project: Project;
  past: Project[];
  /** Undo step names, parallel to `past` / `future`. */
  pastLabels: string[];
  future: Project[];
  futureLabels: string[];
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
      snap: 'main',
      pxPerTick: 0.9,
      rowHeight: 14,
      scrollTick: 0,
      scrollY: 14 * (127 - 84),
      tool: 'draw',
      noteLength: 24,
      noteVelocity: DEFAULT_VELOCITY,
      noteStyle: {},
      noteColor: 0,
      noteType: 'normal',
      lane: 'velocity',
      ghostNotes: true,
    },
    playlist: { snap: 'main', pxPerTick: 0.18, trackHeight: 44, scrollTick: 0, scrollY: 0, tool: 'draw' },
    mainSnap: 'line',
    typingKeyboard: false,
    timeDisplay: 'bars',
    hint: '',
    rackFilter: 'all',
    playlistPick: null,
    pickerShow: { pattern: true, audio: true, automation: true },
    lastTweaked: null,
  };
}

function initialState(): AppState {
  const project = createEmptyProject();
  return {
    project,
    past: [],
    pastLabels: [],
    future: [],
    futureLabels: [],
    coalesceKey: null,
    dirty: false,
    fileName: null,
    ui: initialUi(project),
    transport: {
      playing: false,
      mode: 'pattern',
      recording: false,
      metronome: false,
      songStart: 0,
      patternStart: 0,
      loop: null,
      precount: false,
      recordFilter: { notes: true, audio: true, automation: true },
      monitoring: 'off',
      latencyCompensation: true,
      autoUnarm: false,
      startOnInput: false,
    },
    sampleRevision: 0,
    audioReady: false,
  };
}

export const useStore = create<AppState>(() => initialState());

/** Resets the whole store; used by tests. */
export function resetStore(): void {
  useStore.setState(initialState(), true);
}
