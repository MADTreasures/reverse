import { memo } from 'react';
import { mixerTarget } from '../../model/automationTargets';
import { PALETTE, PALETTE_NAMES } from '../../model/colors';
import { EFFECT_SPECS } from '../../model/effects';
import { formatDb, formatPan, volumeToGain } from '../../model/timing';
import type { EffectSlot, MixerTrack, TrackInput } from '../../model/types';
import { inputChannelNames, usePlugins } from '../../plugins/pluginStore';
import {
  MAX_EFFECT_SLOTS,
  addMixerTrack,
  disarmAllTracks,
  moveEffect,
  removeEffect,
  selectMixerTrack,
  setMixerTrackProps,
  setTrackArmed,
  setTrackInput,
  setTransport,
  toggleEffect,
} from '../../store/actions';
import { useStore } from '../../store/store';
import { Fader } from '../controls/Fader';
import { IconMixer, IconPlus } from '../controls/Icons';
import { Knob } from '../controls/Knob';
import { Meter } from '../controls/Meter';
import { effectSlotMenu } from '../menus/pluginMenus';
import { openDialog, promptDialog, showMenu, type MenuItem } from '../overlays';
import { WindowFrame } from '../workspace/WindowFrame';
import { openEffectEditor } from '../workspace/windows';

const FADER_H = 150;

/** Name of a track input as FL Studio shows it ("In 1 - In 2", "In 3"). */
export function inputLabel(input: TrackInput | null, names = inputChannelNames()): string {
  if (!input) return '(none)';
  const [kind, n] = input.split(':');
  const i = Number(n);
  const name = (k: number) => names[k] ?? `In ${k + 1}`;
  return kind === 'stereo' ? `${name(i)} - ${name(i + 1)}` : name(i);
}

function inputMenu(index: number, current: TrackInput | null): MenuItem[] {
  const names = inputChannelNames();
  const stereo: MenuItem[] = [];
  for (let i = 0; i + 1 < names.length; i += 2) {
    const id = `stereo:${i}` as TrackInput;
    stereo.push({ label: inputLabel(id, names), radio: true, checked: current === id, onClick: () => setTrackInput(index, id) });
  }
  return [
    { label: 'Stereo', header: true },
    ...stereo,
    { label: 'Mono', header: true },
    ...names.map((_, i) => {
      const id = `mono:${i}` as TrackInput;
      return { label: inputLabel(id, names), radio: true, checked: current === id, onClick: () => setTrackInput(index, id) };
    }),
    { separator: true },
    { label: '(none)', radio: true, checked: current === null, onClick: () => setTrackInput(index, null) },
  ];
}

function mixerMenu(): MenuItem[] {
  const s = useStore.getState();
  const t = s.transport;
  const sel = s.ui.selectedMixerTrack;
  const track = s.project.mixer[sel];
  return [
    { label: 'Options', header: true },
    {
      label: 'Disk recording',
      submenu: [
        { label: 'Latency compensation', checked: t.latencyCompensation, onClick: () => setTransport({ latencyCompensation: !t.latencyCompensation }) },
        { label: 'Auto-unarm', checked: t.autoUnarm, onClick: () => setTransport({ autoUnarm: !t.autoUnarm }) },
        { label: 'Monitor external input', header: true },
        { label: 'Off', radio: true, checked: t.monitoring === 'off', onClick: () => setTransport({ monitoring: 'off' }) },
        { label: 'When armed', radio: true, checked: t.monitoring === 'armed', onClick: () => setTransport({ monitoring: 'armed' }) },
        { label: 'On', radio: true, checked: t.monitoring === 'on', onClick: () => setTransport({ monitoring: 'on' }) },
      ],
    },
    { label: 'Audio settings…', onClick: () => openDialog('audio') },
    { label: `Mixer track (${track?.name ?? ''})`, header: true },
    {
      label: 'Rename…',
      shortcut: 'F2',
      onClick: async () => {
        const name = await promptDialog('Rename mixer track', track?.name ?? '');
        if (name) setMixerTrackProps(sel, { name });
      },
    },
    { label: 'Arm selected track', disabled: sel === 0, onClick: () => setTrackArmed(sel, true) },
    { label: 'Disarm all tracks', onClick: () => disarmAllTracks() },
    { separator: true },
    { label: 'Insert one track', onClick: () => addMixerTrack() },
  ];
}

