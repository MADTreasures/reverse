import { useRef } from 'react';
import { engine } from '../../audio/engine';
import { describeTarget, mixerTarget } from '../../model/automationTargets';
import { findPattern } from '../../model/patterns';
import { usePlugins } from '../../plugins/pluginStore';
import { MAX_BPM, MIN_BPM, formatClock, formatDb, formatPosition, ticksToSeconds, volumeToGain } from '../../model/timing';
import { isElectron, isMac } from '../../platform/platform';
import { selectPattern, setBpm, setMixerTrackProps, setTransport } from '../../store/actions';
import { useStore } from '../../store/store';
import { prepareCanvas, useFrame } from '../animation';
import { DragNumber } from '../controls/DragNumber';
import {
  IconBrowser,
  IconChevronLeft,
  IconChevronRight,
  IconKeyboard,
  IconMetronome,
  IconMixer,
  IconPause,
  IconPiano,
  IconPlay,
  IconPlaylist,
  IconPlug,
  IconPlus,
  IconPrecount,
  IconRack,
  IconRecord,
  IconStop,
} from '../controls/Icons';
import { Knob } from '../controls/Knob';
import { Meter } from '../controls/Meter';
import { runCommand, SHORTCUTS, type CommandId } from '../commands';
import { useHint } from '../hint';
import { enableMidi } from '../keyboard';
import { showMenu, toast, type MenuItem } from '../overlays';
import { addChannelMenu } from '../menus/channelMenus';

function cmd(label: string, id: CommandId, extra: Partial<MenuItem> = {}): MenuItem {
  return { label, shortcut: SHORTCUTS[id], onClick: () => void runCommand(id), ...extra };
}

function fileMenu(): MenuItem[] {
  return [
    cmd('New project', 'new'),
    cmd('Open…', 'open'),
    cmd('Open demo song', 'demo'),
    { separator: true },
    cmd('Save', 'save'),
    cmd('Save as…', 'saveAs'),
    cmd('Save new version', 'saveNewVersion'),
    { separator: true },
    cmd('Import audio files…', 'importSamples'),
    cmd('Export WAV…', 'export'),
    { separator: true },
    cmd('Project name…', 'projectInfo'),
  ];
}

function editMenu(): MenuItem[] {
  const s = useStore.getState();
  return [
    cmd('Undo / redo last edit', 'undoToggle', { disabled: s.past.length === 0 && s.future.length === 0 }),
    cmd('Undo step', 'undo', { disabled: s.past.length === 0 }),
    cmd('Redo step', 'redo', { disabled: s.future.length === 0 }),
  ];
}

function patternsMenu(): MenuItem[] {
  const s = useStore.getState();
  return [
    cmd('New pattern', 'newPattern'),
    cmd('New pattern with name…', 'newPatternNamed'),
    cmd('Clone pattern', 'clonePattern'),
    cmd('Rename pattern…', 'renamePattern'),
    cmd('Delete pattern…', 'deletePattern', { danger: true }),
    { separator: true },
    ...s.project.patterns.map((p) => ({
      label: p.name,
      swatch: p.color,
      checked: p.id === s.ui.selectedPatternId,
      onClick: () => selectPattern(p.id),
    })),
  ];
}

function viewMenu(): MenuItem[] {
  const s = useStore.getState();
  const open = (id: string) => s.ui.windows[id]?.open ?? false;
  return [
    cmd('Playlist', 'window:playlist', { checked: open('playlist') }),
    cmd('Channel rack', 'window:channelRack', { checked: open('channelRack') }),
    cmd('Piano roll', 'window:pianoRoll', { checked: open('pianoRoll') }),
    cmd('Mixer', 'window:mixer', { checked: open('mixer') }),
    cmd('Browser', 'toggleBrowser', { checked: s.ui.browserOpen }),
    cmd('Plugin picker', 'pluginPicker'),
    { separator: true },
    cmd('Close all windows', 'closeAllWindows'),
  ];
}

