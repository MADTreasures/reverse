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
| Color Wheel | Farbtonring mit Quadrat (HSV) oder Dreieck (HLS; reiner Farbton rechts, Weiss oben links, Schwarz unten links), Umschalter unten rechts, H/S/V- bzw. H/L/S-Werte unten, Klick auf die Werte zeigt RGB [CW] | gleich (Umschalter als Knopf □/▷; die Wahl gilt auch für die Farbregler und wird gespeichert) | ✅ | `colour palettes: …`, Unit: `color spaces of the colour palettes` |
| Color Slider / Set / History | Color Slider: Reiter links für RGB, HSV (bzw. HLS) und CMYK; Color Set: Liste der Farbsets oben, Schraubenschlüssel → *Edit color sets* (Liste ziehbar, Doppelklick benennt um, Create new set, Add standard set, Duplicate set, Delete, Rename), Kacheln anklicken, ⌥-Klick ersetzt, Ersetzen/Hinzufügen (vor der gewählten Kachel)/Löschen, RGB-Anzeige (Klick: HSV/HLS), Import/Export .cls/.aco, Farbnamen, Ansicht (Kachelgrösse, Liste), Pipette trägt automatisch ein; Color History: neueste zuerst [CS, CSET, CH] | Farbregler und Farbsets wie beschrieben; eigene Standard-Sets (Standard, Grays, Skin tones, Pastel) im Browser gespeichert (der frühere Einzel-Satz wird übernommen); CMYK ohne Farbprofil (Schwarz = gemeinsamer Anteil); Import/Export, Farbnamen, Ansichtsoptionen und automatisches Eintragen fehlen | 🟡 | `colour palettes: …`, Unit: `colour sets` |
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
| Untertools Pencil, Brush, Airbrush, Eraser, Blend | Pencil, Mechanical pencil, Charcoal, Crayon, … · Watercolor/Ink/Thick paint · Soft, Spray, Droplet … · Hard, Soft, Kneaded, Rough … · Blend, Blur, Finger tip … [T4846, PB] | je eine Auswahl mit denselben Namen, dazu Transparent/Opaque watercolor, Oil paint, Flat brush, Calligraphy (eigene Werte) | 🟡 | `colour mixing: …`, `a flat brush tip …` |
| Standardwerte | G-pen 10 px, Stabilisierung 6, Kantenglättung „Middle“; Pencil Deckkraft 90 % mit Druck; Straight line 3 px [Screenshots] | gleich | ✅ | – |
| Deckkraft vs. Dichte | Deckkraft begrenzt den ganzen Strich, „Brush density“ wirkt pro Tupfer [GL-I, T563] | gleich (Strichpuffer) | ✅ | `blend mode and opacity …` |
| Kantenglättung | 4 Stufen: None, Weak, Middle, Strong [GL-A] | 4 Stufen | ✅ | – |
| Stiftdruck | Dynamik je Einstellung: Druck (Mindestwert + Kurve), Neigung, Tempo, Zufall; globale Druckeinstellung (File > Pen Pressure Settings: Zeichnen, „Stronger/Lighter“, Kurve) [DYN, PEN] | Druck mit Mindestwert und Kurve (monoton kubisch), Neigung, Zufall für Grösse und Dichte; globale Kurve mit Testfeld, Stärker/Leichter und „Adjust from drawing“ (Perzentile); Tempo fehlt; Wirkung der Neigung eigenes Modell | 🟡 | Unit: `pressure graphs`, `brush dynamics`; `brush dynamics popover …` |
| Pinselspitze | Härte, Dicke, Richtung, Winkel (fest, Stiftrichtung, Linienrichtung, Zufall); Spitzenform Kreis oder Material (mehrere Bildspitzen, hinzufügen/löschen), horizontal/vertikal spiegeln (aus, spiegeln, zufällig, bei umgekehrten Strichen); Wiederholmethode (Repeat, Reverse, Do not repeat, Random, One time only, One random cycle) [GL-B, GL-S] | Härte, Dicke, Winkel fest / Linienrichtung / Stiftrichtung, Zufallswinkel; Material-Spitzen: neun eigene, per Code gezeichnete Spitzen und importierte Bilder (dunkel bzw. deckend = Farbe, max. 256 px, im Browser-Speicher), mehrere Spitzen mit Repeat/Reverse/Do not repeat/Random/One time only, Spiegeln aus/an/zufällig; neues Werkzeug **Dekoration** (B) mit Blättern, Gras, Sternen, Glitzer, Herzen, Blumen; „One random cycle“, „bei umgekehrten Strichen“ und „Ribbon“ fehlen | 🟡 | `a flat brush tip …`, `brush materials: …`, Unit: `brush tip materials` |
| Textur | Texture: Papiertextur-Material, Dichte (mit Dynamik), Invertieren, Dichte betonen, Skalierung, Drehwinkel, Helligkeit, Kontrast, Texturmodus (Normal, Multiply, Subtract, Compare, Outline, Overlay, Color dodge, Hard mix, Height), „Apply by each plot“ [GL-T] | fünf eigene nahtlose Texturen und importierte Bilder (max. 512 px); Dichte, Skalierung, Drehung, Helligkeit, Kontrast, Invertieren, Modus Subtract/Multiply, pro Strich oder pro Abdruck, auch auf Vektorlinien; die Textur ist an der Leinwand verankert; Dichte-Dynamik, „Dichte betonen“ und die übrigen Modi fehlen | 🟡 | `brush materials: …`, Unit: `paper textures` |
| Ein- und Auslaufen | „Starting and ending“ [GL-S] | Länge in px für Anfang und Ende, wirkt auf Grösse und/oder Dichte; der Strich wird beim Absetzen mit bekannter Länge neu gezeichnet | 🟡 | `starting and ending taper …`, Unit: `taperFactor` |
| Farbmischung | Ink > Color mixing: Blend, Running color (Smear), Amount/Density of paint, Color stretch [GL-I] | Blend und Running color mit Farbmenge, Farbdichte, Farbdehnung (Formeln eigenes Modell); Smear fehlt | 🟡 | `colour mixing: …`, Unit: `color mixing` |
| Aquarellkante (Pinsel) | Watercolor edge: Bereich, Deckkraft, Dunkelheit [GL-W] | gleich, beim Absetzen auf den Strich angewendet | 🟡 | – |
| Stabilisierung | 0–100 (Bereich nicht dokumentiert), wirkt ab Stiftkontakt [GL-C] | gleitender Mittelwert, 0–100, holt am Strichende auf | 🟡 | Unit: `Stabilizer` |
| Füllen | Untertools „Refer only to editing layer“ / „Refer other layers“; Einstellungen: nur verbundene Pixel, Lücke schliessen (5 Stufen), Toleranz, Bereichsvergrösserung, Mehrfachreferenz (alle / Referenzebene …); Entwurfsebenen und Papier werden nicht referenziert; ⇧-Klick schaltet Mehrfachreferenz um [FILL, GL-F, GL-R] | alles davon; „To darkest pixel“, „Enclose and fill“, „Lasso fill“ fehlen | 🟡 | `fill tool fills …`, Unit: `closes small gaps …` |
| Auto select | wie Füllen + Auswahlmodus; ⌘-Klick schaltet Mehrfachreferenz um [AUTO] | gleich | ✅ | – |
| Auswahlbereich | Rechteck, Ellipse, Lasso, Polylinie, Auswahlstift, Auswahl radieren …; ⇧ hinzufügen, ⌥ abziehen, ⇧⌥ Schnittmenge; ⇧ Quadrat/Kreis [SEL] | alle genannten; Magnet-Lasso, „Shrink selection“ fehlen | 🟡 | `polyline selection …`, `selection pen …` |
| Verlauf | Verlaufsbalken mit Knoten (Zeichen-, Unter-, Wunschfarbe; Deckkraft), Umkehren, *Advanced settings*: Edit gradient mit Verlaufsliste (ersetzen, laden, duplizieren, neu, löschen, Verlaufssätze); Form Linie/Kreis/Ellipse; Randverhalten Do not repeat / Repeat / Reverse / Do not draw; Dithering; Start from center; Snap angle; „Create gradient layer“; Verlaufsebenen: Start (Kreuz) und Ende (Kreis) mit dem Objekt- oder Verlaufswerkzeug ändern, Farben/Form in Tool Settings, *Layer > New Layer > Gradient* öffnet den Dialog [GRAD, GLAY] | alles genannte; Kreis/Ellipse immer von der Mitte, Ellipse halb so hoch wie lang (eigene Annahme), ⇧ statt „Snap angle“ (45°); Verlaufsliste: eigene Vorlagen + eigener Satz (lokal gespeichert), keine Verlaufssatz-Materialien; neue Verlaufsebene von oben nach unten (eigene Annahme); Freiform-Verlauf fehlt | 🟡 | `gradients: …`, Unit: `gradient tool` |
| Figur | Gerade (⇧ = 45°), Rechteck/Ellipse (⇧ = Quadrat/Kreis), Kurven, Polylinie … [FIG] | Gerade, Rechteck, Ellipse | 🟡 | – |
| Lineale | Lineal, Kurven-, Figur-Lineal, Lineal-Stift, Spezial-Lineale (Parallel, Parallelkurve, Mehrfachkurve, Radial, Radialkurve, Konzentrisch), Hilfslinien, Perspektiv-Lineal (1/2/3 Punkte, Fischauge, Raster), Symmetrie-Lineal (Linienzahl, Liniensymmetrie); Lineal gehört zu einer Ebene, Bereich „alle Ebenen / gleicher Ordner / nur Bearbeitungsziel“, ⇧-Klick aufs Symbol blendet aus; Einrasten über View > Snap (⌘1 Lineal, ⌘2 Spezial-Lineal), lila = Einrasten an, grün = aus; Bearbeiten mit dem Objekt-Werkzeug; Kurvenarten wie bei den Figur-Kurven [RUL, SNAP, PERSP, EDITR, MENU, CRV] | Lineal, **Kurven-Lineal** (Klicks, Doppelklick schliesst ab; Polylinie, Spline, quadratische Bézierkurve mit Ankern auf halbem Weg zwischen den Richtungspunkten, kubische Bézierkurve mit gezogenen Richtungspunkten; ⌥-Klick = Ecke; Rücktaste/Entf löscht den letzten Punkt), **Figur-Lineal** (Rechteck, Ellipse, Vieleck; ⇧ Quadrat/Kreis, ⌥ von der Mitte), **Lineal-Stift**, Hilfslinie, Parallel, **Parallelkurve** (innen scharfe, aussen runde Ecken), **Mehrfachkurve** (Drehgriff für die Verschiebungsrichtung), Radial, **Radialkurve** (erster Klick = Mitte), Konzentrisch, Symmetrie (2–32, mit/ohne Spiegelung), Perspektive 1/2/3 Punkte (Menü und Werkzeug), Bereich und Ein-/Ausblenden über das Symbol, ⌘1/⌘2, Farben, Objekt-Werkzeug (Griffe und Kontrollpunkte, Verschieben, Entf), *Draw along ruler* (Linienbreite, Kantenglättung; nicht für Spezial-Lineale); Standardbereich „alle Ebenen“ angenommen. Fischauge, Raster, ⌘4 und Kontrollpunkte hinzufügen/löschen fehlen | 🟡 | `symmetrical ruler …`, `special and linear rulers …`, `perspective ruler …`, `curve ruler …`, `figure ruler and ruler pen …`, `special curve rulers …`, Unit: `rulers`, `curve sampling`, `following a path`, `parallel, multiple and radial curves`, `the ruler pen` |
| Vektorradierer | Eraser-Gruppe „Vector“; Modi: berührten Bereich, bis zum Schnittpunkt (Option „Refer all layers“), ganze Linie; andere Radierer erzeugen auf Vektorebenen keine Linien; mit Transparentfarbe gezeichnete Striche werden Linien; auf Rasterebenen radiert er normal [VEC, ERASE] | gleich; Einstellung „Vector eraser“ bei jedem Radierer in Tool Settings (statt Advanced Tool Settings) | ✅ | `vector layer: strokes become lines …`, Unit: `vector lines` |
| Objekt-Werkzeug auf Vektorebenen | Linie antippen = auswählen (Linie und Kontrollpunkte hervorgehoben), verschieben, Griffe skalieren, Drehgriff oben; „Adjust line thickness when scaling“; Farbe, Grösse, Pinselform der gewählten Linien in Tool Settings; „Operation of transparent part: Switch to a different layer“; Auswahlmodus [VEC, OBJ, V] | Auswählen (⇧ ergänzt/entfernt), verschieben, skalieren (Ecken; ⇧ frei), drehen (⇧ 15°), Linienfarbe (Farbwähler oder Zeichenfarbe), Breite, Deckkraft, Linienstärke beim Skalieren ein/aus, Klick auf eine Linie einer anderen Vektorebene wechselt die Ebene, Entf löscht; Kontrollpunkte der gewählten Linien werden angezeigt und lassen sich ziehen; Pinselform-Wechsel fehlt | 🟡 | `Object tool: select, move, recolour …`, `Object tool drags the control points …` |
| Linie korrigieren (Y) | Kontrollpunkt (7 Modi: verschieben, hinzufügen, löschen, Ecke, Linienbreite, Deckkraft, teilen), Vektorlinie kneifen (Fix end, Pinch level, Pen pressure, Effect range, Add control point, Connect lines), Vektorlinie vereinfachen (Simplify, Smooth corner, Process whole line, Convert curve, Connect lines, Delete short lines, Brush size), Vektorlinien verbinden (Connect lines, different properties, Brush size), Linienbreite anpassen (Thicken/Narrow, At least 1 pixel, Scale up/down width, Process whole line), Vektorlinie nachzeichnen (Fix end, Connect lines, Simplify, Stabilization), Linienbreite nachzeichnen (Stiftdruck); *Ruler from vector*; „Snap to control points“ [VEC, SUBC] | alle sieben Unterwerkzeuge mit diesen Einstellungen; „Kurve umwandeln“ nur nach Gerade oder Spline (keine Bézier-Linien); Breite anpassen und nachzeichnen wirken mit weichem Rand des Werkzeugs; *Ruler from vector* macht Kurven-Lineale. Einrasten an Kontrollpunkten und „Remove dust“ fehlen | 🟡 | `Correct line: …` (2), `Object tool drags the control points …`, Unit: `vector lines with control points`, `the Control point tool`, `pinch, simplify, connect, width and redraw` |
| Text-Werkzeug | T; Klick = Text an der Stelle, Ziehen = Textrahmen mit „Wrap text at frame“ (Umbruch, Überstehendes unsichtbar); OK-/Abbrechen-Starter; Schrift, Grösse, Stil (fett, kursiv, durchgestrichen …), Ausrichtung, Richtung (vertikal: lateinische Zeichen gedreht), Textfarbe; erweitert: Zeilen-/Zeichenabstand, Rand; Text anklicken = bearbeiten; Objekt-Werkzeug: verschieben (⇧ Achse), drehen, skalieren (ohne Umbruch: Schriftgrösse) [TXT, TXE, TXS, TXV] | gleich; Grösse in pt (bei der Dokumentauflösung); Esc = Abbrechen, ⌘Enter = OK; neue Ebene je Text, benannt nach dem Text; Stile gelten für den ganzen Rahmen (nicht pro Buchstabe); Rubi, TateChuYoko, Kreistext, Verzerren fehlen | 🟡 | `text tool: …`, Unit: `text layout` |
| Sprechblasen | T (Gruppe Balloon): Ellipse-Sprechblase wie eine Figur aufziehen, Linienbreite, Linien- und Füllfarbe; „Balloon tail“ von innen nach aussen ziehen (Biegung, Breite); Blase über vorhandenem Text → Textebene wird Sprechblasenebene; überlappende Blasen derselben Ebene verschmelzen; Objekt-Werkzeug: verschieben, skalieren (Text bleibt gleich gross), drehen [BAL] | Ellipse, abgerundet, Rechteck, Gedanken-Wolke; Schwanz gebogen oder als Gedankenbläschen; Text in der Blase wird zentriert und bewegt sich mit; Linie = Hauptfarbe, Füllung = Unterfarbe (eigene Annahme); Kurven-Sprechblase, Sprechblasenstift, Kontrollpunkte, Blitz-Blasen fehlen | 🟡 | `balloons: …`, Unit: `text boxes and balloons`, `layer objects` |
| Comic-Rahmen | *Layer > New Layer > Frame Border folder* (Draw border, Linienbreite; Rahmen = Innenrand); Werkzeuge Rectangle frame (rastet am Innenrand ein), Polyline frame, Frame border pen; Divide frame border (Ziehen mit Vorschau, vertikale/horizontale Stegbreite, Ordner teilen); *Divide frame border equally* (Anzahl, Ordner: duplizieren / leer / unverändert); Inhalt nur im Rahmen sichtbar; Objekt-Werkzeug: an der Linie verschieben, Griffe, Drehen, Linienbreite und -farbe; Entf löscht; Rahmen als Lineal; Rahmen-Vorlagen als Material (auf die Leinwand ziehen, legt die Rahmenordner an; eigene Rahmenordner als Vorlage registrieren) [FRM] | Rahmenordner mit Panels (Maske = Panelpolygone, Rahmenlinie darüber), Rechteck- und Polylinienrahmen, Teilen (Steg oben/unten 4 mm, links/rechts 2 mm, eigene Werte), gleichmässig teilen (neue leere Ordner oder Panels im selben Ordner), Objekt-Werkzeug, Rahmenkanten als Lineal beim Einrasten (⌘1); ohne Comic-Projekt gibt es keinen Innenrand: neue Rahmen liegen 5 % innerhalb der Leinwand (eigene Annahme). Rahmen-Vorlagen: zwölf eigene Seitenaufteilungen (keine Materialien des Vorbilds) im Dialog *Frame templates* statt Material-Palette, mit Stegen, Linienbreite, Ordner je Rahmen; eigene Vorlagen aus den Rahmen der Leinwand (lokal gespeichert, relativ zur Leinwand). Rahmenstift, Kontrollpunkte, Verbinden, Anti-Aliasing-Stufen und „Ordner duplizieren“ fehlen | 🟡 | `comic frames: …`, `frame templates: …`, Unit: `comic frames`, `frame templates` |
| Ebene verschieben | in der Gruppe „Operation“ (K); ⌥-Ziehen kopiert, ⇧ fixiert die Richtung [LAY, MOD] | gleich; auch Gruppe „Operation“ mit „Select layer“ (D) | ✅ | `free transform …` |
| Transformieren | *Edit → Transform*: Scale up/Scale down/Rotate (⌘T), Scale up/Scale down, Rotate, Free transform (⇧⌘T: Ecken frei, ⇧ = eine Richtung), Distort (Ecke in einer Richtung, Mittelgriffe neigen), Skew (Kante gleitet entlang ihrer Richtung), Perspective (Ecke und ihr Gegenüber gegenläufig), Mesh transformation (Gitterpunkte, Anzahl waagrecht/senkrecht, Standard 4 × 4), Puppet warp; ausserhalb ziehen = drehen; ⇧ = 45°-Schritte; Bezugspunkt (+) ziehen oder ⌥-Klick; Tool Property: Zurücksetzen, Spiegeln am Bezugspunkt, OK/Abbrechen, Modus, Bezugspunkt (Mitte, Ecken, Kanten, frei) mit Position, Vektorbreite ändern, Original behalten, Skalierung W/H, Seitenverhältnis beibehalten (Standard an; gilt dann auch an den Mittelgriffen), Drehwinkel, Interpolation (bilinear, nächster Nachbar, bikubisch – Standard –, Durchschnittsfarben); Enter/Doppelklick bestätigt, Esc bricht ab [TR, TRS, IMS] | alles genannte ausser Puppet warp, „Adjust position“ und „Rotate bounding box“; die Box ist eine projektive Abbildung ihrer vier Ecken (affin, solange sie ein Parallelogramm bilden – dann schnell über die Leinwand gezeichnet, sonst pixelgenau in JavaScript), das Gitter eine Catmull-Rom-Fläche durch die Punkte (eigenes Modell; das Vorbild zeigt glatte Verformungen); Vektorlinien, Rahmen und Verläufe folgen Punkt für Punkt, Text und Sprechblasen der lokalen affinen Näherung; Moduswechsel aus dem Gitter behält dessen Ecken | 🟡 | `free transform …`, `Edit > Transform modes …`, Unit: `transform geometry`, `transform resampling`, `non-affine transforms of objects` |
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
| ⌘-Ziehen mit Zeichenwerkzeugen | temporär „Object“-Werkzeug | gleich (Vektorlinien und Lineale) | ✅ | Unit: `⌘ with drawing tools …` |

