import { memo } from 'react';
import { mixerTarget } from '../../model/automationTargets';
import { PALETTE, PALETTE_NAMES } from '../../model/colors';
import { EFFECT_SPECS } from '../../model/effects';
import { DEFAULT_SEND, sidechainSources, trackRoutes } from '../../model/routing';
import { formatDb, formatPan, volumeToGain } from '../../model/timing';
import type { EffectSlot, MixerTrack, TrackInput } from '../../model/types';
import { inputChannelNames, usePlugins } from '../../plugins/pluginStore';
import {
  MAX_EFFECT_SLOTS,
  addMixerTrack,
  disarmAllTracks,
  moveEffect,
  removeEffect,
  resetRouting,
  routeOnly,
  selectMixerTrack,
  setRoute,
  setRouteLevel,
  sidechainTo,
  soloWithRouting,
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
import { openDialog, promptDialog, showMenu, toast, type MenuItem } from '../overlays';
import { WindowFrame } from '../workspace/WindowFrame';
import { openEffectEditor } from '../workspace/windows';
import { LatencyPanel, pdcMenu, trackLatencyMenu } from './Latency';

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
    { label: 'Plugin delay compensation', submenu: pdcMenu() },
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

const LOOP_MESSAGE = 'That route would feed the track back into itself.';

/** Turns a send on with FL Studio's feedback check. */
function tryRoute(ok: boolean): void {
  if (!ok) toast(LOOP_MESSAGE);
}

/** Right-click menu of a route switch or send knob: `from` (the selected track) → `to`. */
function routeMenu(from: number, to: number): MenuItem[] {
  const mixer = useStore.getState().project.mixer;
  const linked = trackRoutes(mixer, from).find((r) => r.to === to);
  return [
    { label: `${mixer[from]?.name ?? ''} → ${mixer[to]?.name ?? ''}`, header: true },
    { label: 'Route to this track only', onClick: () => tryRoute(routeOnly(from, to)) },
    { label: 'Sidechain to this track', checked: !!linked?.sidechain, onClick: () => tryRoute(sidechainTo(from, to)) },
    ...(linked ? [{ separator: true } as MenuItem, { label: 'Remove send', onClick: () => void setRoute(from, to, false) }] : []),
  ];
}

export function Mixer() {
  const tracks = useStore((s) => s.project.mixer);
  const selectedIndex = useStore((s) => s.ui.selectedMixerTrack);
  const sel = Math.min(selectedIndex, tracks.length - 1);
  const sends = trackRoutes(tracks, sel);
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
          {tracks.map((t, i) => {
            const send = sends.find((r) => r.to === i);
            return (
              <Strip
                key={t.id}
                track={t}
                index={i}
                selected={i === selectedIndex}
                sel={sel}
                selName={tracks[sel]?.name ?? ''}
                sendLevel={send ? send.level : null}
                sendSidechain={!!send?.sidechain}
              />
            );
          })}
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
    ...(usePlugins.getState().nativeEngine ? [{ label: 'Delay compensation', submenu: trackLatencyMenu(index) }] : []),
    ...routingMenu(index),
    { separator: true },
    { label: 'Add effect', submenu: effectSlotMenu(index, null) },
  ];
}

/** FL Studio's track menu › routing, for the selected track and the track that was right-clicked. */
function routingMenu(index: number): MenuItem[] {
  const s = useStore.getState();
  const mixer = s.project.mixer;
  const sel = s.ui.selectedMixerTrack;
  const items: MenuItem[] = [{ label: 'Routing', header: true }];
  if (sel > 0 && sel !== index && sel < mixer.length) {
    const linked = trackRoutes(mixer, sel).find((r) => r.to === index);
    items.push(
      { label: 'Route selected to this track', checked: !!linked && !linked.sidechain, onClick: () => tryRoute(setRoute(sel, index, !linked || !!linked.sidechain)) },
      { label: 'Route selected to this track only', onClick: () => tryRoute(routeOnly(sel, index)) },
      { label: 'Sidechain selected to this track', checked: !!linked?.sidechain, onClick: () => tryRoute(sidechainTo(sel, index)) },
    );
  }
  if (index > 0 && sel !== index && sel >= 0 && sel < mixer.length) {
    items.push({ label: 'Route this track to selected only', onClick: () => tryRoute(routeOnly(index, sel)) });
  }
  if (index > 0) items.push({ label: 'Reset routing', disabled: !mixer[index]?.routes, onClick: () => resetRouting(index) });
  return items.length > 1 ? items : [];
}

