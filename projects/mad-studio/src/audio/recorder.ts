/**
 * Audio input recording for the browser engine (FL Studio workflow): every armed mixer track with an
 * input records that input while the transport plays with recording on. The native engine records
 * through the audio device instead (see engine/PROTOCOL.md, "Recording").
 */
import type { MixerTrack, Project, TrackInput } from '../model/types';
import recorderUrl from './worklets/recorder-worklet.js?url';

export interface RecordTarget {
  trackIndex: number;
  input: TrackInput;
}

export interface RecordedTake {
  trackIndex: number;
  trackName: string;
  channels: Float32Array[];
  sampleRate: number;
  /** Song (or pattern) tick where the take starts. */
  startTick: number;
}

export function parseInput(input: TrackInput): { stereo: boolean; first: number } {
  const [kind, n] = input.split(':');
  return { stereo: kind === 'stereo', first: Number(n) };
}

/** Armed tracks with an input – the ones that record. */
export function armedTargets(project: Project): RecordTarget[] {
  const out: RecordTarget[] = [];
  project.mixer.forEach((t: MixerTrack, i: number) => {
    if (i > 0 && t.armed && t.input) out.push({ trackIndex: i, input: t.input });
  });
  return out;
}

/** Tracks whose input is monitored with the given mode (FL: Monitor external input). */
export function monitoredTargets(project: Project, mode: 'off' | 'armed' | 'on'): RecordTarget[] {
  if (mode === 'off') return [];
  const out: RecordTarget[] = [];
  project.mixer.forEach((t, i) => {
    if (i > 0 && t.input && (mode === 'on' || t.armed)) out.push({ trackIndex: i, input: t.input });
  });
  return out;
}

interface Session {
  target: RecordTarget;
  node: AudioWorkletNode;
  chunks: Float32Array[][];
  done: Promise<void>;
}

export class WebRecorder {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private deviceChannels = 1;
  private moduleFor: BaseAudioContext | null = null;
  private sessions: Session[] = [];
  private sink: GainNode | null = null;
  private monitors = new Map<number, { node: AudioNode; dest: AudioNode }>();
  private opening: Promise<boolean> | null = null;

  get active(): boolean {
    return this.sessions.length > 0;
  }

  /** Asks for microphone access and connects the input (once). Returns false when not allowed. */
  open(ctx: AudioContext): Promise<boolean> {
    if (this.source) return Promise.resolve(true);
    if (!this.opening) this.opening = this.doOpen(ctx).finally(() => (this.opening = null));
    return this.opening;
  }