### Tastenkürzel (macOS)

| Funktion | Clip Studio Paint [TS, MENU, OPT] | MAD Studio Paint | Status |
| -------- | --------------------------------- | ---------------- | ------ |
| Werkzeuge | / Zoom · H Hand · R Drehen · O Objekt · D Ebene wählen · K Ebene verschieben · M Auswahl · W Auto select · I Pipette · P Pen/Pencil · B Brush/Airbrush · E Radierer · J Blend · G Füllen/Verlauf · U Figur/Rahmen/Lineal · T Text/Sprechblase | gleich | ✅ |
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
| Ordner | Standard „Normal“ (isoliert), „Through“ wählbar; auf „Through“-Ordner kann nichts beschnitten werden [FOL] | gleich; Deckkraft und Maske eines „Through“-Ordners mischen dessen Ergebnis mit dem Hintergrund (eigenes Modell, im Handbuch nicht beschrieben) | ✅ | Unit: `never clips onto …`, `Through folders with opacity …` |
| Schnittmaske | Alpha und Deckkraft der Basis wirken; rosa Balken [OLS] | gleich | ✅ | `layers: …` |
| Ebenenmasken | „Mask outside selection“ / „Mask selection“ (ohne Auswahl: alles bzw. nichts maskiert), Symbol in der Ebenen-Palette; Maske per Klick aufs Miniaturbild bearbeiten: jede Farbe zeigt, Radierer/Transparenz verbirgt (Alpha-Skala); Entf = nichts maskiert; Deaktivieren (rotes Kreuz), „Show mask area“ (violett), Verknüpfung (Häkchen zwischen den Bildern) = Maske bewegt sich mit; „Apply mask to layer“ (Ordner werden zur Rasterebene), „Delete mask“ [MASK] | gleich; dazu ⌘-Klick auf die Maske = Auswahl | 🟡 | `layer mask: …` (3 Tests) |
| Referenz-, Entwurfsebene, Sperren, Transparente Pixel schützen | Leuchtturm-Symbol; Entwurf = blauer Balken, nicht im Export und nicht in Füll-Referenz; Sperren blockiert Zeichnen und Einstellungen [REF, DR, JS] | gleich | ✅ | – |
| Paletten-Interaktionen | ⌥-Klick aufs Auge = nur diese Ebene; ⌘-Klick aufs Miniaturbild = Auswahl; ⌥-Ziehen = Duplikat; Doppelklick = umbenennen [LP, BO] | gleich | ✅ | `layer palette: ⌥-click …` |
| Neue Ebene | direkt über der aktiven, bzw. oben in einem gewählten Ordner [BO, FOL] | gleich | ✅ | `folders: …` |
| Vereinen | Mit unterer: verweigert bei gesperrten, ausgeblendeten, Entwurfsebenen; behält Name/Modus der unteren. Sichtbare vereinen: Ausgeblendete und Entwürfe bleiben [T582] | gleich | ✅ | `merging is refused …` |
| Auf untere Ebene übertragen | Pixel nach unten, obere bleibt leer [JB] | gleich | ✅ | – |
| Korrekturebenen | Layer > New Correction Layer: Brightness/Contrast, Level correction, Tone curve, Hue/Saturation/Luminosity, Color balance, Reverse gradient, Posterization, Binarization, Gradient map; wirken auf alle Ebenen darunter (im Ordner; bei „Through“ auch ausserhalb); mit gepaarter Maske (Auswahl = Wirkungsbereich); Einstellungen per Tipp aufs Miniaturbild, Reverse gradient ohne Einstellungen [TC, TCE] | gleich; beschneidbar auf die Ebene darunter; Formeln eigene Standardmodelle (im Handbuch nicht angegeben) | 🟡 | `correction layer: …`, `correction layers see the paper …`, Unit: `tonal corrections` |
| Tonwertkorrektur (Bearbeiten) | dieselben 9 Korrekturen direkt auf die Ebene, mit Vorschau, nur in der Auswahl; ⌘U = Farbton/Sättigung/Helligkeit, ⌘I = Umkehren [TC, TCE, MENU] | gleich; Verlaufsumsetzung mit eigenen Vorlagen statt der mitgelieferten Materialien | 🟡 | `Edit > Tonal correction …` |
| Filter | *Filter*-Menü: Blur (Blur, Blur (Strong), Gaussian blur, Lens blur, Smoothing, Radial blur, Motion blur, Spin blur), Sharpen (Unsharp mask, Sharpen, Sharpen More), Effect (Artistic, Chromatic aberration, Crystallize, Mosaic, Noise, Normal map, Pencil drawing, Remove jpeg noise, Retro film), Distort (Pinch, Ripple, Curved surface, Convert to Panorama, Geometric Distortion, Polar coordinates, ZigZag, Wave, Twirl, Fish-eye lens), Render (Perlin noise), Correction (Remove dust, Adjust line width); Dialoge mit Vorschau, rotes × auf der Leinwand als Mittelpunkt (verschiebbar); eine Auswahl begrenzt den Filter; dazu Quick Filters / Quick Effects [FLT] | alle 33 Filter mit den dokumentierten Einstellungen; Wertebereiche, Standardwerte und Formeln sind eigene Modelle (das Handbuch nennt keine), z. B. Bewegungs-, Radial- und Drehunschärfe durch fortgesetztes Halbieren, Linienbreite über eine exakte Distanztransformation, Staub = zusammenhängende Pixelgruppe bis zur Staubgrösse; Dialoge wie im Vorbild (Wert mit Regler, rechts OK/Abbrechen/Vorschau), die Vorschau wird in einem Web Worker berechnet, das × folgt Klicken/Ziehen auf der Leinwand; ein Filter öffnet mit den zuletzt benutzten Werten; ein Rückgängig-Schritt je Filter. Quick Filters/Quick Effects, Liquify und „Convert to lines and tones“ fehlen | 🟡 | `Filter menu: …`, Unit: `filter core`, `blur filters`, `effect filters`, `distort filters`, `render and correction filters`, `the Filter menu` |
| Papier | unterste Ebene des Stapels: Ebenenmodi und Korrekturebenen darüber wirken auf sie [LP] | gleich (Export mit transparentem Hintergrund ohne Papier) | ✅ | `correction layers see the paper …` |
| Ebeneneigenschaften | Layer Property palette: Border effect (Edge: Dicke, Farbe; Watercolor edge: Bereich, Deckkraft, Dunkelheit, Weichzeichnung), Layer color (ersetzt Schwarz, Unterfarbe ersetzt Weiss), Tone, Expression color [LPROP] | Randeffekt, Ton und Ebenenfarbe gleich (Formeln eigene Modelle); **Expression color** Color/Gray/Monochrome mit *Color threshold*, *Alpha threshold*, *Reflect layer opacity* und Schwarz/Weiss einzeln ausblendbar – als Darstellung der Ebene (nicht zerstörend: *Color* bringt die Farben zurück, im Vorbild endgültig; auch Zeichnen bleibt farbig gespeichert); PSD: Ebenen mit Ausdrucksfarbe werden so geschrieben, wie sie aussehen; ohne *Display decrease color* (nur für Bildmaterial und 3D) | 🟡 | `Layer Property palette: …`, Unit: `layer effects` |
| Masken-Darstellung „Mask Expression“ (Verläufe ja/nein, Schwelle) | in den Ebeneneigenschaften, wenn die Maske gewählt ist: *Show gradients* Ja/Nein, *Threshold* [LPROP, MASK] | gleich: mit gewählter Maske zeigt die Palette *Mask expression*; ohne Verläufe zeigt die Maske die Ebene ganz, wo ihre Deckkraft die Schwelle erreicht, sonst gar nicht (auch bei Masken-Keyframes); die Pixel der Maske bleiben, wie sie sind; PSD bekommt die Maske, wie sie wirkt; gespeichert | ✅ | `expression color … and mask expression …`, Unit: `expression color and mask expression`, `keeps the mask expression …` |
| Vektorebenen | Linien als Pfad mit Kontrollpunkten: verlustfrei skalieren/transformieren; alle Zeichen- und Figurwerkzeuge; Füllen, Verlauf, Mischen und Farbmischung gesperrt; „Select overlapping vectors“ / „Select vectors within area“; Neue Vektorebene über Menü oder Symbol [VEC] | gleich; Linien speichern Punkte mit Breite und Dichte (aus Druck, Neigung, Ein-/Auslaufen) und werden daraus gezeichnet; Verschieben, ⌘T, Spiegeln, Bildauflösung, Leinwandgrösse, Zuschneiden wirken auf die Linien; Auswahl begrenzt neue Linien; *Layer → Rasterize*; plain Vektorebenen lassen sich in Vektorebenen vereinen. Linien werden nach dem Zeichnen zu Splines durch wenige Kontrollpunkte (Nachkorrektur, ≤ 0,5 px Abweichung); Linien älterer Dateien (dichte Punktfolgen) bleiben unverändert, bis sie korrigiert werden. „Convert layer“ nach Vektor fehlt; Aquarellkante und Farbmischung werden auf Linien nicht angewendet | 🟡 | `vector layer: …`, `Object tool: …`, `fill, gradient and blend refuse …`, `Move layer, ⌘T and Flip …`, Unit: `vector lines`, `.madpaint format` |
| Text-/Sprechblasenebenen | Text und Blasen als eigene Ebenenarten, rastern über Layer > Rasterize [TXT, BAL] | eine Ebenenart für beide (mit Blasen als Sprechblasenebene angezeigt); Zeichenwerkzeuge verweigern sie mit Hinweis; Verschieben, ⌘T, Spiegeln, Bildgrösse wirken auf Text und Blasen; Entf löscht Text/Blasen (in der Auswahl) | 🟡 | `text tool: …`, `balloons: …` |
| Rasterfolien (Töne) | Layer Property > Tone: Frequenz (lpi), Dichte (Farbe / Helligkeit des Bildes / fester Wert bei Füllebenen), Ebenendeckkraft als Punktgrösse, Posterisierung, Punktform (24 Arten), Winkel, Rauschen (Grösse, Faktor), Punktposition; *Layer > New Layer > Tone* bzw. „New tone“ im Auswahl-Starter: Simple tone settings, Füllebene mit Maske aus der Auswahl; Werkzeug „Move tone pattern“; *Show tone area* [SCR, TLAY, LPROP] | Ton-Effekt mit allen genannten Einstellungen außer den Bildmotiv-Punkten (7 Formen: Kreis, Quadrat, Raute, Linie, Kreuz, Ellipse, Rauschen); Punktverlauf: Schwelle je Position in der gedrehten Rasterzelle (eigenes Modell, flächentreu); Ton-Ebene = schwarze Füllebene mit Ton-Effekt (feste Dichte) und Maske, wie im Vorbild, benannt wie „Circle 60.0 line 10%“; Punkte verschieben über die Positionsregler; Standard-Rasterweite ≈ dpi/8 (eigene Wahl, damit Punkte ~8 px gross sind); „Tonbereich anzeigen“ und Zusammenfassen gleicher Töne fehlen | 🟡 | `screentones: …`, Unit: `screentones` |
| Füllebenen | *Layer → New Layer → Fill*: Farbe im Dialog *Color settings*, Ebenenmaske aus der Auswahl (ohne Auswahl leer); Farbe ändern per Doppelklick auf die Miniatur, mit dem Objekt-Werkzeug (*Fill color* in den Werkzeugeinstellungen) oder per Klick in eine Farbpalette; Bereich über die Maske; Ton-Ebenen sind Füllebenen mit Ton [FIL, TLAY] | gleich (eigene Ebenenart, die Farbe wird über die ganze Leinwand gezeichnet, die Maske bestimmt den Bereich; nicht bemalbar – *Rasterize* wandelt sie um; Farbrad, Farbregler, Farbset und Farbverlauf-Palette färben sie beim Objekt-Werkzeug um, ein Rückgängig-Schritt je Zug); *Color settings* mit Farbring, RGB- und Hex-Werten, alter/neuer Farbe; PSD: als Photoshop-Füllebene (Volltonfarbe) geschrieben und wieder als Füllebene gelesen | ✅ | `fill layers: …`, Unit: `writes fill layers as Photoshop fill layers …`, `keeps fill layers …` |

