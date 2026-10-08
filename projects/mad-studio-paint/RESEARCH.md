# Recherche: Clip Studio Paint

Arbeitsprotokoll im Stil von REA: **Beobachtung**, **Schlussfolgerung** und **Unbekanntes**
werden getrennt festgehalten. Jede Aussage über das Vorbild hat eine Quelle; Abkürzungen der
Quellen stehen am Ende.

## Ausgangslage

Aufträge:

1. „REA benutzen, um das Zeichenprogramm Clip Studio Paint für den Mac zu machen“ – in einem
   eigenen Projektordner „MAD Studio Paint“.
2. „Clip Studio Paint installieren und vergleichen; es soll sich möglichst gleich anfühlen und
   bedienen lassen.“

Clip Studio Paint (Celsys) läuft selbst nativ auf macOS. Ziel ist deshalb kein Port, sondern ein
**eigenständiges Programm mit derselben Bedienung** unter eigenem Namen.

## Prüfung: Installieren und mit REA analysieren?

| Punkt | Beobachtung | Quelle |
| ----- | ----------- | ------ |
| Installer | Aktuelle Version 5.1.5 (Stand 15.09.2026): `CSP_515m_app.pkg` (macOS, 455 MB) und `CSP_515w_setup.exe` (Windows, 489 MB) auf `vd.clipstudio.net`, erreichbar über `clipstudio.net/en/dl/latest`. **Nicht heruntergeladen.** | HTTP-HEAD-Abfragen, 08.10.2026 |
| Arbeitsumgebung | Linux-Cloud-Container (x86_64) ohne macOS, Windows oder GPU. Weder das `.pkg` noch das `.exe` laufen dort. | `uname -m`, `/etc/os-release` |
| Lizenzregistrierung | Die Software verlangt beim ersten Start eine Lizenzregistrierung (Seriennummer und Hardware-Informationen); auch die Testversion braucht eine Registrierung. | EULA §3, §4.3 |
| Installationsort | Nur auf einem Rechner, den der Nutzer „besitzt, hat und bedient“ (Main Computer), plus höchstens einem zweiten. Ein fremder Cloud-Container ist das nicht. | EULA §4.1, §4.2 |
| Reverse Engineering | „User may not … decompile, reverse engineer, disassemble, attempt to derive the source code … or otherwise reduce the Software.“ Datenstruktur, Design, Aufbau und Code gelten als Geschäftsgeheimnis. | EULA §5.2, §5.3, §2 |
| Gesetz (Schweiz) | Dekompilieren ist nur zur Herstellung von Interoperabilität erlaubt (Art. 21 URG), nicht für ein konkurrierendes Programm. Ideen und Bedienkonzepte sind urheberrechtlich nicht geschützt; Code, Grafiken und Texte schon. | URG |

