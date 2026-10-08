/**
 * Renderer side of the native audio engine (engine/PROTOCOL.md). The engine process renders all
 * audio, hosts VST3/AU plugins and records inputs; this class mirrors the store into it and keeps the
 * same API as the Web Audio engine so the UI does not care which one runs.
 */
import { registerPluginParamName } from '../model/automationTargets';
import { DEFAULT_VELOCITY } from '../model/defaults';
import { findPattern, patternLength } from '../model/patterns';
import { findPreset } from '../model/presets';
import { patternTimeline, songTimeline, withLoop, type Timeline } from '../model/timeline';
import { secondsPerTick, snapRound } from '../model/timing';
import type { Id, Project } from '../model/types';
import type { EngineMessage, NativeEngineBridge } from '../platform/platform';
import { parseLatencyReport, usePlugins, type AudioDeviceInfo, type PluginParam } from '../plugins/pluginStore';
import { addNotes, endCoalesce, setTransport, storePluginStates } from '../store/actions';
import { noteTweaked } from '../store/automationActions';
import { pianoRollSnap, patternStartTick } from '../store/snap';
import { useStore, type AppState, type PlayMode } from '../store/store';
import { toast } from '../ui/overlays';
import { AutomationRuntime } from './automationRuntime';
import type { EngineApi } from './engineApi';
import { deliverTakes, type RecordedTake } from './recorder';
import type { RenderOptions } from './render';
import { decodeAudioFile, samplePool } from './samplePool';
import type { WavBitDepth } from './wav';

interface HeldNote {
  channelId: Id;
  key: number;
  velocity: number;
  recordStart: number | null;
}

interface Status {
  playing: boolean;
  tick: number;
  at: number;
  activity: Record<string, number>;
}