export function Mixer() {
  const tracks = useStore((s) => s.project.mixer);
  const selectedIndex = useStore((s) => s.ui.selectedMixerTrack);
  const toolbar = (
    <>
      <button className="btn" data-hint="Mixer menu" onClick={(e) => showMenu(e, mixerMenu())}>
        ▾ Menu
      </button>
      <button className="btn" data-hint="Add an insert track" onClick={() => addMixerTrack()}>
        <IconPlus size={11} /> Track
      </button>
    </>
  );
  return (
    <WindowFrame id="mixer" title="Mixer" icon={<IconMixer />} toolbar={toolbar}>
      <div className="mixer">
        <div className="mixer-strips">
          {tracks.map((t, i) => (
            <Strip key={t.id} track={t} index={i} selected={i === selectedIndex} />
          ))}
        </div>
        <TrackInspector index={Math.min(selectedIndex, tracks.length - 1)} />
      </div>
    </WindowFrame>
  );
}

function trackMenu(track: MixerTrack, index: number): MenuItem[] {
  return [
    { label: track.name, header: true },
    {
      label: 'Rename…',
      shortcut: 'F2',
      onClick: async () => {
        const name = await promptDialog('Rename mixer track', track.name);
        if (name) setMixerTrackProps(index, { name });
      },
    },
    { label: 'Color', submenu: PALETTE.map((c, i) => ({ label: PALETTE_NAMES[i], swatch: c, onClick: () => setMixerTrackProps(index, { color: c }) })) },
    ...(index > 0
      ? [
          { label: 'Disk recording', header: true },
          { label: 'Input', submenu: inputMenu(index, track.input) },
          { label: track.armed ? 'Disarm' : 'Arm for recording', onClick: () => setTrackArmed(index, !track.armed) },
        ]
      : []),
    { separator: true },
    { label: 'Add effect', submenu: effectSlotMenu(index, null) },
  ];
}

const Strip = memo(function Strip({ track, index, selected }: { track: MixerTrack; index: number; selected: boolean }) {
  const isMaster = index === 0;
  const activeFx = track.effects.filter((e) => e.enabled).length;
  return (
    <div
      className={`strip ${isMaster ? 'master' : ''} ${selected ? 'selected' : ''} ${track.armed ? 'armed' : ''}`}
      onPointerDown={() => selectMixerTrack(index)}
      onContextMenu={(e) => {
        e.preventDefault();
        showMenu(e, trackMenu(track, index));
      }}
    >
      <span className="strip-num">{isMaster ? 'M' : index}</span>
      <button
        className="strip-name"
        style={{ ['--tc' as string]: track.color }}
        data-hint={`${track.name} – double-click to rename`}
        onDoubleClick={async () => {
          const name = await promptDialog('Rename mixer track', track.name);
          if (name) setMixerTrackProps(index, { name });
        }}
      >
        {track.name}
      </button>
      <span className="strip-fx-count">{activeFx ? `FX ${activeFx}` : track.input ? inputLabel(track.input) : ''}</span>
      <button
        className={`mute-led ${track.muted ? '' : 'on'} ${track.solo ? 'solo' : ''}`}
        data-hint={isMaster ? 'Mute master' : 'Mute (Ctrl/Cmd+click: solo)'}
        onClick={(e) =>
          !isMaster && (e.metaKey || e.ctrlKey) ? setMixerTrackProps(index, { solo: !track.solo }) : setMixerTrackProps(index, { muted: !track.muted })
        }
      />
      <Knob
        size={24}
        label={`${track.name} pan`}
        value={track.pan}
        min={-1}
        max={1}
        defaultValue={0}
        bipolar
        format={formatPan}
        target={mixerTarget(index, 'pan')}
        onChange={(v, g) => setMixerTrackProps(index, { pan: v }, { coalesce: g })}
      />
      <div className="strip-fader-row">
        <Fader
          value={track.volume}
          height={FADER_H}
          label={`${track.name} volume`}
          target={mixerTarget(index, 'volume')}
          onChange={(v, g) => setMixerTrackProps(index, { volume: v }, { coalesce: g })}
        />
        <Meter trackIndex={index} width={10} height={FADER_H} />
      </div>
      <span className="strip-db">{formatDb(volumeToGain(track.volume)).replace(' dB', '')}</span>
      {isMaster ? (
        <span className="arm-dot placeholder" />
      ) : (
        <button
          className={`arm-dot ${track.armed ? 'on' : ''}`}
          data-hint={track.armed ? 'Armed for recording – click to disarm' : 'Arm for audio recording (choose an input in the track inspector)'}
          onClick={(e) => {
            e.stopPropagation();
            setTrackArmed(index, !track.armed);
          }}
        />
      )}
    </div>
  );
});