**Entscheidung:** Clip Studio Paint wurde **nicht heruntergeladen, nicht installiert und nicht
mit REA untersucht**. REA wird nur auf das *eigene* Programm angewendet (siehe unten). Die
Bedienung wurde aus der **öffentlichen Dokumentation** übernommen (Clean-Room): Ideen,
Abläufe, Tastenkürzel und Anordnungen – keine Texte, Bilder, Icons, Pinsel oder Dateien.
Den direkten Vergleich am echten Programm kann man auf dem eigenen Mac mit der Testversion
machen – dafür gibt es die [Checkliste](#selbst-vergleichen-checkliste-für-den-eigenen-mac).

## Methode

1. **Spezifikation aus der Doku.** Vier getrennte Recherchen über das offizielle Handbuch der
   Version 5.0 (help.clip-studio.com), offizielle Tipps (tips.clip-studio.com,
   „ClipStudioOfficial“), Support-FAQ und Release Notes:
   Tastenkürzel & Menüs · Bildschirmaufbau & Paletten · Werkzeuge & Pinselgefühl ·
   Ebenen, Ansicht & Dateien. Jede Angabe mit Quelle und Konfidenz (H = steht im Text,
   M = aus offiziellem Screenshot oder Tipps, L = Dritte oder Schlussfolgerung).
   Screenshots aus dem Handbuch wurden nur angesehen (für Proportionen und Farben), nicht ins
   Repo übernommen.
2. **Umsetzung** in eigenem Code, eigene Icons, eigene Pinselwerte.
3. **Nachweis**: Jede übernommene Bedienregel hat einen automatisierten Test
   (`tests/e2e/app.spec.ts`, Unit-Tests unter `src/**`). Spalte „Test“ unten.
4. **REA** prüft das eigene Programm: Laufzeitaufnahme der Oberfläche und statische Analyse des
   ausgelieferten `app.asar`.

## Vergleich: Clip Studio Paint (laut Handbuch) ↔ MAD Studio Paint

Status: ✅ gleich · 🟡 ähnlich/vereinfacht · ❌ fehlt (noch)

### Oberfläche

| Bereich | Clip Studio Paint (Doku) | MAD Studio Paint | Status | Test |
| ------- | ------------------------ | ---------------- | ------ | ---- |
| Standard-Layout (Ver. 5) | Links: Werkzeugpalette (1 Spalte, Farbsymbole unten), Stapel „Tool Group \| Tool Settings“, „Color Wheel \| Color Slider“, „Color Set \| Color History“, schmale „Tool Sliders“ (Grösse, Deckkraft). Rechts: „Navigator“, „Layer \| … \| History“ [IF, TIPS] | identisch angeordnet; Material-Leiste ganz rechts fehlt | 🟡 | `boots into the default workspace` |
| Klassisches Layout („Ver. 4.2 layout“) | Links: Sub Tool, Tool Property, Brush Size, Farbpaletten untereinander; Command Bar mit Auswahl-Befehlen [PDF4 S. 7] | *Window → Workspace: Classic layout* | ✅ | `workspace switch …` |
| Farbschema | Dunkel (Paletten ≈ #3f3f3f, Leisten ≈ #4e4e4e, Auswahl ≈ #606a80), hell umschaltbar [PREF, Screenshots] | dieselben Grautöne; hell über *Preferences* (⌘K) | ✅ | `preferences (⌘K) …` |
| Werkzeugpalette | Reihenfolge Ver. 5: Pen, Pencil, Brush, Eraser, Airbrush, (Decoration), Blend · Selection, Auto select, Fill, Gradient · Operation, Figure, (Text, Comic, Ruler, Correct line), Move, Eyedropper [TOOLPAL] | gleiche Reihenfolge für alle vorhandenen Werkzeuge | 🟡 | – |
| Tool Group / Sub Tool | Gruppen-Schaltflächen oben, Liste mit Strichvorschau und Namen unten rechts [USE, CUST] | gleich | ✅ | – |
| Tool Settings | Zeilen: Beschriftung, dünner Balken, Wert mit Pfeilen, Druck-Schalter ganz rechts; Pen: Brush Size, Opacity, Anti-aliasing (4 Stufen), Stabilization; Schraubenschlüssel öffnet erweiterte Einstellungen [USE, DYN] | gleich (Schraubenschlüssel blendet Härte, Abstand, Körnung, Mindestgrösse ein) | ✅ | – |
| Brush Size | Voreinstellungen 0.7 … 2000 px als Punkte [BS] | dieselbe Liste | ✅ | – |
| Tool Sliders | senkrechte Regler für Grösse und Deckkraft mit Blasen [TS] | gleich | ✅ | – |
| Farbsymbole | Haupt-, Unter- und Transparentfarbe; Ver. 5 Kreise, früher Quadrate [SEL, NEW] | Kreise (Standard) / Quadrate (klassisch) | ✅ | – |
| Color Wheel | Farbtonring mit Quadrat (HSV), H/S/V-Werte unten [CW] | gleich; HLS-Dreieck fehlt | 🟡 | – |
| Color Slider / Set / History | RGB/HSV/CMYK-Regler; Farbsets; Verlauf neueste oben links [CS, CSET, CH] | RGB-Regler; ein eigenes Farbset; Verlauf | 🟡 | – |
| Navigator | Vorschau mit rotem Rahmen, Zeile Zoom (Regler, −, +, 100 %, einpassen), Zeile Drehung (Regler, links, rechts, zurücksetzen, spiegeln H/V) [NAV] | gleich | ✅ | – |
| Statusleiste der Leinwand | Zoom- und Drehregler mit Knöpfen [CANVAS] | gleich | ✅ | – |
| Command Bar | Ver. 5: Neu, Öffnen, Speichern · Undo, Redo · Löschen, Füllen, Skalieren/Drehen · Spiegeln · Hilfe [CMD] | gleich (ohne „Clip Studio öffnen“, „Smartphone“) | 🟡 | – |
| Auswahl-Starter | Leiste unter der Auswahl: Aufheben, Zuschneiden, Umkehren, Vergrössern, Verkleinern, Löschen, Ausserhalb löschen, Ausschneiden+Einfügen, Kopieren+Einfügen, Transformieren, Füllen, (Neuer Ton) [LCH] | alle ausser „Neuer Ton“ | 🟡 | `selection: drag selects …` |
| Fenstertitel | „Name (B x H px DPI Zoom%)“, Stern bei Änderungen [PC] | „Name* (B x Hpx DPIdpi Zoom%) - MAD Studio Paint“ | ✅ | `boots …` |
| Paletten ausblenden | Tab = alle Paletten, ⇧Tab = Titel-/Menüleiste [HIDE] | gleich | ✅ | `workspace switch …` |

### Werkzeuge und Pinselgefühl

| Bereich | Clip Studio Paint (Doku) | MAD Studio Paint | Status | Test |
| ------- | ------------------------ | ---------------- | ------ | ---- |
| Untertools Pen | G-pen, Real G-pen, Mapping pen, Turnip pen, … Marker: Milli pen, Felt pen, Dot pen [T4846] | G-pen, Real G-pen, Mapping pen, Turnip pen · Milli pen, Felt pen, Dot pen (eigene Werte) | 🟡 | `, and . step …` |
| Untertools Pencil, Brush, Airbrush, Eraser, Blend | Pencil, Mechanical pencil, Charcoal, Crayon, … · Watercolor/Ink/Thick paint · Soft, Spray, Droplet … · Hard, Soft, Kneaded, Rough … · Blend, Blur, Finger tip … [T4846, PB] | je eine Auswahl mit denselben Namen; keine Farbmischung (Watercolor-Kanten, Ölfarbe) | 🟡 | – |
| Standardwerte | G-pen 10 px, Stabilisierung 6, Kantenglättung „Middle“; Pencil Deckkraft 90 % mit Druck; Straight line 3 px [Screenshots] | gleich | ✅ | – |
| Deckkraft vs. Dichte | Deckkraft begrenzt den ganzen Strich, „Brush density“ wirkt pro Tupfer [GL-I, T563] | gleich (Strichpuffer) | ✅ | `blend mode and opacity …` |
| Kantenglättung | 4 Stufen: None, Weak, Middle, Strong [GL-A] | 4 Stufen | ✅ | – |
| Stiftdruck | Druck auf Grösse/Dichte, Kurve und Mindestwert [DYN] | Druck auf Grösse und Dichte, linear mit Mindestwert; keine Neigung, keine freie Kurve, keine globale Druckeinstellung | 🟡 | Unit: `pressureCurve` |
| Stabilisierung | 0–100 (Bereich nicht dokumentiert), wirkt ab Stiftkontakt [GL-C] | gleitender Mittelwert, 0–100, holt am Strichende auf | 🟡 | Unit: `Stabilizer` |
| Füllen | Untertools „Refer only to editing layer“ / „Refer other layers“; Einstellungen: nur verbundene Pixel, Lücke schliessen (5 Stufen), Toleranz, Bereichsvergrösserung, Mehrfachreferenz (alle / Referenzebene …); Entwurfsebenen und Papier werden nicht referenziert; ⇧-Klick schaltet Mehrfachreferenz um [FILL, GL-F, GL-R] | alles davon; „To darkest pixel“, „Enclose and fill“, „Lasso fill“ fehlen | 🟡 | `fill tool fills …`, Unit: `closes small gaps …` |
| Auto select | wie Füllen + Auswahlmodus; ⌘-Klick schaltet Mehrfachreferenz um [AUTO] | gleich | ✅ | – |
| Auswahlbereich | Rechteck, Ellipse, Lasso, Polylinie, Auswahlstift, Auswahl radieren …; ⇧ hinzufügen, ⌥ abziehen, ⇧⌥ Schnittmenge; ⇧ Quadrat/Kreis [SEL] | alle genannten; Magnet-Lasso, „Shrink selection“ fehlen | 🟡 | `polyline selection …`, `selection pen …` |
| Verlauf | „Foreground to transparent“, „Foreground to background“ …; Form Linie/Kreis/Ellipse [GRAD] | Linie und Kreis, beide Farbvarianten; kein Verlaufseditor | 🟡 | – |
| Figur | Gerade (⇧ = 45°), Rechteck/Ellipse (⇧ = Quadrat/Kreis), Kurven, Polylinie … [FIG] | Gerade, Rechteck, Ellipse | 🟡 | – |
| Ebene verschieben | in der Gruppe „Operation“ (K); ⌥-Ziehen kopiert, ⇧ fixiert die Richtung [LAY, MOD] | gleich; auch Gruppe „Operation“ mit „Select layer“ (D) | ✅ | `free transform …` |
| Transformieren | ⌘T Skalieren/Drehen (Seitenverhältnis bleibt), ⇧⌘T frei; ausserhalb ziehen = drehen; ⇧ = 45°-Schritte; Enter/Doppelklick bestätigt, Esc bricht ab [TR] | gleich; Verzerren, Perspektive, Netz fehlen | 🟡 | `free transform …` |
| Pipette | „Pick displayed color“ / „Pick color from layer“; ⌥-Klick in Zeichenwerkzeugen; Rechtsklick überall [EYE, MOD] | gleich | ✅ | `⌥-click with a brush picks …` |
| Blend | Blend, Blur, Finger tip (Werte nicht dokumentiert) [PB] | eigene Umsetzung (Weichzeichnen bzw. Verwischen) | 🟡 | – |
| Zoom / Hand / Drehen | Klick zoomt, ⌥ kehrt um, Ziehen links/rechts = stufenlos; Doppelklick mit „Drehen“ setzt zurück [GL-Z, NAV] | gleich | ✅ | `rotation: …` |

### Zusatztasten während der Bedienung (macOS: Ctrl → ⌘, Alt → ⌥)

| Zusatztaste | Clip Studio Paint [MOD] | MAD Studio Paint | Status | Test |
| ----------- | ----------------------- | ---------------- | ------ | ---- |
| Space + Ziehen | Hand | gleich | ✅ | `Space + drag pans …` |
| ⇧Space + Ziehen, ⇧ + Mausrad | Ansicht drehen | gleich | ✅ | `Space + drag pans …` |
| Space, dann ⌘ + Klick / ⌥Space + Klick | Zoom + / − | gleich | ✅ | Unit: `modifier keys` |
| ⌥-Klick (Zeichenwerkzeuge, Füllen, Verlauf, Figur) | Pipette | gleich | ✅ | `⌥-click …` |
| ⌘⌥-Ziehen | Pinselgrösse | gleich (mit Kreisvorschau) | ✅ | Unit |
| ⇧-Ziehen / ⇧-Klick | gerade Linie / Verbindung zum letzten Punkt | gleich | ✅ | `⇧-click connects …` |
| ⇧⌘-Klick | Ebene unter dem Zeiger wählen | gleich | ✅ | Unit |
| Rechtsklick | Pipette | gleich | ✅ | Unit |
| Werkzeugtaste halten | Werkzeug nur solange gedrückt (500 ms) | gleich, Zeit in *Preferences* | ✅ | `holding a tool key …` |
| ⌘-Ziehen mit Zeichenwerkzeugen | temporär „Object“-Werkzeug | fehlt (keine Vektorobjekte) | ❌ | – |

### Tastenkürzel (macOS)

| Funktion | Clip Studio Paint [TS, MENU, OPT] | MAD Studio Paint | Status |
| -------- | --------------------------------- | ---------------- | ------ |
| Werkzeuge | / Zoom · H Hand · R Drehen · D Ebene wählen · K Ebene verschieben · M Auswahl · W Auto select · I Pipette · P Pen/Pencil · B Brush/Airbrush · E Radierer · J Blend · G Füllen/Verlauf · U Figur | gleich | ✅ |
| Gruppen | mehrmals drücken wechselt; , / . = voriges/nächstes Werkzeug der Gruppe | gleich | ✅ |
| Datei | ⌘N, ⌘O, ⌘S, ⇧⌘S | gleich | ✅ |
| Bearbeiten | ⌘Z, ⌘Y/⇧⌘Z, ⌘X/F2, ⌘C/F3, ⌘V/F4, ⌫ Löschen, ⇧⌫ ausserhalb löschen, ⌥⌫ Füllen, ⌘U HSL, ⌘I Umkehren, ⌘T, ⇧⌘T | gleich | ✅ |
| Ebene | ⇧⌘N, ⌘G, ⇧⌘G, ⌥⌘G, ⌘E, ⇧⌘E, ⌥] / ⌥[ | gleich | ✅ |
| Auswahl | ⌘A, ⌘D, ⇧⌘D, ⇧⌘I | gleich | ✅ |
| Ansicht | ⌘+ / ⌘−, ⌥⌘0 100 %, ⌘0 einpassen, `-` / `^` drehen (5°) | gleich; auf US-Tastaturen zusätzlich `=` | ✅ |
| Optionen | [ / ] Grösse (Voreinstellungsschritte), ⌘[ / ⌘] Deckkraft, ⇧⌘O / ⇧⌘P Dichte, X Farben tauschen, C Transparentfarbe, 0 Mehrfachreferenz | gleich | ✅ |
| Fenster | Tab, ⇧Tab; ⌘K Einstellungen | gleich | ✅ |

### Ebenen

| Bereich | Clip Studio Paint (Doku) | MAD Studio Paint | Status | Test |
| ------- | ------------------------ | ---------------- | ------ | ---- |
| Neue Illustration | „Paper“ + „Layer 1“; Ebenen heissen „Layer N“, Ordner „Folder N“, Kopien „… Copy“ [T1250, Screenshots, PRF] | gleich | ✅ | `layers: …` |
| Ebenenmodi | 28 Modi in fester Reihenfolge + „Through“ für Ordner [BL, T656] | alle 28; die 11 Modi ohne Canvas-Entsprechung (Linear burn, Subtract, Glow dodge, Add, Vivid/Linear/Pin light, Hard mix, Darker/Lighter color, Divide) pixelweise berechnet; Glow dodge / Add (Glow) nach einem Modell (Formel nicht offiziell) | 🟡 | `per-pixel blending modes …`, Unit: `blendPixels` |
| Ordner | Standard „Normal“ (isoliert), „Through“ wählbar; auf „Through“-Ordner kann nichts beschnitten werden [FOL] | gleich | ✅ | Unit: `never clips onto …` |
| Schnittmaske | Alpha und Deckkraft der Basis wirken; rosa Balken [OLS] | gleich | ✅ | `layers: …` |
| Referenz-, Entwurfsebene, Sperren, Transparente Pixel schützen | Leuchtturm-Symbol; Entwurf = blauer Balken, nicht im Export und nicht in Füll-Referenz; Sperren blockiert Zeichnen und Einstellungen [REF, DR, JS] | gleich | ✅ | – |
| Paletten-Interaktionen | ⌥-Klick aufs Auge = nur diese Ebene; ⌘-Klick aufs Miniaturbild = Auswahl; ⌥-Ziehen = Duplikat; Doppelklick = umbenennen [LP, BO] | gleich | ✅ | `layer palette: ⌥-click …` |
| Neue Ebene | direkt über der aktiven, bzw. oben in einem gewählten Ordner [BO, FOL] | gleich | ✅ | `folders: …` |
| Vereinen | Mit unterer: verweigert bei gesperrten, ausgeblendeten, Entwurfsebenen; behält Name/Modus der unteren. Sichtbare vereinen: Ausgeblendete und Entwürfe bleiben [T582] | gleich | ✅ | `merging is refused …` |
| Auf untere Ebene übertragen | Pixel nach unten, obere bleibt leer [JB] | gleich | ✅ | – |
| Vektor-, Text-, Füll-, Ton-, Korrekturebenen, Masken | vorhanden [WAL] | fehlen | ❌ | – |

### Ansicht, Undo, Dateien

| Bereich | Clip Studio Paint (Doku) | MAD Studio Paint | Status | Test |
| ------- | ------------------------ | ---------------- | ------ | ---- |
| Zoomstufen | 3200, 1600, 800, 400, 200, 150, 100, 66.67, 50, 33.33, 25 % … bis 0.78 % [PRF, T684] | gleich (unter 25 % halbierend, nicht belegt) | 🟡 | `zoom steps …` |
| Drehen | Schritt 5° (einstellbar), −179.9 … 180°, Ansicht spiegeln [NAV, PRF] | gleich | ✅ | `rotation: …` |
| Mausrad | zoomt [NAV] | Mausrad zoomt; Trackpad: zwei Finger verschieben, Pinch zoomt | 🟡 | – |
| Undo | Anzahl in den Einstellungen (Desktop-Screenshot: 200), History-Palette [UND, PRF] | 200, einstellbar; History-Palette | ✅ | `pen stroke … undo` |
| Neue Leinwand | Standard 1600 × 1200 px, 72 dpi; Vorlagen u. a. „UXGA (1600 x 1200px)“, „A4 color (350dpi)“ [NEW] | gleich | ✅ | – |
| Exportieren | PNG, JPEG, WebP, BMP, TIFF, TGA, PSD …; Skalierung; Entwurfsebenen aus; Transparenz [EXP] | PNG, JPEG, WebP mit denselben Optionen | 🟡 | – |
| Dateiformat | `.clip` | eigenes `.madpaint` (kein `.clip`, kein PSD) | ❌ | Unit: `.madpaint format` |
| Bild ablegen | auf der Leinwand → neue Leinwand, auf der Ebenen-Palette → Ebene [IMP, PC] | gleich | ✅ | – |

## REA im Projekt

REA (`rea-agents@5.0.0`) wurde ausschliesslich auf das **eigene** Programm angewendet.

| Prüfung | REA-Werkzeug | Ergebnis | Evidence |
| ------- | ------------ | -------- | -------- |
| Laufzeit: Oberfläche der Web-App | `capture_browser_scenario` (Chromium 141, Tasten B → M, Accessibility-Baum) | Menüs File · Edit · Layer · Select · View · Filter · Window · Help; Werkzeugpalette mit 14 Werkzeugen in der Reihenfolge des Vorbilds + 3 Farbsymbolen; nach B → M ist „Selection area“ aktiv, Untertools inkl. Polyline, Selection pen, Erase selection; Ebenenmodi: 28 in der Reihenfolge des Vorbilds; keine Konsolen- oder Seitenfehler | `ev_d57e1c7f520f…` |
| Statisch: ausgeliefertes `app.asar` (inkl. 393-KB-Renderer-Bundle) | `analyze-javascript-application` (CLI) | 1 BrowserWindow: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, Preload gesetzt · 1 Bridge `madPaint` mit 8 Mitgliedern · IPC: 6 Handler, alle 6 Renderer-Sendungen gepaart, 0 dynamische Kanäle · Speicher: nur `localStorage` und `IndexedDB`, keine Netzwerkziele | `ev_7c2a9ab594dc…` |
| Statisch: Electron-Hülle nach der Änderung | `analyze-javascript-application` (CLI) | wie oben; 5 explizite Web-Preferences (ohne `backgroundThrottling`) | `ev_734b44a2e730…` |

Abgeleitete Änderung: `backgroundThrottling: false` stammte aus der Audio-App MAD Studio und
wurde entfernt (eine Mal-App muss im Hintergrund nicht weiterlaufen; spart Akku).
„Sender validation“ meldet REA mit 0 Beobachtungen – der Code prüft jeden IPC-Aufruf über
`isTrustedSender()`, diese Helfer-Form erkennt die statische Analyse nicht (Status: unbekannt,
nicht „fehlt“). Das MCP-Werkzeug läuft in Claude Code nach 60 s in ein Timeout; für die
Analyse wurde deshalb die CLI verwendet.

## Selbst vergleichen (Checkliste für den eigenen Mac)

Wer Clip Studio Paint als Testversion auf dem eigenen Mac installiert (normale Nutzung im
Rahmen der Lizenz), kann beide Programme nebeneinander öffnen und Punkt für Punkt
vergleichen. Abweichungen bitte als Issue oder Nachricht melden – mit dem Punkt aus der Liste.

1. **Start:** Neue Leinwand (⌘N) 1600 × 1200 px. Stehen Paletten und Command Bar gleich?
2. **Werkzeugtasten:** P, P, B, B, E, G, G, M, W, I, K, D, H, R, / – landen beide Programme
   auf denselben Werkzeugen? Taste halten, zeichnen, loslassen: zurück zum vorherigen Werkzeug?
3. **G-pen:** Druck leicht/stark, schnelle Kurven. Strichdicke, Spitzen, Glättung (Stabilisierung 6)?
4. **Bleistift und Pinsel:** Körnung, Aufbau der Deckkraft bei mehrfachem Übermalen.
5. **Gerade Linien:** ⇧-Ziehen und ⇧-Klick nach einem Strich.
6. **Pinselgrösse:** [ / ], ⌘⌥-Ziehen, Brush-Size-Palette (klassisches Layout).
7. **Füllen:** Lineart auf Ebene 1 (mit kleinen Lücken), auf Ebene 2 mit „Refer other layers“
   füllen. Wie viel Lücke wird geschlossen? Wie weit reicht die Füllung unter die Linie?
8. **Auswahl:** Rechteck mit ⇧/⌥, Lasso, Polylinie, Auswahlstift; Auswahl-Starter-Knöpfe.
9. **Ebenen:** Schnittmaske, Ordner (Normal/Through), Modi Multiply, Screen, Overlay, Add (Glow),
   Subtract; ⌘E, ⇧⌘E; Entwurfsebene beim Export.
10. **Transformieren:** ⌘T, Ecke ziehen, aussen drehen, ⇧, Enter / Esc / Doppelklick.
11. **Ansicht:** Space, ⇧Space, ⌘+/⌘−, `-`, Navigator, Spiegeln.
12. **Undo:** ⌘Z/⌘Y, History-Palette anklicken.

## Unbekanntes / offene Fragen

- **Werkzeugtasten in Ver. 5:** Englische Handbuchseiten nennen Zoom = `/`; die japanische
  Tabelle (neue Gruppierung) nennt `Z` und für Comic `N`. Umgesetzt: `/`.
- **JIS-Tasten** `^`, `@`, `;` der Originalkürzel: welche Taste ein US-/Schweizer Mac auslöst, ist
  nicht dokumentiert. Zusätzlich belegt: `=` (rechts drehen), ⌘= (Zoom).
- **Zahlen ohne Quelle:** Wertebereiche (Stabilisierung, Toleranz, Bereichsvergrösserung,
  Stufen von „Close gap“), Fabrikwerte der meisten Pinsel, Zoomstufen unter 25 %, Undo-Standard
  (nur Screenshot: 200). Eigene, plausible Werte gewählt.
- **Glow dodge / Add (Glow):** offiziell nur „stärker bei halbtransparenten Pixeln“; Formel nach
  einem Community-Modell (niedrige Konfidenz).
- **Farbmischung** (Blend, Running color, Watercolor-Kanten), Neigung, Druckkurven, Vektorebenen,
  Lineale, Text, Comic-Rahmen, Animation und 3D sind nicht umgesetzt.
- **Mehrfaches Drücken** einer geteilten Werkzeugtaste (Zyklus) belegt nur die Celsys-Tutorialseite
  „Art Rocket“, nicht das Handbuch.

## Quellen

Präfix `M/` = `https://help.clip-studio.com/en-us/manual_en/` (Handbuch Ver. 5.0)

| Kürzel | Quelle |
| ------ | ------ |
| EULA | https://www.clipstudio.net/en/dl/eula/ |
| IF | `M/060_pc/Interface.htm` |
| NEW | `M/030_new/030_new.htm` |
| PAL, CMD, HIDE | `M/690_interface/Palettes.htm`, `…/Command_Bar.htm`, `…/Hide_Title_Bar_and_Menu_Bar.htm` |
| TOOLPAL, USE, CUST | `M/150_tools/The_Tool_palette.htm`, `…/How_to_use_tools.htm`, `…/Customizing_the_Tool_and_Tool_Group_palettes.htm` |
| DYN, BS, TS, PB | `M/240_brushes/Customizing_brush_tools.htm`, `…/Brush_Size_palette.htm`, `…/Tool_Sliders_palette.htm`, `…/Drawing_and_painting.htm` |
| SEL, CW, CS, CSET, CH, EYE | `M/300_color/Selecting_colors.htm`, `…/Color_Wheel_palette.htm`, `…/Color_Slider_palette.htm`, `…/Color_Set_palette.htm`, `…/Color_History_palette.htm`, `…/Eyedropper_Tool.htm` |
| NAV, CANVAS | `M/270_canvas/Navigating_the_canvas.htm`, `…/Canvas_window.htm` |
| LP, BO, OLS, REF, DR, FOL, BL | `M/180_layers/Using_layers.htm`, `…/Basic_operations.htm`, `…/Other_layer_settings.htm`, `…/Reference_layers.htm`, `…/Draft_layers.htm`, `…/Layer_folders.htm`, `…/Blending_modes.htm` |
| JB, JS | `https://help.clip-studio.com/ja-jp/manual_jp/180_layers/` (Grundoperationen, nützliche Einstellungen) |
| FILL, GRAD | `M/420_fill/Fill_Tool.htm`, `…/Gradient_Tool.htm` |
| SEL (Auswahl), AUTO, LCH | `M/330_selection/Selection_area.htm`, `…/Auto_select_tool.htm`, `…/Selection_Launcher.htm` |
| TR, FIG | `M/360_transform/Types_of_transformations.htm`, `M/450_figure/` |
| MOD, OPT, TS, MENU | `M/780_shortcuts/Shortcuts_usable_during_operation.htm`, `…/Optional_Shortcuts.htm`, `…/Tool_Shortcuts.htm`, `…/Menu_Shortcuts.htm` |
| PRF, UND, EXP, IMP, PC | `M/720_preferences/Preferences.htm`, `M/270_canvas/Undo__47_Redo.htm`, `M/210_file/Exporting_files.htm`, `…/Import_image_file_to_canvas.htm`, `M/060_pc/Saving__44__exporting__44__and_importing_files.htm` |
| GL-x | `M/810_subtools/x.htm` (Glossar der Einstellungen) |
| T563, T582, T656, T684, T868, T1250, T4846 | `https://tips.clip-studio.com/en-us/articles/<Nr>` (ClipStudioOfficial) |
| TIPS | `https://tips.clip-studio.com/en-us/articles/1248` |
| PDF4 | Clip Studio Paint User Guide Ver. 4.0 (PDF, vd.clipstudio.net), S. 7 |
