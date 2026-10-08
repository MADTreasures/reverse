# MAD Engine

> **Licence note:** the engine links [JUCE](https://juce.com) under the **AGPLv3** (see
> [LICENSE](LICENSE)). Distributing the engine (for example inside the MAD Studio app) requires
> AGPL compliance (corresponding source for the whole combined work) or a JUCE commercial/Starter
> licence.

Native audio engine for MAD Studio: renders all audio, hosts VST3 (and AudioUnit on macOS)
plugins and records audio inputs. It runs as a separate process that the Electron main process
talks to over newline-delimited JSON on stdin/stdout ([PROTOCOL.md](PROTOCOL.md)).

```bash
cmake -S engine -B engine/build/Release -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build engine/build/Release -j4
engine/build/Release/mad-engine --self-test
```

(Full documentation follows with the remaining work.)
