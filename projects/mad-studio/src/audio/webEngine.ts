import { DEFAULT_VELOCITY } from '../model/defaults';
import { findPattern, patternLength } from '../model/patterns';
import { findPreset } from '../model/presets';
import { patternTimeline, songTimeline, type Timeline } from '../model/timeline';
import { snapRound, snapTicks } from '../model/timing';
import type { Id, SynthChannel } from '../model/types';
import { addNotes, endCoalesce, setTransport } from '../store/actions';
import { toast } from '../ui/overlays';
import { useStore, type AppState } from '../store/store';
import { AutomationRuntime } from './automationRuntime';
import type { EngineApi } from './engineApi';
import { WebRecorder, armedTargets, deliverTakes, monitoredTargets, type RecordedTake } from './recorder';
import { ProjectGraph } from './graph';
import { SynthInstrument } from './instruments/synth';
import type { Voice } from './instruments/voice';
import { bufferChannels, renderProject, type RenderOptions } from './render';
import { samplePool } from './samplePool';
import { Scheduler } from './scheduler';
import { Ticker } from './timer';
import { encodeWav, type WavBitDepth } from './wav';

interface HeldNote {
  voice: Voice | null;
  channelId: Id;
  key: number;
  velocity: number;
  /** Pattern tick where the note started while recording, else null. */
  recordStart: number | null;
}

/** Browser audio engine: owns the AudioContext, mirrors the store and runs the transport. */
export class WebAudioEngine implements EngineApi {
  ctx: AudioContext | null = null;
  graph: ProjectGraph | null = null;
  private readonly scheduler: Scheduler;
  private readonly ticker: Ticker;
  private timeline: Timeline | null = null;
  private held = new Map<number, HeldNote>();
  private nextHandle = 1;
  private take = 0;
  private initPromise: Promise<void> | null = null;
  /** Playlist automation clips (song mode). */
  readonly automation = new AutomationRuntime();
  /** Audio input recording (FL: armed mixer tracks). */
  private readonly recorder = new WebRecorder();
  private recordStart: { tick: number; mode: 'song' | 'pattern' } | null = null;

  constructor() {
    this.scheduler = new Scheduler({
      now: () => this.ctx?.currentTime ?? 0,
      timeline: () => this.currentTimeline(),
      bpm: () => this.automation.value('proj:bpm') ?? useStore.getState().project.bpm,
      swing: () => this.automation.value('proj:swing') ?? useStore.getState().project.swing,
      beatsPerBar: () => useStore.getState().project.beatsPerBar,
      onEvent: (ev, time, spt) => this.graph?.trigger(ev, time, spt),
      onBeat: (_beat, barStart, time) => {
        if (useStore.getState().transport.metronome) this.graph?.metronomeClick(time, barStart);
      },
    });
    this.ticker = new Ticker(() => {
      this.pumpAutomation();
      this.scheduler.pump();
    });
  }

  /** Song mode: evaluates automation clips at the position being rendered now and updates the graph. */
  private pumpAutomation(): void {
    const ctx = this.ctx;
    const s = useStore.getState();
    if (!ctx || !this.scheduler.playing || s.transport.mode !== 'song') return;
    const tick = this.scheduler.positionAt(ctx.currentTime);
    if (tick === null) return;
    if (this.automation.update(s.project, tick)) this.graph?.sync(this.automation.apply(s.project));
  }

