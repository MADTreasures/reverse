import { PALETTE, PALETTE_NAMES } from '../../model/colors';
import { createSamplerChannel } from '../../model/defaults';
import { FACTORY_SAMPLES } from '../../model/factory';
import { findPattern, patternSteps } from '../../model/patterns';
import { SYNTH_PRESETS } from '../../model/presets';
import type { Channel, Note } from '../../model/types';
import { addSamplerChannelFor, assignSampleToChannel, importSamplesDialog } from '../../project/projectIO';
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
  replaceChannelNotes,
  rotateSteps,
  setChannelProps,
  soloChannel,
} from '../../store/actions';
import { useStore } from '../../store/store';
import { createAutomationChannel } from '../../model/defaults';
import { confirmDialog, openDialog, promptDialog, type MenuItem } from '../overlays';
import { openChannelEditor, openPianoRoll } from '../workspace/windows';
import { instrumentPluginItems } from './pluginMenus';

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
    { label: 'More plugins…', onClick: () => openDialog('plugins') },
    { separator: true },
    { label: 'Plugins (VST3 / AU)', submenu: instrumentPluginItems() },
    {
      label: 'Automation clip',
      onClick: () => {
        const id = addChannel(createAutomationChannel({ name: 'Automation', target: null, value: 0.5, length: 384 }), { autoMixer: false });
        openChannelEditor(id);
      },
    },
    { separator: true },
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

/** Notes copied with the channel menu's Cut/Copy (FL Studio), pasted into any channel. */
let channelClipboard: Omit<Note, 'id'>[] | null = null;

function randomColor(current: string): string {
  const choices = PALETTE.filter((c) => c !== current);
  return choices[Math.floor(Math.random() * choices.length)] ?? PALETTE[0];
}

export function channelContextMenu(channel: Channel): MenuItem[] {
  const s = useStore.getState();
  const patternId = s.ui.selectedPatternId;
  const pattern = findPattern(s.project, patternId);
  const steps = pattern ? patternSteps(pattern, s.project.beatsPerBar) : 16;
  const notes = pattern?.notes[channel.id] ?? [];
  if (channel.kind === 'automation') {
    return [
      { label: channel.name, header: true },
      { label: 'Edit automation…', onClick: () => openChannelEditor(channel.id) },
      {
        label: 'Rename…',
        onClick: async () => {
          const name = await promptDialog('Rename automation clip', channel.name);
          if (name) setChannelProps(channel.id, { name });
        },
      },
      { label: 'Color', submenu: PALETTE.map((c, i) => ({ label: PALETTE_NAMES[i], swatch: c, onClick: () => setChannelProps(channel.id, { color: c }) })) },
      { label: 'Clone', onClick: () => cloneChannel(channel.id) },
      { separator: true },
      {
        label: 'Delete…',
        danger: true,
        onClick: async () => {
          if (await confirmDialog('Delete automation clip', `Delete "${channel.name}" and all its clips?`, 'Delete', true)) deleteChannel(channel.id);
        },
      },
    ];
  }
  return [
    { label: channel.name, header: true },
    { label: channel.kind === 'plugin' ? 'Plugin settings…' : 'Edit instrument…', onClick: () => openChannelEditor(channel.id) },
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
    { label: 'Random color', onClick: () => setChannelProps(channel.id, { color: randomColor(channel.color) }) },
    ...(channel.kind === 'sampler'
      ? [
          {
            label: 'Load sample…',
            onClick: async () => {
              const [first] = await importSamplesDialog();
              if (first) assignSampleToChannel(channel.id, first.info);
            },
          },
        ]
      : []),
    { label: 'Clone', onClick: () => cloneChannel(channel.id) },
    { label: 'Move up', onClick: () => moveChannel(channel.id, -1) },
    { label: 'Move down', onClick: () => moveChannel(channel.id, 1) },
    { separator: true },
    { label: 'Solo', onClick: () => soloChannel(channel.id) },
    { label: 'Route to free mixer track', onClick: () => setChannelProps(channel.id, { mixerTrack: firstFreeInsert(useStore.getState().project) || channel.mixerTrack }) },
    { separator: true },
    // FL Studio: Cut / Copy / Paste act on this channel's notes in the current pattern.
    {
      label: 'Cut',
      disabled: notes.length === 0,
      onClick: () => {
        channelClipboard = notes.map(({ id: _id, ...n }) => n);
        clearChannelNotes(patternId, channel.id);
      },
    },
    { label: 'Copy', disabled: notes.length === 0, onClick: () => void (channelClipboard = notes.map(({ id: _id, ...n }) => n)) },
    {
      label: 'Paste',
      disabled: !channelClipboard?.length,
      onClick: () => {
        if (channelClipboard) replaceChannelNotes(patternId, channel.id, channelClipboard);
      },
    },
    { separator: true },
    { label: 'Fill each 2 steps', onClick: () => fillSteps(patternId, channel.id, 2, steps) },
    { label: 'Fill each 4 steps', onClick: () => fillSteps(patternId, channel.id, 4, steps) },
    { label: 'Fill each 8 steps', onClick: () => fillSteps(patternId, channel.id, 8, steps) },
    { label: 'Rotate left', shortcut: 'Shift+Ctrl+←', onClick: () => rotateSteps(patternId, channel.id, -1) },
    { label: 'Rotate right', shortcut: 'Shift+Ctrl+→', onClick: () => rotateSteps(patternId, channel.id, 1) },
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