### Ansicht, Undo, Dateien

| Bereich | Clip Studio Paint (Doku) | MAD Studio Paint | Status | Test |
| ------- | ------------------------ | ---------------- | ------ | ---- |
| Raster und Linealleiste | *View → Ruler bar* (⌘R; oben und links, 0 am Startpunkt), *View → Grid*, *View → Grid/Ruler bar settings*: Startpunkt (oben links, oben rechts, Mitte, unten links, unten rechts, eigener in px), Rasterabstand (Standard 10 mm) und Unterteilungen (Standard 4), *Save as default*; *View → Snap → Snap to grid* (⌘3) bei sichtbarem Raster; Raster mit *Move grid* verschieben [GRID, MENU] | gleich ausser *Move grid*; Raster und Linealleiste in Pixeln (Abstand im Dialog in px, Standard 10 mm bei der Dokumentauflösung), die Einstellungen werden im Dokument gespeichert (Rückgängig möglich), *Save as default* gilt für Dokumente ohne eigene; ein Strich, der nahe einer Rasterlinie beginnt, folgt ihr (an Kreuzungen der Linie in Strichrichtung); die Linealleiste zeigt die Zeigerposition und bleibt bei gedrehter Ansicht leer | 🟡 | `View > Grid, Ruler bar …`, Unit: `grid and ruler bar` |
| Zoomstufen | 3200, 1600, 800, 400, 200, 150, 100, 66.67, 50, 33.33, 25 % … bis 0.78 % [PRF, T684] | gleich (unter 25 % halbierend, nicht belegt) | 🟡 | `zoom steps …` |
| Drehen | Schritt 5° (einstellbar), −179.9 … 180°, Ansicht spiegeln [NAV, PRF] | gleich | ✅ | `rotation: …` |
| Mausrad | zoomt [NAV] | Mausrad zoomt; Trackpad: zwei Finger verschieben, Pinch zoomt | 🟡 | – |
| Undo | Anzahl in den Einstellungen (Desktop-Screenshot: 200), History-Palette [UND, PRF] | 200, einstellbar; History-Palette | ✅ | `pen stroke … undo` |
| Neue Leinwand | Standard 1600 × 1200 px, 72 dpi; Vorlagen u. a. „UXGA (1600 x 1200px)“, „A4 color (350dpi)“ [NEW] | gleich | ✅ | – |
| Exportieren | *File → Export (Single Layer)* → BMP, JPEG, PNG, WebP, TIFF, Targa, PSD, PSB; Dialog „… export settings“: Vorgaben (*Preset*), *Preview rendering result on output* (Exportvorschau mit Zoom, JPEG-Qualität und Dateigrösse), JPEG-Qualität, WebP *Prioritize quality*/*file size*, PSD/PSB *Output as background*, *Output image* (Entwurf, Text, Schnittmarken, Story-Infos, Kamerapfad …), *Export range* (EX: ganze Seite, Schnittmarken, Beschnitt, Auswahl), *Expression color* (Auto, Duotone Schwellenwert/Rasterung, Grau, RGB, CMYK), *Advanced color settings*, ICC-Profil, *Export transparency* (PNG, WebP), *Output size* (Massstab, Ausgabegrösse in Einheiten, Auflösung 72–1200 dpi; WebP immer 72 dpi), *Process when scaling*, Wasserzeichen/Rauschmuster [EXP] | Untermenü mit allen acht Formaten (BMP 24 Bit, TIFF unkomprimiert, TGA, PSB über ag-psd – eigene Encoder für BMP/TIFF/TGA); Dialog mit denselben Gruppen: Exportvorschau (Zoom, 100 %, Einpassen, JPEG-Qualität live, Dateigrösse), JPEG/WebP/PSD-Einstellungen, *Output image* Entwurf und Text, *Export range* ganze Leinwand/Ausgaberahmen/Auswahl (Rechteck der Auswahl), *Expression color* Auto/Duotone (Threshold)/Duotone (Toning, Rasterpunkte mit der Standardfrequenz)/Grau/RGB, *Export transparency* nur PNG/WebP, *Output size* mit px/mm/cm/in und Auflösung; die Auflösung steht in der Datei (PNG pHYs, JPEG JFIF, TIFF, BMP, PSD); *Save duplicate* auch als .psb; ohne Vorgaben, CMYK, ICC-Profil, *Process when scaling*, Wasserzeichen und Rauschmuster | 🟡 | `export (single layer): …`, `Photoshop documents: …`, Unit: `export (single layer): …`, `BMP`, `Targa`, `TIFF` |
| Dateiformat | `.clip` | eigenes `.madpaint` (kein `.clip`) | ❌ | Unit: `.madpaint format` |
| Photoshop-Dokumente | *Open*: `.psd`/`.psb`, CMYK wird zu RGB [OPN]; *Save Duplicate* → `.psd`/`.psb`, um Ebenen für andere Programme zu behalten, mit Export-Dialog (Output image: u. a. Entwürfe – standardmässig aus; Expression color Graustufen/RGB/CMYK; ICC-Profil) [SAV, DRF] | *Open*: `.psd`/`.psb` (RGB, CMYK, Graustufen, 8/16/32 Bit) mit Ordnern, Masken, Schnittmasken, Modi, Deckkraft, Sperren; Einstellungsebenen → Korrekturebenen (alle neun Arten); Textebenen → editierbare Textrahmen; Ebenenstile → Randeffekt, Ebenenfarbe, Schatten, Schein (Rest aufbewahrt); Form/Smartobjekt/verkrümmter Text als Pixel; „Paper“ → Papier. *Save duplicate → .psd*: Ebenen, Papier als Ebene „Paper“, Entwürfe wählbar (aus), Textrahmen als Photoshop-Text (vertikal als Pixel), Effekte als Ebenenstile, Vektor/Verlauf gerastert, Korrekturebenen → Einstellungsebenen, Rahmenordner → Gruppe mit Rahmenmaske; nur RGB, kein ICC-Profil, kein `.psb` schreiben (Leinwand ≤ 8000 px passt in PSD) | 🟡 | `Photoshop documents: …`, `Photoshop documents keep text editable …`, Unit: `PSD documents`, `text boxes as Photoshop text`, `Photoshop documents with text and layer styles`, `layer styles` |
| Bild ablegen | auf der Leinwand → neue Leinwand, auf der Ebenen-Palette → Ebene [IMP, PC] | gleich | ✅ | – |

### Animation

| Bereich | Clip Studio Paint (Doku) | MAD Studio Paint | Status | Test |
| ------- | ------------------------ | ---------------- | ------ | ---- |
| Neue Animation | *New* → „Create animated illustration“: Anzahl Zellen, Wiedergabezeit, Bildrate; Projekt „Animation“ mit Zeitleiste, Animationsordner mit einer Ebene [NEW, ANI] | „Create animated illustration“ mit Anzahl Zellen (= Frames), Bildrate, Wiedergabezeit; Animationsordner „A“ mit Zelle „1“ auf Frame 1; kein eigenes Projekt „Animation“ | 🟡 | `animation: …` |
| Animationsordner und Zellen | Ebenen und Ordner im Animationsordner sind Zellen; Ordner heissen A, B …, Zellen 1, 2 … (zwischen 1 und 2: 1a); nicht in einem anderen Animationsordner; ohne Zeitleiste normale Ordner [AFC] | gleich, ausser „1a“ (neue Zellen bekommen die nächste Nummer) und Vorlagen für Zellen | 🟡 | Unit: `animation names` |
| Zeitleiste | Spuren je Ebene (Ordner auf-/zuklappbar, Animationsordner mit Zellen), Frames, Start/Ende, Bildrate, mehrere Zeitleisten, Clips, Keyframes, Graph-Editor, Beschriftungen, Ton; Frame einfügen/löschen [TLP, CLP, KEY, FRA] | gleich: Spuren je Ebene (Ordner auf-/zuklappbar), Frames 1…n, Bildrate, ein/aus; **mehrere Zeitleisten** (Zeitleisten-Liste in der Palette, *New timeline*, *Manage timeline*: neu, duplizieren, löschen, bearbeiten, Reihenfolge, Einstellungen; jede mit eigenen Clips, Zellen-Zuweisungen und Keyframes, dieselben Ebenen); **Start-/Endframe** (blaue Marken auf der Bildleiste, *Change settings*; Abspielen und Export-Bereich); *Change frame rate* mit *Change total number of frames* (Zellen, Clips und Keyframes rücken mit, die Spieldauer bleibt; auch Tonclips, damit der Ton synchron bleibt – im Vorbild nicht); Frame einfügen/löschen (verlängert bzw. kürzt Clips); Keyframes; Graph-Editor; **Frame-Anzeige** wie *Playback time* im Vorbild: Frame-Nummer ab 1 oder ab 0, Sekunden + Frame („0+1“), Timecode (mm:ss:ff) – die Bildleiste nummeriert dann die Frames jeder Sekunde und markiert Sekundenanfänge, die Frame-Anzeige zeigt die Zeit; **Trennlinien** alle N Frames (*Division line*); beides in *New timeline* und *Change settings*; keine Beschriftungen, keine geteilte Ansicht, keine Szenen-/Schnittnummer | 🟡 | `several timelines, …`, Unit: `animation tracks`, `clips`, `timelines` |
| Keyframes | *Enable keyframes on this layer* für Ebenen, Ordner, Animationsordner (Zellen gesperrt, Einstellungen bleiben beim Ausschalten erhalten); Objekt-Werkzeug: Rahmen über dem Ausgaberahmen ziehen, skalieren, drehen, Drehpunkt; Werkzeugeinstellungen: Position, Skalierung, Drehung, Drehpunkt, Deckkraft; Interpolation Halten (gelb) / Linear (grün) / Weich (blau); auswählen (Strg), ziehen, Alt+Ziehen kopiert, Ausschneiden/Kopieren/Einfügen, löschen, alle löschen; *Edit layers with active keyframes*; eigene Spuren für Masken; Graph-Editor [KEY, TLP] | gleich, auch *Edit track → Cut/Copy/Paste/Delete* für Keyframes (aus einer Spur in die aktuelle Spur, aus mehreren in die eigenen; sie brauchen einen Clip, wo sie landen); **Masken-Keyframes**: Maske gewählt (Miniatur in der Ebenen-Palette oder Zeile *Mask* in den Details) → das Objekt-Werkzeug und die Werkzeugeinstellungen setzen Position, Skalierung, Drehung und Drehpunkt der Maske innerhalb der Ebene; wo die bewegte Maske die Leinwand freigibt, zeigt sie die Ebene (bei *Mask outside selection*: verbirgt sie, wie die Standardfarbe einer PSD-Maske); Keyframes zeichnen je Einstellung auf (eine Änderung nur das Geänderte; Teil-Keyframes erscheinen klein), *Details (+)* zeigt die Zeilen Transform (> Position, Scale ratio, Rotate, Center of rotation) und Opacity, Keyframes per Rahmen auswählen (Umschalt fügt hinzu, Strg nimmt heraus); keine Beschriftungs-Zeile; Skalieren um den Drehpunkt; Keyframe-Deckkraft multipliziert die Ebenendeckkraft (eigene Wahl); „Add keyframe“ schaltet Keyframes ein | 🟡 | `keyframes move a track …`, `keyframes record each setting …`, Unit: `keyframes` |
| Graph-Editor | Zeitleiste als Kurven: X rot, Y grün, Andere orange; *View* X/Y/Andere, Einstellungsliste mit Augen; Keyframe anklicken/ziehen (Umschalt: eine Achse, Strg+Umschalt: dehnen/stauchen), Neigungsgriffe, *Unpair handles* (eckiger Keyframe), Kurve als Ganzes ziehen, Alt+Klick fügt einen Keyframe nur auf dieser Kurve hinzu bzw. entfernt ihn, *Snap to X/Y axis*, *Drag to zoom*, Mausrad zoomt; *Animation → Animation curve* [GRA] | gleich; Werte auf einer gemeinsamen Achse (Skalierung, Deckkraft, Lautstärke in %), Rahmen-Auswahl im Graphen; Keyframes liegen immer auf ganzen Frames; ohne „Show in list“ (alle Einstellungen stehen in der Liste); Zoom nur für die Werte (die Frames haben eine feste Breite) | 🟡 | `Graph Editor: …`, Unit: `keyframes` |
| 2D-Kamera | *New animation layer → 2D Camera Folder* (Name, Ausgaberahmen); Kamerarahmen mit Keyframes (Position, Skalierung, Drehung, Drehpunkt, Deckkraft); *Show field guides* / *Show camera's field of view*; Export „Apply 2D camera effects“ [TRK, KEY, EXA] | gleich: Dialog mit Name und Grösse des Ausgaberahmens (fügt einer Leinwand ohne einen hinzu, behält seine Mitte; fest, sobald ein Kameraordner ihn nutzt); Kamerarahmen und Keyframe-Rahmen liegen über dem Ausgaberahmen, gedreht wird um seine Mitte | ✅ | `keyframes move a track …`, `animation frame lines: …` |
| Animationsrahmen | *New* (Animation) → *Animation frame settings*: Grösse des Ausgaberahmens, Titelsicherer Bereich (oben/unten/links/rechts), Überlaufrahmen (Massstab oder Grösse, Bezugspunkt, Versatz X/Y), Leerraum; dünne blaue Linien auf der Leinwand, *View → Crop marks/Inner border*; Export *Drawing area* (Ausgaberahmen, Überlaufrahmen, ganze Leinwand) und *Export frames* [NEW, EXA, MRG] | gleich bei „Create animated illustration“ (Breite/Höhe = Ausgaberahmen, die Leinwand wird um Leerraum und Überlaufrahmen grösser); Standardwerte wie im Vorbild (Leerraum ein Zehntel); Linien folgen Leinwandgrösse/Zuschnitt/Auflösung und werden gespeichert; Drawing area in GIF/APNG/Einzelbildern/Film, Export frames bei Einzelbildern; ohne Projekttyp „Animation“, ohne Auswahlbereich als Drawing area, ohne „Add/Delete frame lines“ in den Leinwand-Eigenschaften | 🟡 | `animation frame lines: …`, Unit: `animation frame lines` |
| Clips | Ebenen erscheinen nur, wo ihre Spur einen Clip hat; Clip oben anklicken (Strg für mehrere), ziehen (auch über Spuren hinweg, nicht auf andere Spuren), Ende ziehen = trimmen (Zellen ausserhalb gehen), mit Alt dehnen; *Set as first / last displayed frame*, *Merge clips* (Lücke zeigt die letzte Zelle), *Split clip*, *Delete*, Kopieren/Einfügen (auch auf andere Spuren) [CLP] | gleich; eine Spur ohne eigene Clips gilt über die ganze Zeitleiste; Zuweisen ausserhalb eines Clips legt einen Clip bis zum nächsten an; beim Einfügen in einen anderen Animationsordner werden fehlende Zellen gleichen Namens leer angelegt; ein gezogener Clip stösst an Nachbar-Clips (springt nicht darüber); Clips von Ordnern verlängern ihre Unterspuren nicht mit | 🟡 | `animation clips: …`, Unit: `clips` |
| Zellen zuweisen | Rechtsklick auf einen Frame → Zelle wählen; Zelle gilt bis zur nächsten; ersetzen, verschieben, kopieren, löschen (die vorige Zelle läuft weiter); mehrere Zellen zuweisen; umbenennen nach Reihenfolge [ACT] | Rechts- oder Doppelklick → Zelle, leer, löschen, neue Zelle; Zelle gilt bis zur nächsten; gelöschte/verschobene Zellen verlassen die Spur; **zugewiesene Zellen** anklicken (Strg/⌘ oder Umschalt: mehrere), auf einen anderen Frame ziehen (ersetzt, was dort steht), mit Alt duplizieren, *Edit track → Cut/Copy/Paste/Delete* (in einen anderen Animationsordner: Zellen gleichen Namens, fehlende werden leer angelegt); **Assign multiple cels** (nach Nummer oder Zellname, Anzahl Frames je Zelle, Wiederholungen oder bis zum Ende, leere Frames dazwischen, Zellnummern überspringen; was danach kam, läuft weiter); ohne Zuweisen per Rechts-Ziehen (gleichmässige Abstände) | 🟡 | `animation: …`, `timeline: frame display …`, Unit: `timeline frame display and Assign multiple cels`, `moving, duplicating and pasting assigned cels` |
| Bearbeiten | Zeichnen auf der Zelle des gewählten Frames; Zellen ohne Zuweisung sind gesperrt [AFC] | gleich; zusätzlich springt die Wahl einer Zelle zu einem Frame, der sie zeigt (eigene Wahl), Zellen anderer Frames sind gesperrt | ✅ | `animation: …` |
| Abspielen | Play/Stop, Esc oder Klick auf eine andere Palette stoppt, Schleife, Echtzeit oder alle Frames [CHK] | Play/Stop in Echtzeit nach Bildrate, Schleife, Esc oder Klick auf die Leinwand stoppt | 🟡 | `animation: …` |
| Zwiebelschicht | vorige/nächste Zellen auf der Zeitleiste, Anzahl, Farbe/Halbfarbe/Monochrom, Anzeigefarben, Deckkraft mit Abstufung [ONI] | gleich (Standardwerte eigene Wahl: je 1, Halbfarbe, blau/grün, 50 %, −15 % je Stufe) | ✅ | `animation: …`, Unit: `onion skin` |
| Leuchttisch, Animationszellen-Palette | Palette *Animation cels*: Zielzelle, zellenspezifischer und allgemeiner Leuchttisch; Ebenen per Drag & Drop oder *Register selected layer*, Dateien (auch .clip/.psd), Ebenen anderer Leinwände, Zwiebelschicht-Bilder registrieren; Reihenfolge ziehen; Farbmodus Farbe/Halbfarbe/Monochrom mit Farbe, Deckkraft einzeln/alle, spiegeln, zurücksetzen; *Lock current animation cel*; vorige/nächste Zelle; Leuchttisch-Werkzeug (verschieben, skalieren, drehen, Zahlenwerte); *Move canvas to center* [LTB, ACP] | gleich für Ebenen (*Register selected layer* oder aus der Ebenen-Palette auf den zellenspezifischen bzw. allgemeinen Leuchttisch ziehen – der Reiter *Animation cels* öffnet sich beim Darüberziehen), Bilddateien (PNG/JPEG/WebP …, auch per Drag & Drop auf die Palette, im Dokument gespeichert statt nur verknüpft) und Zwiebelschicht-Bilder; **Umsortieren** per Ziehen, auch zwischen zellenspezifischem und allgemeinem Leuchttisch (die Zielzelle selbst nicht in den allgemeinen); Strg/⌘-Klick wählt mehrere; Werkzeugeinstellungen des Leuchttisch-Werkzeugs mit Zahlenwerten (Position, Skalierung, Winkel), Spiegeln, Zurücksetzen; **Move canvas to center** (Schieberegler mit den Namen der zwei Leuchttisch-Ebenen – die zwei gewählten, sonst die ersten zwei der Zielzelle –, 50 = Mitte; die Leinwand-Ansicht dreht und verschiebt sich live, die Leuchttisch-Ebenen bleiben auf dem Bildschirm stehen; *Cancel* stellt zurück, OK ist ein Rückgängig-Schritt); ohne Ebenen anderer Leinwände und frei wählbaren Drehpunkt; Registrieren der Zielzelle selbst landet im allgemeinen Leuchttisch; neue Leuchttisch-Ebenen: Farbe, 50 % (eigene Wahl) | 🟡 | `light table: …` (2 Tests), Unit: `light table`, `light table: order and Move canvas to center` |
| Ton | *File → Import → Audio* (WAV 8/16 Bit, MP3, Ogg; nur mit aktiver Zeitleiste), mehrere Dateien auf einer Tonspur, *New animation layer → Audio*; Tonspuren als Ebenen; Clips (Trimmen = Start mittendrin, kein Dehnen); Lautstärke-Keyframes im Objekt-Werkzeug; Wiedergabestartzeit [TRK, CLP, KEY] | gleich für Import (alle Formate, die das System dekodiert), Tonspuren, Clips (verschieben, trimmen, teilen, zusammenführen, kopieren), Lautstärke und Lautstärke-Keyframes, Stummschalten; Tonspuren sind **Audio-Ebenen** (Ebenen-Palette: Lautsprecher-Symbol, Auge = stumm, Regler = Lautstärke; nicht in Animationsordnern, nicht zeichen- oder vereinbar; Dateien früherer Versionen: ihre Tonspuren werden Audio-Ebenen unten im Stapel); Wellenform in den Clips; kein Feld „Wiedergabestartzeit“ (Trimmen setzt sie) | 🟡 | `sound: …`, Unit: `sound`, `.madpaint format` |
| Film-Import | *File → Import → Movie* (macOS: MOV, MP4) als Datei-Objekt-Ebene; Filmspur in der Zeitleiste mit Clips und Keyframes; Objekt-Werkzeug wie bei Datei-Objekten [TRK] | gleich als **Film-Ebene** (Ebenen-Palette mit Film-Symbol, nicht zeichenbar): Clip ab dem aktuellen Frame so lang wie der Film; Clips trimmen/teilen/verschieben setzen den Startpunkt im Film; Keyframes wie bei anderen Ebenen; der Ton des Films spielt mit (Lautstärke wie bei Audio-Ebenen); Bilder über ein verborgenes Video-Element dekodiert (die Anzeige zeigt bis zum genauen Bild das nächstliegende, Exporte warten auf jedes Bild); in den Ausgaberahmen eingepasst; Formate: was der Browser/Electron abspielt (WebM/VP9 immer, H.264 je nach System); im Dokument gespeichert | 🟡 | `movie import: …`, Unit: `.madpaint format` |
| Export | Einzelbildfolge (BMP, JPEG, PNG, WebP, TIFF, TGA; Präfix, Suffix, Trennzeichen – leer = Leerzeichen –, Startnummer, Vorschau des Dateinamens; *Settings* für JPEG-Qualität) in einen Ordner, animiertes GIF (Breite/Höhe, Exportbereich, Bildrate, Wiederholungen *Unlimited*/*Number of loops*, Spieldauer und Bildanzahl, Dithering, Transparenz), animierter Sticker (APNG: *Delete blank spaces*, *Color reduction* auf 256 Farben + Transparenz), animiertes WebP (*Export transparency*, *Compression method*: *Prioritize quality* / *Prioritize file size* mit *Quality*), Film (macOS: MP4/MOV; Audio: Abtastrate, Bit, Mono/Stereo; Grösse, 2D-Kamera, Bildrate) [EXA] | Dialoge mit denselben Feldern und Gruppen (*Export options*, *File name settings*, *Advanced settings*, *Size settings*, *Frame export*); Einzelbildfolge in allen sechs Formaten als ZIP (BMP 24 Bit, TIFF unkomprimiert RGB/RGBA, TGA 24/32 Bit – eigene Encoder; JPEG/WebP-Qualität direkt im Dialog statt über *Settings*), GIF wie im Vorbild, APNG immer transparent (Papier aus) mit Zuschnitt auf das Gezeichnete aller Bilder und indizierter Palette mit Alpha (PLTE + tRNS), **animiertes WebP** (eigener Muxer: VP8X, ANIM, ANMF je Bild aus den WebP-Bildern des Browsers; verlustfrei VP8L bzw. verlustbehaftet VP8 + ALPH); zusätzlich überall *Drawing area*, *Export draft* und *Apply 2D camera effects*; **Export animation cels** (jede Zelle jedes Animationsordners als Bild, ein Ordner je Animationsordner im ZIP, Exportordnername, Dateinamenformat Zellname/Nummer/Ordner + Zellname/Ordner + Nummer mit Präfix, Suffix, Trennzeichen, alle sechs Bildformate, Exportbereich, Entwürfe, Rahmenlinien; ohne PaintMan-Optionen und Ebenen ausserhalb der Animationsordner); **Exposure sheet** als CSV (Elternordner, Ordnernamen, je Frame die zugewiesene Zelle, leer = ×; ohne XDTS); **Audio** als WAV (Frames, 44,1/48 kHz, 16/24 Bit, Mono/Stereo; ohne Ogg); **Film** MP4/MOV mit Grösse, Bereich, Bildrate, 2D-Kamera, 44,1/48 kHz, Mono/Stereo; H.264 (Constrained Baseline) + AAC über WebCodecs, sonst MP4 mit VP9 + Opus bzw. MOV mit Photo-JPEG + 16-Bit-PCM; eigener Muxer (mit ffprobe/ffmpeg geprüft: H.264, AAC-LC, VP9, Opus, MJPEG, PCM dekodieren fehlerfrei); *Drawing area* (Ausgaberahmen/Überlaufrahmen/ganze Leinwand) und bei Einzelbildern *Export frames*; ohne Export-Vorgaben (*Preset*), Exportordner (ZIP statt Ordner), ICC-Profil, Bit-Auswahl beim Film (16 Bit) | 🟡 | `animation exports: …` (2 Tests), `sound: …`, Unit: `animated WebP`, `Export animation cels`, `Exposure sheet`, `WAV`, `animated PNG: Color reduction …`, `BMP`, `Targa`, `TIFF`, `MP4 and MOV` |

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
- **Pinsel:** Doppelpinsel, Tempo-Dynamik und „Smear“ fehlen.
- **Pinsel-Materialien:** Die Materialien des Vorbilds werden nicht verwendet; alle Spitzen und
  Texturen sind eigene, per Code erzeugte Bilder (seeded, nahtlos über periodisches Rauschen).
  Wie Texturen wirken, beschreibt das Handbuch nur in Worten; eigenes Modell: Höhe 0–255 der
  Textur, „Subtrahieren“ nimmt Dichte × (255 − Höhe) vom Alphawert (leichte Striche treffen nur
  die hohen Stellen), „Multiplizieren“ multipliziert mit 1 − Dichte × (1 − Höhe/255). Importierte
  Bilder: Transparenz, sonst Helligkeit (dunkel = Farbe bzw. hohe Stelle). Importierte Materialien
  liegen nur im Browser-Speicher dieses Rechners; Vektorlinien, die sie verwenden, werden anderswo
  mit runder Spitze bzw. ohne Textur gezeichnet.
