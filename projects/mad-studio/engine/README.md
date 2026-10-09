# MAD Engine

> **Licence note:** the engine links [JUCE](https://juce.com) under the **GNU AGPLv3** (see
> [LICENSE](LICENSE)). Distributing the engine (for example inside the MAD Studio app) requires
> AGPL compliance — the complete corresponding source of the combined work must be offered to its
> users — or a JUCE commercial/Starter licence.

The native audio engine of MAD Studio. It renders all audio, hosts VST3 plugins (and AudioUnits
on macOS, LV2 on Linux) with automatic plugin delay compensation and records audio inputs. It
runs on macOS, Windows and Linux. It is a separate process that the Electron main
process starts and talks to over newline-delimited JSON on stdin/stdout; the protocol is in
[PROTOCOL.md](PROTOCOL.md) (including an appendix with the engine's additions).

It is a port of the Web Audio engine in `../src/audio/` and sounds the same: the demo song renders
within 0.02 dB RMS of the browser (see [Parity](#web-audio-parity)).

## Build

Requirements: CMake ≥ 3.22, Ninja (or the Visual Studio generator), a C++20 compiler (Xcode 14+ /
clang 15+ / GCC 12+ / Visual Studio 2022).
JUCE **8.0.15** is downloaded as the GitHub release tarball (pinned SHA256) unless
`-DMAD_JUCE_DIR=<path to a JUCE 8.0.15 checkout>` is given (useful for CI caches).

### Linux

```bash
sudo apt-get install -y build-essential cmake ninja-build pkg-config \
  libasound2-dev libfreetype-dev libfontconfig1-dev libx11-dev libxcomposite-dev \
  libxcursor-dev libxext-dev libxinerama-dev libxrandr-dev libxrender-dev \
  libjack-jackd2-dev   # optional: JACK backend (JUCE loads libjack at runtime)

cd projects/mad-studio
cmake -S engine -B engine/build/Release -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build engine/build/Release -j4
```

### macOS (universal binary)

```bash
cd projects/mad-studio
cmake -S engine -B engine/build/Release -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"
cmake --build engine/build/Release -j4
```

Leave out `CMAKE_OSX_ARCHITECTURES` for a native-only build. The deployment target is macOS 11.0.

### Windows (x64)

Visual Studio 2022 with the "Desktop development with C++" workload (its CMake works):

```bash
cd projects/mad-studio
cmake -S engine -B engine/build/Release -G "Visual Studio 17 2022" -A x64
cmake --build engine/build/Release --config Release
```

`mad-engine.exe` lands directly in `engine/build/Release` (no per-configuration subfolder), where
the app and the tests look for it. Audio goes through JUCE's Windows Audio (WASAPI: shared,
exclusive and low-latency modes), DirectSound and ASIO® (the ASIO SDK 2.3.4 headers bundled with
JUCE, which Steinberg licenses under GPLv3 or a proprietary licence; the engine uses the GPLv3,
see [licenses/](licenses/THIRD-PARTY-NOTICES.md)). MinGW is not supported (JUCE 8 refuses it).

### Options

| Option | Default | |
| ------ | ------- | - |
| `-DMAD_JUCE_DIR=<path>` | (download) | use a local JUCE 8.0.15 checkout |
| `-DMAD_JUCE_URL=<url>` / `-DMAD_JUCE_SHA256=<hash>` | GitHub release tarball | alternative mirror |
| `-DMAD_BUILD_TEST_PLUGINS=ON` | `OFF` | build "MAD Test Gain" / "MAD Test Synth" / "MAD Test Delay" for the tests |
| `-DMAD_ENABLE_LV2=OFF` | `ON` (Linux) | LV2 hosting |
| `-DMAD_ENABLE_JACK=OFF` | `ON` (Linux, if headers exist) | JACK backend |
| `-DMAD_ENABLE_ASIO=OFF` | `ON` (Windows) | ASIO drivers (GPLv3 headers bundled with JUCE) |

### Output paths

With the build directory `engine/build/<config>` (e.g. `engine/build/Release`):

| | Path |
| - | ---- |
| macOS app bundle | `engine/build/Release/MAD Engine.app` |
| macOS executable | `engine/build/Release/MAD Engine.app/Contents/MacOS/MAD Engine` |
| Linux / Windows | `engine/build/Release/mad-engine` (`mad-engine.exe`) |
| Test plugins | `engine/build/Release/plugins/MAD Test Gain.vst3`, `…/MAD Test Synth.vst3`, `…/MAD Test Delay.vst3` (macOS also `*.component`) |

The macOS bundle is an agent app (`LSUIElement`, no Dock icon) with the bundle id
`io.github.madtreasures.madstudio.engine` and `NSMicrophoneUsageDescription`. It is not code-signed
by the build; sign it (ad hoc or with an identity) together with the Electron app.

## Command line

```
mad-engine [--stdio] --data-dir <dir>      JSON protocol on stdin/stdout (default mode)
           [--null-audio]                  never open a real device (CI, tests)
           [--null-input-tone <Hz>]        test tone on the null device inputs
           [--sample-rate N] [--buffer-size N]
mad-engine --version                       {"name":"mad-engine","version":"0.2.0","protocol":1,"juce":"8.0.15"}
mad-engine --list-devices                  audio device types and devices as JSON
mad-engine --self-test                     native unit tests, exit code 0/1
mad-engine --scan-plugin <format> <id>     prints {"plugins":[…]} (used by plugins.scan)
mad-engine --render <job.json> --out <file.wav> [--sample-rate N] [--bit-depth 16|24|32] [--data-dir <dir>]
```

All modes work headless. stdout carries only protocol JSON: the engine moves the real stdout to a
private descriptor at startup and points descriptor 1 at stderr, so anything plugins or system
libraries print ends up on stderr. stderr is free-form logging.

`--data-dir` holds `plugins.json` (known and failed plugins). It defaults to the user's application
data folder (`~/.config/MAD Engine`, `~/Library/Application Support/MAD Engine`).

**Render jobs** (`--render`): `{"project":{…},"timeline":{…timeline.set fields…},"automation":{"lanes":[…]},
"samples":[{"id","path","sampleRate","channels","frames"}],"startTick":0,"endTick":6144,"tailSeconds":2}`.
Sample files are raw interleaved little-endian float32 like `samples.loadRaw`; relative paths
are resolved against the job file's folder. Optional `sampleRate` / `bitDepth` in the job are
overridden by the command-line flags. Plugins in the project are created synchronously, using the
`plugins.json` in `--data-dir` when present and an in-process scan of the plugin file otherwise.

## Tests

```bash
cd projects/mad-studio

# native unit tests (reference values generated from the TypeScript sources)
engine/build/Release/mad-engine --self-test

# protocol end-to-end test: Node >= 20, no npm packages. Builds with -DMAD_BUILD_TEST_PLUGINS=ON
# also exercise plugin hosting (otherwise that part is skipped). On macOS it additionally
# scans AudioUnits and loads Apple's AULowpass and DLSMusicDevice.
node engine/tests/protocol-test.mjs [--engine <path>] [--plugins <dir>] [--verbose] [--keep] [--seed <n>]
```

`--self-test` covers the envelope math (`envelope.ts`), biquad coefficients (Web Audio formulas,
Q in dB for lowpass/highpass), StereoPanner laws, `makeImpulseResponse` (first samples
bit-identical) and the ConvolverNode normalisation, oscillator levels, the compressor, sequencer
timing against `scheduler.ts` (swing, loop wrap, several block sizes, count-in, tempo changes),
automation interpolation/hold/override rules, WAV writing (byte-identical to `wav.ts encodeWav`)
and reading, rendered levels of small graphs (pan laws, faders, solo/mute, chokes,
automation, effects), the delay compensation plan, the compensation delay line and compensated
automation across a loop wrap in the live engine.

The protocol test starts the engine with `--null-audio --null-input-tone 440` and checks every
command and event, rendered levels/lengths/bit depths, recording with count-in and latency
trimming, automation, plugin scanning/loading/parameters/states, plugin delay compensation
(sample-exact alignment of a path through "MAD Test Delay" with a dry one, PDC off, track and
plugin offsets, a latency change while running, compensated automation), and ends with a stress section:
random structural edits, timeline/automation updates, sample reloads, live notes, previews, device
restarts and an offline render while the transport plays. That part is most useful with sanitizer
builds (GCC; clang needs its sanitizer runtimes installed):

```bash
cd projects/mad-studio
S=thread   # or address,undefined
cmake -S engine -B engine/build/San -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++ -DMAD_BUILD_TEST_PLUGINS=ON \
  -DCMAKE_C_FLAGS=-fsanitize=$S -DCMAKE_CXX_FLAGS=-fsanitize=$S -DCMAKE_EXE_LINKER_FLAGS=-fsanitize=$S \
  -DCMAKE_SHARED_LINKER_FLAGS=-fsanitize=$S -DCMAKE_MODULE_LINKER_FLAGS=-fsanitize=$S
cmake --build engine/build/San -j4
engine/build/San/mad-engine --self-test
TSAN_OPTIONS="report_destroy_locked=0 detect_deadlocks=0" \
node engine/tests/protocol-test.mjs --engine engine/build/San/mad-engine --plugins engine/build/San/plugins
```

(The TSan options work around JUCE itself: in the test plugins' VST3 wrapper a `MessageManagerLock`
taken on the message thread leaves its entry mutex locked when destroyed. That is reported once
per plugin instance and, after 64 instances, overflows TSan's deadlock-detector table.
`--seed <n>` changes the stress section's random sequence.)

The reference values in `src/tests/ReferenceData.h` are generated from the app's TypeScript code:

```bash
cd projects/mad-studio
node --experimental-transform-types --no-warnings --import ./engine/tests/tools/ts-hooks.mjs \
     engine/tests/tools/gen-reference.mjs
```

### Web Audio parity

`tests/parity/parity.mjs` renders the demo song ("MAD Groove") with the app's own Web Audio
engine in Chromium (`OfflineAudioContext` via `window.__madStudio.renderProject`) and with
`mad-engine --render` from the same project JSON, timeline and factory samples (all produced by the
TypeScript code), then compares RMS/peak overall, per second and with every mixer insert soloed:

```bash
cd projects/mad-studio
npm ci && npm run build          # web app in dist/ (ELECTRON_SKIP_BINARY_DOWNLOAD=1 is fine)
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
node --experimental-transform-types --no-warnings --import ./engine/tests/tools/ts-hooks.mjs \
     engine/tests/parity/parity.mjs [--engine <path>] [--tolerance-db 2] [--detail <insert>]
```

Result on Linux (Chromium 141, 48 kHz): full mix RMS +0.00/+0.01 dB (L/R), peak +0.03 dB, worst
single second 0.28 dB; every soloed insert within 0.18 dB RMS. The only larger per-second figure is
a window that cuts the bass's first note: Chromium's FIR oversampler in the master limiter adds
128 frames of latency, JUCE's about 1.4 ms less, so onsets are ~1.3 ms earlier natively.

`probe-compressor.mjs` and `probe-limiter.mjs` in the same folder measure single Chromium nodes. The
limiter (like the browser's) overshoots its ceiling on heavily clipped material because the 2x
oversampler's downsampling filter rings: +0.78 dB in Chromium, +0.86 dB natively for loud noise.

## Architecture

```
src/
├── app/       main() and CLI modes, Controller (stdio mode: commands, timers, render jobs)
├── core/      JSON helpers/writer, stdio protocol (reader thread, line-atomic writer), lock-free utils
├── dsp/       Web Audio parity DSP: biquad, StereoPanner laws, envelopes, oscillators,
│              DynamicsCompressor, waveshaper, delay line, impulse response, one-pole smoothing
├── engine/    AudioEngine (block processing), GraphBuilder (project.sync -> nodes), Graph (channel
│              strips, mixer tracks, snapshot), instruments, effects, sequencer, timeline/automation,
│              samples, recorder, offline renderer, WAV I/O, parameter tables, Latency (PDC)
├── io/        JUCE AudioDeviceManager wrapper and the null device
├── plugins/   plugin host (scan, cache, instances, params, editors, states), scan child, slots
└── tests/     --self-test and generated reference data
test-plugins/  MAD Test Gain / MAD Test Synth / MAD Test Delay (JUCE plugins)
tests/         protocol-test.mjs, parity/, tools/ (TypeScript import hook, reference generator)
```

**Threads.** A reader thread parses stdin lines and queues them for the message thread, which
coalesces runs of `project.sync`/`timeline.set`/`automation.set` and executes commands. The audio
thread (device callback, or the null-device thread) runs `AudioEngine::process`. Offline renders,
plugin scans (one child process per file, 30 s timeout), the recording writer and reverb IR
builds run on their own threads. Protocol output is written by any thread through one mutex.

**Realtime safety.** The message thread mirrors the project as long-lived nodes (shared pointers)
and publishes immutable `GraphSnapshot`s (channel/track lists, effect chains, timeline,
automation bindings) through an atomic pointer swap; replaced snapshots are deleted on the
message thread once the audio thread has finished a cycle (epoch counter). Parameter changes are
atomics (`AutoParam`) smoothed on the audio thread, so `project.sync` updates that do not change
the structure never swap snapshots and voices/effect tails keep running. Commands to the audio
thread go through a lock-free FIFO; notifications, meters and the transport position come back
through a FIFO and triple buffers. Samples are pinned by playing voices and freed only when unused. Hosted
plugins sit in `PluginSlot`s: the audio thread only try-locks them (silence on failure), which is
how offline renders borrow live instances.

**Processing.** Blocks of up to 2048 frames are split into 32-frame chunks for automation and
parameter updates. Per block: commands, automation + sequencer (tick-based, PPQ 96, loop wrap,
swing via a pending queue, count-in, metronome, tempo from `proj:bpm`), choke groups, note
dispatch with sample offsets, instruments → channel strips (mono or stereo pan law depending on
the instrument output, as Web Audio's channel-count rules) → mixer tracks (effects, pan, fader,
solo/mute, meters) → master (+ preview bus) → device, plus the metronome bus.

**Plugin delay compensation.** Like FL Studio's automatic PDC. `planCompensation()` (pure,
unit-tested) takes every channel's instrument latency, each track's insert latencies and manual
offsets and aligns channels at their track (each waits for the slowest channel of the track)
and tracks at the master; master inserts add to the total. The message thread re-plans whenever
the project changes or a plugin announces a new latency (`AudioProcessorListener` →
`PluginSlot`, polled with the 30 Hz tick) and publishes a snapshot whose channel and track entries
carry `CompensationDelay` ring buffers; buffers are reused while big enough, so delayed audio
keeps flowing across graph updates. Automation bindings carry the latency in front of their
parameter and are read that much earlier. The total moves `status.tick`, delays the metronome,
shifts recorded takes and is trimmed from offline renders.

**DSP parity.** Chromium's algorithms are ported where they define the sound: biquad
coefficients and edge cases, StereoPanner, the DynamicsCompressor kernel (6 ms look-ahead, adaptive
release, makeup gain), WaveShaper curve lookup with linear-phase FIR oversampling,
ConvolverNode normalisation (JUCE's partitioned convolution does the filtering), band-limited
oscillators normalised like Chromium's PeriodicWave tables (saw/square ×0.848), AudioParam
smoothing, and the start-up of LFO OscillatorNodes (440 Hz smoothed to the rate), so LFO phases
match too.

## Integration notes (Electron side)

* Start: `mad-engine --stdio --data-dir <app userData>/engine` (macOS:
  `MAD Engine.app/Contents/MacOS/MAD Engine`). Wait for `ready`; re-send samples after every
  `ready` (sample-rate changes).
* Package the engine next to the app, e.g. electron-builder `extraResources` with
  `engine/build/Release/MAD Engine.app` (macOS) or `mad-engine` (Linux), and resolve it via
  `process.resourcesPath`. Sign the nested app on macOS.
* macOS permissions: a process spawned by the Electron app has the app as its "responsible"
  process, so the microphone prompt and check use the **Electron app's** Info.plist
  (`NSMicrophoneUsageDescription`) and entitlements (`com.apple.security.device.audio-input` with
  the hardened runtime). Signed with the hardened runtime, the engine itself needs
  `com.apple.security.device.audio-input` and `com.apple.security.cs.disable-library-validation`
  (to load third-party plugins); some plugins also need `com.apple.security.cs.allow-jit` /
  `allow-unsigned-executable-memory`.
* Closing stdin (or sending `quit`) shuts the engine down cleanly.
* On Windows spawn with `windowsHide: true` (the engine is a console program).

## Known limitations

* Plugin delay compensation: monitored inputs of armed tracks are delayed with their track
  (FL Studio can bypass that for monitoring); tracks only feed the master (no sends/buses yet);
  at most 524288 samples per path; when the compensation changes, delayed audio jumps.
* Plugin editors need a display; on headless Linux `plugin.openEditor` returns an error. Editor
  windows are kept above other windows because the engine is a background process.
* Chromium quirks not reproduced: GainNodes start at 1 and are smoothed to their value when a graph
  is built (a few ms of leakage at the start of browser renders), the chorus' depth glitch at
  creation, and Chromium's FIR oversampler latency (128/192 frames; native ~1.3 ms less), so the
  distortion has no dry/wet comb filtering at `mix` < 1.
* macOS and Windows are built and tested in CI (`mad-studio-macos.yml`, `mad-studio-windows.yml`):
  self-test, protocol test (on macOS with Apple's AULowpass and DLSMusicDevice), the desktop
  test and the packaged app. The Windows runners have no sound card (null device); the macOS
  microphone permission prompt has not been tried interactively.
* ASIO is built in, but CI has no ASIO driver to open (the runners have no sound card); the
  device list, the shared input/output device and `audio.showControlPanel` are tested without one.
* WAV files are limited to 4 GB (no RF64). Each recording take has a 30 s FIFO between the audio
  thread and the writer thread; if the disk stalls for longer, frames are dropped (reported as
  `droppedFrames` in `record.done`).
* LV2 plugins are hosted on Linux but have no dedicated test.
* Each reverb owns a JUCE `dsp::Convolution`, which runs its own small background thread (it
  wakes every 10 ms); a shared `ConvolutionMessageQueue` would be leaner for projects with many
  reverbs.

---

VST is a registered trademark of Steinberg Media Technologies GmbH.
ASIO is a registered trademark of Steinberg Media Technologies GmbH.
