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
  setTransport,
  setUi,
  stepPattern,
  togglePlayMode,
  undo,
} from '../store/actions';
import { useStore } from '../store/store';
import { confirmDialog, openDialog, promptDialog } from './overlays';
import { toggleWindow } from './workspace/windows';

export type CommandId =
  | 'new'
  | 'open'
  | 'demo'
  | 'save'
  | 'saveAs'
  | 'export'
  | 'importSamples'
  | 'projectInfo'
  | 'undo'
  | 'redo'
  | 'playPause'
  | 'stop'
  | 'toggleMode'
  | 'record'
  | 'metronome'
  | 'typingKeyboard'
  | 'newPattern'
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

export const SHORTCUTS: Partial<Record<CommandId, string>> = {
  new: `${mod}N`,
  open: `${mod}O`,
  save: `${mod}S`,
  saveAs: `${shift}${mod}S`,
  export: `${mod}R`,
  undo: `${mod}Z`,
  redo: `${shift}${mod}Z`,
  playPause: 'Space',
  toggleMode: 'L',
  record: 'R',
  metronome: 'M',
  typingKeyboard: `${mod}T`,
  newPattern: `${mod}F4`,
  nextPattern: ']',
  prevPattern: '[',
  'window:playlist': 'F5',
  'window:channelRack': 'F6',
  'window:pianoRoll': 'F7',
  toggleBrowser: 'F8',
  'window:mixer': 'F9',
  shortcuts: 'F1',
};

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
      return undo();
    case 'redo':
      return redo();
    case 'playPause':
      return engine.togglePlay();
    case 'stop':
      engine.stop();
      return;
    case 'toggleMode':
      return togglePlayMode();
    case 'record':
      return setTransport({ recording: !s.transport.recording });
    case 'metronome':
      return setTransport({ metronome: !s.transport.metronome });
    case 'typingKeyboard':
      return setUi((d) => {
        d.typingKeyboard = !d.typingKeyboard;
      });
    case 'newPattern':
      addPattern();
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
