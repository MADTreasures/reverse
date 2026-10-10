# MAD Engine – stdio protocol (version 1)

The native engine (`mad-engine`, on macOS `MAD Engine.app/Contents/MacOS/MAD Engine`) is a separate
process started by the Electron main process. It owns the audio device, renders all audio, hosts
VST3/AU plugins and records audio inputs. The renderer (React UI) owns the project model and talks to
the engine through the main process, which relays messages 1:1.

* Transport: **newline-delimited JSON** (one JSON object per line, UTF-8) on stdin (commands) and
  stdout (replies/events). stderr is free-form logging.
* Every message has a `"type"` string. Commands may carry `"requestId"`; replies echo it.
* Unknown commands → `{"type":"error","message":"unknown command …","request":"<type>"}`. The engine
  must never crash on malformed input.
* All times in **ticks** use PPQ = 96 (one 16th step = 24 ticks). Tempo in BPM.
* Binary sample data never travels over stdio: the main process writes raw files (see `samples.loadRaw`).

## Startup

Command line (normal mode): `mad-engine --stdio --data-dir <dir>`

* `--data-dir`: writable directory for the plugin list cache (`plugins.json`), crash blacklist etc.

After the audio device is open (or the null device fallback is running) the engine prints:

```json
{"type":"ready","protocol":1,"version":"0.2.0","sampleRate":48000,"bufferSize":512,
 "device":{"type":"CoreAudio","output":"MacBook Pro Speakers","input":"MacBook Pro Microphone","null":false},
 "formats":["VST3","AudioUnit"]}
```

If no device can be opened the engine runs a **null device**: a thread that calls the audio callback in
real time (blockSize/sampleRate seconds per block), so the transport and meters work without hardware
(CI). `device.null` is then `true`.

## Project state

### `project.sync` (renderer → engine)

`{"type":"project.sync","project":{…}}` – the full project JSON (see “Project JSON” below). Sent on every
model change (throttled by the renderer to ≤ 30/s). The engine diffs against the previous state:
parameter changes are applied smoothly (one-pole smoothing, τ = 10 ms, like Web Audio
`setTargetAtTime(v, now, 0.01)`), structural changes (channels/effects/plugins added, removed or
reordered, kind changed) rebuild only what changed. Existing voices keep sounding when unrelated parts
change.

### `timeline.set` (renderer → engine)

The renderer compiles patterns/playlist into note events (same code as the Web Audio engine), so the
engine never interprets patterns or clips itself.

```json
{"type":"timeline.set","mode":"song","loopStart":0,"loopEnd":6144,
 "events":[{"tick":0,"length":24,"channelId":"ch_1","key":60,"velocity":0.78},
           {"tick":384,"length":1536,"channelId":"ch_9","key":60,"velocity":1,"sampleOffset":0,"audioClip":true}]}
```

* Events are sorted by tick. Playback loops from `loopEnd` back to `loopStart`.
* Swing: an event at tick `t` is delayed by `swing * 12` ticks when `t % 48 == 24` (every second 16th),
  where `swing` (0..1) is the project value (or its automated value).
* `length` is converted to seconds at trigger time using the current tempo.
* `audioClip: true` → sampler voice is gated by `length` even for one-shot samplers, and playback starts
  `sampleOffset` ticks (converted to seconds at trigger time) into the sample.
