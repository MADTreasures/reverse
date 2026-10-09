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
| Step-Sequencer | Linksklick schaltet, Linksziehen „malt“, Rechtsklick/-ziehen löscht; Klick wählt den Kanal; das Mausrad über den Steps verändert nichts (zeigt nur die Position) | identisch; die Step-Velocity liegt deshalb auf Alt+Rad (wie Alt+Rad über Noten in der Piano Roll), das normale Rad scrollt |
| Kanal-Kontextmenü | zweispaltig: links Piano roll, Graph editor, Rename/Change color/**Random color**, **Load sample…**, Insert/Replace, Clone, Delete; rechts **Cut/Copy/Paste** (Noten des Kanals im Pattern), Fill each 2/4/8 steps, Rotate left/right (Shift+Ctrl+←/→) … | gleiche Einträge (einspaltig) bis auf Graph editor, Insert/Replace und MIDI-Optionen |
| Regler ziehen | Ziehen ändert den Wert (Panning ≈ 1 %/px), **Ctrl+Ziehen fein** (≈ 0,5 %/px), **Shift+Ziehen grob** (≈ 3 %/px); Mausrad über Reglern ändert den Wert | gleiche Belegung (Ctrl/⌘ = fein, Shift = grob; vorher war Shift fein) |
| Regler-Rechtsklick | Kopf mit Name, **Reset**, Abschnitt *Automation* (Edit events, Init song …, **Create automation clip**), *Remote control*, *Value* (**Copy/Paste value, Type in value…**) | `controlMenu.ts` für alle Knobs, Fader, Tempo: Reset · Create/Edit automation clip · Copy/Paste/Type value |
| Automation-Clip anlegen | erscheint als eigener Kanal im Channel Rack, der Rack-Filter springt auf „Automation“; ein Clip über den ganzen Song (bei leerem Song 1 Takt) landet auf der ersten freien Playlist-Spur; der Playlist-Picker zeigt ihn an | identisch (`createAutomationClip`) |
| Automation bearbeiten | in der Playlist: **Rechtsklick in den Clip = Punkt setzen**, Rechtsklick auf Punkt = Menü (*Point n/m*, Delete, 13 Kurvenmodi, Copy/Paste/Type value), Ziehen = verschieben, kleiner Kreis in der Segmentmitte = Spannung; Rechtsklick auf die Titelleiste löscht den Clip; Hint zeigt Position und Wert | identisch (`Playlist.tsx`, `automation/curve.ts`, `pointMenu.ts`); Kurvenformeln sind eigene, da FL sie nicht dokumentiert |
| Automation-Fenster | „Automation editor“ mit Kurve, darunter „Target links“ | `AutomationEditor.tsx` (Kurve, Ziel, „Link to last tweaked“, Flip, Reset) |
| Mixer | Spuren mit Mute-LED, Pan, Fader, Pegel; rechts der **Track-Inspector**: oben Eingang („(none)“ / *FL Studio ASIO – stereo* „In 1 - In 2“ / *mono* „In 1“, „In 2“), zehn Slots, Equalizer, unten Ausgang „Out 1 - Out 2“; Eingang wählen **armt die Spur** (roter Punkt unter der Spur) | Track-Inspector mit Eingang, zehn Slots und Ausgang, Arm-Punkt unter jeder Spur, Mute-LED (Ctrl+Klick = Solo) |
| Mixer-Menü | *Disk recording* (Latenzkompensation, Monitor input, Auto-unarm), Arm/Disarm selected tracks … | Mixer-Menü „Disk recording“ mit denselben Optionen |
| Audio-Einstellungen | *Device*: eine Liste für Aus- und Eingang (ASIO-Treiber wie „FL Studio ASIO“), *Show ASIO panel* öffnet die Treibereinstellungen, die Pufferlänge stellt man unter Windows dort ein ([Manual: Audio settings](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/envsettings_audio.htm)) | Treibertyp ASIO® mit einem gemeinsamen Gerät für Aus- und Eingang, Knopf *Show ASIO panel*, ASIO-Compatible-Logo im Dialog (Steinbergs Vorgabe) |
| Record-Button | Hint: „Record (automation, score, audio, clips)“, Rechtsklick = Aufnahmefilter | Rechtsklick öffnet den Aufnahmefilter (Noten, Audio) und Vorzähler |
| Add-Menü | „More plugins…“, „Plugin database“, Kategorien (Drum, Synth, Sampler, Misc mit *Automation Clip* …) | „More plugins…“, Plugins (VST3/AU), Automation clip, eigene Synth-/Drum-Kategorien |
| Fenster-Tasten | F5/F6/F7/F9 holen ein offenes, aber verdecktes Fenster erst nach vorne und schliessen es beim zweiten Druck | war bereits so (`toggleWindow`) |
| Kanal-Button | Klick öffnet das Kanalfenster, erneuter Klick schliesst es | `toggleChannelEditor` |
| Mute-Schalter | Channel Rack: Klick = stumm, Ctrl+Klick = solo, **Rechtsklick = Menü** (Solo, Lock active/mute state, Automation …); Mixer: Klick = stumm, **Rechtsklick oder Ctrl+Klick = solo** | identisch (Menü mit Solo und Mute) |
| Snap | Menü *Main · Line · Cell · (none) · 1/6 … 1/2 step · Step · 1/6 … 1/2 beat · Beat · Bar*; Editoren stehen auf „Main“ und folgen dem Haupt-Snap in der Werkzeugleiste (Standard „Line“ = feinste sichtbare Rasterlinie, wird beim Zoomen feiner) | gleiche Liste, Haupt-Snap in der Werkzeugleiste, zoomabhängiges Raster (`gridLineTicks`) |
| Piano Roll – Maus | Klick setzt eine Note mit der Länge der zuletzt **angeklickten** oder geänderten Note; Rechtsklick löscht; Shift+Ziehen **klont**; Ctrl+Klick wählt eine Note, Ctrl+Shift+Klick ergänzt die Auswahl; Doppelklick öffnet *Note properties* (Pan, Velocity, Release, Filter, Fine pitch, Start time, Duration); Klick ins Lineal setzt die Abspielposition im Pattern; Alt+Rad ändert die Velocity | identisch; *Note properties* mit den Werten, die das Datenmodell kennt (Velocity, Startzeit, Dauer) |
| Piano Roll – Tasten | ←/→/↑/↓ scrollen, Shift+←/→ verschiebt die Auswahl, Shift+↑/↓ transponiert um einen Halbton, Ctrl+↑/↓ um eine Oktave; Ctrl+A wählt alles, **Ctrl+D hebt die Auswahl auf**; Ctrl+B dupliziert; Ctrl+L Legato | identisch (vorher: Pfeile verschoben direkt, Ctrl+D duplizierte) |
| Playlist – Maus | Klick platziert das Picker-Element, Rechtsklick löscht, Klick ins Lineal schaltet auf SONG und setzt die Position; Ctrl+Klick / Ctrl+Shift+Klick wie in der Piano Roll; Doppelklick auf einen Pattern-Clip öffnet die Piano Roll; Rad scrollt vertikal, Alt+Rad ändert die Spurhöhe | identisch |
| Playlist-Lineal | Linksklick/-ziehen setzt die Songposition; **Rechts-Ziehen markiert einen Zeitbereich** (rot), die Songposition springt an dessen Anfang und die Wiedergabe loopt darin; Rechtsklick erweitert die Markierung; Linksklick ausserhalb landet umgerechnet in der Schleife; Ctrl+D hebt sie auf | identisch (`transport.loop`, Schleife über `loopStart`/`loopEnd` beider Engines) |
| Slice-Werkzeug | Taste **C** in Playlist und Piano Roll: Klick schneidet Clip bzw. Note an der Snap-Position, Ziehen nach oben/unten schneidet weitere Spuren/Tasten an derselben Stelle | identisch (`sliceClips`, `sliceNotes`) |
| Clip-Menü | Klick auf das Symbol links im Clip-Titel: *Preview, Muted, Rename and color, Change color, Random color, Select source pattern, Edit pattern, Make unique, Select all similar clips, Delete* | gleiche Einträge ausser *Preview*; Clips können stummgeschaltet werden (neu im Datenmodell), Mute-Werkzeug **T** |
| Spurmenü | Rechtsklick auf den Spurkopf: *Rename, Auto name, Reset, … Mute/Unmute all clips, Insert one, Clone, Delete, Move up/down*; Stumm-LED rechts im Spurkopf, leere Spuren gedimmt | gleiche Einträge (ohne Spurfarben/-icons, Gruppen, Performance-Modus) |
| FILE-Menü | *New, New from template ›, Open, Save, Save as, Save new version, … Import › MIDI file, Export › Wave/MP3/OGG/FLAC/MIDI …* | gleicher Aufbau mit dem, was MAD Studio kann (Vorlagen: Basis-Kit, Demo-Song; Import: Audiodateien; Export: Wave) |
| EDIT-Menü / Undo | *Undo ‹Aktion›* (**Ctrl+Z**, mehrstufig), *Redo ‹Aktion›* (**Ctrl+Alt+Z**), Cut, Copy, Paste; nach Ctrl+Z zeigt die Hinweisleiste „Undone: playlist fill paint clip · Level 2/34“ | identisch: benannte Undo-Schritte (z. B. „piano roll move note“), gleiche Tasten, gleiche Hinweiszeile. Korrektur: vorher war Ctrl+Z ein Umschalter wie in älteren FL-Versionen |
| PATTERNS-Menü | *Find first empty… (Shift+F4), Find next empty… (F4), Find next empty (no naming) (Ctrl+F4), Rename and color… (F2), Change color, Random color, Transpose…, Insert one, Clone (Shift+Ctrl+C), Delete (Shift+Ctrl+Del), Move up/down (Shift+Ctrl+↑/↓), Split by channel, Render as audio clip …*; links die Pattern-Liste | gleiche Einträge und Tasten inklusive *Split by channel* (beobachtet: das Pattern behält den ersten Kanal und heisst danach, jeder weitere Kanal bekommt ein eigenes Pattern, die Playlist-Clips bleiben unverändert); ohne Rendern |
| VIEW-Menü | Abschnitte *Windows* (Playlist F5, Piano roll F7, Channel rack F6, Mixer F9, Browser Alt+F8, Plugin picker F8 …) und *Layout* (Close all windows F12, Close all plugin windows Alt+F12, Close all unfocused windows Ctrl+F12 …) | gleiche Abschnitte, Reihenfolge und Tasten für die vorhandenen Fenster |
| OPTIONS-Menü | Abschnitte *System* (MIDI/Audio/General settings, Manage plugins), *Project* (Project info F11), *MIDI*, *Switches* (Typing keyboard Ctrl+T, Metronome Ctrl+M, Recording precount Ctrl+P, **Start on input Ctrl+I**, Blend recorded notes, Loop record …) | gleiche Abschnitte; *Start on input* neu: bei scharfer Aufnahme startet die erste gespielte Note die Wiedergabe |
| TOOLS-Menü | *Last tweaked parameters*, **Score logger › Dump score log to selected pattern**, Macros (Stop sound …) | *Last tweaked*, Score-Logger neu: alles, was auf Tipp-Tastatur oder MIDI-Keyboard gespielt wird (auch ohne Aufnahme), lässt sich nachträglich ins Pattern übernehmen (letzte 1/2/5/10 Minuten) |
| Browser | Reiter *All, Project, Plugins, Presets, Sounds, Starred* | unter Wine blieb der Inhaltsbereich schwarz – nicht verglichen |

Bewusst **nicht** übernommen: FLs Grafik (Skin, Icons, Logo, Farbschema im Detail), Sounds und
Plugin-Namen. Das Bedienkonzept ist übernommen, das Aussehen bleibt eigenständig.

## VST/AU, Aufnahme, Automation und Latenzausgleich: wie FL Studio es macht

Quellen: FL Studio Online Manual (Seiten *Plugin Wrapper*, *System settings › Manage plugins*,
*Recording audio*, *Playlist › Automation Clips*, *Keyboard shortcuts*,
[*Mixer track properties › Plugin Delay Compensation*](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/mixer_trackprops.htm),
[*Mixer menu*](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/mixer_mixermenu.htm))
und die Beobachtungen oben.

| # | Beobachtung (Manual / Testversion) | Schlussfolgerung | Umsetzung |
| - | ---------------------------------- | ---------------- | --------- |
| 13 | Plugins laufen in einem **Wrapper** mit Preset-Menü, Parameterliste („Browse parameters“), Editor-Fenster und Optionen; „Make bridged“ startet ein Plugin in **separatem Prozess**, damit Abstürze FL nicht mitreissen | Plugin-Hosting gehört in einen nativen Prozess, getrennt von der Oberfläche | eigener Engine-Prozess `engine/` (C++/JUCE) mit stdio-Protokoll (`engine/PROTOCOL.md`); Wrapper-Fenster `PluginWrapper.tsx` mit allen Parametern als automatisierbare Knöpfe |
| 14 | **Plugin-Manager**: Suchpfade, „Scan & verify“ ordnet Plugins als Instrument oder Effekt ein; fehlerhafte Plugins werden markiert | Scannen muss abstürzende Plugins überleben | Scan **pro Plugin in einem eigenen Prozess** (`mad-engine --scan-plugin`), Liste mit Instrumenten/Effekten/Fehlern (`PluginManager.tsx`) |
| 15 | Instrument-Plugins sind **Kanäle** im Channel Rack, Effekt-Plugins sitzen in **Mixer-Slots** | gleiche Datenmodell-Trennung | Kanaltyp `plugin`, Slot-Typ `plugin`; Zustand der Plugins (Chunk, base64) wird beim Speichern aus der Engine geholt |
| 16 | „**Last tweaked**“: zuletzt bewegter Parameter (auch in Fremd-Plugins) → *Create automation clip* | Engine meldet Parameteränderungen aus dem Plugin-Fenster | `plugin.paramChanged` → `ui.lastTweaked`, Menü *Tools › Last tweaked* |
| 17 | Aufnahme: **Eingang am Mixer-Track** wählen (stereo/mono), Track wird **scharf geschaltet**, Record + Play; im Song-Modus entstehen **Audio-Clips in der Playlist**, im Pattern-Modus Audio-Clip-Kanäle; Dateien landen im Ordner **„Recorded“**; Optionen Latenzkompensation, Monitoring (Off / When armed / On), Auto-unarm, Vorzähler | Aufnahme hängt am Mixer, nicht an Playlist-Spuren | Modellfelder `MixerTrack.input`/`armed`; Web-Engine: `getUserMedia` + AudioWorklet (`recorder.ts`); native Engine: Gerät/Interface, WAV-Dateien im Ordner `~/Music/MAD Studio/Recorded`; Takes werden auf die aufnehmende Mixer-Spur geroutet |
| 18 | **Automation-Clips** sind spezielle Kanäle, ihre Clips laufen in der Playlist; zwischen Clips bleibt der letzte Wert stehen; ein Ziel kann mehrere Clips haben | Automation als Kanal + Playlist-Clip, Auswertung pro Ziel | `automation.ts` (Kurven, Auswertung, Linearisierung zu Stützstellen), `automationRuntime.ts` (Web Audio), Protokoll `automation.set` (native Engine) |
| 19 | Aufnahmefilter „Automation“: Reglerbewegungen während der Song-Aufnahme werden als Automation aufgezeichnet | Bewegungen in den Clip des Reglers schreiben, alte Punkte im überstrichenen Bereich ersetzen | `recordAutomationValue()` (Clip wird bei der ersten Bewegung angelegt, Punkte ausgedünnt) |
| 20 | Mixer-Menü › **Plugin delay compensation**: *Automatic* (Standard bei neuen Projekten, pro Projekt gespeichert), *Compensate automations* (FX-Automation bleibt mit dem verzögerten Audio synchron), *Reset manual latency on all tracks* | Plugins melden ihre Latenz; alle anderen Wege werden um die Differenz verzögert, Automation hinter latenten Plugins früher gelesen | native Engine: `planCompensation()` richtet Kanäle je Spur und Spuren am Master aus, Verzögerungsringe in den Graph-Snapshots, versetzt gelesene Automation (auch über den Loop-Sprung), Render ohne Vorlauf, Status/Metronom/Aufnahme um die Gesamtlatenz verschoben; Projektfelder `pdc`, `pdcAutomation`; Ereignis `latency` |
| 21 | **Delay-Panel** an jeder Mixer-Spur: orange bei erkannter Latenz, blau bei manuellem Versatz; Menü *Reset · Set in ms · Set in samples · Set in beats · Set from*; Mausrad 10 ms, Ctrl 1 ms, Ctrl+Alt 1 Sample; positiv verzögert die Spur, negativ alle anderen | manueller Versatz pro Spur zusätzlich zur Automatik | `MixerTrack.latencyOffset` (ms), Uhr-Symbol in jedem Strip und im Track-Inspector (`LatencyPanel`), Hinweisleiste mit Latenz, Verzögerung und Versatz |
| 22 | Wrapper › Settings › **Latency**: fester Versatz für Plugins, die ihre Latenz falsch melden | Versatz zur gemeldeten Latenz addieren | `latencyOffset` am Plugin (Samples), Feld im Plugin-Fenster neben der gemeldeten Latenz |

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