  private async doOpen(ctx: AudioContext): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      return false;
    }
    const track = this.stream.getAudioTracks()[0];
    this.deviceChannels = Math.max(1, track?.getSettings().channelCount ?? 1);
    this.source = ctx.createMediaStreamSource(this.stream);
    this.splitter = ctx.createChannelSplitter(Math.max(2, this.deviceChannels));
    this.source.connect(this.splitter);
    return true;
  }

  /** Input latency reported by the browser (seconds). */
  inputLatency(): number {
    const lat = this.stream?.getAudioTracks()[0]?.getSettings() as { latency?: number } | undefined;
    return typeof lat?.latency === 'number' ? lat.latency : 0;
  }

  /** Channel names of the input device (FL lists "In 1", "In 2", …). */
  channelNames(): string[] {
    return Array.from({ length: Math.max(2, this.deviceChannels) }, (_, i) => `In ${i + 1}`);
  }

  /** Signal of one track input: mono → one channel, stereo → two (missing channels fall back to the first). */
  private tap(ctx: BaseAudioContext, input: TrackInput): AudioNode | null {
    if (!this.splitter) return null;
    const { stereo, first } = parseInput(input);
    const ch = (n: number) => Math.min(n, this.deviceChannels - 1);
    const merger = ctx.createChannelMerger(2);
    this.splitter.connect(merger, ch(first), 0);
    this.splitter.connect(merger, ch(stereo ? first + 1 : first), 1);
    return merger;
  }

  /** Routes monitored inputs into their mixer tracks (graph inputs given by `dest`). */
  setMonitoring(ctx: AudioContext, targets: RecordTarget[], dest: (trackIndex: number) => AudioNode | null): void {
    const wanted = new Set(targets.map((t) => t.trackIndex));
    for (const [index, m] of this.monitors) {
      if (!wanted.has(index)) {
        m.node.disconnect();
        this.monitors.delete(index);
      }
    }
    for (const t of targets) {
      if (this.monitors.has(t.trackIndex)) continue;
      const d = dest(t.trackIndex);
      const node = d ? this.tap(ctx, t.input) : null;
      if (!node || !d) continue;
      node.connect(d);
      this.monitors.set(t.trackIndex, { node, dest: d });
    }
  }

  /** Starts recording all targets at audio time `at`. */
  async start(ctx: AudioContext, targets: RecordTarget[], at: number): Promise<void> {
    if (this.moduleFor !== ctx) {
      await ctx.audioWorklet.addModule(recorderUrl);
      this.moduleFor = ctx;
    }
    if (!this.sink) {
      // Worklets must reach the destination to be processed; this branch stays silent.
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.sink.connect(ctx.destination);
    }
    for (const target of targets) {
      const tap = this.tap(ctx, target.input);
      if (!tap) continue;
      const channels = parseInput(target.input).stereo ? 2 : 1;
      const node = new AudioWorkletNode(ctx, 'mad-recorder', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
      tap.connect(node);
      node.connect(this.sink);
      const chunks: Float32Array[][] = [];
      const done = new Promise<void>((resolve) => {
        node.port.onmessage = (e: MessageEvent<{ type: string; channels?: Float32Array[] }>) => {
          if (e.data.type === 'data' && e.data.channels) chunks.push(e.data.channels);
          if (e.data.type === 'done') {
            tap.disconnect();
            node.disconnect();
            resolve();
          }
        };
      });
      node.port.postMessage({ cmd: 'start', at, channels });
      this.sessions.push({ target, node, chunks, done });
    }
  }

  /** Stops all sessions and returns the recorded audio per track (trimmed by `trimSeconds`). */
  async stop(sampleRate: number, trimSeconds: number): Promise<{ trackIndex: number; channels: Float32Array[] }[]> {
    const sessions = this.sessions;
    this.sessions = [];
    for (const s of sessions) s.node.port.postMessage({ cmd: 'stop' });
    await Promise.all(sessions.map((s) => Promise.race([s.done, new Promise((r) => setTimeout(r, 1500))])));
    const trim = Math.max(0, Math.round(trimSeconds * sampleRate));
    return sessions
      .map((s) => {
        const count = s.chunks[0]?.length ?? 0;
        const total = s.chunks.reduce((n, c) => n + (c[0]?.length ?? 0), 0);
        const channels = Array.from({ length: count }, () => new Float32Array(Math.max(0, total - trim)));
        let pos = -trim;
        for (const chunk of s.chunks) {
          const len = chunk[0].length;
          for (let c = 0; c < count; c++) {
            const src = chunk[c];
            for (let i = 0; i < len; i++) {
              const at = pos + i;
              if (at >= 0) channels[c][at] = src[i];
            }
          }
          pos += len;
        }
        return { trackIndex: s.target.trackIndex, channels };
      })
      .filter((t) => t.channels.length > 0 && t.channels[0].length > 0);
  }

  close(): void {
    for (const m of this.monitors.values()) m.node.disconnect();
    this.monitors.clear();
    this.source?.disconnect();
    this.splitter?.disconnect();
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.source = null;
    this.splitter = null;
  }
}

type TakeHandler = (takes: RecordedTake[], mode: 'song' | 'pattern') => void;
let takeHandler: TakeHandler | null = null;

/** The project layer registers how finished takes become samples and clips. */
export function setTakeHandler(handler: TakeHandler): void {
  takeHandler = handler;
}

export function deliverTakes(takes: RecordedTake[], mode: 'song' | 'pattern'): void {
  if (takes.length) takeHandler?.(takes, mode);
}
