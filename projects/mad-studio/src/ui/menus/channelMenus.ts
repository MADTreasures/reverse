import { PALETTE, PALETTE_NAMES } from '../../model/colors';
import { createSamplerChannel } from '../../model/defaults';
import { FACTORY_SAMPLES } from '../../model/factory';
import { findPattern, patternSteps } from '../../model/patterns';
import { SYNTH_PRESETS } from '../../model/presets';
import type { Channel } from '../../model/types';
import { addSamplerChannelFor, importSamplesDialog } from '../../project/projectIO';
import {
  addChannel,
  addFactoryChannel,
  addSynthChannel,
  clearChannelNotes,
  cloneChannel,
  deleteChannel,
  fillSteps,
  firstFreeInsert,
  moveChannel,
  setChannelProps,
  soloChannel,
} from '../../store/actions';
import { useStore } from '../../store/store';
import { confirmDialog, promptDialog, type MenuItem } from '../overlays';
import { openChannelEditor, openPianoRoll } from '../workspace/windows';

function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    map.set(k, [...(map.get(k) ?? []), it]);
  }
  return [...map.entries()];
}

export function addChannelMenu(): MenuItem[] {
  return [
    {
      label: 'Synth',
      submenu: [
        { label: 'Init synth', onClick: () => addSynthChannel() },
        { separator: true },
        ...groupBy(SYNTH_PRESETS, (p) => p.category).map(([cat, presets]) => ({
          label: cat,
          submenu: presets.map((p) => ({ label: p.name, onClick: () => addSynthChannel(p.id) })),
        })),
      ],
    },
    {
      label: 'Drums & FX',
      submenu: groupBy(FACTORY_SAMPLES, (s) => s.category).map(([cat, list]) => ({
        label: cat,
        submenu: list.map((s) => ({ label: s.name, onClick: () => addFactoryChannel(s.key) })),
      })),
    },
    { label: 'Empty sampler', onClick: () => addChannel(createSamplerChannel({ name: 'Sampler', sampleId: null, color: PALETTE[0] })) },
    { separator: true },
    {
      label: 'Import audio files…',
      onClick: async () => {
        for (const s of await importSamplesDialog()) addSamplerChannelFor(s.info);
      },
    },
  ];
}

export function channelContextMenu(channel: Channel): MenuItem[] {
  const s = useStore.getState();
  const patternId = s.ui.selectedPatternId;
  const pattern = findPattern(s.project, patternId);
  const steps = pattern ? patternSteps(pattern, s.project.beatsPerBar) : 16;
  return [
    { label: 'Edit instrument…', onClick: () => openChannelEditor(channel.id) },
    { label: 'Piano roll', shortcut: 'F7', onClick: () => openPianoRoll(channel.id) },
    { separator: true },
    {
      label: 'Rename…',
      onClick: async () => {
        const name = await promptDialog('Rename channel', channel.name);
        if (name) setChannelProps(channel.id, { name });
      },
    },
    {
      label: 'Color',
      submenu: PALETTE.map((c, i) => ({ label: PALETTE_NAMES[i], swatch: c, onClick: () => setChannelProps(channel.id, { color: c }) })),
    },
    { label: 'Clone', onClick: () => cloneChannel(channel.id) },
    { label: 'Move up', onClick: () => moveChannel(channel.id, -1) },
    { label: 'Move down', onClick: () => moveChannel(channel.id, 1) },
    { separator: true },
    { label: 'Solo', onClick: () => soloChannel(channel.id) },
    { label: 'Route to free mixer track', onClick: () => setChannelProps(channel.id, { mixerTrack: firstFreeInsert(useStore.getState().project) || channel.mixerTrack }) },
    { separator: true },
    { label: 'Fill each 2 steps', onClick: () => fillSteps(patternId, channel.id, 2, steps) },
    { label: 'Fill each 4 steps', onClick: () => fillSteps(patternId, channel.id, 4, steps) },
    { label: 'Fill each 8 steps', onClick: () => fillSteps(patternId, channel.id, 8, steps) },
    { label: 'Clear notes in pattern', onClick: () => clearChannelNotes(patternId, channel.id) },
    { separator: true },
    {
      label: 'Delete channel',
      danger: true,
      onClick: async () => {
        if (await confirmDialog('Delete channel', `Delete "${channel.name}" and all its notes?`, 'Delete', true)) deleteChannel(channel.id);
      },
    },
  ];
}