function optionsMenu(): MenuItem[] {
  const s = useStore.getState();
  return [
    cmd('Audio settings…', 'audioSettings'),
    cmd('Manage plugins…', 'pluginPicker'),
    { separator: true },
    cmd('Metronome', 'metronome', { checked: s.transport.metronome }),
    cmd('Recording precount', 'precount', { checked: s.transport.precount }),
    cmd('Typing keyboard to piano', 'typingKeyboard', { checked: s.ui.typingKeyboard }),
    {
      label: 'Enable MIDI keyboard input',
      onClick: () =>
        void enableMidi()
          .then((n) => toast(n < 0 ? 'MIDI input is already enabled.' : `MIDI enabled – ${n} input${n === 1 ? '' : 's'} found. Notes play on the selected channel.`))
          .catch((err: unknown) => toast(err instanceof Error ? err.message : 'MIDI is not available.', 'error')),
    },
    {
      label: 'Time display',
      submenu: [
        { label: 'Bars:steps:ticks', checked: s.ui.timeDisplay === 'bars', onClick: () => useStore.setState((x) => ({ ui: { ...x.ui, timeDisplay: 'bars' } })) },
        { label: 'Minutes:seconds', checked: s.ui.timeDisplay === 'clock', onClick: () => useStore.setState((x) => ({ ui: { ...x.ui, timeDisplay: 'clock' } })) },
      ],
    },
  ];
}

function toolsMenu(): MenuItem[] {
  const s = useStore.getState();
  const last = s.ui.lastTweaked;
  const info = last ? describeTarget(s.project, last) : null;
  return [
    { label: info ? `Last tweaked: ${info.label}` : 'Last tweaked: –', header: true },
    cmd('Create automation clip', 'lastTweakedAutomation', { disabled: !info }),
    { separator: true },
    cmd('Plugin manager…', 'pluginPicker'),
  ];
}

function helpMenu(): MenuItem[] {
  return [cmd('Keyboard shortcuts', 'shortcuts'), cmd('About MAD Studio', 'about')];
}

/** Right-click on the record button (FL Studio: recording filter). */
function recordMenu(): MenuItem[] {
  const t = useStore.getState().transport;
  const f = t.recordFilter;
  return [
    { label: 'Recording filter', header: true },
    { label: 'Notes', checked: f.notes, onClick: () => setTransport({ recordFilter: { ...f, notes: !f.notes } }) },
    { label: 'Audio (armed mixer tracks)', checked: f.audio, onClick: () => setTransport({ recordFilter: { ...f, audio: !f.audio } }) },
    { separator: true },
    cmd('Recording precount', 'precount', { checked: t.precount }),
    { label: 'Audio settings…', onClick: () => void runCommand('audioSettings') },
  ];
}

const MENUS: [string, () => MenuItem[]][] = [
  ['File', fileMenu],
  ['Edit', editMenu],
  ['Add', addChannelMenu],
  ['Patterns', patternsMenu],
  ['View', viewMenu],
  ['Options', optionsMenu],
  ['Tools', toolsMenu],
  ['Help', helpMenu],
];