function slotName(slot: EffectSlot): string {
  return slot.type === 'plugin' ? (slot.plugin?.name ?? 'Plugin') : EFFECT_SPECS[slot.type].name;
}

/** FL Studio's track inspector: input, ten effect slots, output. */
function TrackInspector({ index }: { index: number }) {
  const track = useStore((s) => s.project.mixer[index]);
  const channels = useStore((s) => s.project.channels);
  const device = usePlugins((s) => s.device);
  if (!track) return null;
  const routed = channels.filter((c) => c.kind !== 'automation' && c.mixerTrack === index).map((c) => c.name);
  const slots = Array.from({ length: MAX_EFFECT_SLOTS }, (_, i) => track.effects[i] ?? null);
  return (
    <div className="mixer-fx">
      <div className="mixer-fx-title">
        <span className="swatch" style={{ background: track.color }} />
        <strong>{track.name}</strong>
        <span className="faint">{index === 0 ? 'Master' : `Insert ${index}`}</span>
      </div>
      {index > 0 && (
        <button
          className={`io-select ${track.input ? 'set' : ''}`}
          data-hint="Audio input recorded on this track – choosing one arms the track"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            showMenu({ x: r.left, y: r.bottom + 2 }, inputMenu(index, track.input));
          }}
        >
          <span className="io-icon">⇥</span>
          <span className="io-label">{inputLabel(track.input)}</span>
          <span className="menu-arrow">▾</span>
        </button>
      )}
      <div className="fx-slots">
        {slots.map((fx, i) =>
          fx ? (
            <div key={fx.id} className={`fx-slot ${fx.enabled ? '' : 'disabled'}`}>
              <button
                className="fx-name"
                data-hint="Open effect · right-click for options"
                onClick={() => openEffectEditor(index, fx.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  showMenu(e, [
                    { label: `Slot ${i + 1}: ${slotName(fx)}`, header: true },
                    { label: 'Open editor', onClick: () => openEffectEditor(index, fx.id) },
                    { label: 'Replace', submenu: effectSlotMenu(index, fx.id) },
                    { label: 'Move up', disabled: i === 0, onClick: () => moveEffect(index, fx.id, -1) },
                    { label: 'Move down', disabled: i === track.effects.length - 1, onClick: () => moveEffect(index, fx.id, 1) },
                    { separator: true },
                    { label: 'Delete', danger: true, onClick: () => removeEffect(index, fx.id) },
                  ]);
                }}
              >
                {slotName(fx)}
              </button>
              <button className={`fx-led ${fx.enabled ? 'on' : ''}`} data-hint="Enable / bypass" onClick={() => toggleEffect(index, fx.id)} />
            </div>
          ) : (
            <button
              key={`empty-${i}`}
              className="fx-slot empty"
              data-hint="Empty slot – click to choose an effect or plugin"
              disabled={i > track.effects.length}
              onClick={(e) => showMenu(e, effectSlotMenu(index, null))}
            >
              Slot {i + 1}
            </button>
          ),
        )}
      </div>
      <div className="io-select output" data-hint="Output of this track">
        <span className="io-icon">⇤</span>
        <span className="io-label">{index === 0 ? (device ? device.outputChannels.slice(0, 2).join(' - ') || 'Out 1 - Out 2' : 'Out 1 - Out 2') : 'Master'}</span>
      </div>
      <div className="routed-list">
        {index === 0 ? 'All insert tracks feed the master.' : routed.length ? `Channels: ${routed.join(', ')}` : 'No channels routed here yet.'}
      </div>
    </div>
  );
}