/** FL Studio's send switch at the bottom of a track, relative to the selected track. */
function RouteSwitch({ index, sel, selName, level, sidechain }: { index: number; sel: number; selName: string; level: number | null; sidechain: boolean }) {
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  if (index === sel) {
    return (
      <span className="route-out" data-hint="Selected track – its sends show on the tracks it feeds">
        ▼
      </span>
    );
  }
  if (sel === 0) return <span className="route-out placeholder" />;
  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    showMenu(e, routeMenu(sel, index));
  };
  if (level === null) {
    return (
      <button
        className="route-switch"
        aria-label={`Send ${selName} to this track`}
        data-hint={`Send ${selName} to this track · right-click: route only / sidechain`}
        onPointerDown={stop}
        onClick={() => tryRoute(setRoute(sel, index, true))}
        onContextMenu={menu}
      >
        ▲
      </button>
    );
  }
  return (
    <div className={`route-send ${sidechain ? 'sidechain' : ''}`} onPointerDown={stop}>
      <Knob
        size={20}
        label={`Send level from ${selName}`}
        value={level}
        min={0}
        max={1}
        defaultValue={sidechain ? 0 : DEFAULT_SEND}
        format={(v) => (sidechain && v === 0 ? 'Sidechain only' : formatDb(volumeToGain(v)))}
        color={sidechain ? '#8b98a3' : undefined}
        menuItems={() => routeMenu(sel, index)}
        onChange={(v, g) => setRouteLevel(sel, index, v, { coalesce: g })}
      />
    </div>
  );
}

interface StripProps {
  track: MixerTrack;
  index: number;
  selected: boolean;
  /** The selected track and its send to this strip (FL Studio's route switches follow the selection). */
  sel: number;
  selName: string;
  sendLevel: number | null;
  sendSidechain: boolean;
}

const Strip = memo(function Strip({ track, index, selected, sel, selName, sendLevel, sendSidechain }: StripProps) {
  const isMaster = index === 0;
  const native = usePlugins((s) => s.nativeEngine);
  const activeFx = track.effects.filter((e) => e.enabled).length;
  return (
    <div
      className={`strip ${isMaster ? 'master' : ''} ${selected ? 'selected' : ''} ${track.armed ? 'armed' : ''} ${sendLevel !== null ? 'routed' : ''}`}
      onPointerDown={(e) => e.button === 0 && selectMixerTrack(index)}
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
        data-hint={isMaster ? 'Mute master' : 'Mute (right-click or Ctrl/Cmd+click: solo, Alt+click: solo with the tracks routed to and from it)'}
        onClick={(e) => {
          if (!isMaster && e.altKey) soloWithRouting(index);
          else if (!isMaster && (e.metaKey || e.ctrlKey)) setMixerTrackProps(index, { solo: !track.solo });
          else setMixerTrackProps(index, { muted: !track.muted });
        }}
        onContextMenu={(e) => {
          // FL Studio: right-clicking a mixer track's mute switch solos the track.
          e.preventDefault();
          e.stopPropagation();
          if (!isMaster) setMixerTrackProps(index, { solo: !track.solo });
        }}
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
      {native && <LatencyPanel index={index} variant="strip" />}
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
      <RouteSwitch index={index} sel={sel} selName={selName} level={sendLevel} sidechain={sendSidechain} />
    </div>
  );
});

function slotName(slot: EffectSlot): string {
  return slot.type === 'plugin' ? (slot.plugin?.name ?? 'Plugin') : EFFECT_SPECS[slot.type].name;
}

/** FL Studio's track inspector: input, ten effect slots, output. */
/** "Master, Insert 3 (sidechain)" – where a track sends its audio. */
function sendSummary(mixer: readonly MixerTrack[], index: number): string {
  const routes = trackRoutes(mixer, index);
  if (routes.length === 0) return '(none)';
  return routes.map((r) => `${mixer[r.to]?.name ?? '?'}${r.sidechain ? ' (sidechain)' : ''}`).join(', ');
}

function TrackInspector({ index }: { index: number }) {
  const track = useStore((s) => s.project.mixer[index]);
  const mixer = useStore((s) => s.project.mixer);
  const channels = useStore((s) => s.project.channels);
  const device = usePlugins((s) => s.device);
  const native = usePlugins((s) => s.nativeEngine);
  if (!track) return null;
  const routed = channels.filter((c) => c.kind !== 'automation' && c.mixerTrack === index).map((c) => c.name);
  const incoming = mixer.flatMap((t, i) => (i > 0 && trackRoutes(mixer, i).some((r) => r.to === index && (!r.sidechain || r.level > 0)) ? [t.name] : []));
  const keyedBy = sidechainSources(mixer, index).map((i) => mixer[i].name);
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
      <div className="io-select output" data-hint="Output of this track (sends: the route switches at the bottom of the other tracks)">
        <span className="io-icon">⇤</span>
        <span className="io-label">{index === 0 ? (device ? device.outputChannels.slice(0, 2).join(' - ') || 'Out 1 - Out 2' : 'Out 1 - Out 2') : sendSummary(mixer, index)}</span>
      </div>
      {native && <LatencyPanel index={index} variant="inspector" />}
      <div className="routed-list">
        {routed.length ? `Channels: ${routed.join(', ')}` : index === 0 ? '' : 'No channels routed here yet.'}
        {incoming.length > 0 && <div>From: {incoming.join(', ')}</div>}
        {keyedBy.length > 0 && <div>Sidechain: {keyedBy.join(', ')}</div>}
      </div>
    </div>
  );
}