* Audio clip instance properties (`src/model/clips.ts`, optional, only with `audioClip`):
  `sample` – id of a loaded sample to play instead of the channel's sample (the renderer computes
  pitch-shifted, time-stretched and reversed variants of the channel's sample, ids like
  `factory:fx_riser~x1.5c-200r`, and loads them with `samples.loadRaw`; a variant that is not loaded is
  silent, and the channel's `reverse` plays its reversed copy); `clipGain` – linear gain (0..64);
  `fadeIn` / `fadeOut` – ticks from the clip start / before the clip end (together at most `length`);
  `fadeInTension` / `fadeOutTension` – −1..1. The fade gain is `x^(1+3t)` for tension `t ≥ 0`, else
  `1−(1−x)^(1−3t)`, sampled at 256 points as float32 and interpolated linearly between them (exactly
  what the browser's `setValueCurveAtTime` does), times `clipGain`, after the amp envelope.

**Note properties** (FL Studio's note properties, `src/model/notes.ts`). All fields are optional and only
sent when they differ from the default; the renderer has already resolved slide and portamento notes
(slide notes produce no event of their own):

| Field | Range (default) | Built-in synth | Built-in sampler | Plugin instrument |
| ----- | --------------- | -------------- | ---------------- | ----------------- |
| `pan` | −1..1 (0) | voice panned (mono law for a mono voice, stereo law for a stereo one) | same | — |
| `fine` | −1200..1200 cents (0) | oscillator detune | playback detune | — |
| `release` | 0..1 (0.5) | amp and filter envelope release × `2^((release−0.5)·2)` | amp release × the same | MIDI note-off velocity |
| `modX` | 0..1 (0.5) | filter cutoff × `2^((modX−0.5)·8)` (±4 octaves) | — | — |
| `modY` | 0..1 (0.5) | filter resonance × `4^((modY−0.5)·2)`, at most 24 | — | — |
| `color` | 0..15 (0) | — | — | MIDI channel `color + 1` |
| `glideFrom`, `glideTime` | semitones, seconds | portamento: the pitch starts `glideFrom` semitones away and moves linearly (in semitones) to the key in `glideTime` | same | — |
| `bends` | `[{at, length, to}]` (ticks, ticks, semitones) | slide notes: from `at` ticks after the note start the pitch moves from wherever it is to `to` semitones (relative to the key) within `length` ticks, then holds | same | — |

* Ticks in `bends` are converted with the tempo at the note start, like `length`. At most 8 bends per
  event are used.
* Voices with a note pan are mixed on a separate, always-stereo path of the channel and panned there with
  the stereo law, so they never change how the channel pans its other voices (`graph.ts` `ChannelStrip`).

### `automation.set` (renderer → engine)

Compiled, piecewise-linear automation lanes in **absolute song ticks** and **target units**:

```json
{"type":"automation.set","lanes":[{"target":"ch:ch_1:volume","points":[[0,0.8],[384,0.2],[768,0.2]]}]}
```

* Linear interpolation between points. Before the first point: no override (project value applies).
  After the last point: hold the last value.
* Lanes are only evaluated while the transport plays in **song** mode (`timeline.set` with
  `mode:"song"`). Evaluate at least every 32 samples; parameter smoothing hides steps.
* An override stays in effect after the transport stops (like FL Studio, controls keep the automated
  value) **until** the project value of that target changes in a later `project.sync`, or a new
  `automation.set` no longer contains the target.
* The engine reports nothing back for automation; the renderer computes the displayed values itself.

Target keys and units:

| Target | Unit |
| ------ | ---- |
| `ch:<channelId>:volume` | channel volume knob 0..1 (gain = `(v/0.8)²`) |
| `ch:<channelId>:pan` | −1..1 |
| `ch:<channelId>:synth.<path>` | SynthParams units, `<path>` e.g. `gain`, `filter.cutoff` (Hz), `filter.resonance`, `filter.envAmount`, `filter.keyTrack`, `lfo.rate`, `lfo.depth`, `osc.0.level`, `osc.2.fine`, `osc.1.coarse`, `osc.0.detune`, `osc.0.pan`, `ampEnv.attack`, `filterEnv.release` |
| `ch:<channelId>:sampler.<path>` | SamplerParams units: `gain`, `fine` (cents), `start` (0..1), `ampEnv.*` |
| `mx:<trackIndex>:volume` / `mx:<trackIndex>:pan` | mixer fader 0..1 (gain = `(v/0.8)²`) / −1..1 |
| `fx:<slotId>:<paramKey>` | internal effect parameter units (see `EFFECT_SPECS`) |
| `proj:bpm` / `proj:swing` | BPM (10..522) / 0..1 |
| `plug:<instanceKey>:<paramIndex>` | plugin parameter, normalized 0..1 |

`<instanceKey>` is `ch:<channelId>` for plugin instruments and `fx:<slotId>` for plugin effects
(slot ids are unique project-wide).

### `samples.loadRaw` / `samples.unload`

```json
{"type":"samples.loadRaw","id":"factory:kick_punch","path":"/tmp/…/s1.f32","sampleRate":48000,"channels":1,"frames":21000}
```

Raw **interleaved little-endian float32** PCM. The engine reads the file synchronously (the main process
deletes it afterwards) and replies `{"type":"samples.loaded","id":"…"}`. If `sampleRate` differs from the
device rate the engine resamples (or plays at the corrected rate). `samples.unload {id}` frees it.
Reversed playback (`sampler.reverse`) uses a reversed copy created by the engine.

## Transport

| Command | Fields | Notes |
| ------- | ------ | ----- |
| `transport.play` | `fromTick`, `countInTicks?` (default 0), `record?` (bool), `seq?` | Starts at `fromTick` (clamped into the loop). With `countInTicks > 0` the metronome clicks for that many ticks first (transport position negative, no events), then playback/recording starts at `fromTick`. |
| `transport.stop` | `seq?` | Stops, kills voices with a 12 ms fade, finishes recordings (→ `record.done`). |
| `transport.seek` | `tick`, `seq?` | While playing: relocate (voices are killed). While stopped: next start position. |
| `transport.settings` | `metronome` (bool) | Metronome clicks on every beat (accent on bar start) whenever the transport runs. |

`seq` (optional, integer ≥ 1) numbers the client's transport commands. The audio thread records the
`seq` of the last play/stop/seek it applied and every `status` echoes it, so a status that was
produced before the latest command took effect (still in flight when the client pressed play) can be
recognised and ignored. A `transport.play` refused during a render is acknowledged as a stop with its
`seq`.

## Live input and previews

| Command | Fields |
| ------- | ------ |
| `live.noteOn` | `handle` (int), `channelId`, `key`, `velocity` (0..1); optional `glideFrom` (semitones), `glideTime` (s): portamento of the channel settings, computed by the renderer |
| `live.noteOff` | `handle` |
| `live.allNotesOff` | – (panic) |
| `preview.sample` | `id` – plays the sample once (max 6 s) through the master at gain 0.8 |
| `preview.synth` | `synth` (SynthParams), `keys` (array), `duration` (s) – temporary synth through the master |
| `preview.stop` | – |

## Events (engine → renderer)

* `{"type":"status","playing":true,"tick":1234.5,"cpu":0.12,"seq":3,"activity":{"ch_1":0.02}}` – ~30×/s while
  playing, ~4×/s when stopped. `tick` is the position currently **heard** (output latency and plugin
  delay compensation accounted for);
  during count-in it is negative. `activity` lists channels that triggered a note in the last 0.2 s with
  the age in seconds. `cpu` = audio callback load 0..1. `seq` = the last applied transport command's
  `seq` (0 before any).
* `{"type":"meters","peaks":[[0.5,0.48],[0.1,0.1],…],"waveform":[…256 floats…]}` – ~30×/s. `peaks` has one
  `[left,right]` entry per mixer track (index 0 = master): peak absolute value of the post-fader output
  over the last 1024 samples. `waveform`: last 256 samples of the master’s left channel.
* `{"type":"error","message":"…","request":"<type>"}` and `{"type":"log","message":"…"}`.

## Audio device

* `audio.getDevices` → `{"type":"audio.devices","types":[{"name":"CoreAudio","outputs":["…"],"inputs":["…"]}],
  "current":{"type":"CoreAudio","output":"…","input":"…","sampleRate":48000,"bufferSize":512,
  "inputChannels":["In 1","In 2"],"outputChannels":["Out 1","Out 2"],"inputLatency":256,"outputLatency":512,"null":false},
  "sampleRates":[44100,48000,96000],"bufferSizes":[64,128,256,512,1024]}`
* `audio.setDevice` with any of `type`, `output`, `input`, `sampleRate`, `bufferSize` → reopens the device and
  replies with `audio.devices`. A sample-rate change is followed by a new `ready` message so the renderer
  re-sends samples.

## Recording (FL-Studio style)

Each mixer track has `input` (`null`, `"stereo:N"` = device inputs N and N+1, `"mono:N"` = input N; 0-based,
FL’s “In 1 - In 2” is `stereo:0`) and `armed`. Configure once:

`{"type":"record.config","folder":"/Users/x/Music/MAD Studio/Recorded","monitoring":"armed","latencyCompensation":true,"bitDepth":24}`

* `monitoring`: `"off"`, `"armed"` (monitor inputs of armed tracks) or `"on"` (always monitor tracks with an
  input). Monitored input is added to the track’s input before its effects.
* Recording runs while the transport plays with `record:true` (after the count-in) for every **armed**
  track that has an input. The engine writes the raw input (pre-effects, FL’s “EXT” pickup) to a WAV file
  per track in `folder` (`<track name>_<yyyyMMdd-HHmmss>.wav`) on a background writer thread.
* `latencyCompensation`: drop `inputLatency + outputLatency` samples plus the plugin delay compensation
  total (the player hears the music that much later) from the start of each file so the take lines up
  with the timeline.
* On stop: `{"type":"record.done","takes":[{"trackIndex":3,"path":"…","startTick":1536,"sampleRate":48000,"channels":2,"frames":96000}]}`.

## Offline render

`{"type":"render.start","requestId":"r1","path":"/…/song.wav","sampleRate":48000,"bitDepth":24,"startTick":0,"endTick":6144,"tailSeconds":2}`

Renders the current project/timeline/automation in song mode, faster than real time, on a background
thread while live playback is stopped. Events: `render.progress {requestId, fraction}`,
`render.done {requestId, path, peak, seconds}` or `error`.

## Plugins (VST3, AU on macOS, LV2 on Linux if enabled)

Project JSON carries plugin instances (see below). The engine creates them on `project.sync`
(asynchronously, plugins can be slow) and keys them by `<instanceKey>`.

| Command | Reply / effect |
| ------- | -------------- |
| `plugins.getPaths` | `{"type":"plugins.paths","paths":{"VST3":["…"],"AudioUnit":[]}}` default search paths |
| `plugins.scan` `{formats?, paths?, rescanAll?}` | `paths`: an array of folders (for every format) or an object keyed by format like `plugins.paths` (`{"VST3":["…"]}`); formats without folders use their defaults. Scans **out of process** (one `mad-engine --scan-plugin` child per file, 30 s timeout, crashes/timeouts are recorded as failed); events `plugins.scanProgress {format,name,index,total}`; finally `plugins.list` |
| `plugins.getList` | `{"type":"plugins.list","plugins":[PluginDescription…],"failed":[{"format","fileOrIdentifier","reason"}]}` (cached in `<data-dir>/plugins.json`) |
| `plugin.getParams {key}` | `{"type":"plugin.params","key","params":[{"index","name","label","value","text","steps","automatable"}]}` |
| `plugin.setParam {key,index,value}` | sets a normalized parameter |
| `plugin.openEditor {key,title}` / `plugin.closeEditor {key}` | native editor window (generic editor if the plugin has none); `plugin.editorClosed {key}` when the user closes it |
| `plugins.getStates {requestId}` | `{"type":"plugins.states","requestId","states":{"<key>":"<base64>"}}` – the renderer stores these into the project before saving |

Events: `plugin.loaded {key,name,latency,hasEditor,numParams}`, `plugin.error {key,message}`,
`plugin.paramChanged {key,index,value,text}` (throttled to ≤ 30/s per instance; used for “last tweaked”
automation like FL Studio).

`PluginDescription`: `{"uid","name","vendor","format","category","version","fileOrIdentifier","isInstrument","numInputs","numOutputs"}`.
`uid` must be stable across scans (JUCE `PluginDescription::createIdentifierString()`).

## Plugin delay compensation (PDC)

Like FL Studio's automatic PDC: a plugin that reports latency (VST3/AU latency, read again
whenever the plugin announces a change) delays its own audio, so the engine delays every other
path by the difference and everything meets in time.

* Channels are aligned at their mixer track (each waits for the slowest channel of the track),
  every track input waits for the slowest path into it (channels and the sends of other tracks,
  sidechain links included), and the faster sends are delayed; at the master the same happens for
  the tracks sending to it (aligned input + their inserts). Master inserts add to the total. The output lags the transport by `total` samples; `status.tick`, the
  metronome, recording (takes move back by it, like the device latencies) and offline renders
  (the file still starts exactly at `startTick`) account for it.
* Automation is compensated: a lane whose target sits behind latent plugins is read that many
  samples earlier: `mx:<i>:*` – the track's aligned input plus all its inserts; `fx:<slotId>:*`
  and `plug:fx:<slotId>:*` – the latency before that insert; `ch:<id>:volume|pan` – the
  channel's instrument latency. Instrument parameters and `proj:*` are not shifted. Right after
  a loop wrap a shifted lane reads the end of the loop (that audio is still playing).
* Project fields: `"pdc": false` turns automatic compensation off (manual offsets still apply);
  `"pdcAutomation": false` keeps automation at the transport position (FL Studio's *Compensate
  automations* switched off);
  `mixer[i].latencyOffset` (ms, ±1000) shifts a track: > 0 delays it, < 0 delays all the others;
  `plugin.latencyOffset` (samples) is added to what a plugin reports (for plugins that misreport
  their latency). Every path is compensated by at most 524288 samples.
* Event `latency`, sent at startup and whenever the compensation changes (project edits, a plugin
  announcing a new latency, a plugin finishing loading, a new sample rate):

  ```json
  {"type":"latency","automatic":true,"automations":true,"total":1000,"sampleRate":48000,
   "tracks":[{"latency":1000,"delay":0},{"latency":1000,"delay":0},{"latency":0,"delay":1000}],
   "plugins":{"fx:fx_7":{"reported":1000,"offset":0}}}
  ```

  `tracks[i].latency` – latency the track has detected (aligned input plus its inserts; master:
  the total); `tracks[i].delay` – compensation delay of its send to the master (master and tracks
  that do not send there: 0); `tracks[i].sends` – only for tracks that do not just feed the master:
  `[{"to":2,"delay":0}, …]`, every send with its compensation delay.
  `plugins` – every loaded instance by key with its reported latency and manual offset (samples).
  `automations` – whether automation is compensated (`pdc` and `pdcAutomation`).

## Project JSON (what `project.sync` contains)

Only these fields matter to the engine (others such as `patterns`, `tracks`, `clips` are ignored):

```jsonc
{
  "bpm": 130, "beatsPerBar": 4, "swing": 0.0, "pdc": true, "pdcAutomation": true,
  "channels": [
    {"id":"ch_1","kind":"synth","volume":0.8,"pan":0,"muted":false,"mixerTrack":1,
     "synth":{"osc":[{"wave":"sawtooth","level":0.8,"coarse":0,"fine":0,"unison":3,"detune":18,"pan":0}, {…}, {…}],
              "filter":{"enabled":true,"type":"lowpass","cutoff":1800,"resonance":4,"envAmount":0.4,"keyTrack":0.3},
              "ampEnv":{"attack":0.005,"decay":0.3,"sustain":0.6,"release":0.25},
              "filterEnv":{"attack":0.01,"decay":0.4,"sustain":0.2,"release":0.3},
              "lfo":{"target":"off","rate":4,"depth":0.3},"gain":0.6}},
    {"id":"ch_2","kind":"sampler","volume":0.8,"pan":0,"muted":false,"mixerTrack":2,
     "sampler":{"sampleId":"factory:kick_punch","rootKey":60,"fine":0,"keyTrack":true,"reverse":false,"oneShot":true,
                "loop":false,"start":0,"ampEnv":{…},"chokeGroup":0,"cutSelf":false,"gain":0.8}},
    {"id":"ch_3","kind":"plugin","volume":0.8,"pan":0,"muted":false,"mixerTrack":3,
     "plugin":{"uid":"VST3-MAD Test Synth-…","name":"MAD Test Synth","vendor":"MAD","format":"VST3",
               "fileOrIdentifier":"/…/MAD Test Synth.vst3","isInstrument":true,"state":null,"latencyOffset":0}},
    {"id":"ch_4","kind":"automation", …}   // ignored by the engine
  ],
  "mixer": [   // index 0 = master
    {"id":"mx_0","volume":0.8,"pan":0,"muted":false,"solo":false,"input":null,"armed":false,"latencyOffset":0,
     "effects":[{"id":"fx_1","type":"limiter","enabled":true,"params":{"gain":0,"ceiling":-0.5,"release":0.1}},
                {"id":"fx_2","type":"plugin","enabled":true,"params":{},"plugin":{…PluginInstanceData…}}]},
    {"id":"mx_1", …, "routes":[{"to":0,"level":0.8},{"to":4,"level":0,"sidechain":true}]}
  ],
  "samples": {"factory:kick_punch":{"id":"factory:kick_punch","name":"Kick Punch","source":"factory"}}
}
```

`effects[].type` is one of `eq`, `filter`, `compressor`, `distortion`, `chorus`, `delay`, `reverb`,
`limiter`, `plugin`. Only `enabled` effects are in the chain.

Mixer routing (FL Studio's route switches and send knobs, `src/model/routing.ts`): channel →
`mixer[channel.mixerTrack]` (clamped) → the track's `routes` → … → master (index 0) → device output. An
insert without `routes` sends to the master at unity (`[{"to":0,"level":0.8}]`); `routes: []` sends
nowhere. Each send takes the track's output after its fader and mute and adds it to the target's
input at `level` (knob position, gain `(level/0.8)²`). `sidechain: true` marks a sidechain link
(*Sidechain to this track*, created with level 0): the audio also reaches the target's sidechain bus
at unity, where a compressor with `"sidechain":1` uses it for its detector (without a sidechain link
it compresses its own input). Routes to missing tracks, to the track itself, duplicate targets and
routes that would close a loop are dropped; tracks are checked in index order, so of two routes
closing a loop the one on the lower track stays (the app sends the same, already validated, routes).
Tracks are processed senders first, the master last.

A track is silent when `muted`. When any insert (index > 0) has `solo`, only the master, the soloed
inserts and the tracks their audio passes through on its way to the master are heard (a sidechain
link with level 0 carries no audio); the master is never soloed out.

Channels may carry `settings` (FL Studio's channel settings › Misc, `src/model/channelSettings.ts`):
`{"polyphony":0,"mono":false,"porta":false,"glide":0.1,"arp":{…}}`. The engine uses only the voice limit
(`mono` = 1 voice, else `polyphony`, 0 = the instrument's default of 24 synth / 32 sampler voices; the
oldest voice fades out, like `voice.ts` `enforcePolyphony`). Arpeggiator, Mono note cutting and
portamento are resolved by the renderer into the `timeline.set` events and the live note messages.

---

## Appendix: implementation notes and extensions (engine 0.2.0)

Everything above is implemented as specified. The engine adds the following; renderers that
ignore unknown fields keep working.

### Additions

* **`requestId` echo**: every direct reply carries the request's `requestId` when it had one
  (`samples.loaded`, `audio.devices`, `plugins.paths`, `plugins.list` for `plugins.getList`,
  `plugin.params`, `pong`, `plugins.states`, `render.*`). `error` messages carry it too.
* **`status`**: extra field `"state":"stopped"|"countIn"|"playing"`. During a count-in `tick`
  runs from `-countInTicks` up to 0 (then continues at `fromTick`). While stopped, `tick` is the
  next start position (the last `fromTick`/`transport.seek` target).
* **`meters`**: ~30/s while the transport runs or any meter shows signal. While stopped and
  completely silent the engine sends one all-zero frame and then pauses until signal returns.
* **`render.start`**: optional `project`, `timeline` (timeline.set fields) and `automation`
  (`{"lanes":[…]}`) override the live state for this render. Defaults: `sampleRate` = device
  rate, `bitDepth` 24, `startTick` 0, `endTick` = timeline `loopEnd`, `tailSeconds` 2. The range
  is rendered once, without looping, in song mode (automation applies).
  `render.done` adds `frames`, `sampleRate` and `renderTime` (wall-clock seconds); `seconds` is the
  duration of the rendered audio. Live playback is stopped while rendering and `transport.play` /
  `audio.setDevice` are refused (`error`) until the render has finished.
* **`record.done`** takes may contain `droppedFrames` when the disk writer could not keep up
  (30 s of buffering per take). Takes without any audio are deleted and not listed.
* **`plugin.loaded`** adds `numInputs` / `numOutputs` (channel counts after bus setup).
* **`PluginDescription`** adds `descriptiveName`, `uniqueId`, `deprecatedUid`, `lastFileModTime`,
  `lastInfoUpdateTime`, `hasSharedContainer` (needed to recreate the description). `numInputs` /
  `numOutputs` may be 0 when unknown (VST3 scans read `moduleinfo.json` without instantiating).
* **`plugin.editorClosed`** is also sent after `plugin.closeEditor` and when a plugin is removed
  while its editor is open. Without a display (headless Linux) `plugin.openEditor` replies with
  an `error`.
* **`plugin.paramChanged`**: at most one event per instance per ~33 ms (the most recent change).
* **Audio devices**: every entry of `audio.devices.types` has `separateInputs` (false for ASIO®,
  whose drivers are one device for inputs and outputs: the engine then uses the output device as
  input too); `current.hasControlPanel` is true when the driver has its own settings panel.
  `audio.showControlPanel` opens that panel (FL Studio: *Show ASIO panel*), blocks until it is
  closed, restarts the device if the driver changed its settings and replies with `audio.devices`
  (an `error` when there is no panel). The Windows engine lists the `ASIO` type (Steinberg's ASIO
  SDK headers bundled with JUCE, used under GPLv3). ASIO is a registered trademark of Steinberg
  Media Technologies GmbH. `audio.devices.types` contains a pseudo type `"Null"`;
  `audio.setDevice {"type":"Null"}` selects the null device, `"input": null` (or `"none"`) opens
  no input. `current.inputChannels` / `outputChannels` list the active channels (up to 8 inputs,
  2 outputs).
* **New commands**: `ping` → `{"type":"pong"}`; `quit` → graceful shutdown (same as closing
  stdin: recordings are finalised, the process exits with code 0).
* **Command line**: `--null-audio` (always use the null device, also after `audio.setDevice`,
  which then only changes its sample rate / buffer size), `--null-input-tone <Hz>` (test
  aid: a 0.25 amplitude sine on the null device's two inputs), `--sample-rate N` /
  `--buffer-size N` (initial device settings), `--help`. `--version` prints
  `{"name":"mad-engine","version":"0.2.0","protocol":1,"juce":"8.0.15"}`; `--render` prints a
  `render.done` line (or an `error` line and exit code 1). `--scan-plugin` exits 2 with an
  `"error"` field for an unknown format.

### Behaviour details

* Errors: `transport.play` with `record:true` but no armed mixer track with an `input` replies
  with an `error` and plays without recording; `live.noteOn` needs a non-zero `handle`;
  `plugins.scan` while a scan is running is refused.
* `transport.play` while playing restarts at `fromTick` (voices are killed).
* Consecutive queued `project.sync` / `timeline.set` / `automation.set` messages are coalesced
  (only the newest of a run is applied).
* A plugin effect that is still loading (or borrowed by an offline render) passes audio
  through; a plugin instrument is silent. Until it has loaded, a plugin counts as latency 0.
* When the compensation changes, delayed audio jumps (like any latency change in a DAW).
  Unchanged delays keep running across project edits.
* Internal effect parameters (project values and `fx:` automation) are clamped to the
  `EFFECT_SPECS` ranges of `model/effects.ts`.
* Sequenced notes on muted channels are not triggered (as in the Web Audio engine); live notes are.
* A gated sampler (`oneShot:false`, or `loop`) releases a live note on `live.noteOff` (the Web
  Audio engine only releases looping ones).