- **3D** ist nicht umgesetzt.
- **Kurven-Lineale:** Wie Spline und Parallelkurve gerechnet werden, sagt das Handbuch nicht.
  Eigene Annahmen: Spline = zentripetaler Catmull-Rom durch alle Punkte; Parallelkurven und die
  Kurven-Spezial-Lineale laufen über die Enden gerade weiter (wie die Abbildung des Handbuchs),
  das normale Kurven-Lineal endet an seinen Enden. Die Mehrfachkurve verschiebt die Kurve entlang
  ihres Drehgriffs (anfangs quer zur Verbindung von Anfang und Ende), die Radialkurve dreht sie um
  die Mitte. Beginnt ein Strich nahe an einem Lineal, Figur-Lineal, einer Hilfslinie oder
  Rahmenkante, hat dieses Vorrang vor einem Spezial-Lineal (ein Symmetrie-Lineal wiederholt den
  Strich trotzdem); der Lineal-Stift glättet den Strich und behält ihn als Spline durch wenige
  Punkte (Knicke über 57° bleiben Ecken).
- **Animation:** Standardwerte (Bildrate und Zellen bei „Create animated illustration“,
  Zwiebelschicht-Farben und -Deckkraft, Name des ersten Animationsordners) sind nicht
  dokumentiert; gewählt: 8 Zellen bei 8 fps, Ordner „A“, je eine vorige/nächste Zelle in
  Halbfarbe (blau/grün) mit 50 %. Ob die Wahl einer Zelle in der Ebenen-Palette den Frame
  wechselt, sagt das Handbuch nicht (umgesetzt: Sprung zum nächstgelegenen Frame mit dieser
  Zelle). Die GIF-Wiederholungen zählen die Durchläufe insgesamt (NETSCAPE-Block = Anzahl − 1).
  Die Einzelbildfolge kommt im Browser als ZIP statt in einen Ordner.
