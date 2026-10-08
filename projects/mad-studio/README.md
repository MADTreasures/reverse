# MAD Studio

> **Vorbild:** FL Studio (Image-Line, <https://www.image-line.com/>) · **Plattform:** macOS (Electron-App) und Browser ·
> **Status:** 🟢 v0.2 – Automation, Audioaufnahme, FL-Bedienung, native Engine mit VST3/AU-Hosting

[![MAD Studio CI](https://github.com/MADTreasures/reverse/actions/workflows/mad-studio-ci.yml/badge.svg)](https://github.com/MADTreasures/reverse/actions/workflows/mad-studio-ci.yml)
[![MAD Studio macOS](https://github.com/MADTreasures/reverse/actions/workflows/mad-studio-macos.yml/badge.svg)](https://github.com/MADTreasures/reverse/actions/workflows/mad-studio-macos.yml)

MAD Studio ist eine **pattern-basierte Musikproduktions-Software (DAW)** mit dem Workflow,
den man von FL Studio kennt: Beats im **Channel Rack** per Step-Sequencer bauen, Melodien
in der **Piano Roll** schreiben, Patterns in der **Playlist** zu einem Song anordnen und
alles im **Mixer** mit Effekten abmischen – dazu **Automation-Clips**, **Audioaufnahme** und
**VST3/AU-Plugins** (über die native Engine der Desktop-App). Bedienung, Menüs, Mausbelegung und Tastenkürzel sind an FL Studio
angeglichen (verglichen mit der installierten Testversion, siehe [RESEARCH.md](RESEARCH.md)).
Alles ist selbst geschrieben – Code, Klänge und Grafiken. Das mitgelieferte Drum-Kit wird beim
Start synthetisiert, es sind keine fremden Samples enthalten.

![MAD Studio – Playlist und Channel Rack](docs/screenshot-main.png)
![MAD Studio – Piano Roll, Synth und Mixer](docs/screenshot-editors.png)

## Funktionen

| Bereich | Was geht |
| ------- | -------- |
| **Channel Rack** | Step-Sequencer (malen, Rechtsklick löscht, ⌥+Mausrad = Velocity), Lautstärke/Pan, Mute/Solo (Rechtsklick auf die LED), Mixer-Routing, Swing, Pattern-Länge, „Fill each 2/4/8 steps“, Rotate, Noten eines Kanals kopieren/einfügen, Mini-Piano-Roll-Vorschau; Klick auf den Kanalnamen öffnet/schliesst das Kanalfenster |
| **Piano Roll** | Werkzeuge Zeichnen/Malen/Löschen/Slice/Auswahl, Verschieben, Länge ziehen, Shift+Ziehen klont, Klick auf eine Note übernimmt Länge und Velocity für neue Noten, Doppelklick = Noteneigenschaften, Velocity-Spur und ⌥+Mausrad, Snap wie in FL (Main/Line/Cell …, zoomabhängiges Raster), Ghost Notes, Quantisieren, Legato, Kopieren/Einfügen/Duplizieren, Transponieren, Klick ins Lineal setzt die Startposition im Pattern |
| **Playlist** | Picker-Panel (Patterns, Audio-Clips, Automation-Clips), platzieren, verschieben, Länge ändern (Pattern läuft in Schleife), links trimmen, Shift+Ziehen klont, Werkzeuge Mute (T) und Slice (C), Clip-Menü (stumm, Quell-Pattern, *Make unique* …), Spurmenü (einfügen, klonen, löschen, verschieben, alle Clips stumm …), Doppelklick auf Pattern-Clip öffnet die Piano Roll, Song-Position per Klick ins Lineal, **Zeitbereich per Rechts-Ziehen im Lineal – die Wiedergabe loopt darin** |
| **Automation** | Rechtsklick auf jeden Regler → *Create automation clip* (wie in FL): Automation-Kanal im Channel Rack + Clip in der Playlist; Punkte per Rechtsklick setzen, ziehen, Kurven biegen, 13 Kurvenmodi; Tempo-Automation; Reglerbewegungen während der Song-Aufnahme werden aufgezeichnet; *Tools → Last tweaked* |
| **Aufnahme** | Mikrofon/Line-In: im Mixer-Track-Inspector Eingang wählen (armt die Spur), Record + Play → Audio-Clip in der Playlist (Song-Modus) bzw. Audio-Clip-Kanal (Pattern-Modus); Vorzähler, Latenzkompensation, Monitoring, Auto-unarm; Ordner „Recorded“ im Browser |
| **Mixer** | Master + 16 Insert-Spuren (erweiterbar bis 64), Fader, Pan, Mute-LED (Ctrl-Klick = Solo), Arm-Taste, Track-Inspector mit Eingang, **10 Effekt-Slots** und Ausgang, Stereo-Pegelanzeigen |
| **Plugins** | VST3 (macOS/Linux) und Audio Units (macOS) als Instrumente im Channel Rack und als Effekte in Mixer-Slots, Plugin-Manager mit Scan (jedes Plugin in eigenem Prozess – ein abstürzendes Plugin reisst nichts mit), Plugin-Fenster mit dem Editor des Plugins, alle Parameter automatisierbar, Plugin-Zustand im Projekt gespeichert – über die **native Engine** der Desktop-App |
| **Effekte** | Parametric EQ, Auto Filter (mit LFO), Compressor, Distortion, Chorus, Tempo Delay (Ping-Pong, tempo-synchron), Reverb, Limiter |
| **Instrumente** | 3-Oszillator-Synth (Sinus/Dreieck/Säge/Rechteck/Rauschen, Unison, Filter mit Hüllkurve, LFO) mit 14 Presets · Sampler (Root-Key, Feinstimmung, Reverse, One-Shot, Loop, Choke-Gruppen, ADSR) |
| **Sounds** | 20 synthetisierte Factory-Sounds: Kicks, Snares, Claps, Hi-Hats, Becken, Toms, Percussion, 808-Bass, Riser, Impact |
| **Transport** | Pattern-/Song-Modus, Tempo (10–522 BPM), Metronom, Aufnahme von Tastatur/MIDI ins Pattern, Positionsanzeige (Takt:Step:Tick oder Zeit) |
| **Eingabe** | Computertastatur als Klavier (funktioniert auch mit Schweizer/Deutscher QWERTZ-Tastatur), MIDI-Keyboards (Web MIDI) |
| **Dateien** | Projekte als `.madstudio` (ZIP mit `project.json` und allen eigenen Samples), Autosave & Wiederherstellung, Audio-Import per Drag & Drop (WAV, AIFF, MP3, …), **WAV-Export** (16/24-bit, 32-bit float, 44.1–96 kHz) |
| **Komfort** | Undo/Redo wie in FL Studio 26 (Ctrl/⌘Z rückgängig, Ctrl/⌘⌥Z wiederherstellen, benannte Schritte), Score-Logger (nachträglich ins Pattern übernehmen, was gespielt wurde), frei verschiebbare Fenster wie im Vorbild, Hinweisleiste für jedes Bedienelement, Demo-Song „MAD Groove“ |
| **Audio-Engines** | Desktop-App: **native Engine** (C++/JUCE, eigener Prozess, CoreAudio/ALSA/JACK, VST3/AU, Aufnahme, Offline-Rendering; klingt wie die Web-Engine: Demo-Song innerhalb 0,02 dB RMS); Browser bzw. ohne Engine: Web-Audio-Engine – gleiche Bedienung, automatische Umschaltung |

## Installation auf dem Mac

### Variante A – fertige App herunterladen

1. Auf GitHub unter **Actions → „MAD Studio · macOS app“** den neuesten erfolgreichen Lauf öffnen
   (oder unter **Releases**, sobald ein Tag `mad-studio-v*` existiert).
2. Unten bei *Artifacts* **`MAD-Studio-macOS-Apple-Silicon`** (M1/M2/M3/M4) oder
   **`MAD-Studio-macOS-Intel`** herunterladen und entpacken – darin liegt die DMG-Datei.
3. DMG öffnen und **MAD Studio** in den Programme-Ordner ziehen.
4. Die App ist nicht von Apple notarisiert. Beim ersten Start blockiert macOS sie deshalb.
   Abhilfe: *Systemeinstellungen → Datenschutz & Sicherheit → „Trotzdem öffnen“*, oder im Terminal:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/MAD Studio.app"
   ```

### Variante B – selbst bauen (empfohlen für Entwickler)

Voraussetzung: [Node.js](https://nodejs.org/) 22.12 oder neuer.

```bash
cd projects/mad-studio
npm ci
# native Engine (VST3/AU, Aufnahme) – braucht CMake, Ninja und Xcode; ohne sie läuft die App mit der Web-Engine
cmake -S engine -B engine/build/Release -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"
cmake --build engine/build/Release
npm run dist:mac        # erzeugt release/MAD Studio-0.1.0-arm64.dmg und …-x64.dmg (mit Engine)
```

Selbst gebaute Apps sind nicht unter Quarantäne und starten direkt. Zum schnellen
Ausprobieren ohne Paketieren: `npm run app` (baut und startet die App; eine gebaute Engine unter
`engine/build/Release` wird automatisch verwendet). Details zur Engine (Linux-Abhängigkeiten,
Optionen, Tests): [engine/README.md](engine/README.md).

### Variante C – im Browser

```bash
cd projects/mad-studio
npm ci
npm run dev             # http://localhost:5173 in Chrome, Edge oder Safari öffnen
```

MIDI-Keyboards funktionieren in der Mac-App automatisch, im Browser (nur Chrome/Edge) nach
*Options → Enable MIDI keyboard input*.

## Kurzanleitung

1. **Beat bauen:** Im Channel Rack auf die Step-Felder klicken (oder mit gedrückter Maus malen).
   Mit **Space** abspielen.
2. **Melodie schreiben:** Kanal anklicken → **F7** öffnet die Piano Roll. Klicken setzt Noten,
   Rechtsklick löscht, am rechten Notenrand zieht man die Länge.
3. **Patterns verwalten:** Oben im Pattern-Wähler (oder **[ / ]**) zwischen Patterns wechseln,
   über *Patterns → New pattern* neue anlegen.
4. **Song anordnen:** In der Playlist (**F5**) klicken platziert das aktuelle Pattern. Mit **L** in
   den Song-Modus wechseln und abspielen.
5. **Abmischen:** **F9** öffnet den Mixer. Kanäle werden über die Nummer im Channel Rack auf
   Mixer-Spuren geroutet. Effekte über *+ Add effect* hinzufügen.
6. **Automatisieren:** Rechtsklick auf einen Regler (z. B. Lautstärke im Channel Rack) →
   *Create automation clip*. Im Clip in der Playlist setzt **Rechtsklick** Punkte, Ziehen verschiebt
   sie, der kleine Kreis zwischen zwei Punkten biegt die Kurve; Rechtsklick auf einen Punkt öffnet
   die Kurvenmodi. Abspielen im Song-Modus (**L**).
7. **Aufnehmen:** **F9** → Mixer-Spur wählen → oben im Track-Inspector den Eingang wählen
   („In 1 - In 2“ stereo oder „In 1“ mono; die Spur wird scharf geschaltet). Record (**R**), dann
   Play – nach Stop liegt die Aufnahme als Audio-Clip in der Playlist. Rechtsklick auf Record:
   Aufnahmefilter, **⌘P** Vorzähler.
8. **Plugins (Desktop-App):** **F8** öffnet den Plugin-Manager → *Find installed plugins*.
   Instrumente kommen als Kanal ins Channel Rack, Effekte in einen Mixer-Slot (Klick auf einen
   leeren Slot). Im Plugin-Fenster öffnet *Show plugin editor* die Oberfläche des Plugins.
9. **Exportieren:** *File → Export WAV…* (**⌘R**).

Eigene Samples einfach aus dem Finder in das Channel Rack (neuer Kanal), auf einen Kanal
(Sample ersetzen) oder in die Playlist (Audio-Clip) ziehen.

### Tastenkürzel (wie in FL Studio, Ctrl = ⌘ auf dem Mac)

| Taste | Funktion | Taste | Funktion |
| ----- | -------- | ----- | -------- |
| Space | Play / Stop | ⌃Space | Play / Pause |
| L | Pattern-/Song-Modus | R | Aufnahme |
| F5 / F6 / F7 / F9 | Playlist / Channel Rack / Piano Roll / Mixer | F8 / ⌥F8 | Plugin-Manager / Browser |
| F12 | Alle Fenster schliessen | Enter | Playlist maximieren |
| Esc | Fokussiertes Fenster schliessen | F2 / F4 | Pattern umbenennen / neues Pattern mit Name |
| + / − | Nächstes / vorheriges Pattern | ⌘F4 | Neues Pattern |
| ⌘Z | Rückgängig (schrittweise, Menü nennt die Aktion) | ⌥⌘Z | Wiederherstellen |
| ⌘M / ⌘P | Metronom / Aufnahme-Vorzähler | ⌃H | Alles stumm (Panic) |
| ⌘S / ⇧⌘S / ⌘N | Speichern / unter / neue Version | ⌘O / ⌘R | Öffnen / WAV exportieren |
| 1 … 0 / ⌘1 … 0 | Kanäle 1–10 stumm / solo | ⌘T | Computertastatur als Klavier |
| P · B · D · T · E | Werkzeug Zeichnen · Malen · Löschen · Stumm (Playlist) · Auswahl | Q · ⌥Q | Quantisieren |
| ⌘A / ⌘D | Alles wählen / Auswahl aufheben | ⌘C / ⌘V / ⌘B | Kopieren / Einfügen / Duplizieren |
| ⇧↑ ↓ / ⌘↑ ↓ | Noten um Halbton / Oktave transponieren | ⇧← → | Auswahl verschieben (Pfeile allein scrollen) |
| ⌘L (Piano Roll) | Legato | Home | Songposition an den Anfang |
| ⇧+Ziehen | Noten/Clips klonen | Entf | Auswahl löschen |
| ⌥C / ⌥Entf / ⌘L (Channel Rack) | Kanal klonen / löschen / auf freie Mixer-Spur | ⌘ + Mausrad | Horizontal zoomen |

Die vollständige Liste zeigt **F1** in der App. Rechtsklick auf einen Regler öffnet wie in FL
Studio das Reglermenü (Reset, Automation-Clip, Wert kopieren/einfügen/eintippen). Weitere
FL-Gewohnheiten: Doppelklick auf eine Note öffnet ihre Eigenschaften, Doppelklick auf einen
Pattern-Clip die Piano Roll, das Symbol links im Clip-Titel das Clip-Menü (stummschalten,
Quell-Pattern, *Make unique* …), Rechtsklick auf den Spurkopf das Spurmenü.

## Projektdateien

- `.madstudio` ist ein ZIP-Archiv mit `project.json` (lesbares JSON) und dem Ordner
  `samples/` mit allen importierten Audiodateien im Originalformat. Ein Projekt lässt sich so
  ohne fehlende Samples weitergeben.
- Die Sitzung wird alle paar Sekunden automatisch gesichert (IndexedDB) und beim nächsten
  Start wiederhergestellt. Das ersetzt aber kein Speichern in eine Datei.

## Architektur

```
src/
├── model/        Datenmodell (Projekt, Kanäle, Patterns, Noten, Clips, Mixer), Timing (96 PPQ),
│                 Timeline-Berechnung, Presets, Demo-Song, Dateiformat – reine Logik, ohne DOM
├── store/        Zustand (zustand + immer) mit Undo/Redo; alle Bearbeitungen laufen über actions.ts
├── audio/        Engine: Look-ahead-Scheduler, Synth, Sampler, Mixer-Graph, Effekte,
│                 Offline-Rendering, WAV-Encoder, synthetisierte Drum-Sounds
├── ui/           React-Oberfläche; Piano Roll und Playlist zeichnen auf <canvas>
├── project/      Öffnen/Speichern/Import/Export, Autosave
└── platform/     Brücke zu Electron (Dateidialoge, Menü) bzw. Browser-Fallbacks
electron/         Electron-Hauptprozess (app://-Protokoll, Menü, Dateidialoge), Preload und
                  engine.cjs (startet die native Engine und reicht ihre Nachrichten durch)
engine/           native Engine (C++20/JUCE 8, AGPLv3): Audio-Graph, Instrumente, Effekte,
                  VST3/AU-Hosting, Aufnahme, Offline-Rendering; Protokoll in engine/PROTOCOL.md
tests/e2e/        Playwright-Tests der laufenden App (Browser)
tests/native/     Playwright-Test der Desktop-App mit nativer Engine (Plugins, Rendern, Zustand)
```

Datenfluss: Jede Bearbeitung erzeugt über `edit()` einen neuen, unveränderlichen
Projektzustand (für Undo). Die Audio-Engine abonniert den Store und gleicht ihren Web-Audio-
Graphen ab: Kanal → Instrument → Kanal-Strip → Mixer-Insert → Effekte → Master. Der Scheduler
plant Noten etwa 120 ms im Voraus auf die Sample-genaue Audio-Uhr (Look-ahead-Verfahren),
sodass Timing-Schwankungen der Oberfläche nicht hörbar sind. Dieselbe Graph-Klasse rendert
offline für den WAV-Export.

In der Desktop-App rechnet stattdessen die **native Engine** in einem eigenen Prozess: Der
Renderer schickt ihr Projektzustand, fertig berechnete Timeline und Automation als JSON-Zeilen
(`project.sync`, `timeline.set`, `automation.set`), die Engine meldet Position, Pegel, Plugin-
Ereignisse und Aufnahmen zurück. Patterns und Clips werden also an genau einer Stelle (TypeScript)
interpretiert; beide Engines spielen dieselben Ereignisse. Startet die Engine nicht, schaltet die
App automatisch auf Web Audio um.

## Entwicklung

```bash
npm run dev          # Browser-Version mit Hot Reload
npm run app:dev      # Electron-Fenster mit Hot Reload
npm run typecheck    # TypeScript prüfen
npm test             # Unit-Tests (Vitest): Timing, Timeline, Scheduler, Store, Dateiformat, WAV, Sounds
npm run test:e2e     # End-to-End-Tests der laufenden App (Playwright, Chromium)
npm run check        # Typecheck + Unit-Tests + Build
npm run dist:mac     # macOS-App als DMG (arm64 + x64) nach release/, inkl. gebauter Engine
npm run icon         # App-Icon aus build/icon.svg neu erzeugen

# native Engine
npm run engine:configure && npm run engine:build   # cmake (Release) nach engine/build/Release
npm run engine:test                                # Protokolltest (stdio, Test-Plugins, Stresstest)
engine/build/Release/mad-engine --self-test        # native Unit-Tests (macOS: MAD Engine.app/…)
npx playwright test -c playwright.native.config.ts # Desktop-App + Engine (Linux: unter xvfb-run)
```

CI: [`mad-studio-ci.yml`](../../.github/workflows/mad-studio-ci.yml) prüft jede Änderung unter
Linux (Typecheck, Tests, Build, E2E, Electron-Start) und baut in einem zweiten Job die native
Engine (Self-Test, Protokolltest mit VST3-Test-Plugins, Electron mit Engine).
[`mad-studio-macos.yml`](../../.github/workflows/mad-studio-macos.yml) baut die Engine als
Universal-Binary (Self-Test, Protokolltest inkl. Audio Units), die Mac-App mit Engine, startet sie
testweise und stellt die DMGs als Artefakte bereit. Bei einem Tag
`mad-studio-v*` wird daraus ein GitHub-Release.

## Grenzen und nächste Schritte

Noch nicht enthalten (Roadmap):

- Plugin-Latenzausgleich (PDC), Sidechain-Eingänge und Mehrkanal-Ausgänge von Plugins, Plugin-Presets im Wrapper
- Native Engine unter Windows (vorbereitet, aber nicht gebaut/getestet); Plugin-Editoren brauchen ein Fenstersystem
- Time-Stretching von Audio-Clips, Takes/Comping, Punch-in
- Sends/Busse zwischen Mixer-Spuren
- MIDI-Datei-Import/Export, Import von `.flp`-Projekten (Format ist öffentlich dokumentiert)
- Autosave speichert grosse Sample-Sammlungen bei jeder Änderung komplett neu

## Lizenz der nativen Engine

Die native Engine (`engine/`) nutzt das JUCE-Framework unter der **GNU AGPLv3** und steht
deshalb selbst unter AGPLv3 (siehe [engine/LICENSE](engine/LICENSE)). Wer die App mit Engine
weitergibt, muss den Quellcode zugänglich machen (AGPL) – oder eine kommerzielle JUCE-Lizenz
verwenden (JUCE 8: kostenlose *Starter*-Stufe bis zu einer Umsatzgrenze, sonst *Indie*/*Pro*;
aktuelle Bedingungen auf juce.com prüfen). Für das VST3-SDK gelten zusätzlich die Bedingungen von
Steinberg. Die Oberfläche (`src/`, `electron/`) läuft in einem eigenen Prozess und spricht mit der
Engine nur über JSON-Nachrichten; ob das lizenzrechtlich als getrenntes Werk gilt, ist im Zweifel
juristisch zu klären.

## Rechtliches

MAD Studio ist ein unabhängiges Projekt und steht in keiner Verbindung zu Image-Line.
„FL Studio“ ist eine Marke von Image-Line Software und wird hier nur beschreibend als Vorbild
genannt. Es wurde kein Code, keine Grafik und kein Sound von FL Studio verwendet und nichts
dekompiliert. Wie das Vorbild untersucht wurde, steht in [RESEARCH.md](RESEARCH.md).
