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

- `.flp`-Import: Das Format ist von Open-Source-Projekten dokumentiert (Event-basiertes
  Binärformat). Ein Import der Noten, Patterns und Playlist wäre machbar; Plugin-Zustände
  (z. B. interne Synth-Parameter) bleiben herstellerspezifisch und unbekannt.
- Klangliche Nähe zu bestimmten FL-Plugins ist kein Ziel; die Factory-Sounds sind eigene Synthese.