export function TopBar() {
  const transport = useStore((s) => s.transport);
  const bpm = useStore((s) => s.project.bpm);
  const dirty = useStore((s) => s.dirty);
  const projectName = useStore((s) => s.project.name);
  const masterVolume = useStore((s) => s.project.mixer[0]?.volume ?? 0.8);
  const windows = useStore((s) => s.ui.windows);
  const browserOpen = useStore((s) => s.ui.browserOpen);
  const typing = useStore((s) => s.ui.typingKeyboard);
  const native = usePlugins((s) => s.nativeEngine);
  const device = usePlugins((s) => s.device);
  const hint = useHint((s) => s.text);

  return (
    <header className={`topbar ${isElectron && isMac ? 'mac-inset' : ''}`}>
      <div className="tb-row tb-row1">
        <div className="brand-row">
          <span className="brand">
            MAD<span>STUDIO</span>
          </span>
          <nav className="menubar">
            {MENUS.map(([name, items]) => (
              <button
                key={name}
                className="menu-btn"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  showMenu({ x: r.left, y: r.bottom + 2 }, items());
                }}
              >
                {name}
              </button>
            ))}
          </nav>
        </div>

        <div className="transport">
          <div className="mode-switch" data-hint="Pattern or song mode (L)">
            <button className={transport.mode === 'pattern' ? 'active' : ''} onClick={() => setTransport({ mode: 'pattern' })}>
              <span className="mode-led" />
              PAT
            </button>
            <button className={transport.mode === 'song' ? 'active' : ''} onClick={() => setTransport({ mode: 'song' })}>
              <span className="mode-led" />
              SONG
            </button>
          </div>
          <button className={`transport-btn play ${transport.playing ? 'active' : ''}`} data-hint="Play (Space) · Ctrl/Cmd+Space: play / pause" onClick={() => engine.togglePlay()}>
            {transport.playing ? <IconPause size={16} /> : <IconPlay size={16} />}
          </button>
          <button className="transport-btn" data-hint="Stop (Space)" onClick={() => engine.stop()}>
            <IconStop size={15} />
          </button>
          <button
            className={`transport-btn record ${transport.recording ? 'active' : ''}`}
            data-hint="Record (notes, audio) (R) – right-click: recording filter"
            onClick={() => setTransport({ recording: !transport.recording })}
            onContextMenu={(e) => {
              e.preventDefault();
              showMenu(e, recordMenu());
            }}
          >
            <IconRecord size={14} />
          </button>
          <div className="tempo" data-hint="Tempo (BPM) – drag, wheel, double-click to type, right-click: automation">
            <DragNumber
              className="tempo-value"
              value={bpm}
              min={MIN_BPM}
              max={MAX_BPM}
              step={0.5}
              decimals={3}
              hint="Tempo"
              target="proj:bpm"
              format={(v) => v.toFixed(3)}
              onChange={(v, g) => setBpm(v, { coalesce: g })}
            />
          </div>
          <TimeDisplay />
        </div>

        <div className="tb-toggles">
          <WindowToggle label="Typing keyboard to piano (Ctrl/Cmd+T)" active={typing} onClick={() => void runCommand('typingKeyboard')}>
            <IconKeyboard size={16} />
          </WindowToggle>
          <WindowToggle label="Recording precount (Ctrl/Cmd+P)" active={transport.precount} onClick={() => void runCommand('precount')}>
            <IconPrecount size={16} />
          </WindowToggle>
          <WindowToggle label="Metronome (Ctrl/Cmd+M)" active={transport.metronome} onClick={() => void runCommand('metronome')}>
            <IconMetronome size={15} />
          </WindowToggle>
        </div>

        <div className="topbar-right">
          <div className="master-section" data-hint="Master volume">
            <Knob
              size={26}
              label="Master volume"
              value={masterVolume}
              min={0}
              max={1}
              defaultValue={0.8}
              format={(v) => formatDb(volumeToGain(v))}
              target={mixerTarget(0, 'volume')}
              onChange={(v, g) => setMixerTrackProps(0, { volume: v }, { coalesce: g })}
            />
            <Scope />
            <Meter trackIndex={0} width={9} height={30} />
          </div>
        </div>
      </div>

      <div className="tb-row tb-row2">
        <div className="hint-bar" title={hint}>
          {hint || (
            <>
              <span className="project-title">{projectName}</span>
              {dirty && <span className="dirty-dot" title="Unsaved changes" />}
            </>
          )}
        </div>
        <div className="window-toggles">
          <WindowToggle label="Browser (Alt+F8)" active={browserOpen} onClick={() => void runCommand('toggleBrowser')}>
            <IconBrowser size={16} />
          </WindowToggle>
          <WindowToggle label="Channel rack (F6)" active={windows.channelRack?.open} onClick={() => void runCommand('window:channelRack')}>
            <IconRack size={16} />
          </WindowToggle>
          <WindowToggle label="Piano roll (F7)" active={windows.pianoRoll?.open} onClick={() => void runCommand('window:pianoRoll')}>
            <IconPiano size={16} />
          </WindowToggle>
          <WindowToggle label="Playlist (F5)" active={windows.playlist?.open} onClick={() => void runCommand('window:playlist')}>
            <IconPlaylist size={16} />
          </WindowToggle>
          <WindowToggle label="Mixer (F9)" active={windows.mixer?.open} onClick={() => void runCommand('window:mixer')}>
            <IconMixer size={16} />
          </WindowToggle>
          <WindowToggle label="Plugin picker / manager (F8)" onClick={() => void runCommand('pluginPicker')}>
            <IconPlug size={16} />
          </WindowToggle>
        </div>
        <PatternSelector />
        <button
          className={`engine-status ${native ? 'native' : ''}`}
          data-hint={native ? 'Native audio engine (VST3/AU, low latency) – click for audio settings' : 'Browser audio engine (Web Audio) – click for audio settings'}
          onClick={() => void runCommand('audioSettings')}
        >
          <span className="engine-led" />
          {native ? `Native${device ? ` · ${Math.round(device.sampleRate / 100) / 10} kHz · ${device.bufferSize}` : ''}` : 'Web Audio'}
        </button>
      </div>
    </header>
  );
}