type Pending = { resolve: (msg: EngineMessage) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

let requestCounter = 0;

export class NativeEngine implements EngineApi {
  readonly isNative = true;
  readonly automation = new AutomationRuntime();
  private ready = false;
  private everReady = false;
  private failures = 0;
  private rate = 48000;
  private status: Status = { playing: false, tick: 0, at: 0, activity: {} };
  /** Number of the last transport.play/stop/seek sent; `status` echoes the last one the engine applied. */
  private transportSeq = 0;
  private transportSentAt = 0;
  /** Play was pressed before the engine was ready; it starts with the engine's `ready`. */
  private playWhenReady = false;
  private meterPeaks: [number, number][] = [];
  private wave: number[] = [];
  private held = new Map<number, HeldNote>();
  private nextHandle = 1;
  private take = 0;
  private timeline: Timeline | null = null;
  private timelineSentFor: { project: Project; mode: string; pattern: string; loop: { start: number; end: number } | null } | null = null;
  private lanesSent: unknown = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private sentSamples = new Map<string, AudioBuffer>();
  private pending = new Map<string, Pending>();
  private recordMode: 'song' | 'pattern' = 'song';
  private unsubscribers: (() => void)[] = [];
  private startTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly bridge: NativeEngineBridge,
    private readonly onFatal: (reason: string) => void,
  ) {}

  // ------------------------------------------------------------------ lifecycle

  async init(): Promise<void> {
    usePlugins.setState({ nativeEngine: true, engineError: null });
    this.unsubscribers.push(this.bridge.onMessage((m) => this.onMessage(m)));
    this.unsubscribers.push(useStore.subscribe((s, prev) => this.onStoreChange(s, prev)));
    this.unsubscribers.push(samplePool.subscribe(() => this.syncSamples()));
    // Without a "ready" in time the desktop app falls back to the browser engine.
    this.startTimer = setTimeout(() => {
      if (!this.everReady) this.fail('The native audio engine did not start.');
    }, 15000);
  }

  dispose(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    if (this.startTimer) clearTimeout(this.startTimer);
  }

  private fail(reason: string): void {
    this.dispose();
    usePlugins.setState({ nativeEngine: false, engineError: reason });
    this.onFatal(reason);
  }

  async resume(): Promise<void> {}

  private send(message: EngineMessage): void {
    this.bridge.send(message);
  }

  private sendTransport(message: EngineMessage): void {
    this.transportSeq += 1;
    this.transportSentAt = performance.now();
    this.send({ ...message, seq: this.transportSeq });
  }

  private request(message: EngineMessage, timeoutMs = 10000): Promise<EngineMessage> {
    const requestId = `r${++requestCounter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${message.type} timed out`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.send({ ...message, requestId });
    });
  }

  // ------------------------------------------------------------------ messages

  private onMessage(m: EngineMessage): void {
    const requestId = typeof m.requestId === 'string' ? m.requestId : null;
    const waiting = requestId ? this.pending.get(requestId) : undefined;
    switch (m.type) {
      case 'ready':
        this.onReady(m);
        return;
      case 'status': {
        // Produced before the engine applied our latest play/stop/seek (e.g. while it was still busy
        // with the first project sync): it describes the old transport state, and taking it would stop
        // a just-started transport or move the playhead back. Accepted after 5 s in case the engine
        // never applied the command.
        if (typeof m.seq === 'number' && m.seq < this.transportSeq && performance.now() - this.transportSentAt < 5000) return;
        const playing = m.playing === true;
        this.status = { playing, tick: Number(m.tick) || 0, at: performance.now(), activity: (m.activity as Record<string, number>) ?? {} };
        const s = useStore.getState();
        if (playing && s.transport.mode === 'song' && this.status.tick >= 0) this.automation.update(s.project, this.status.tick);
        if (!playing && s.transport.playing) setTransport({ playing: false });
        return;
      }
      case 'latency':
        usePlugins.setState({ latency: parseLatencyReport(m) });
        return;
      case 'meters':
        if (Array.isArray(m.peaks)) this.meterPeaks = m.peaks as [number, number][];
        if (Array.isArray(m.waveform)) this.wave = m.waveform as number[];
        return;
      case 'engine.exit':
        this.ready = false;
        this.sentSamples.clear();
        usePlugins.setState({ latency: null });
        this.transportSeq = 0; // a restarted engine counts from 0
        if (!this.everReady && ++this.failures >= 3) this.fail('The native audio engine keeps crashing on start.');
        else toast('The audio engine stopped unexpectedly – restarting…', 'error');
        setTransport({ playing: false });
        return;
      case 'engine.error':
        if (!this.everReady) this.fail(String(m.message ?? 'The native audio engine could not be started.'));
        return;
      case 'audio.devices':
        usePlugins.setState({
          device: (m.current as AudioDeviceInfo) ?? null,
          deviceTypes: (m.types as { name: string; outputs: string[]; inputs: string[] }[]) ?? [],
          sampleRates: (m.sampleRates as number[]) ?? [],
          bufferSizes: (m.bufferSizes as number[]) ?? [],
        });
        return;
      case 'record.done':
        void this.onRecordDone(m);
        return;
      case 'plugins.list':
        usePlugins.setState({ plugins: (m.plugins as never[]) ?? [], failed: (m.failed as never[]) ?? [], scanning: null });
        return;
      case 'plugins.paths':
        usePlugins.setState({ paths: (m.paths as Record<string, string[]>) ?? {} });
        return;
      case 'plugins.scanProgress':
        usePlugins.setState({ scanning: { format: String(m.format ?? ''), name: String(m.name ?? ''), index: Number(m.index) || 0, total: Number(m.total) || 0 } });
        return;
      case 'plugin.loaded':
        this.setInstance(String(m.key), { state: 'ready', hasEditor: m.hasEditor !== false, latency: Number(m.latency) || 0 });
        return;
      case 'plugin.error':
        this.setInstance(String(m.key), { state: 'error', message: String(m.message ?? 'error') });
        return;
      case 'plugin.editorClosed':
        this.setInstance(String(m.key), { editorOpen: false });
        return;
      case 'plugin.params': {
        const key = String(m.key);
        const params = (m.params as PluginParam[]) ?? [];
        for (const p of params) registerPluginParamName(`plug:${key}:${p.index}`, p.name);
        usePlugins.setState((st) => ({ params: { ...st.params, [key]: params } }));
        return;
      }
      case 'plugin.paramChanged': {
        const key = String(m.key);
        const index = Number(m.index);
        usePlugins.setState((st) => {
          const list = st.params[key];
          if (!list) return {};
          return { params: { ...st.params, [key]: list.map((p) => (p.index === index ? { ...p, value: Number(m.value), text: String(m.text ?? p.text) } : p)) } };
        });
        // FL Studio's "last tweaked" also works for plugin parameters.
        noteTweaked(`plug:${key}:${index}`);
        return;
      }
      case 'render.progress':
        // Carries the render's requestId, but the request only completes with render.done.
        return;
      case 'error':
        if (waiting) {
          clearTimeout(waiting.timer);
          this.pending.delete(requestId!);
          waiting.reject(new Error(String(m.message ?? 'engine error')));
        } else console.warn('[engine]', m.message);
        return;
      default:
        if (waiting) {
          clearTimeout(waiting.timer);
          this.pending.delete(requestId!);
          waiting.resolve(m);
        }
    }
  }

  private setInstance(key: string, patch: Partial<NonNullable<ReturnType<typeof usePlugins.getState>['instances'][string]>>): void {
    usePlugins.setState((st) => {
      const prev = st.instances[key] ?? { state: 'loading' as const };
      return { instances: { ...st.instances, [key]: { ...prev, ...patch } } };
    });
  }

  private onReady(m: EngineMessage): void {
    this.ready = true;
    this.everReady = true;
    if (this.startTimer) clearTimeout(this.startTimer);
    this.rate = Number(m.sampleRate) || 48000;
    usePlugins.setState({ nativeEngine: true, engineError: null, formats: (m.formats as string[]) ?? [] });
    // Everything the engine needs, from scratch (also after a crash/restart or a rate change).
    this.sentSamples.clear();
    this.timelineSentFor = null;
    this.lanesSent = null;
    samplePool.ensureFactorySamples(this.rate);
    this.syncSamples();
    this.syncAll();
    this.sendRecordConfig();
    this.send({ type: 'transport.settings', metronome: useStore.getState().transport.metronome });
    this.send({ type: 'audio.getDevices' });
    this.send({ type: 'plugins.getList' });
    this.send({ type: 'plugins.getPaths' });
    if (!useStore.getState().audioReady) useStore.setState({ audioReady: true });
    if (this.playWhenReady) {
      this.playWhenReady = false;
      void this.play();
    }
  }

  // ------------------------------------------------------------------ store mirroring

  private onStoreChange(state: AppState, prev: AppState): void {
    if (state.project !== prev.project) {
      this.automation.reconcile(state.project);
      this.timeline = null;
      this.markPluginInstances(state.project);
      this.scheduleSync();
    }
    if (state.ui.selectedPatternId !== prev.ui.selectedPatternId || state.transport.mode !== prev.transport.mode || state.transport.loop !== prev.transport.loop) {
      this.timeline = null;
      this.scheduleSync();
    }
    if (state.transport.metronome !== prev.transport.metronome) this.send({ type: 'transport.settings', metronome: state.transport.metronome });
    if (state.transport.monitoring !== prev.transport.monitoring || state.transport.latencyCompensation !== prev.transport.latencyCompensation) {
      this.sendRecordConfig();
    }
    if (state.transport.mode !== prev.transport.mode && state.transport.playing) {
      this.stop();
      void this.play();
    }
  }

  private markPluginInstances(project: Project): void {
    const keys = [
      ...project.channels.filter((c) => c.kind === 'plugin').map((c) => `ch:${c.id}`),
      ...project.mixer.flatMap((t) => t.effects.filter((e) => e.type === 'plugin').map((e) => `fx:${e.id}`)),
    ];
    const current = usePlugins.getState().instances;
    const missing = keys.filter((k) => !current[k]);
    if (missing.length) usePlugins.setState((st) => ({ instances: { ...st.instances, ...Object.fromEntries(missing.map((k) => [k, { state: 'loading' as const }])) } }));
  }

  private scheduleSync(): void {
    if (this.syncTimer) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.syncAll();
    }, 30);
  }

  private currentTimeline(): Timeline {
    if (!this.timeline) {
      const s = useStore.getState();
      this.timeline = s.transport.mode === 'song' ? withLoop(songTimeline(s.project), s.transport.loop) : patternTimeline(s.project, s.ui.selectedPatternId);
    }
    return this.timeline;
  }

  private syncAll(): void {
    if (!this.ready) return;
    const s = useStore.getState();
    this.send({ type: 'project.sync', project: s.project });
    const key = { project: s.project, mode: s.transport.mode, pattern: s.ui.selectedPatternId, loop: s.transport.loop };
    const t = this.timelineSentFor;
    if (!t || t.project !== key.project || t.mode !== key.mode || t.pattern !== key.pattern || t.loop !== key.loop) {
      const tl = this.currentTimeline();
      this.send({ type: 'timeline.set', mode: s.transport.mode, loopStart: tl.start, loopEnd: tl.end, events: tl.events });
      this.timelineSentFor = key;
    }
    const lanes = this.automation.unitLanes(s.project);
    const lanesKey = this.automation.lanesOf(s.project);
    if (lanesKey !== this.lanesSent) {
      this.send({ type: 'automation.set', lanes });
      this.lanesSent = lanesKey;
    }
  }

  private syncSamples(): void {
    if (!this.ready) return;
    const project = useStore.getState().project;
    const wanted = new Set(Object.keys(project.samples));
    for (const id of [...this.sentSamples.keys()]) {
      if (!samplePool.has(id)) {
        this.sentSamples.delete(id);
        this.send({ type: 'samples.unload', id });
      }
    }
    for (const id of wanted) {
      const entry = samplePool.get(id);
      if (!entry || this.sentSamples.get(id) === entry.buffer) continue;
      this.sentSamples.set(id, entry.buffer);
      const channels = Array.from({ length: entry.buffer.numberOfChannels }, (_, c) => entry.buffer.getChannelData(c));
      void this.bridge.loadSample(id, entry.buffer.sampleRate, channels);
    }
  }

  private sendRecordConfig(): void {
    const t = useStore.getState().transport;
    this.send({ type: 'record.config', folder: this.bridge.recordFolder, monitoring: t.monitoring, latencyCompensation: t.latencyCompensation, bitDepth: 24 });
  }

  // ------------------------------------------------------------------ transport

  get playing(): boolean {
    return useStore.getState().transport.playing;
  }

  get sampleRate(): number {
    return this.rate;
  }

  async play(): Promise<void> {
    if (this.playing) return;
    if (!this.ready) {
      // Still starting (opening the audio device can take a moment): play once it is ready.
      this.playWhenReady = true;
      return;
    }
    const s = useStore.getState();
    this.syncAll();
    this.take += 1;
    const from = s.transport.mode === 'song' ? s.transport.songStart : patternStartTick(s);
    const record = s.transport.recording && s.transport.recordFilter.audio;
    const countIn = s.transport.recording && s.transport.precount ? s.project.beatsPerBar * 96 : 0;
    this.recordMode = s.transport.mode;
    if (s.transport.mode === 'song') this.automation.update(s.project, from);
    this.status = { playing: true, tick: from - countIn, at: performance.now(), activity: {} };
    this.sendTransport({ type: 'transport.play', fromTick: from, countInTicks: countIn, record });
    setTransport({ playing: true });
  }

  stop(): void {
    this.playWhenReady = false;
    this.sendTransport({ type: 'transport.stop' });
    this.status = { ...this.status, playing: false };
    for (const [handle, note] of this.held) if (note.recordStart !== null) this.noteOff(handle);
    endCoalesce();
    if (useStore.getState().transport.playing) setTransport({ playing: false });
  }

  togglePlay(): void {
    if (this.playing || this.playWhenReady) this.stop();
    else void this.play();
  }

  panic(): void {
    this.send({ type: 'live.allNotesOff' });
    this.held.clear();
  }

  seek(tick: number, mode: PlayMode = 'song'): void {
    const t = Math.max(0, Math.round(tick));
    setTransport(mode === 'song' ? { songStart: t } : { patternStart: t });
    const s = useStore.getState();
    if (s.transport.playing && s.transport.mode === mode) {
      this.status = { ...this.status, tick: t, at: performance.now() };
      this.sendTransport({ type: 'transport.seek', tick: t });
    }
  }

  playheadTick(): number | null {
    const st = this.status;
    if (!st.playing || !useStore.getState().transport.playing) return null;
    const bpm = this.automation.value('proj:bpm') ?? useStore.getState().project.bpm;
    const elapsed = Math.min(0.15, (performance.now() - st.at) / 1000);
    let tick = st.tick + elapsed / secondsPerTick(bpm);
    if (tick < 0) return null;
    const tl = this.currentTimeline();
    if (tick >= tl.end && tl.end > tl.start) tick = tl.start + ((tick - tl.start) % (tl.end - tl.start));
    return tick;
  }

  patternTick(): number | null {
    const pos = this.playheadTick();
    if (pos === null) return null;
    const s = useStore.getState();
    const pattern = findPattern(s.project, s.ui.selectedPatternId);
    if (!pattern) return null;
    const len = patternLength(pattern, s.project.beatsPerBar);
    if (s.transport.mode === 'pattern') return pos % len;
    const clip = s.project.clips.find((c) => c.kind === 'pattern' && c.patternId === pattern.id && pos >= c.start && pos < c.start + c.length);
    if (!clip) return null;
    return (pos - clip.start + clip.offset) % len;
  }

  // ------------------------------------------------------------------ live notes

  noteOn(channelId: Id, key: number, velocity = DEFAULT_VELOCITY): number {
    const handle = this.nextHandle++;
    this.send({ type: 'live.noteOn', handle, channelId, key, velocity });
    const s = useStore.getState();
    let recordStart: number | null = null;
    if (s.transport.recording && s.transport.recordFilter.notes && this.playing) recordStart = this.patternTick();
    this.held.set(handle, { channelId, key, velocity, recordStart });
    return handle;
  }

  noteOff(handle: number): void {
    const note = this.held.get(handle);
    if (!note) return;
    this.held.delete(handle);
    this.send({ type: 'live.noteOff', handle });
    if (note.recordStart === null) return;
    const s = useStore.getState();
    const pattern = findPattern(s.project, s.ui.selectedPatternId);
    const endTick = this.patternTick();
    if (!pattern || endTick === null) return;
    const len = patternLength(pattern, s.project.beatsPerBar);
    const grid = pianoRollSnap(s);
    const start = snapRound(note.recordStart, grid) % len;
    let length = endTick - note.recordStart;
    if (length <= 0) length += len;
    length = Math.max(grid, snapRound(length, grid));
    addNotes(pattern.id, note.channelId, [{ key: note.key, start, length, velocity: note.velocity }], { coalesce: `record#${this.take}` });
  }

  previewSample(sampleId: string): void {
    this.send({ type: 'preview.sample', id: sampleId });
  }

  previewPreset(presetId: string): void {
    const preset = findPreset(presetId);
    if (!preset) return;
    const keys = preset.category === 'Bass' ? [36] : preset.category === 'Pad' || preset.category === 'Keys' ? [60, 64, 67] : [60];
    this.send({ type: 'preview.synth', synth: preset.params, keys, duration: 0.6 });
  }

  // ------------------------------------------------------------------ meters

  peaks(trackIndex: number): [number, number] {
    return this.meterPeaks[trackIndex] ?? [0, 0];
  }

  masterWaveform(target: Float32Array<ArrayBuffer>): boolean {
    const w = this.wave;
    if (!w.length) return false;
    for (let i = 0; i < target.length; i++) target[i] = w[Math.floor((i / target.length) * w.length)] ?? 0;
    return true;
  }

  channelActivityAge(channelId: Id): number {
    const age = this.status.activity[channelId];
    if (age === undefined) return Infinity;
    return age + (performance.now() - this.status.at) / 1000;
  }

  // ------------------------------------------------------------------ recording

  private async onRecordDone(m: EngineMessage): Promise<void> {
    const list = Array.isArray(m.takes) ? (m.takes as { trackIndex: number; path: string; startTick: number; sampleRate: number }[]) : [];
    const takes: RecordedTake[] = [];
    for (const t of list) {
      try {
        const bytes = await this.bridge.readFile(t.path);
        const buffer = await decodeAudioFile(bytes, t.sampleRate || this.rate);
        const project = useStore.getState().project;
        takes.push({
          trackIndex: t.trackIndex,
          trackName: project.mixer[t.trackIndex]?.name ?? `Insert ${t.trackIndex}`,
          channels: Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice()),
          sampleRate: buffer.sampleRate,
          startTick: Number(t.startTick) || 0,
        });
      } catch (err) {
        toast(`Could not read the recording ${t.path}: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    }
    deliverTakes(takes, this.recordMode);
  }

  // ------------------------------------------------------------------ export

  async renderWav(opts: RenderOptions & { bitDepth: WavBitDepth }): Promise<{ wav: Uint8Array; buffer: AudioBuffer }> {
    const s = useStore.getState();
    const sampleRate = opts.sampleRate ?? this.rate;
    let endTick: number;
    if (opts.mode === 'pattern') {
      // Render a pattern repeated `loops` times by sending it as a one-off timeline.
      const tl = patternTimeline(s.project, opts.patternId ?? s.ui.selectedPatternId);
      const loops = Math.max(1, opts.loops ?? 1);
      const len = tl.end - tl.start;
      const events = Array.from({ length: loops }, (_, k) => tl.events.map((e) => ({ ...e, tick: e.tick + k * len }))).flat();
      endTick = len * loops;
      this.send({ type: 'timeline.set', mode: 'pattern', loopStart: 0, loopEnd: endTick, events });
      this.send({ type: 'automation.set', lanes: [] });
    } else {
      const tl = songTimeline(s.project);
      endTick = tl.end;
      this.send({ type: 'timeline.set', mode: 'song', loopStart: tl.start, loopEnd: tl.end, events: tl.events });
      this.send({ type: 'automation.set', lanes: this.automation.unitLanes(s.project) });
    }
    this.timelineSentFor = null;
    this.lanesSent = null;
    try {
      const path = await this.bridge.tempPath('render.wav');
      const done = await this.request({ type: 'render.start', path, sampleRate, bitDepth: opts.bitDepth, startTick: 0, endTick, tailSeconds: opts.tail ?? 2 }, 600000);
      const bytes = await this.bridge.readFile(String(done.path ?? path));
      const buffer = await decodeAudioFile(bytes, sampleRate);
      return { wav: bytes, buffer };
    } finally {
      this.syncAll();
    }
  }

  // ------------------------------------------------------------------ plugins

  async capturePluginStates(): Promise<void> {
    const project = useStore.getState().project;
    const hasPlugins = project.channels.some((c) => c.kind === 'plugin') || project.mixer.some((t) => t.effects.some((e) => e.type === 'plugin'));
    if (!hasPlugins || !this.ready) return;
    try {
      const res = await this.request({ type: 'plugins.getStates' }, 5000);
      if (res.states && typeof res.states === 'object') storePluginStates(res.states as Record<string, string>);
    } catch {
      toast('Could not read the plugin states from the engine – plugins keep their previous settings.', 'error');
    }
  }

  openPluginEditor(key: string, title: string): void {
    this.send({ type: 'plugin.openEditor', key, title });
    this.setInstance(key, { editorOpen: true });
  }

  setPluginParam(key: string, index: number, value: number): void {
    this.send({ type: 'plugin.setParam', key, index, value });
    usePlugins.setState((st) => {
      const list = st.params[key];
      return list ? { params: { ...st.params, [key]: list.map((p) => (p.index === index ? { ...p, value } : p)) } } : {};
    });
    noteTweaked(`plug:${key}:${index}`);
  }

  requestPluginParams(key: string): void {
    this.send({ type: 'plugin.getParams', key });
  }

  scanPlugins(opts: { rescanAll?: boolean; paths?: Record<string, string[]> } = {}): void {
    usePlugins.setState({ scanning: { format: '', name: 'Starting…', index: 0, total: 0 } });
    this.send({ type: 'plugins.scan', ...opts });
  }

  getAudioDevices(): void {
    this.send({ type: 'audio.getDevices' });
  }

  setAudioDevice(opts: { type?: string; output?: string; input?: string; sampleRate?: number; bufferSize?: number }): void {
    this.send({ type: 'audio.setDevice', ...opts });
  }
}
