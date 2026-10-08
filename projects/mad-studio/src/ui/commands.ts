import { engine } from '../audio/engine';
import { findPattern } from '../model/patterns';
import { isMac } from '../platform/platform';
import { importSamplesDialog, newProject, openDemo, openProjectDialog, saveProject } from '../project/projectIO';
import {
  addPattern,
  clonePattern,
  deletePattern,
  redo,
  renamePattern,
  renameProject,
  setChannelProps,
  setTransport,
  setUi,
  soloChannel,
  stepPattern,
  togglePlayMode,
  undo,
} from '../store/actions';
import { createAutomationClip } from '../store/automationActions';
import { useStore } from '../store/store';
import { confirmDialog, openDialog, promptDialog, toast } from './overlays';
import { closeWindow, focusWindow, openWindow, toggleMaximize, toggleWindow } from './workspace/windows';

export type CommandId =
  | 'new'
  | 'open'
  | 'demo'
  | 'save'
  | 'saveAs'
  | 'export'
  | 'importSamples'
  | 'projectInfo'
  | 'saveNewVersion'
  | 'undo'
  | 'redo'
  | 'undoToggle'
  | 'playPause'
  | 'pause'
  | 'stop'
  | 'panic'
  | 'gotoStart'
  | 'toggleMode'
  | 'record'
  | 'metronome'
  | 'precount'
  | 'typingKeyboard'
  | 'newPattern'
  | 'newPatternNamed'
  | 'lastTweakedAutomation'
  | 'pluginPicker'
  | 'audioSettings'
  | 'closeAllWindows'
  | 'togglePlaylistMax'
  | 'clonePattern'
  | 'renamePattern'
  | 'deletePattern'
  | 'nextPattern'
  | 'prevPattern'
  | 'window:playlist'
  | 'window:channelRack'
  | 'window:pianoRoll'
  | 'window:mixer'
  | 'toggleBrowser'
  | 'shortcuts'
  | 'about';

const mod = isMac ? '⌘' : 'Ctrl+';
const shift = isMac ? '⇧' : 'Shift+';
const alt = isMac ? '⌥' : 'Alt+';

/** Shortcuts follow FL Studio's defaults (Ctrl is Cmd on the Mac). */
export const SHORTCUTS: Partial<Record<CommandId, string>> = {
  open: `${mod}O`,
  save: `${mod}S`,
  saveAs: `${shift}${mod}S`,
  saveNewVersion: `${mod}N`,
  export: `${mod}R`,
  undoToggle: `${mod}Z`,
  undo: `${alt}${mod}Z`,
  redo: `${shift}${mod}Z`,
  playPause: 'Space',
  // macOS reserves ⌘Space (Spotlight) and ⌘H (Hide); the Control key works there.
  pause: isMac ? '⌃Space' : 'Ctrl+Space',
  panic: isMac ? '⌃H' : 'Ctrl+H',
  gotoStart: 'Home',
  toggleMode: 'L',
  record: 'R',
  metronome: `${mod}M`,
  precount: `${mod}P`,
  typingKeyboard: `${mod}T`,
  newPattern: `${mod}F4`,
  newPatternNamed: 'F4',
  renamePattern: 'F2',
  nextPattern: '+',
  prevPattern: '−',
  'window:playlist': 'F5',
  'window:channelRack': 'F6',
  'window:pianoRoll': 'F7',
  pluginPicker: 'F8',
  toggleBrowser: `${alt}F8`,
  'window:mixer': 'F9',
  closeAllWindows: 'F12',
  togglePlaylistMax: 'Enter',
  shortcuts: 'F1',
};

/** Ctrl/Cmd+Z in FL Studio undoes the last edit, pressed again it redoes it. */
let toggledUndo = false;

/** Mute (or with `solo` solo) the n-th channel of the rack (FL: keys 1–0, Ctrl+1–0). */
export function muteChannelByIndex(index: number, solo: boolean): void {
  const ch = useStore.getState().project.channels[index];
  if (!ch) return;
  if (solo) soloChannel(ch.id);
  else setChannelProps(ch.id, { muted: !ch.muted });
}

