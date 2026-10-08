# Recherche: FL Studio

Arbeitsprotokoll im Stil von REA: **Beobachtung**, **Schlussfolgerung** und **Unbekanntes**
werden getrennt festgehalten.

## Ausgangslage

Auftrag: „REA benutzen, um eine DAW wie FL Studio für den Mac zu machen.“

- FL Studio läuft seit Version 20 (2018) selbst nativ auf macOS. Ziel war deshalb **kein Port**,
  sondern ein **eigenständiger Nachbau des Workflows** unter eigenem Namen (MAD Studio).
- REA ([morluto/rea](https://github.com/morluto/rea)) analysiert ausgelieferte Programme
  (Binärdateien, Electron-Apps, Pakete), um ihre Funktionsweise zu erklären und Nachbauten
  anzuleiten.

## Entscheidung: Clean-Room statt Dekompilieren

| Punkt | Bewertung |
| ----- | --------- |
| Rechtlich | Lizenzverträge kommerzieller Software wie FL Studio untersagen Reverse Engineering in der Regel. Dekompilieren, um ein Konkurrenzprodukt zu bauen, ist auch gesetzlich nicht gedeckt (die Ausnahme in Art. 21 URG / EU-Richtlinie 2009/24 gilt nur für Interoperabilität). Code aus einer Dekompilierung zu übernehmen, wäre eine Urheberrechtsverletzung. |
| Technisch | Die FL-Studio-Binärdateien lagen in der Arbeitsumgebung (Linux-Cloud-Container) nicht vor; REAs native Analyse bräuchte zudem Hopper, Ghidra oder IDA. |
| Fachlich | Nicht nötig: Der Workflow von FL Studio ist im öffentlichen [FL Studio Online Manual](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/) beschrieben. Die DSP-Technik (Oszillatoren, Filter, Hüllkurven, Faltungshall …) ist allgemeines Fachwissen. |

Daher wurde **nichts von FL Studio heruntergeladen, installiert oder dekompiliert**. Quelle
waren öffentliche Dokumentation und allgemeines DAW-Wissen. Die Umsetzung ist vollständig
eigener Code mit eigenen Namen, Grafiken und Klängen.

REA ist im Repo trotzdem eingerichtet (`/.mcp.json`, `/.claude/skills/`), für erlaubte Anwendungen:
eigene Builds untersuchen (z. B. das paketierte `app.asar` von MAD Studio mit
`analyze-javascript-application`), Open-Source-Apps analysieren oder Dateiformate zur
Interoperabilität verstehen, wo das zulässig ist.

## Untersuchungsfragen

- [x] Aus welchen Bausteinen besteht der FL-Studio-Workflow?
- [x] Wie hängen Channel Rack, Patterns, Piano Roll und Playlist datenmässig zusammen?
- [x] Wie wird zwischen Pattern- und Song-Wiedergabe umgeschaltet?
- [x] Wie läuft das Signal vom Kanal bis zum Master?
- [x] Welche Bedienkonventionen erwarten FL-Nutzer (Maus, Tastenkürzel)?
- [x] Wie bedient sich FL Studio im Detail (Menüs, Maus, Kontextmenüs)? → Vergleich mit der installierten Testversion, siehe unten
- [x] Wie hostet FL Studio VST/AU-Plugins, wie nimmt es Audio auf, wie funktionieren Automation-Clips?
- [ ] Wie ist das `.flp`-Projektformat aufgebaut? (offen – nur für einen späteren Import relevant)

## Befunde → Umsetzung

| # | Konzept im Vorbild (Beobachtung, öffentliche Doku) | Schlussfolgerung für den Nachbau | Umsetzung in MAD Studio |
| - | -------------------------------------------------- | -------------------------------- | ----------------------- |
| 1 | **Channel Rack**: Liste von Kanälen (Instrumente/Sampler) mit Step-Sequencer-Zeile, Lautstärke, Pan und Mixer-Zuweisung | Ein Kanal ist ein Instrument plus Kanal-Strip; Steps sind nur eine Ansicht auf Noten | `Channel` in `src/model/types.ts`; `stepView()` leitet Steps aus Noten ab, mit Mini-Piano-Roll, wenn das nicht passt |
| 2 | **Patterns** enthalten Noten für alle Kanäle; Step-Sequencer und Piano Roll bearbeiten dieselben Daten | Noten pro Pattern und Kanal speichern; Pattern-Länge wächst mit dem Inhalt (ganze Takte) | `Pattern.notes[channelId]`, `patternLength()` |
| 3 | **Piano Roll** pro Kanal: Zeichnen, Verschieben, Länge, Velocity, Snap, Ghost Notes | Canvas-Editor mit Raster in Ticks | `src/ui/pianoroll/` (96 PPQ, Snap inkl. Triolen) |
| 4 | **Playlist**: Pattern-Clips und Audio-Clips auf Spuren, Song-Modus | Clips referenzieren Patterns; verlängerte Clips wiederholen das Pattern | `songTimeline()` expandiert Clips mit Schleife und Offset |
| 5 | **PAT/SONG**-Umschalter im Transport | Zwei Timeline-Quellen für denselben Scheduler | `patternTimeline()` / `songTimeline()`, Taste **L** |
| 6 | **Mixer**: Insert-Spuren mit Effekt-Slots, Kanäle werden Inserts zugewiesen, alles läuft in den Master | Graph Kanal → Insert → Master; Solo stummt andere Inserts | `ProjectGraph`, `MixerTrackNode` in `src/audio/graph.ts` |
| 7 | **Swing**-Regler im Channel Rack | Jede zweite 16tel verzögern | `swingOffsetTicks()` |
| 8 | **Cut-Gruppen** (z. B. offene/geschlossene Hi-Hat) | Choke-Gruppen pro Sampler-Kanal | `ChokeManager` |
| 9 | **„Typing keyboard to piano“** | Physische Tastenpositionen (unabhängig vom Layout) auf Halbtöne abbilden | `src/ui/keyboard.ts` (`event.code`) |
| 10 | **Browser** mit Samples/Presets per Drag & Drop | Drag-&-Drop-Payloads für Rack, Kanal und Playlist | `src/ui/dnd.ts`, `src/ui/browser/` |
| 11 | **Fenster-Workspace** mit frei verschiebbaren Fenstern, F5/F6/F7/F9 | Eigener Fenstermanager im Workspace | `src/ui/workspace/` (F8 schaltet hier den Browser) |
| 12 | **Export** als Audiodatei | Gleiche Graph-Klasse offline rendern | `renderProject()` + `encodeWav()` |

Bewusst **eigene** Lösungen (keine Übernahme aus dem Vorbild): Name, Farbschema, Icons,
App-Icon, Synth-Architektur und -Presets, prozedural synthetisierte Drums, Dateiformat
(`.madstudio` = ZIP + JSON).

## Vergleich mit der installierten FL-Studio-Testversion

Auftrag: „Installiere FL Studio und vergleiche, es soll sich möglichst gleich anfühlen und bedienen lassen.“

**Vorgehen.** Die kostenlose Testversion von FL Studio (Windows-Installer von image-line.com) wurde in
der Linux-Arbeitsumgebung unter Wine 9.0 auf einem virtuellen Bildschirm (Xvfb) installiert und per
Maus/Tastatur-Automation (xdotool) bedient; Screenshots dienten nur dem Vergleich und liegen **nicht**
im Repo. Version 26.1.7 startet unter Wine nicht (Signaturprüfung, bekanntes Wine-Problem ab 26.1.4,
Wine-Merge-Request 11824), daher wurde **26.1.3** verwendet. Die Lizenzbedingungen (EULA) verbieten
Reverse Engineering, Dekompilieren und Disassemblieren sowie das Übernehmen von Logos/Artwork – nichts
davon ist passiert: FL Studio wurde nur wie von einem Nutzer bedient und beobachtet (Black Box).

| Bereich | Beobachtung in FL Studio 26.1.3 | Umsetzung in MAD Studio |
| ------- | ------------------------------- | ----------------------- |
| Werkzeugleiste | Zwei Zeilen: oben Menüs (FILE … TOOLS HELP), PAT/SONG, Play/Stop/Record, Tempo, Songposition, Schalter für Tipp-Tastatur, Vorzähler, Loop-Aufnahme, Metronom; unten Hint-Leiste, Fenster-Buttons in der Reihenfolge Browser · Channel Rack · Piano Roll · Playlist · Mixer, Snap und Pattern-Auswahl mit „+“ | gleiche Anordnung (`TopBar.tsx`), eigene Icons; Menü „Tools“ mit „Last tweaked“ ergänzt |
| Standardprojekt | 130 BPM, vier/fünf Drum-Kanäle, je auf eigene Mixer-Spur geroutet | war bereits so (eigene Sounds) |
| Step-Sequencer | Linksklick schaltet, Linksziehen „malt“, Rechtsklick/-ziehen löscht; Klick wählt den Kanal | identisch (bestand schon) |
| Kanal-Kontextmenü | Piano roll · Rename/Color · Clone/Delete · Fill each 2/4/8 steps · Rotate left/right … | an FL angelehnt, „Rotate left/right“ (Shift+Ctrl+←/→) ergänzt |
| Regler-Rechtsklick | Kopf mit Name, **Reset**, Abschnitt *Automation* (Edit events, Init song …, **Create automation clip**), *Remote control*, *Value* (**Copy/Paste value, Type in value…**) | `controlMenu.ts` für alle Knobs, Fader, Tempo: Reset · Create/Edit automation clip · Copy/Paste/Type value |
| Automation-Clip anlegen | erscheint als eigener Kanal im Channel Rack, der Rack-Filter springt auf „Automation“; ein Clip über den ganzen Song (bei leerem Song 1 Takt) landet auf der ersten freien Playlist-Spur; der Playlist-Picker zeigt ihn an | identisch (`createAutomationClip`) |
| Automation bearbeiten | in der Playlist: **Rechtsklick in den Clip = Punkt setzen**, Rechtsklick auf Punkt = Menü (*Point n/m*, Delete, 13 Kurvenmodi, Copy/Paste/Type value), Ziehen = verschieben, kleiner Kreis in der Segmentmitte = Spannung; Rechtsklick auf die Titelleiste löscht den Clip; Hint zeigt Position und Wert | identisch (`Playlist.tsx`, `automation/curve.ts`, `pointMenu.ts`); Kurvenformeln sind eigene, da FL sie nicht dokumentiert |
| Automation-Fenster | „Automation editor“ mit Kurve, darunter „Target links“ | `AutomationEditor.tsx` (Kurve, Ziel, „Link to last tweaked“, Flip, Reset) |
| Mixer | Spuren mit Mute-LED, Pan, Fader, Pegel; rechts der **Track-Inspector**: oben Eingang („(none)“ / *FL Studio ASIO – stereo* „In 1 - In 2“ / *mono* „In 1“, „In 2“), zehn Slots, Equalizer, unten Ausgang „Out 1 - Out 2“; Eingang wählen **armt die Spur** (roter Punkt unter der Spur) | Track-Inspector mit Eingang, zehn Slots und Ausgang, Arm-Punkt unter jeder Spur, Mute-LED (Ctrl+Klick = Solo) |
| Mixer-Menü | *Disk recording* (Latenzkompensation, Monitor input, Auto-unarm), Arm/Disarm selected tracks … | Mixer-Menü „Disk recording“ mit denselben Optionen |
| Record-Button | Hint: „Record (automation, score, audio, clips)“, Rechtsklick = Aufnahmefilter | Rechtsklick öffnet den Aufnahmefilter (Noten, Audio) und Vorzähler |
| Add-Menü | „More plugins…“, „Plugin database“, Kategorien (Drum, Synth, Sampler, Misc mit *Automation Clip* …) | „More plugins…“, Plugins (VST3/AU), Automation clip, eigene Synth-/Drum-Kategorien |

Bewusst **nicht** übernommen: FLs Grafik (Skin, Icons, Logo, Farbschema im Detail), Sounds und
Plugin-Namen. Das Bedienkonzept ist übernommen, das Aussehen bleibt eigenständig.

## VST/AU, Aufnahme und Automation: wie FL Studio es macht

Quellen: FL Studio Online Manual (Seiten *Plugin Wrapper*, *System settings › Manage plugins*,
*Recording audio*, *Playlist › Automation Clips*, *Keyboard shortcuts*) und die Beobachtungen oben.

| # | Beobachtung (Manual / Testversion) | Schlussfolgerung | Umsetzung |
| - | ---------------------------------- | ---------------- | --------- |
| 13 | Plugins laufen in einem **Wrapper** mit Preset-Menü, Parameterliste („Browse parameters“), Editor-Fenster und Optionen; „Make bridged“ startet ein Plugin in **separatem Prozess**, damit Abstürze FL nicht mitreissen | Plugin-Hosting gehört in einen nativen Prozess, getrennt von der Oberfläche | eigener Engine-Prozess `engine/` (C++/JUCE) mit stdio-Protokoll (`engine/PROTOCOL.md`); Wrapper-Fenster `PluginWrapper.tsx` mit allen Parametern als automatisierbare Knöpfe |
| 14 | **Plugin-Manager**: Suchpfade, „Scan & verify“ ordnet Plugins als Instrument oder Effekt ein; fehlerhafte Plugins werden markiert | Scannen muss abstürzende Plugins überleben | Scan **pro Plugin in einem eigenen Prozess** (`mad-engine --scan-plugin`), Liste mit Instrumenten/Effekten/Fehlern (`PluginManager.tsx`) |
| 15 | Instrument-Plugins sind **Kanäle** im Channel Rack, Effekt-Plugins sitzen in **Mixer-Slots** | gleiche Datenmodell-Trennung | Kanaltyp `plugin`, Slot-Typ `plugin`; Zustand der Plugins (Chunk, base64) wird beim Speichern aus der Engine geholt |
| 16 | „**Last tweaked**“: zuletzt bewegter Parameter (auch in Fremd-Plugins) → *Create automation clip* | Engine meldet Parameteränderungen aus dem Plugin-Fenster | `plugin.paramChanged` → `ui.lastTweaked`, Menü *Tools › Last tweaked* |
| 17 | Aufnahme: **Eingang am Mixer-Track** wählen (stereo/mono), Track wird **scharf geschaltet**, Record + Play; im Song-Modus entstehen **Audio-Clips in der Playlist**, im Pattern-Modus Audio-Clip-Kanäle; Dateien landen im Ordner **„Recorded“**; Optionen Latenzkompensation, Monitoring (Off / When armed / On), Auto-unarm, Vorzähler | Aufnahme hängt am Mixer, nicht an Playlist-Spuren | Modellfelder `MixerTrack.input`/`armed`; Web-Engine: `getUserMedia` + AudioWorklet (`recorder.ts`); native Engine: Gerät/Interface, WAV-Dateien im Ordner `~/Music/MAD Studio/Recorded`; Takes werden auf die aufnehmende Mixer-Spur geroutet |
| 18 | **Automation-Clips** sind spezielle Kanäle, ihre Clips laufen in der Playlist; zwischen Clips bleibt der letzte Wert stehen; ein Ziel kann mehrere Clips haben | Automation als Kanal + Playlist-Clip, Auswertung pro Ziel | `automation.ts` (Kurven, Auswertung, Linearisierung zu Stützstellen), `automationRuntime.ts` (Web Audio), Protokoll `automation.set` (native Engine) |
| 19 | Aufnahmefilter „Automation“: Reglerbewegungen während der Song-Aufnahme werden als Automation aufgezeichnet | Bewegungen in den Clip des Reglers schreiben, alte Punkte im überstrichenen Bereich ersetzen | `recordAutomationValue()` (Clip wird bei der ersten Bewegung angelegt, Punkte ausgedünnt) |

## REA-Prüfung des eigenen App-Pakets

REA wurde auf das **ausgelieferte** `app.asar` von MAD Studio angewendet (statische Analyse,
nichts ausgeführt) – als unabhängige Sicherheitsprüfung der Electron-Hülle.

| Prüfpunkt | Beobachtung (REA) | Evidence |
| --------- | ----------------- | -------- |
| Fenster-Sicherheit | 1 BrowserWindow: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, Preload gesetzt (AST, exakt) | `ev_24e6bd59…`, `ev_22dc38d0…` |
| Preload-Brücke | genau 1 API `madNative` mit 8 Mitgliedern (`saveFile`, `openFile`, `onMenu`, `onOpenFile`, `setDocumentEdited`, `setTitle`, `ready`, `platform`) | beide |
| IPC | 6 Handler im Hauptprozess, alle 6 Renderer-Sendungen gepaart, keine ungepaarten | beide |
| Dynamische Kanäle | 1. Lauf: 1 nicht auflösbarer Listener (generischer `subscribe(channel, …)`-Helfer) → Preload auf literale Kanäle umgestellt; 2. Lauf: 0 dynamische, `menu:action` und `file:opened` erkannt | `ev_24e6bd59…` → `ev_22dc38d0…` |
| Absender-Prüfung | von REA **nicht beobachtet** (0) – der Code prüft jeden Aufruf über `isTrustedSender()`, diese Helfer-Form erkennt die statische Analyse aber nicht. Status: unbekannt, nicht „fehlt“ | beide |

Daraus abgeleitete Härtung (Schlussfolgerung, eigene Designentscheidung):

- `file:save` schreibt ohne Dialog nur noch an Pfade, die der Nutzer selbst gewählt oder im
  Finder geöffnet hat. Vorher hätte ein kompromittierter Renderer an beliebige Orte schreiben können.
- Preload-Kanäle literal statt über einen generischen Helfer – die IPC-Oberfläche bleibt prüfbar.

Grenzen dieser Prüfung: Analysiert wurde die Electron-Hülle (`package.json`, `electron/`,
`index.html`) aus dem echten Paket. Beim kompletten `app.asar` brach REA 5.0.0 nach der Analyse
beim Ausgeben des Ergebnisses ab (`RangeError: Invalid string length` – das Ergebnis-JSON für das
430-KB-React-Bundle sprengt die maximale String-Länge). Der MCP-Aufruf aus Claude Code läuft
zudem nach 60 s in ein Timeout; für grosse Ziele die CLI verwenden:
`npx -y rea-agents@5.0.0 analyze-javascript-application <pfad> --json`.

## Unbekanntes / offene Fragen

- Die genauen Formeln von FLs Kurvenmodi (Single/Double curve 2/3, Stairs …) sind nicht dokumentiert;
  MAD Studio verwendet eigene Formeln mit ähnlichem Verhalten.

- `.flp`-Import: Das Format ist von Open-Source-Projekten dokumentiert (Event-basiertes
  Binärformat). Ein Import der Noten, Patterns und Playlist wäre machbar; Plugin-Zustände
  (z. B. interne Synth-Parameter) bleiben herstellerspezifisch und unbekannt.
- Klangliche Nähe zu bestimmten FL-Plugins ist kein Ziel; die Factory-Sounds sind eigene Synthese.
