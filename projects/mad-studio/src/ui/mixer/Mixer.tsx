import { memo } from 'react';
import { PALETTE, PALETTE_NAMES } from '../../model/colors';
import { EFFECT_SPECS, EFFECT_TYPES } from '../../model/effects';
import { formatDb, formatPan, volumeToGain } from '../../model/timing';
import type { MixerTrack } from '../../model/types';
import {
  MAX_EFFECT_SLOTS,
  addEffect,
  addMixerTrack,
  moveEffect,
  removeEffect,
  replaceEffect,
  selectMixerTrack,
  setMixerTrackProps,
  toggleEffect,
} from '../../store/actions';
import { useStore } from '../../store/store';
import { Fader } from '../controls/Fader';
import { IconClose, IconMixer, IconPlus } from '../controls/Icons';
import { Knob } from '../controls/Knob';
import { Meter } from '../controls/Meter';
import { promptDialog, showMenu, type MenuItem } from '../overlays';
import { WindowFrame } from '../workspace/WindowFrame';
import { openEffectEditor } from '../workspace/windows';

const FADER_H = 150;

export function Mixer() {
  const tracks = useStore((s) => s.project.mixer);
  const selectedIndex = useStore((s) => s.ui.selectedMixerTrack);
  const toolbar = (
    <button className="btn" data-hint="Add an insert track" onClick={() => addMixerTrack()}>
      <IconPlus size={11} /> Track
    </button>
  );
  return (
    <WindowFrame id="mixer" title="Mixer" icon={<IconMixer />} toolbar={toolbar}>
      <div className="mixer">
        <div className="mixer-strips">
          {tracks.map((t, i) => (
            <Strip key={t.id} track={t} index={i} selected={i === selectedIndex} />
          ))}
        </div>
        <FxPanel index={Math.min(selectedIndex, tracks.length - 1)} />
      </div>
    </WindowFrame>
  );
}

function trackMenu(track: MixerTrack, index: number): MenuItem[] {
  return [
    {
      label: 'Rename…',
      onClick: async () => {
        const name = await promptDialog('Rename mixer track', track.name);
        if (name) setMixerTrackProps(index, { name });
      },
    },
    { label: 'Color', submenu: PALETTE.map((c, i) => ({ label: PALETTE_NAMES[i], swatch: c, onClick: () => setMixerTrackProps(index, { color: c }) })) },
    { separator: true },
    { label: 'Add effect', submenu: EFFECT_TYPES.map((type) => ({ label: EFFECT_SPECS[type].name, onClick: () => addEffect(index, type) })) },
  ];
}

const Strip = memo(function Strip({ track, index, selected }: { track: MixerTrack; index: number; selected: boolean }) {
  const isMaster = index === 0;
  const activeFx = track.effects.filter((e) => e.enabled).length;
  return (
    <div
      className={`strip ${isMaster ? 'master' : ''} ${selected ? 'selected' : ''}`}
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
      <span className="strip-fx-count">{activeFx ? `FX ${activeFx}` : ''}</span>
      <Knob
        size={24}
        label={`${track.name} pan`}
        value={track.pan}
        min={-1}
        max={1}
        defaultValue={0}
        bipolar
        format={formatPan}
        onChange={(v, g) => setMixerTrackProps(index, { pan: v }, { coalesce: g })}
      />
      <div className="strip-buttons">
        <button className={`mute ${track.muted ? 'on' : ''}`} data-hint="Mute" onClick={() => setMixerTrackProps(index, { muted: !track.muted })}>
          M
        </button>
        {!isMaster && (
          <button className={`solo ${track.solo ? 'on' : ''}`} data-hint="Solo" onClick={() => setMixerTrackProps(index, { solo: !track.solo })}>
            S
          </button>
        )}
      </div>
      <div className="strip-fader-row">
        <Fader value={track.volume} height={FADER_H} label={`${track.name} volume`} onChange={(v, g) => setMixerTrackProps(index, { volume: v }, { coalesce: g })} />
        <Meter trackIndex={index} width={10} height={FADER_H} />
      </div>
      <span className="strip-db">{formatDb(volumeToGain(track.volume)).replace(' dB', '')}</span>
    </div>
  );
});

function FxPanel({ index }: { index: number }) {
  const track = useStore((s) => s.project.mixer[index]);
  const channels = useStore((s) => s.project.channels);
  if (!track) return null;
  const routed = channels.filter((c) => c.mixerTrack === index).map((c) => c.name);
  const addMenu = (e: { clientX: number; clientY: number }) =>
    showMenu(
      e,
      EFFECT_TYPES.map((type) => ({
        label: EFFECT_SPECS[type].name,
        onClick: () => {
          const id = addEffect(index, type);
          if (id) openEffectEditor(index, id);
        },
      })),
    );
  return (
    <div className="mixer-fx">
      <div className="mixer-fx-title">
        <span className="swatch" style={{ background: track.color }} />
        <strong>{track.name}</strong>
        <span className="faint">{index === 0 ? 'Master' : `Insert ${index}`}</span>
      </div>
      {track.effects.map((fx, i) => (
        <div key={fx.id} className={`fx-slot ${fx.enabled ? '' : 'disabled'}`}>
          <button className={`fx-led ${fx.enabled ? 'on' : ''}`} data-hint="Enable / bypass" onClick={() => toggleEffect(index, fx.id)} />
          <button
            className="fx-name"
            data-hint="Open effect · right-click for options"
            onClick={() => openEffectEditor(index, fx.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              showMenu(e, [
                { label: 'Open editor', onClick: () => openEffectEditor(index, fx.id) },
                { label: 'Move up', disabled: i === 0, onClick: () => moveEffect(index, fx.id, -1) },
                { label: 'Move down', disabled: i === track.effects.length - 1, onClick: () => moveEffect(index, fx.id, 1) },
                { label: 'Replace with', submenu: EFFECT_TYPES.map((type) => ({ label: EFFECT_SPECS[type].name, onClick: () => replaceEffect(index, fx.id, type) })) },
                { separator: true },
                { label: 'Remove', danger: true, onClick: () => removeEffect(index, fx.id) },
              ]);
            }}
          >
            {i + 1}. {EFFECT_SPECS[fx.type].name}
          </button>
          <button className="icon-btn" data-hint="Remove effect" onClick={() => removeEffect(index, fx.id)}>
            <IconClose size={10} />
          </button>
        </div>
      ))}
      {track.effects.length < MAX_EFFECT_SLOTS && (
        <button className="fx-add" data-hint="Add an insert effect" onClick={addMenu}>
          + Add effect
        </button>
      )}
      <div className="routed-list">
        {index === 0 ? 'All insert tracks feed the master.' : routed.length ? `Channels: ${routed.join(', ')}` : 'No channels routed here yet.'}
      </div>
    </div>
  );
}