export async function runCommand(id: CommandId): Promise<void> {
  const s = useStore.getState();
  switch (id) {
    case 'new':
      return newProject();
    case 'open':
      return openProjectDialog();
    case 'demo':
      return openDemo();
    case 'save':
      await saveProject(false);
      return;
    case 'saveNewVersion':
      await saveProject(false, true);
      return;
    case 'saveAs':
      await saveProject(true);
      return;
    case 'export':
      openDialog('export');
      return;
    case 'importSamples':
      await importSamplesDialog();
      return;
    case 'projectInfo': {
      const name = await promptDialog('Project name', s.project.name);
      if (name) renameProject(name);
      return;
    }
    case 'undo':
      toggledUndo = false;
      return undo();
    case 'redo':
      toggledUndo = false;
      return redo();
    case 'undoToggle':
      if (toggledUndo && s.future.length > 0) {
        toggledUndo = false;
        return redo();
      }
      toggledUndo = s.past.length > 0;
      return undo();
    case 'playPause':
      return engine.togglePlay();
    case 'pause': {
      // Start/pause: stopping keeps the song position so playback continues from there.
      if (!engine.playing) return void engine.play();
      const tick = engine.playheadTick();
      engine.stop();
      if (tick !== null && s.transport.mode === 'song') engine.seek(tick);
      return;
    }
    case 'stop':
      engine.stop();
      return;
    case 'panic':
      engine.stop();
      engine.panic();
      return;
    case 'gotoStart':
      engine.seek(0);
      return;
    case 'toggleMode':
      return togglePlayMode();
    case 'record':
      return setTransport({ recording: !s.transport.recording });
    case 'metronome':
      return setTransport({ metronome: !s.transport.metronome });
    case 'precount':
      setTransport({ precount: !s.transport.precount });
      toast(`Recording precount ${!s.transport.precount ? 'on' : 'off'}`);
      return;
    case 'typingKeyboard':
      return setUi((d) => {
        d.typingKeyboard = !d.typingKeyboard;
      });
    case 'newPattern':
      addPattern();
      return;
    case 'newPatternNamed': {
      const id = addPattern();
      const p = findPattern(useStore.getState().project, id);
      const name = await promptDialog('Pattern name', p?.name ?? '');
      if (name) renamePattern(id, name);
      return;
    }
    case 'lastTweakedAutomation': {
      const target = s.ui.lastTweaked;
      if (!target) toast('Move a control first, then use “Last tweaked”.', 'error');
      else if (createAutomationClip(target)) toast('Automation clip created for the last tweaked control.');
      return;
    }
    case 'pluginPicker':
      openDialog('plugins');
      return;
    case 'audioSettings':
      openDialog('audio');
      return;
    case 'closeAllWindows':
      for (const [id, w] of Object.entries(s.ui.windows)) if (w.open && id !== 'playlist') closeWindow(id);
      return;
    case 'togglePlaylistMax':
      openWindow('playlist');
      toggleMaximize('playlist');
      focusWindow('playlist');
      return;
    case 'clonePattern':
      clonePattern(s.ui.selectedPatternId);
      return;
    case 'renamePattern': {
      const p = findPattern(s.project, s.ui.selectedPatternId);
      if (!p) return;
      const name = await promptDialog('Rename pattern', p.name);
      if (name) renamePattern(p.id, name);
      return;
    }
    case 'deletePattern': {
      const p = findPattern(s.project, s.ui.selectedPatternId);
      if (!p) return;
      const used = s.project.clips.some((c) => c.kind === 'pattern' && c.patternId === p.id);
      if (await confirmDialog('Delete pattern', `Delete "${p.name}"${used ? ' and its clips in the playlist' : ''}?`, 'Delete', true)) {
        deletePattern(p.id);
      }
      return;
    }
    case 'nextPattern':
      return stepPattern(1);
    case 'prevPattern':
      return stepPattern(-1);
    case 'window:playlist':
      return toggleWindow('playlist');
    case 'window:channelRack':
      return toggleWindow('channelRack');
    case 'window:pianoRoll':
      return toggleWindow('pianoRoll');
    case 'window:mixer':
      return toggleWindow('mixer');
    case 'toggleBrowser':
      return setUi((d) => {
        d.browserOpen = !d.browserOpen;
      });
    case 'shortcuts':
      return openDialog('shortcuts');
    case 'about':
      return openDialog('about');
  }
}