function WindowToggle({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`toggle-btn ${active ? 'active' : ''}`} data-hint={label} onClick={onClick}>
      {children}
    </button>
  );
}

function TimeDisplay() {
  const ref = useRef<HTMLDivElement>(null);
  const mode = useStore((s) => s.ui.timeDisplay);
  useFrame(() => {
    const el = ref.current;
    if (!el) return;
    const s = useStore.getState();
    const pos = engine.playheadTick() ?? (s.transport.mode === 'song' ? s.transport.songStart : 0);
    const text = mode === 'clock' ? formatClock(ticksToSeconds(pos, s.project.bpm)) : formatPosition(pos, s.project.beatsPerBar);
    if (el.textContent !== text) el.textContent = text;
  });
  return (
    <div
      className="time-display"
      ref={ref}
      data-hint="Song position – click to switch bars / time"
      onClick={() => useStore.setState((s) => ({ ui: { ...s.ui, timeDisplay: s.ui.timeDisplay === 'bars' ? 'clock' : 'bars' } }))}
    />
  );
}

function PatternSelector() {
  const patterns = useStore((s) => s.project.patterns);
  const selected = useStore((s) => findPattern(s.project, s.ui.selectedPatternId));
  const index = patterns.findIndex((p) => p.id === selected?.id);
  return (
    <div className="pattern-selector" data-hint="Pattern selector (+ / − or numpad +/− to switch)">
      <button className="icon-btn" onClick={() => index > 0 && selectPattern(patterns[index - 1].id)}>
        <IconChevronLeft size={12} />
      </button>
      <button
        className="pattern-name"
        style={{ ['--pc' as string]: selected?.color ?? '#888' }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          showMenu({ x: r.left, y: r.bottom + 2 }, patternsMenu());
        }}
      >
        {selected?.name ?? '—'}
      </button>
      <button className="icon-btn" onClick={() => index < patterns.length - 1 && selectPattern(patterns[index + 1].id)}>
        <IconChevronRight size={12} />
      </button>
      <button className="icon-btn" data-hint="New pattern (Ctrl/Cmd+F4)" onClick={() => void runCommand('newPattern')}>
        <IconPlus size={12} />
      </button>
    </div>
  );
}

function Scope() {
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useRef(new Float32Array(1024));
  useFrame(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = 92;
    const h = 34;
    const ctx = prepareCanvas(canvas, w, h);
    if (!ctx) return;
    ctx.fillStyle = '#0b0e10';
    ctx.fillRect(0, 0, w, h);
    if (!engine.masterWaveform(data.current)) return;
    ctx.strokeStyle = '#ff9b3d';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const d = data.current;
    for (let x = 0; x < w; x++) {
      const v = d[Math.floor((x / w) * d.length)];
      const y = h / 2 - v * (h / 2 - 2);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
  return <canvas ref={ref} className="scope" style={{ width: 92, height: 34 }} />;
}
