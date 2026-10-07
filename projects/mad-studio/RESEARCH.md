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

## Unbekanntes / offene Fragen

- `.flp`-Import: Das Format ist von Open-Source-Projekten dokumentiert (Event-basiertes
  Binärformat). Ein Import der Noten, Patterns und Playlist wäre machbar; Plugin-Zustände
  (z. B. interne Synth-Parameter) bleiben herstellerspezifisch und unbekannt.
- Klangliche Nähe zu bestimmten FL-Plugins ist kein Ziel; die Factory-Sounds sind eigene Synthese.