- **Comic-Rahmen:** Standardwerte (Linienbreite, Stegbreiten) und ob „Divide folder“ beim
  Werkzeug standardmässig an ist, sind nicht dokumentiert; gewählt: 5 px, 4 mm / 2 mm, an.
  Welche Stegbreite („vertical gutter“ / „horizontal gutter“) zu welcher Schnittrichtung gehört,
  ist nicht eindeutig; benannt nach der Lage des Stegs (oben/unten, links/rechts).
- **Text:** Grösse-Einheit, Standardgrösse und Standardschrift des Text-Werkzeugs sind nicht
  dokumentiert; gewählt: pt bei der Dokumentauflösung, 24 pt, Systemschrift „sans-serif“. Ob Esc
  im Text bestätigt oder abbricht, sagt das Handbuch nicht (umgesetzt: abbrechen).
- **Sprechblasen:** Farben neuer Blasen (Linie/Füllung) sind als „Line color / Fill color“
  beschrieben, nicht deren Standard; angenommen: Haupt- und Unterfarbe. Formen der Wolke und des
  Schwanzes sind eigene Geometrie.
- **Vektorlinien:** Das Handbuch beschreibt Pfade mit Kontrollpunkten (Spline/Bezier), aber kein
  Dateiformat und keine Formeln. MAD Studio Paint vereinfacht den geglätteten Strich (Douglas-
  Peucker über Lage, Breite und Dichte, dann Nachprüfung des Splines) zu Kontrollpunkten mit
  Breite und Dichte, legt einen zentripetalen Catmull-Rom-Spline hindurch (Knicke über 57° als
  Ecken) und zeichnet die Linie mit derselben Pinselspitze; „bis zum Schnittpunkt“ schneidet an
  den Kreuzungen der Pfade (Mittellinien), abgeschnittene Stücke erhalten eigene Kontrollpunkte.