  /** Creates the AudioContext and graph (idempotent). */
  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    samplePool.ensureFactorySamples(ctx.sampleRate);
    const graph = new ProjectGraph(ctx, samplePool, { meters: true });
    graph.sync(this.automation.apply(useStore.getState().project));
    this.graph = graph;
    useStore.subscribe((state, prev) => this.onStoreChange(state, prev));
    samplePool.subscribe(() => useStore.setState((s) => ({ sampleRevision: s.sampleRevision + 1 })));
    useStore.setState({ audioReady: true });
  }

  private onStoreChange(state: AppState, prev: AppState): void {
    if (state.project !== prev.project) {
      this.automation.reconcile(state.project);
      this.graph?.sync(this.automation.apply(state.project));
      this.timeline = null;
    }
    if (state.ui.selectedPatternId !== prev.ui.selectedPatternId) this.timeline = null;
    if (state.project.mixer !== prev.project.mixer || state.transport.monitoring !== prev.transport.monitoring) void this.updateMonitoring();
    if (state.transport.mode !== prev.transport.mode && state.transport.playing) {
      this.stop();
      void this.play();
    }
  }

  private currentTimeline(): Timeline {
    if (!this.timeline) {
      const s = useStore.getState();
      this.timeline =
        s.transport.mode === 'song' ? songTimeline(s.project) : patternTimeline(s.project, s.ui.selectedPatternId);
    }
    return this.timeline;
  }

  /** Must be called from a user gesture in browsers (autoplay policy). */
  async resume(): Promise<void> {
    await this.init();
    if (this.ctx && this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        // Ignored: resume needs a user gesture and will be retried.
      }
    }
  }

  get playing(): boolean {
    return this.scheduler.playing;
  }

  async play(): Promise<void> {
    await this.resume();
    const ctx = this.ctx;
    if (!ctx || this.scheduler.playing) return;
    let s = useStore.getState();
    this.timeline = null;
    this.take += 1;
    const from = s.transport.mode === 'song' ? s.transport.songStart : 0;
    if (s.transport.mode === 'song' && this.automation.update(s.project, from)) this.graph?.sync(this.automation.apply(s.project));

    // Audio recording: armed tracks with an input (asks for microphone access the first time).
    const targets = s.transport.recording && s.transport.recordFilter.audio ? armedTargets(s.project) : [];
    let recording = false;
    if (targets.length) {
      recording = await this.recorder.open(ctx);
      if (!recording) toast('Microphone access was denied – audio is not recorded.', 'error');
      s = useStore.getState();
      if (this.scheduler.playing) return;
    }

    // Recording precount (FL: Ctrl+P): one bar of metronome clicks before playback starts.
    const now = ctx.currentTime + 0.05;
    let startAt = now;
    if (s.transport.recording && s.transport.precount && this.graph) {
      const spb = 60 / s.project.bpm;
      for (let b = 0; b < s.project.beatsPerBar; b++) this.graph.metronomeClick(now + b * spb, b === 0);
      startAt = now + s.project.beatsPerBar * spb;
    }
    this.scheduler.start(from, startAt);
    if (recording) {
      await this.recorder.start(ctx, targets, startAt);
      this.recordStart = { tick: from, mode: s.transport.mode };
    }
    this.ticker.start();
    setTransport({ playing: true });
  }

  /** Connects monitored inputs (FL: Monitor external input) to their mixer tracks. */
  private async updateMonitoring(): Promise<void> {
    const ctx = this.ctx;
    const graph = this.graph;
    if (!ctx || !graph) return;
    const s = useStore.getState();
    const targets = monitoredTargets(s.project, s.transport.monitoring);
    if (targets.length && !(await this.recorder.open(ctx))) return;
    this.recorder.setMonitoring(ctx, targets, (i) => graph.tracks[i]?.input ?? null);
  }

  /** Finishes a running recording and hands the takes to the project. */
  private finishRecording(): void {
    const start = this.recordStart;
    if (!start || !this.recorder.active || !this.ctx) return;
    this.recordStart = null;
    const s = useStore.getState();
    const ctx = this.ctx;
    const trim = s.transport.latencyCompensation ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + this.recorder.inputLatency() : 0;
    void this.recorder.stop(ctx.sampleRate, trim).then((parts) => {
      const project = useStore.getState().project;
      const takes: RecordedTake[] = parts.map((p) => ({
        trackIndex: p.trackIndex,
        trackName: project.mixer[p.trackIndex]?.name ?? `Insert ${p.trackIndex}`,
        channels: p.channels,
        sampleRate: ctx.sampleRate,
        startTick: start.tick,
      }));
      deliverTakes(takes, start.mode);
    });
  }

  stop(): void {
    const wasPlaying = this.scheduler.playing;
    this.finishRecording();
    this.scheduler.stop();
    this.ticker.stop();
    if (this.ctx && this.graph) this.graph.stopAll(this.ctx.currentTime);
    for (const [handle, note] of this.held) if (note.recordStart !== null) this.noteOff(handle);
    endCoalesce();
    if (wasPlaying || useStore.getState().transport.playing) setTransport({ playing: false });
  }

  /** Silences everything immediately (FL: Ctrl+H, stop all sound). */
  panic(): void {
    if (this.ctx && this.graph) this.graph.stopAll(this.ctx.currentTime);
    for (const handle of [...this.held.keys()]) this.noteOff(handle);
  }

  togglePlay(): void {
    if (this.scheduler.playing) this.stop();
    else void this.play();
  }

  /** Moves the song start marker; while playing in song mode playback jumps there. */
  seek(tick: number): void {
    const t = Math.max(0, Math.round(tick));
    setTransport({ songStart: t });
    const s = useStore.getState();
    if (this.scheduler.playing && s.transport.mode === 'song' && this.ctx && this.graph) {
      this.graph.stopAll(this.ctx.currentTime);
      this.scheduler.relocate(t, this.ctx.currentTime + 0.03);
    }
  }

  private latency(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    return (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  }

  /** Position (ticks) currently heard, or null when stopped. */
  playheadTick(): number | null {
    if (!this.ctx) return null;
    return this.scheduler.positionAt(this.ctx.currentTime - this.latency());
  }

  /** Position inside the selected pattern (for recording and the step highlight). */
  patternTick(): number | null {
    const pos = this.playheadTick();
    if (pos === null) return null;
    const s = useStore.getState();
    const pattern = findPattern(s.project, s.ui.selectedPatternId);
    if (!pattern) return null;
    const len = patternLength(pattern, s.project.beatsPerBar);
    if (s.transport.mode === 'pattern') return pos % len;
    const clip = s.project.clips.find(
      (c) => c.kind === 'pattern' && c.patternId === pattern.id && pos >= c.start && pos < c.start + c.length,
    );
    if (!clip) return null;
    return (pos - clip.start + clip.offset) % len;
  }

  noteOn(channelId: Id, key: number, velocity = DEFAULT_VELOCITY): number {
    void this.resume();
    const handle = this.nextHandle++;
    const voice = this.graph?.noteOn(channelId, key, velocity) ?? null;
    const s = useStore.getState();
    let recordStart: number | null = null;
    if (s.transport.recording && this.scheduler.playing) {
      const tick = this.patternTick();
      if (tick !== null) recordStart = tick;
    }
    this.held.set(handle, { voice, channelId, key, velocity, recordStart });
    return handle;
  }

  noteOff(handle: number): void {
    const note = this.held.get(handle);
    if (!note) return;
    this.held.delete(handle);
    if (this.ctx) note.voice?.release(this.ctx.currentTime);
    if (note.recordStart === null) return;
    const s = useStore.getState();
    const pattern = findPattern(s.project, s.ui.selectedPatternId);
    const endTick = this.patternTick();
    if (!pattern || endTick === null) return;
    const len = patternLength(pattern, s.project.beatsPerBar);
    const grid = snapTicks(s.ui.pianoRoll.snap, s.project.beatsPerBar);
    const start = snapRound(note.recordStart, grid) % len;
    let length = endTick - note.recordStart;
    if (length <= 0) length += len;
    length = Math.max(grid, snapRound(length, grid));
    addNotes(pattern.id, note.channelId, [{ key: note.key, start, length, velocity: note.velocity }], {
      coalesce: `record#${this.take}`,
    });
  }

  previewSample(sampleId: string): void {
    void this.resume();
    const ctx = this.ctx;
    const buffer = samplePool.buffer(sampleId);
    if (!ctx || !buffer || !this.graph) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.8;
    src.connect(gain);
    gain.connect(this.graph.previewBus);
    src.start();
    src.stop(ctx.currentTime + Math.min(buffer.duration, 6));
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
    };
  }

  previewPreset(presetId: string): void {
    void this.resume();
    const ctx = this.ctx;
    const preset = findPreset(presetId);
    if (!ctx || !preset || !this.graph) return;
    const channel = {
      id: 'preview',
      kind: 'synth',
      name: 'preview',
      color: '',
      volume: 0.8,
      pan: 0,
      muted: false,
      mixerTrack: 0,
      synth: preset.params,
    } satisfies SynthChannel;
    const synth = new SynthInstrument(ctx, channel);
    synth.output.connect(this.graph.previewBus);
    const t = ctx.currentTime + 0.01;
    const keys = preset.category === 'Bass' ? [36] : preset.category === 'Pad' || preset.category === 'Keys' ? [60, 64, 67] : [60];
    for (const k of keys) synth.trigger(k, 0.8, t, 0.6);
    setTimeout(() => synth.dispose(), 4000);
  }

  peaks(trackIndex: number): [number, number] {
    return this.graph?.peaks(trackIndex) ?? [0, 0];
  }

  masterWaveform(target: Float32Array<ArrayBuffer>): boolean {
    return this.graph?.master?.readWaveform(target) ?? false;
  }

  /** Seconds since the channel last triggered a note (Infinity if never). */
  channelActivityAge(channelId: Id): number {
    const t = this.graph?.activity.get(channelId);
    if (t === undefined || !this.ctx) return Infinity;
    return this.ctx.currentTime - t;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 44100;
  }

  // Plugins only exist in the native engine (desktop app); the browser engine ignores these.
  readonly isNative: boolean = false;
  async capturePluginStates(): Promise<void> {}
  openPluginEditor(_key: string, _title: string): void {}
  setPluginParam(_key: string, _index: number, _value: number): void {}
  requestPluginParams(_key: string): void {}
  scanPlugins(): void {}
  getAudioDevices(): void {}
  setAudioDevice(): void {}

  async renderWav(opts: RenderOptions & { bitDepth: WavBitDepth }): Promise<{ wav: Uint8Array; buffer: AudioBuffer }> {
    const buffer = await renderProject(useStore.getState().project, opts);
    return { wav: encodeWav(bufferChannels(buffer), buffer.sampleRate, opts.bitDepth), buffer };
  }
}