- **Linie korrigieren:** Stärken und Bereiche sind nicht beziffert. Eigene Annahmen: Kneifen
  bewegt Kontrollpunkte mit einer Kosinus-Glocke über „Kneifgrad“ % der Linienlänge (Druck
  verkürzt sie bis auf ein Viertel); „Vereinfachen“ 0–100 entspricht 0,5–10,5 px Toleranz;
  „Verbinden“ legt die beiden Enden auf ihre Mitte; Linienbreite/Deckkraft am Kontrollpunkt:
  60 px nach rechts verdoppeln die Breite, 150 px nach rechts machen voll deckend.
- **Auswahl beim Verschieben/Transformieren einer Vektorebene:** nicht beschrieben; umgesetzt:
  Linien, die die Auswahl berühren, werden als Ganzes mitgenommen.
- **Lineal-Bereich:** Welchen Geltungsbereich ein neues Lineal standardmässig hat, sagt das Handbuch nicht; angenommen: „alle Ebenen“.
- **Mehrfaches Drücken** einer geteilten Werkzeugtaste (Zyklus) belegt nur die Celsys-Tutorialseite
  „Art Rocket“, nicht das Handbuch.
- **PSD:** Das Handbuch nennt Formate und Dialoge, aber nicht, wie Ebenenarten und -modi
  übersetzt werden. Eigene Annahmen: Vektor- und Verlaufsebenen als Pixel; Textrahmen als
  Photoshop-Text (ohne Umbruch als Punkttext, dessen Anker auf der ersten Grundlinie liegt –
  geschätzt als halbe Zeilenhöhe + 0,33 × Schriftgrösse unter dem Rahmenrand –, mit Umbruch als
  Absatztext mit dem Rahmen als Box; CSS-Schriftfamilie ↔ PostScript-Name über eine kleine Tabelle,
  sonst ohne Leerzeichen; fett/kursiv als „Faux“-Stil; Textkante ↔ Kontur außen); das Papier
  als unterste Ebene „Paper“ (als normale Ebene, nicht als Photoshop-Hintergrund);
  „Glow dodge“ → Farbig abwedeln, „Add“ und „Add (Glow)“ → Linear abwedeln; Randeffekt (Kante)
  ↔ Kontur außen, Ebenenfarbe ↔ Farbüberlagerung (beim Öffnen mit Unterfarbe gleich Farbe, also
  alle Pixel in der Farbe), Rasterfolie und Aquarellkante werden in die Pixel gerechnet (samt
  Maske); Schatten und Schein werden mit normaler Füllmethode gerechnet (Photoshops
  Standardmethoden Multiplizieren/Negativ multiplizieren nicht), „Spread/Choke“ als Prozent
  der Grösse, Weichzeichnen als dreifacher Box-Filter; Rahmenordner → Gruppe mit Maske aus
  Rahmenflächen und Rahmenlinie. Beim Öffnen gilt eine leere Maske mit Hintergrund Schwarz als
  „keine Maske“ (wie bei psd-tools; manche Programme schreiben sie für jede Ebene), und ohne
  Ebene „Paper“ ist das Papier aus (wie Photoshop: Transparenz). Die Mathematik der Korrekturebenen ist eigene; Photoshop rechnet
  Farbton/Sättigung u. a. etwas anders. Geprüft wurde mit einem unabhängigen Leser (psd-tools)
  und einem unabhängigen Schreiber (pytoshop, 16 Bit), nicht mit Photoshop selbst.

## Quellen

Präfix `M/` = `https://help.clip-studio.com/en-us/manual_en/` (Handbuch Ver. 5.0)

| Kürzel | Quelle |
| ------ | ------ |
| EULA | https://www.clipstudio.net/en/dl/eula/ |
| IF | `M/060_pc/Interface.htm` |
| NEW | `M/030_new/030_new.htm` |
| PAL, CMD, HIDE | `M/690_interface/Palettes.htm`, `…/Command_Bar.htm`, `…/Hide_Title_Bar_and_Menu_Bar.htm` |
| TOOLPAL, USE, CUST | `M/150_tools/The_Tool_palette.htm`, `…/How_to_use_tools.htm`, `…/Customizing_the_Tool_and_Tool_Group_palettes.htm` |
| PEN | `M/240_brushes/Adjusting_pen_pressure.htm` |
| RUL, SNAP, PERSP, EDITR | `M/510_ruler/Basics_of_creating_rulers.htm`, `…/Drawing_while_snapping_to_a_ruler.htm`, `…/Perspective_Rulers.htm` + `…/Drawing_along_a_perspective_ruler.htm`, `…/Editing_a_ruler.htm` |
| CRV | `M/450_figure/Complex_lines.htm` (Polylinie, Spline, quadratische und kubische Bézierkurven, Ecken mit ⌥, letzten Punkt löschen) |
| DYN, BS, TS, PB | `M/240_brushes/Customizing_brush_tools.htm`, `…/Brush_Size_palette.htm`, `…/Tool_Sliders_palette.htm`, `…/Drawing_and_painting.htm` |
| SEL, CW, CS, CSET, CH, EYE | `M/300_color/Selecting_colors.htm`, `…/Color_Wheel_palette.htm`, `…/Color_Slider_palette.htm`, `…/Color_Set_palette.htm`, `…/Color_History_palette.htm`, `…/Eyedropper_Tool.htm` |
| NAV, CANVAS | `M/270_canvas/Navigating_the_canvas.htm`, `…/Canvas_window.htm` |
| GRID | `M/270_canvas/Using_the_ruler_bar_and_grid.htm` |
| LP, BO, OLS, REF, DR, FOL, BL | `M/180_layers/Using_layers.htm`, `…/Basic_operations.htm`, `…/Other_layer_settings.htm`, `…/Reference_layers.htm`, `…/Draft_layers.htm`, `…/Layer_folders.htm`, `…/Blending_modes.htm` |
| MASK, LPROP | `M/180_layers/Layer_masks.htm`, `…/Layer_properties.htm` |
| VEC, ERASE | `M/180_layers/Vector_layers.htm`, `M/240_brushes/Eraser_tools.htm` |
| SUBC | `M/810_subtools/C.htm` (Correction: Post correction – auf Vektorebenen weniger Kontrollpunkte, Spline oder quadratische Bézierkurve) |
| GLAY, FIL | `M/180_layers/Gradient_layers.htm`, `M/180_layers/Fill_layers.htm` |
| FRM, SCR, TLAY | `M/540_comic/Frames_and_Panels.htm`, `M/540_comic/Screentones.htm`, `M/180_layers/Tone_layers.htm` |
| TXT, TXE, TXS, TXV, BAL | `M/480_text/Adding_text.htm`, `…/Editing_text.htm`, `…/Text_settings.htm`, `…/Vertical_text_and_readings.htm`, `M/540_comic/Balloons.htm` |
| OBJ, V | `M/810_subtools/O.htm` (Operation), `M/810_subtools/V.htm` (Vector) |
| FLT | `M/390_filters/Filters.htm` (Filter-Menü, alle Gruppen und Dialoge) |
| TC, TCE, GD | `M/390_filters/Tonal_Correction.htm`, `…/Tonal_Correction_Effects.htm`, `M/810_subtools/G.htm` (Gradient dialog) |
| JB, JS | `https://help.clip-studio.com/ja-jp/manual_jp/180_layers/` (Grundoperationen, nützliche Einstellungen) |
| FILL, GRAD | `M/420_fill/Fill_Tool.htm`, `…/Gradient_Tool.htm` |
| SEL (Auswahl), AUTO, LCH | `M/330_selection/Selection_area.htm`, `…/Auto_select_tool.htm`, `…/Selection_Launcher.htm` |
| TR, FIG | `M/360_transform/Types_of_transformations.htm`, `M/450_figure/` |
| TRS, IMS | `M/360_transform/Transform_using_the_Tool_Settings_palette.htm`, `M/810_subtools/T.htm` (Transformation settings), `M/810_subtools/I.htm` (Image settings: Interpolation) |
| MOD, OPT, TS, MENU | `M/780_shortcuts/Shortcuts_usable_during_operation.htm`, `…/Optional_Shortcuts.htm`, `…/Tool_Shortcuts.htm`, `…/Menu_Shortcuts.htm` |
| PRF, UND, EXP, IMP, PC | `M/720_preferences/Preferences.htm`, `M/270_canvas/Undo__47_Redo.htm`, `M/210_file/Exporting_files.htm`, `…/Import_image_file_to_canvas.htm`, `M/060_pc/Saving__44__exporting__44__and_importing_files.htm` |
| OPN, SAV, DRF | `M/210_file/Open_file.htm`, `M/210_file/Save_file.htm`, `M/180_layers/Draft_layers.htm` |
| ANI, AFC, TLP, ACT | `M/600_animation/Animating_in_Clip_Studio_Paint.htm`, `…/Animation_folders_and_cels.htm`, `…/Timeline_Palette.htm`, `…/Assigning_cels_to_the_timeline.htm` |
| CLP, KEY, FRA, CHK | `…/Using_clips.htm`, `…/Using_keyframes.htm`, `…/Using_frames.htm`, `…/Checking_your_animation.htm` |
| GRA | `…/Using_the_Graph_Editor.htm` |
| MRG | `M/270_canvas/Margins.htm`, `M/210_file/Creating_a_New_Canvas.htm` (Animation cel terms) |
| TRK | `…/Track_operations.htm` |
| ONI, LTB, ACP, EXA | `…/Onion_skin.htm`, `…/Using_light_table_layers.htm`, `…/Animation_Cels_palette.htm`, `…/Export_animation.htm` |
| GL-x | `M/810_subtools/x.htm` (Glossar der Einstellungen) |
| T563, T582, T656, T684, T868, T1250, T4846 | `https://tips.clip-studio.com/en-us/articles/<Nr>` (ClipStudioOfficial) |
| TIPS | `https://tips.clip-studio.com/en-us/articles/1248` |
| PDF4 | Clip Studio Paint User Guide Ver. 4.0 (PDF, vd.clipstudio.net), S. 7 |
