# MAD Studio Paint

> **Vorbild:** Clip Studio Paint (Celsys, <https://www.clipstudio.net/>) · **Plattform:** macOS (Electron-App) und Browser ·
> **Status:** 🟢 v0.1 lauffähig

[![MAD Studio Paint CI](https://github.com/MADTreasures/reverse/actions/workflows/mad-studio-paint-ci.yml/badge.svg)](https://github.com/MADTreasures/reverse/actions/workflows/mad-studio-paint-ci.yml)
[![MAD Studio Paint macOS](https://github.com/MADTreasures/reverse/actions/workflows/mad-studio-paint-macos.yml/badge.svg)](https://github.com/MADTreasures/reverse/actions/workflows/mad-studio-paint-macos.yml)

MAD Studio Paint ist ein **ebenenbasiertes Mal- und Zeichenprogramm** für Illustration und
Comic. Es ist so gebaut, dass sich Leute, die Clip Studio Paint kennen, sofort zurechtfinden:
gleiche Anordnung der Paletten, gleiche Werkzeuggruppen und Untertools, gleiche
Zusatztasten (Space = Hand, ⌥-Klick = Pipette, ⇧ = gerade Linie …) und dieselben Abläufe bei
Ebenen, Auswahl und Füllen. Alles ist selbst geschrieben – Code, Pinsel-Engine, Icons und
App-Symbol. Wie das Vorbild untersucht und verglichen wurde, steht in
[RESEARCH.md](RESEARCH.md).

![MAD Studio Paint – Standard-Arbeitsbereich](docs/screenshot-default.png)
![MAD Studio Paint – klassischer Arbeitsbereich](docs/screenshot-classic.png)

## Funktionen

| Bereich | Was geht |
| ------- | -------- |
| **Zeichnen** | Pen (G-pen, Real G-pen, Mapping pen, Turnip pen, Calligraphy · Milli pen, Felt pen, Dot pen), Pencil (Pencil, Mechanical pencil, Charcoal, Crayon), Brush (Round watercolor brush, Transparent watercolor, Opaque watercolor, Brush pen, Dry ink · Oil paint, Flat brush, Gouache, Soft brush), Airbrush (Soft, Spray, Droplet), Eraser (Hard, Soft, Kneaded eraser, Rough), Blend (Blend, Blur, Finger tip), **Verflüssigen** (Liquify, J: Schieben, Aufblähen, Zusammenziehen, nach links/rechts schieben, Wirbel im/gegen den Uhrzeigersinn; Pinselgrösse, Stärke, Härte, Kantenglättung, *Nur Bearbeitungsbereich referenzieren*, Stabilisierung; ⌥ kehrt die Wirkung um – auch mitten im Strich –, gedrückt halten wirkt weiter, ⇧ entlang einer Geraden; die Tupfer eines Strichs bilden ein Verschiebungsfeld, durch das das Bild nur einmal abgetastet wird, so bleiben Linien scharf; auf Rasterebenen, Auswahlebenen und Ebenenmasken, eine Auswahl begrenzt die Wirkung) |
| **Pinsel-Engine** | Stiftdruck auf Grösse und Dichte mit **Druckkurve** je Einstellung und **globaler Druckeinstellung** (*File → Pen pressure settings*: Kurve, Stärker/Leichter, Testfeld, automatisch aus dem Gezeichneten), **Stiftneigung** (breiter/heller wie die Bleistiftseite), **Tempo** (schnelle Striche dünner/heller), Zufall, Stabilisierung 0–100, Kantenglättung in 4 Stufen, Deckkraft pro Strich und „Brush density“ pro Tupfer, **Pinselspitze** (Härte, Dicke, Winkel – fest, Linienrichtung oder Stiftrichtung –, Zufallswinkel; Spitzenform Kreis oder **Material**: neun eigene Bildspitzen wie Kreide, Borsten, Spritzer, Blatt, Gras, Stern, Glitzer, Herz, Blume oder **eigene Bilder importieren**, mehrere Spitzen mit Wiederholmethode, horizontal/vertikal spiegeln), **Papiertextur** (fünf eigene nahtlose Texturen – Zeichenpapier, rau, Aquarellpapier, Leinwand, Skizzenbuch – oder importierte Bilder; Dichte, Skalierung, Drehung, Helligkeit, Kontrast, Invertieren, Modus Subtrahieren/Multiplizieren, pro Strich oder pro Abdruck; die Textur liegt fest auf dem Papier), **Ein- und Auslaufen** (auch mit der Maus), **Farbmischung** (Blend, Running color: Farbmenge, Farbdichte, Farbdehnung), **Aquarellkante**, Abstand, Körnung, Streuung – alles im Fenster *Advanced Tool Settings* (Schraubenschlüssel) |
| **Werkzeuge** | Auswahlbereich (Rechteck, Ellipse, Lasso, Polylinie, Auswahlstift, Auswahl radieren, **Auswahl verkleinern** auf die umschlossene Zeichnung, **Magnet-Lasso**: das Lasso rastet an den Linien der Referenzebene ein, Stärke 1–5; auch bei Lasso-Füllen und Umschliessen und füllen), Auto select (Bearbeitungsebene / alle Ebenen / Referenzebenen), Füllen (Toleranz, **Lücke schliessen** in 5 Stufen, Bereichsvergrösserung rund/rechteckig/**bis zum dunkelsten Pixel**, Mehrfachreferenz – auch *Layer in folder*, nur verbundene Pixel; Ziehen füllt mehrere Bereiche; **Umschliessen und füllen**, **Lasso-Füllung**, **Restflächen-Stift** mit Zielfarbe), **Verlauf** (Knotenleiste mit Haupt-/Unter-/Wunschfarbe und Deckkraft, Umkehren, *Verlauf bearbeiten* mit Verlaufsliste: eigene Vorlagen und eigener Verlaufssatz zum Laden, Ersetzen, Duplizieren, Anlegen, Löschen; Form Linie/Kreis/Ellipse; Randverhalten nicht wiederholen / wiederholen / spiegeln / nicht zeichnen; Dithering; **Verlaufsebenen**, deren Richtung, Farben und Form später änderbar sind – mit dem Verlaufswerkzeug neu ziehen oder Start-/Endgriff mit dem Objekt-Werkzeug; *Layer → New Layer → Gradient*), Figur (Gerade, **Kurve**, **Polylinie**, **fortlaufende Kurve**, **Bézierkurve**, Rechteck, Ellipse, **Vieleck**; Rundung der Ecken, Linie/Füllung/beides), **Lineale** (Lineal, **Kurven-Lineal** – Punkte klicken, Doppelklick/Enter schliesst ab, Polylinie, Spline, quadratische und kubische Bézierkurve, ⌥-Klick = Ecke –, **Figur-Lineal** (Rechteck, Ellipse, Vieleck), **Lineal-Stift** (freihand), Hilfslinie, Spezial-Lineale: Parallele, **Parallelkurve**, **Mehrfachkurve**, Radial, **Radialkurve**, konzentrisch, **Symmetrie-Lineal** mit 2–32 Linien und Spiegelung, **Perspektiv-Lineal** mit 1–3 Fluchtpunkten; Striche und Figur-Linien rasten ein, *Snap to ruler* ⌘1 / *Snap to special ruler* ⌘2, Geltungsbereich je Ebene; Kontrollpunkte mit dem Objekt-Werkzeug ziehen; *Layer → Ruler/Frame → Draw along ruler*), Operation (Objekt: **Vektorlinien** wählen (⇧ ergänzt), verschieben, skalieren, drehen, Farbe/Breite/Deckkraft ändern, löschen; Lineale wählen/verschieben/bearbeiten/löschen; Ebene wählen, Ebene verschieben), Pipette (angezeigte Farbe / Ebenenfarbe), Hand, Drehen, Zoom |
| **Ebenen** | Rasterebenen, **Vektorebenen** und Ordner (Normal oder „Through“), **alle 28 Ebenenmodi** des Vorbilds (11 davon pixelweise berechnet), Deckkraft, **Ebeneneigenschaften** (Randeffekt: Kante oder Aquarellkante, **Rasterfolie/Ton**: Rasterweite in lpi, Dichte aus Farbe/Helligkeit/fester Wert, Deckkraft als Punktgrösse, Posterisierung, Punktformen Kreis/Quadrat/Raute/Linie/Kreuz/Ellipse/Rauschen, Winkel, Position; Ebenenfarbe mit Unterfarbe, **Ausdrucksfarbe** Farbe/Grau/Monochrom mit Farb- und Alphaschwelle, Ebenendeckkraft berücksichtigen, Schwarz/Weiss einzeln; bei gewählter Maske **Mask expression**: Verläufe ja/nein mit Schwelle), **Füllebenen** (*Layer → New Layer → Fill*: eine Farbe aus *Color settings*, Maske aus der Auswahl; Farbe per Doppelklick auf die Miniatur, mit dem Objekt-Werkzeug oder per Klick in eine Farbpalette ändern), **Rasterfolien-Ebenen** (*Layer → New Layer → Tone* / Auswahl-Starter „New tone“: Füllebene mit Ton – Dichte, Typ, Winkel, Maske aus der Auswahl, benannt wie „Circle 60.0 line 10%“), **Korrekturebenen** (die neun Tonwertkorrekturen als Ebene, mit eigener Maske, beschneidbar, Einstellungen per Klick aufs Symbol), **Ebenenmasken** (Ausserhalb der Auswahl / Auswahl maskieren, auf der Maske zeichnen: Farbe zeigt, Radierer verbirgt, Löschen = nichts maskiert, aktivieren, Maskenbereich anzeigen, mit der Ebene verknüpfen, auf die Ebene anwenden, ⌘-Klick = Auswahl), Auf untere Ebene beschneiden, Referenz-, Entwurfsebene, Sperren, Transparente Pixel schützen, Auf untere Ebene übertragen, Mit unterer / sichtbare Ebenen vereinen, Auf eine Ebene reduzieren, Ordner erstellen/auflösen, Duplizieren (auch ⌥-Ziehen), ⌥-Klick aufs Auge = nur diese Ebene, ⌘-Klick aufs Miniaturbild = Auswahl, Papier-Ebene (wie im Vorbild Teil des Stapels: Ebenenmodi und Korrekturebenen wirken auf sie) |
| **Text & Sprechblasen** | **Text-Werkzeug** (T): klicken und tippen oder einen Rahmen aufziehen (Umbruch am Rahmen, Überstehendes verborgen), direkt auf der Leinwand mit Zoom und Drehung (auch Eingabemethoden für Japanisch usw.), Text-Starter mit OK/Abbrechen, ⌘Enter bestätigt, Esc bricht ab; Text anklicken = bearbeiten. Schrift (beliebige installierte), Grösse in pt, fett/kursiv/unterstrichen/durchgestrichen, Ausrichtung, **vertikaler Text** (Spalten von rechts nach links, lateinische Zeichen gedreht), Zeilen- und Zeichenabstand, Textrand. Textebenen heissen nach ihrem Text. **Sprechblasen** (T): Ellipse, abgerundet, Rechteck, Gedankenblase (Wolke); Linie in Haupt-, Füllung in Unterfarbe; **Sprechblasenschwanz** (gebogen) und Gedankenschwanz (Bläschen) von innen nach aussen ziehen; Blasen über Text nehmen ihn auf und zentrieren ihn, überlappende Blasen verschmelzen. Objekt-Werkzeug: Text/Blasen wählen, verschieben (Text in der Blase geht mit), skalieren, drehen, Doppelklick = Text bearbeiten, Linien- und Füllfarbe |
| **Comic-Rahmen** | **Rahmenordner** (*Layer → New frame border folder*: ein Rahmen innerhalb der Seitenränder, Linienbreite, „Draw border“): der Inhalt des Ordners ist nur im Rahmen sichtbar, die Rahmenlinie liegt darüber. Werkzeug **Frame border** (U): Rechteckrahmen (rastet an Leinwand und anderen Rahmen ein), Polylinienrahmen, **Rahmen teilen** (über einen Rahmen ziehen, Stege oben/unten und links/rechts in mm, neuer Rahmenordner je Teil), *Layer → Ruler/Frame → Divide frame border equally* (Spalten × Zeilen). **Rahmen-Vorlagen** (*Layer → Ruler/Frame → Frame templates*): zwölf eigene Seitenaufteilungen (1–4 Reihen, Raster, breit + 2, gestaffelt, schräg, Splash …) mit Vorschaubild, Stegen in mm, Linienbreite, ein Rahmenordner je Rahmen oder alle in einem; die Rahmen auf der Leinwand lassen sich als eigene Vorlage registrieren. Objekt-Werkzeug: Rahmen an der Linie greifen, verschieben, skalieren, drehen, Linienbreite/-farbe, Entf löscht den Rahmen (der Ordner bleibt). Rahmenkanten wirken als Lineal (⌘1) |
| **Animation** | *File → New* mit „Create animated illustration“ (Anzahl Zellen, Bildrate) oder *Animation → New animation layer → Animation folder*: **Animationsordner** (A, B, C …) mit nummerierten **Zellen** (1, 2, 3 …; eine Zelle kann auch ein Ordner mit mehreren Ebenen sein). **Zeitleisten-Palette** unter der Leinwand (Höhe an der Oberkante ziehbar): eine Spur je Ebene (Ordner auf- und zuklappbar, Animationsordner zeigen ihre Zellen je Frame), Bildleiste zum Anklicken und Ziehen (Scrubben), Zelle auf einen Frame legen per Rechts- oder Doppelklick (Zelle, leer, löschen, neue Zelle), eine Zelle gilt bis zur nächsten Zuweisung. **Clips**: eine Ebene erscheint nur, wo ihre Spur einen Clip hat; Clip am oberen Streifen anklicken (Strg/⌘ für mehrere), ziehen zum Verschieben, Enden ziehen zum Trimmen, mit Alt zeitlich dehnen; *Animation → Edit track*: Set as first / last displayed frame, Split clip, Merge clips, Delete clip, Copy/Paste clip. **Keyframes**: *Enable keyframes on this layer* bzw. *Add keyframe* (Zeitleiste) für Ebenen, Ordner und Animationsordner; mit dem Objekt-Werkzeug den Rahmen auf der Leinwand verschieben, an den Ecken skalieren, am Griff drehen, den Drehpunkt versetzen oder in den Werkzeugeinstellungen Position, Skalierung, Drehung, Drehpunkt und Deckkraft eingeben – jede Änderung wird im Keyframe des aktuellen Frames aufgezeichnet, je Einstellung (Keyframes mit nur einem Teil erscheinen klein); *Details (+)* vor dem Spurnamen zeigt die Zeilen Transform (aufklappbar: Position, Scale ratio, Rotate, Center of rotation) und Opacity; Interpolation Halten (gelb), Linear (grün), Weich (blau), auch je Zeile; Keyframes anklicken, mit einem Rahmen auswählen (Umschalt fügt hinzu, Strg/⌘ nimmt heraus), ziehen (Alt kopiert), löschen (auf einer Zeile nur diese Einstellung); **Masken-Keyframes**: mit gewählter Maske (Miniatur bzw. Zeile *Mask*) bewegt, skaliert und dreht das Objekt-Werkzeug die Ebenenmaske über die Zeit; **Graph-Editor** (Knopf links in der Zeitleiste bzw. *Animation → Animation curve*): die Einstellungen der Spur als Kurven (X rot, Y grün, Andere orange), Keyframes ziehen (Umschalt: eine Achse, Strg+Umschalt: dehnen), Neigungsgriffe, *Unpair handles*, ganze Kurve verschieben, Alt+Klick setzt bzw. entfernt einen Keyframe auf einer Kurve, an X/Y einrasten, Mausrad und *Drag to zoom*; Ebenen mit Keyframes sind gesperrt, bis *Edit layers with active keyframes* an ist. **Animationsrahmen** (*New* → *Animation frame settings*): Ausgaberahmen, Titelsicherer Bereich, Überlaufrahmen (Massstab/Grösse, Bezugspunkt, Versatz) und Leerraum als dünne blaue Linien (*View → Crop marks/Inner border*); die Exporte wählen den *Drawing area* (Ausgaberahmen, Überlaufrahmen, ganze Leinwand), Einzelbilder auf Wunsch mit den Rahmenlinien. **2D-Kameraordner** (*New animation layer → 2D camera folder*: Name und Grösse des Ausgaberahmens): Keyframes bewegen, zoomen und drehen den Kamerarahmen (Hilfslinien) über den Ebenen darin; *Show camera's field of view* zeigt das Bild durch die Kamera, die Exporte wenden sie an („Apply 2D camera effects“). **Leuchttisch** in der Palette *Animation cels* (Reiter neben *Layer*/*History*, *Window → Animation cels*): Zielzelle (sperrbar), zellenspezifischer und allgemeiner Leuchttisch; Ebenen (auch aus der Ebenen-Palette hineinziehen), Bilddateien (auch per Drag & Drop) und Zwiebelschicht-Bilder registrieren, per Ziehen umsortieren (auch zwischen zellenspezifisch und allgemein), Strg/⌘-Klick wählt mehrere; Farbmodus Farbe/Halbfarbe/Monochrom mit Anzeigefarbe, Deckkraft (einzeln oder alle), horizontal/vertikal spiegeln, Position zurücksetzen; das **Leuchttisch-Werkzeug** (Operation) verschiebt, skaliert und dreht die gewählte Leuchttisch-Ebene (auch mit Zahlenwerten in den Werkzeugeinstellungen), ohne das Original zu ändern; nur die Anzeige zeigt sie; **Move canvas to center** dreht und verschiebt die Leinwand zwischen zwei Leuchttisch-Ebenen (Zwischenzeichnungen). Neue Animationszelle (auf dem gewählten Frame bzw. dem nächsten), zugewiesene Zellen wählen (Strg/⌘, Umschalt), ziehen (Alt dupliziert), ausschneiden/kopieren/einfügen, **Assign multiple cels**, Zugewiesene Zelle löschen, *Edit track → Cut/Copy/Paste/Delete* auch für Keyframes und Clips, Frame-Anzeige als Nummer ab 1/0, Sekunden + Frame oder Timecode, Trennlinien alle N Frames, Vorige/nächste Zelle, **Frame einfügen/löschen** (Anzahl, *Selected layer only*, *Split clip*), *Move frame*: Anfang/Ende, voriger/nächster Frame, **voriger/nächster Keyframe**, **Go to specified frame**, **Go to timeline label**; **Beschriftungen** (*Animation → Label*): **Zeitleisten-Labels** (grün in der Bildleiste; Doppel- oder Rechtsklick auf einen Frame benennt ihn, jeder Text nur einmal), **Spur-Labels** auf einem Frame oder über einen Bereich (*Create track label* mit *Range* oder in der Label-Zeile unter *Details (+)*: Rechtsklick bzw. Rechts-Ziehen und tippen; anklicken wählt aus – Umschalt/Strg für mehrere, auch per Rahmen –, nochmals klicken bearbeitet, leerer Text löscht, ziehen verschiebt, Alt dupliziert, Enden ziehen ändert den Bereich, *Edit track → Cut/Copy/Paste/Delete*), **Zwischenbild-Labels 〇/●** (auch in gleichen Abständen: nach Rechts-Ziehen Alt+Enter bzw. Umschalt+Alt+Enter); bei zugeklappter Label-Zeile stehen die Labels oben auf der Spur; sie wandern mit Frame einfügen/löschen und Bildrate ändern mit; Bildrate und Länge (*Timeline → Change settings*, *Change frame rate* auf Wunsch mit gleicher Spieldauer), **Start-/Endframe** (blaue Marken auf der Bildleiste), **mehrere Zeitleisten** (Liste in der Zeitleisten-Palette, *New timeline*, *Manage timeline*: duplizieren, löschen, ordnen), Zeitleiste ein/aus. **Abspielen** mit Bildrate, Schleife, Esc stoppt. **Zwiebelschicht** (vorige/nächste Zellen, Anzahl, Farbe/Halbfarbe/Monochrom, Anzeigefarben, Deckkraft und Abstufung). Wer eine Zelle wählt, springt zu einem Frame, der sie zeigt; Zellen anderer Frames sind gesperrt. **Film-Import**: *File → Import → Movie* (MP4, MOV, WebM – was das System abspielen kann) legt eine **Film-Ebene** an: ihr Clip zeigt den Film Bild für Bild, in den Ausgaberahmen eingepasst, sein Ton spielt mit; Clips trimmen, teilen, verschieben (der Film beginnt dann mittendrin), Keyframes wie bei anderen Ebenen; der Film wird im Dokument gespeichert, Exporte warten auf jedes Filmbild. **Ton**: *File → Import → Audio* (WAV, MP3, Ogg, AAC/M4A, FLAC …; bei aktiver Zeitleiste) legt einen Clip auf eine **Audio-Ebene** (*New animation layer → Audio*; in der Ebenen-Palette mit Lautsprecher-Symbol, Auge = stumm, der Deckkraft-Regler setzt die Lautstärke, in Ordnern: ausgeblendeter Ordner = stumm), mit Wellenform in der Zeitleiste; Tonclips verschieben, trimmen (der Ton beginnt dann mittendrin), teilen, kopieren; Lautstärke und **Lautstärke-Keyframes** (Objekt-Werkzeug → Werkzeugeinstellungen), Stummschalten per Auge; der Ton spielt beim Abspielen synchron mit und wird im Dokument gespeichert. *File → Export animation* mit den Dialogen des Vorbilds (Breite/Höhe, Exportbereich, Bildrate, Wiederholungen „Unlimited/Number of loops“, Spieldauer, *Export options*): **animiertes GIF** (Dithering, Transparenz), **animierter Sticker (APNG)** (immer transparent; *Delete blank spaces* schneidet auf das Gezeichnete zu, *Color reduction* auf 256 Farben mit Transparenz), **animiertes WebP** (Transparenz, Kompression *Prioritize quality* = verlustfrei bzw. *Prioritize file size* mit Qualität), **Einzelbildfolge** (BMP, JPEG mit Qualität, PNG, WebP, TIFF, TGA; Präfix, Suffix, Trennzeichen, Startnummer, Vorschau des Dateinamens; als ZIP), **Animationszellen** (jede Zelle als Bild, ein Ordner je Animationsordner, Dateinamenformate wie im Vorbild), **Belichtungsblatt** (CSV, mit Spur-Labels und 〇/●), **Audio** (WAV, 44,1/48 kHz, 16/24 Bit, Mono/Stereo), **Film** als **MP4** oder **QuickTime (MOV)** (Grösse, Bereich, Bildrate, 2D-Kamera, Audio 44,1/48 kHz, Mono/Stereo): H.264 + AAC, wo das System sie kodieren kann (macOS); sonst MP4 mit VP9 + Opus bzw. MOV mit Photo-JPEG + 16-Bit-PCM (spielt in QuickTime); eigener MP4/MOV-Muxer |
| **Vektorebenen** | Jeder Strich (Pinsel, Figur, auch mit Symmetrie) wird wie nach der Nachkorrektur des Vorbilds als **Spline durch wenige Kontrollpunkte** mit Breite und Dichte je Punkt gespeichert und daraus gezeichnet: Verschieben, ⌘T, Spiegeln, Bildauflösung und Leinwandgrösse verlieren nichts. **Linie korrigieren** (Y): *Kontrollpunkt* (verschieben, hinzufügen, löschen, Ecke umschalten, Linienbreite und Deckkraft am Punkt ziehen, Linie teilen), *Vektorlinie kneifen* (Kneifgrad, Druck, Wirkungsbereich, Enden fixieren, Kontrollpunkt hinzufügen, Linien verbinden), *Vektorlinie vereinfachen* (Stärke, Ecken glätten, ganze Linie, Kurve umwandeln: Gerade/Spline, kurze Linien löschen, verbinden), *Vektorlinien verbinden*, *Linienbreite anpassen* (dicker/dünner um px, skalieren um %, mind. 1 px, ganze Linie), *Vektorlinie nachzeichnen* (Enden fixieren, verbinden, vereinfachen, Stabilisierung), *Linienbreite nachzeichnen* (Stiftdruck); das Objekt-Werkzeug zeigt und zieht die Kontrollpunkte gewählter Linien; *Layer → Ruler/Frame → Ruler from vector*. **Vektorradierer** (berührten Bereich, **bis zum Schnittpunkt** – auf Wunsch mit allen Ebenen –, ganze Linie), normale Radierer radieren den berührten Teil, Transparentfarbe zeichnet radierende Linien; *Select → Select overlapping vectors / Select vectors within area*; Füllen, Verlauf und Mischen sind wie im Vorbild gesperrt; *Layer → Rasterize*; Vektorebenen lassen sich in Vektorebenen vereinen |
| **Auswahl** | Hinzufügen (⇧) / Abziehen (⌥) / Schnittmenge (⇧⌥), Quadrat/Kreis (⇧ beim Aufziehen), Alles, Aufheben, Erneut, Umkehren, **Vergrössern/Verkleinern** (Breite, spitze oder runde Ecken), **Rand weichzeichnen**, **Farbbereich auswählen** (*Select color gamut*: Dialog bleibt offen, Farben auf der Leinwand anklicken; Farbtoleranz, neu/hinzufügen/abziehen, *Refer multiple* mit allen Ebenen, Referenzebenen, gewählter Ebene oder Ebenen im Ordner), **Quick Mask** (die Auswahl als rote Ebene bemalen und zurück; wird nicht gespeichert), **Auswahlebenen** (*Convert to selection layer*: gespeicherte Auswahl als grüne Ebene, nicht exportiert; *Convert selection layer to selection*), laufende Ameisen und **Auswahl-Starter** (Aufheben, Zuschneiden, Umkehren, Vergrössern, Verkleinern, Löschen, Ausserhalb löschen, Ausschneiden/Kopieren & Einfügen, Transformieren, Füllen) |
| **Bearbeiten** | Undo/Redo (200 Schritte, History-Palette), Ausschneiden/Kopieren/Einfügen (auch Bilder aus der Zwischenablage), Löschen, Füllen, **Transformieren** wie im Vorbild (*Edit → Transform*: Skalieren/Drehen ⌘T, nur Skalieren, nur Drehen, Freies Transformieren ⇧⌘T mit frei ziehbaren Ecken, Verzerren, Neigen, Perspektive, Gitter-Transformation mit einstellbarer Punktzahl; Bezugspunkt ziehen oder ⌥-Klick; Werkzeugeinstellungen mit Modus, Bezugspunkt, Skalierung, Drehwinkel, Seitenverhältnis, Original behalten, Interpolation), Spiegeln, **Tonwertkorrektur** mit Vorschau – alle neun des Vorbilds: Helligkeit/Kontrast, Tonwertkorrektur mit Histogramm, Gradationskurve, Farbton/Sättigung/Helligkeit (⌘U), Farbbalance, Umkehren (⌘I), Posterisieren, Binarisieren, Verlaufsumsetzung, Bildauflösung, Leinwandgrösse |
| **Filter** | gegliedert wie im Vorbild: *Blur* (Blur, Blur (strong), Gaussian blur, Lens blur mit Blendenform, Smoothing, Radial blur, Motion blur, Spin blur), *Sharpen* (Unsharp mask, Sharpen, Sharpen more), *Effect* (Artistic, Chromatic aberration, Crystallize, Mosaic, Noise, Normal map, Pencil drawing, Remove jpeg noise, Retro film), *Distort* (Pinch, Ripple, Curved surface, Convert to panorama, Geometric distortion, Polar coordinates, ZigZag, Wave, Twirl, Fish-eye lens), *Render* (Perlin noise), *Correction* (Remove dust, Adjust line width) – Dialoge mit Live-Vorschau (im Hintergrund berechnet), rotes × auf der Leinwand für den Mittelpunkt, wirkt nur in der Auswahl, ein Schritt im Verlauf |
| **Ansicht** | Zoom 0,78 %–3200 % in den Stufen des Vorbilds (Mausrad, Pinch, ⌘+/⌘−), Drehen in 5°-Schritten um die Fenstermitte, Ansicht spiegeln, Navigator, Zoom/Drehung in der Statusleiste, Tab / ⇧Tab blendet Paletten / Menüleiste aus, **Raster** (*View → Grid*) und **Linealleiste** (⌘R) mit *Grid/Ruler bar settings* (Startpunkt, Abstand, Unterteilungen, als Standard speichern), **An Raster ausrichten** (⌘3) |
| **Farbe** | Farbkreis mit Quadrat (HSV) oder Dreieck (HLS), H/S/V- bzw. H/L/S-Werte (Klick: RGB), Farbregler mit Reitern RGB / HSV (HLS) / CMYK, **mehrere Farbsets** (Auswahl oben, *Edit color sets*: neu, Standard-Set, duplizieren, löschen, umbenennen, sortieren; ⌥-Klick ersetzt eine Kachel), Farbverlauf, Haupt-/Unter-/Transparentfarbe; **Zwischenfarbe** (*Intermediate Color*: Kacheln zwischen vier Eckfarben, Klick auf eine Ecke übernimmt die Zeichenfarbe) und **Näherungsfarbe** (*Approximate Color*: Kacheln um die Zeichenfarbe, Regler oben und links mit wählbarer Eigenschaft H/S/V/L/R/G/B), beide mit Palettenmenü (Raster 10/20/30, Kachelbreite 7/10/15 pt, Gitterlinien) und Wert-Anzeige (Klick: RGB ↔ HSV/HLS) |
| **Arbeitsbereich** | **Standard** (Layout der aktuellen Version: Tool Group/Tool Settings, Tool Sliders) und **Klassisch** (Sub Tool, Tool Property, Brush Size untereinander) – *Window → Workspace*; im *Window*-Menü jede Palette ein- und ausblenden (eingeblendet kommt sie in ihrem Stapel nach vorn; gemerkt), Palettenmenü (≡) in der Titelleiste; **Sub View** (Referenzbilder: importieren per Knopf, Drag & Drop oder Zwischenablage, mit automatischer Pipette Farben aufnehmen oder mit der Hand verschieben, Zoom-Regler, Mausrad, einpassen, drehen in 5°-Schritten, spiegeln, voriges/nächstes Bild, Bildliste zum Wählen, Umsortieren und Entfernen, als neue Leinwand öffnen, entfernen; die Bilder bleiben über Leinwände und Neustarts hinweg); **Search Layer** (Ebenen nach Typ, *Include*/*Exclude*-Bedingungen und Suchwort filtern, anklicken, ein-/ausblenden, löschen, neue Ebene des Typs); Einstellungen (⌘K): dunkles/helles Design, Drehschritt, Anzahl Undo, Haltezeit der Werkzeugtasten |
| **Dateien** | Eigenes Format `.madpaint` (ZIP mit `document.json` und einer PNG-Datei pro Ebene), **Photoshop-Dokumente** (`.psd`/`.psb` öffnen mit Ordnern, Masken, Schnittmasken, Modi, Deckkraft, Sperren, Einstellungsebenen, **editierbaren Textebenen** und **Ebenenstilen**; *File → Save duplicate → .psd/.psb* mit Ebenen, Textebenen als Photoshop-Text, Effekten als Ebenenstile, Papier als unterste Ebene „Paper“, Entwurfsebenen wahlweise); **Export (single layer)** als BMP, JPEG, PNG, WebP, TIFF, TGA, PSD oder PSB mit dem Einstellungsdialog des Vorbilds (Exportvorschau mit Zoom und Dateigrösse, Qualität, WebP-Kompression, PSD als Hintergrund, Entwurf/Text ein- oder ausblenden, Exportbereich ganze Leinwand/Ausgaberahmen/Auswahl, Ausdrucksfarbe Auto/Duotone Schwellenwert/Duotone Rasterpunkte/Grau/RGB, Transparenz, Ausgabegrösse als Massstab, Grösse in px/mm/cm/in oder Auflösung – die dpi stehen in der Datei); **Ebenenstile** in der Palette *Layer Property*: Schlagschatten, Schatten nach innen, Schein nach aussen und innen (Farbe, Deckkraft, Winkel, Abstand, Grösse, Spread), PNG/JPEG/WebP öffnen, Bilder ablegen (auf der Leinwand: öffnen, auf der Ebenen-Palette: als Ebene), Autosave & Wiederherstellung |

## Installation auf dem Mac

### Variante A – fertige App herunterladen

1. Auf GitHub unter **Actions → „MAD Studio Paint · macOS app“** den neuesten erfolgreichen Lauf
   öffnen (oder unter **Releases**, sobald ein Tag `mad-studio-paint-v*` existiert).
2. Unten bei *Artifacts* **`MAD-Studio-Paint-macOS-Apple-Silicon`** (M1–M4) oder
   **`MAD-Studio-Paint-macOS-Intel`** herunterladen und entpacken – darin liegt die DMG-Datei.
3. DMG öffnen und **MAD Studio Paint** in den Programme-Ordner ziehen.
4. Die App ist nicht von Apple notarisiert. Beim ersten Start blockiert macOS sie deshalb.
   Abhilfe: *Systemeinstellungen → Datenschutz & Sicherheit → „Trotzdem öffnen“*, oder im Terminal:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/MAD Studio Paint.app"
   ```

### Variante B – selbst bauen

Voraussetzung: [Node.js](https://nodejs.org/) 22.12 oder neuer.

```bash
cd projects/mad-studio-paint
npm ci
npm run dist:mac        # erzeugt release/MAD-Studio-Paint-0.1.0-arm64.dmg und …-x64.dmg
```

Zum schnellen Ausprobieren ohne Paketieren: `npm run app` (baut und startet die App).

### Variante C – im Browser

```bash
cd projects/mad-studio-paint
npm ci
npm run dev             # http://localhost:5174 in Chrome, Edge oder Safari öffnen
```

Grafiktabletts funktionieren in beiden Varianten mit Druckempfindlichkeit (Pointer Events).

## Für Umsteiger von Clip Studio Paint

Die Bedienung folgt dem öffentlichen Handbuch des Vorbilds (Ver. 5). Die wichtigsten Gewohnheiten:

| Gewohnheit | In MAD Studio Paint |
| ---------- | ------------------- |
| Werkzeugtasten mehrfach drücken wechselt innerhalb der Gruppe (P = Feder ↔ Bleistift, B = Pinsel ↔ Airbrush ↔ Dekoration, G = Füllen ↔ Verlauf) | gleich |
| Werkzeugtaste **gedrückt halten** = Werkzeug nur vorübergehend, beim Loslassen zurück | gleich |
| Space = Hand, ⇧Space = Drehen, ⌘Space = Zoom +, ⌥Space = Zoom − | gleich |
| ⌥-Klick mit Zeichenwerkzeugen = Pipette, ⌘⌥-Ziehen = Pinselgrösse, ⇧-Ziehen = gerade Linie | gleich |
| X = Haupt-/Unterfarbe tauschen, C = Transparentfarbe, [ / ] = Pinselgrösse | gleich |
| ⌘⇧-Klick = Ebene unter dem Mauszeiger wählen | gleich |
| Tab = Paletten ausblenden, ⇧Tab = Menüleiste ausblenden | gleich |
| Ebenen-Palette: Modus + Deckkraft oben, Schalter für Schnittmaske/Referenz/Entwurf/Sperren, Stift-Symbol markiert die Bearbeitungsebene | gleich |
| Vektorebenen: Vektorradierer, Objekt-Werkzeug, Linie korrigieren (Y) | gleich (ohne Quadratische/Kubische Bézier-Linien und Kontrollpunkt-Einrasten) |
| Text-Werkzeug und Sprechblasen (T) | gleich (ohne Rubi, Kreistext, Zeichenformat pro Buchstabe) |
| Comic-Rahmen (Rahmenordner, Rahmen teilen, Rahmen-Vorlagen) | gleich (Vorlagen im Dialog statt Material-Palette; ohne Kontrollpunkte, Rahmen verbinden) |
| Animation: Animationsordner, Zeitleiste mit Clips und Keyframes, 2D-Kamera, Zwiebelschicht, Leuchttisch, Ton, Film-Import, Export als Einzelbilder, GIF, APNG, WebP und Film (MP4/MOV) | gleich |
| 3D | noch nicht (siehe unten) |

### Tastenkürzel

Wie im Handbuch des Vorbilds (macOS: Ctrl → ⌘, Alt → ⌥):

| Taste | Funktion | Taste | Funktion |
| ----- | -------- | ----- | -------- |
| P | Pen / Pencil | M | Auswahlbereich |
| B | Brush / Airbrush | W | Auto select |
| E | Eraser | I | Pipette |
| J | Blend / Verflüssigen | K / D | Ebene verschieben / Ebene wählen |
| G | Füllen / Verlauf | H / R / `/` | Hand / Drehen / Zoom |
| U | Figur / Rahmen / Lineal | , / . | Voriges / nächstes Werkzeug der Gruppe |
| T | Text / Sprechblase | O | Objekt (auch ⌘ mit Zeichenwerkzeugen) |
| [ / ] | Pinselgrösse (Voreinstellungen) | ⌘[ / ⌘] | Deckkraft − / + |
| X / C | Farben tauschen / Transparentfarbe | ⇧⌘O / ⇧⌘P | Dichte − / + |
| ⌘N / ⌘O / ⌘S / ⇧⌘S | Neu / Öffnen / Speichern / Speichern unter | 0 | Mehrfachreferenz (Füllen) |
| ⌘Z / ⌘Y (⇧⌘Z) | Undo / Redo | ⌘T / ⇧⌘T | Skalieren/Drehen / Freies Transformieren |
| ⌘X ⌘C ⌘V (F2 F3 F4) | Ausschneiden / Kopieren / Einfügen | ⌫ / ⇧⌫ / ⌥⌫ | Löschen / Ausserhalb löschen / Füllen |
| ⌘A / ⌘D / ⇧⌘D / ⇧⌘I | Alles / Aufheben / Erneut / Umkehren | ⌘U / ⌘I | Farbton·Sättigung·Helligkeit / Umkehren |
| ⇧⌘N | Neue Rasterebene | ⌘E / ⇧⌘E | Mit unterer / sichtbare Ebenen vereinen |
| ⌘G / ⇧⌘G | Ordner erstellen / auflösen | ⌥⌘G | Auf untere Ebene beschneiden |
| ⌥] / ⌥[ | Ebene darüber / darunter wählen | ⌘K | Einstellungen |
| ⌘+ / ⌘− / ⌘0 / ⌥⌘0 | Zoom + / − / Einpassen / 100 % | − / = (^) | Ansicht links / rechts drehen (5°) |
| Tab / ⇧Tab | Paletten / Menüleiste aus | F1 | Alle Tastenkürzel |

## Dokumente

- `.madpaint` ist ein ZIP-Archiv mit `document.json` (Ebenenbaum, Modi, Deckkraft, Flags,
  Papierfarbe, Vektorlinien, Text und Sprechblasen, Zeitleiste und Zellen-Zuweisungen – lesbares JSON) und `layers/<id>.png` (eine verlustfreie PNG-Datei
  pro Rasterebene und pro Ebenenmaske, die Maske im Alphakanal) sowie `preview.png`. Fremde
  Programme können die Ebenen so direkt öffnen. Vektorebenen speichern ihre Linien (Kontrollpunkte
  mit Breite und Dichte, Kurvenart und Ecken, eine Pinseltabelle je Ebene), Textebenen ihre Textrahmen und Sprechblasen;
  beide werden beim Öffnen neu gezeichnet.
- Das Clip-Studio-Format `.clip` wird **nicht** gelesen oder geschrieben (siehe
  [RESEARCH.md](RESEARCH.md)). Austausch mit anderen Programmen: **PSD** sowie PNG/JPEG/WebP.
- **PSD** (über die MIT-lizenzierte Bibliothek [ag-psd](https://github.com/Agamnentzar/ag-psd);
  der Code dafür lädt erst, wenn eine PSD geöffnet oder gespeichert wird):
  - *File → Open* liest `.psd` und `.psb` (RGB, CMYK, Graustufen; 8, 16 und 32 Bit) mit
    Ordnern („Hindurchwirken“ bleibt erhalten), Ebenenmasken, Schnittmasken, allen passenden
    Ebenenmodi, Deckkraft (auch „Fläche“), Sichtbarkeit und Sperren. Einstellungsebenen werden zu
    Korrekturebenen: Helligkeit/Kontrast, Tonwertkorrektur, Gradationskurve,
    Farbton/Sättigung, Farbbalance, Umkehren, Tontrennung, Schwellenwert, Verlaufsumsetzung.
    **Textebenen bleiben editierbarer Text** (Schrift, Grösse, fett/kursiv, Unter-/Durchstreichen,
    Farbe, Ausrichtung, Zeilen- und Zeichenabstand, Punkt- oder Absatztext, Drehung; eine Kontur
    wird zur Textkante). **Ebenenstile**: Kontur → Randeffekt, Farbüberlagerung → Ebenenfarbe,
    Schlagschatten, Schatten nach innen, Schein nach aussen/innen → eigene Ebenenstile (sichtbar und
    einstellbar); Abgeflachte Kante, Glanz und Verlaufsüberlagerung werden aufbewahrt und beim
    Speichern zurückgeschrieben (aber nicht angezeigt). Form- und Smartobjekt-Ebenen sowie
    verkrümmter Text kommen als Pixel (ein Hinweis nennt, was nicht übernommen wurde). Eine
    unterste Ebene „Paper“ wird wieder zum Papier. Gespeichert wird danach als `.madpaint`; die PSD
    bleibt unverändert.
  - *File → Save duplicate → .psd* schreibt die Ebenen: **Textrahmen als Photoshop-Textebenen**
    (mehrere Rahmen und Sprechblasen einer Ebene als Gruppe; vertikaler Text bleibt Pixel, weil
    vertikaler Text die Datei für Photoshop unbrauchbar machen kann), Vektor- und Verlaufsebenen
    als Pixel, das Papier als unterste Ebene „Paper“, Entwurfsebenen nur wenn angehakt.
    Korrekturebenen werden zu Einstellungsebenen, Randeffekt (Kante), Ebenenfarbe, Schatten und
    Schein zu **Ebenenstilen**. Rahmenordner werden Gruppen mit einer Maske in Form der Rahmen und
    der Rahmenlinie als Ebene. Ebenen mit Rasterfolie oder Aquarellkante werden so geschrieben,
    wie sie aussehen (Photoshop kennt diese Effekte nicht). Photoshop fragt beim Öffnen, ob es die
    Textebenen neu zeichnen soll. Ein zusammengesetztes Bild liegt bei, damit Vorschau und Quick
    Look es zeigen.
  - *File → Export (single layer)* bietet PSD als Format, auf Wunsch „Output as background“.
- Die Arbeit wird einige Sekunden nach jeder Änderung automatisch gesichert (IndexedDB)
  und beim nächsten Start wiederhergestellt. Das ersetzt kein Speichern in eine Datei.

## Architektur

```
src/
├── model/        Dokumentmodell (Ebenenbaum, Modi, Flags), Farben, Clipping-Gruppen – reine Logik
├── paint/        Pinsel-Mathematik (Dabs, Druck, Stabilisierung), Füllen, Auswahlmasken, Undo-Stapel,
│                 Werkzeuge & Untertools, Ansichts-Transformation – reine Logik, unit-getestet
├── engine/       Pixel-Seite: eine Canvas pro Ebene und Maske, Compositor (Modi, Ordner, Masken,
│                 Schnittmasken, nur geänderte Bereiche), Pinsel-Engine, Bearbeitungen mit Undo-Patches
├── tools/        Zeiger-Eingabe → Werkzeug: Zusatztasten, Sitzungen je Werkzeug, Freies Transformieren
├── store/        Zustand (zustand), Aktionen (Ebenen, Auswahl, Undo/Redo, Ansicht), Zwischenablage
├── io/           .madpaint-Format, PSD (ag-psd, nachgeladen), Öffnen/Speichern/Export, Autosave
├── ui/           React-Oberfläche: Paletten, Zeichenfläche, Menüs (eine Befehlstabelle für die
│                 Menüleiste im Browser und das native Mac-Menü), Dialoge, Tastatur
└── platform/     Brücke zu Electron (Dateidialoge, Menü) bzw. Browser-Fallbacks
electron/         Electron-Hauptprozess (app://-Protokoll, natives Menü, Dateidialoge) und Preload
tests/e2e/        Playwright-Tests der laufenden App
```

Ein Pinselstrich wird in einen Strich-Puffer gezeichnet und bei jedem Mausereignis nur im
geänderten Rechteck mit der Ebene verrechnet (Sicherung ⊕ Puffer, maskiert durch die Auswahl,
„Transparente Pixel schützen“ über `source-atop`). So bleibt die Deckkraft innerhalb eines
Strichs konstant, und Vorschauen (gerade Linie, Figur, Verlauf) lassen sich beliebig neu
zeichnen. Undo speichert nur die Pixel des geänderten Rechtecks (vorher/nachher).

## Entwicklung

```bash
npm run dev          # Browser-Version mit Hot Reload
npm run app:dev      # Electron-Fenster mit Hot Reload
npm run typecheck    # TypeScript prüfen
npm test             # Unit-Tests (Vitest)
npm run test:e2e     # End-to-End-Tests der laufenden App (Playwright, Chromium)
npm run check        # Typecheck + Unit-Tests + Build
npm run dist:mac     # macOS-App als DMG (arm64 + x64) nach release/
npm run icon         # App-Icon aus build/icon.svg neu erzeugen
```

CI: [`mad-studio-paint-ci.yml`](../../.github/workflows/mad-studio-paint-ci.yml) prüft jede
Änderung unter Linux (Typecheck, Tests, Build, E2E, Electron-Start).
[`mad-studio-paint-macos.yml`](../../.github/workflows/mad-studio-paint-macos.yml) baut die
Mac-App auf einem macOS-Runner, startet sie testweise und stellt die DMGs als Artefakte bereit.
Bei einem Tag `mad-studio-paint-v*` wird daraus ein GitHub-Release.

## Grenzen und nächste Schritte

Was im Vergleich zum Vorbild noch fehlt, steht Punkt für Punkt in
[RESEARCH.md](RESEARCH.md#vergleich-clip-studio-paint-laut-handbuch--mad-studio-paint). Die grössten Lücken:

- 3D; bei der Animation OpenToonz-/XDTS-Export und Kameraanweisungen für Toei-Belichtungsblätter; bei Rasterfolien die
  Bildmotiv-Punkte (Stern, Herz …), das Werkzeug „Rasterpunkte verschieben“ und „Tonbereich
  anzeigen“; beim
  Text: Formatierung einzelner Buchstaben, Rubi (Lesehilfe), Kreistext; bei Rahmen:
  Rahmen verbinden, Kontrollpunkte, Comic-Seiten mit Beschnitt und Innenrand.
- Doppelpinsel, Band-Spitzen („Ribbon“), Freiform-Verlauf; die Material-Palette
  des Vorbilds (Materialien kommen hier über die Pinseleinstellungen und den Bildimport).
- Import/Export von `.clip`. Beim PSD-Austausch: Formatierung einzelner Buchstaben, vertikaler
  und verkrümmter Text, Vektormasken und Muster-Überlagerungen werden nicht als solche
  übernommen; Abgeflachte Kante, Glanz und Verlaufsüberlagerung werden nur aufbewahrt, nicht
  angezeigt; „Glow dodge“ und „Add (Glow)“ werden zu „Farbig abwedeln“ bzw. „Linear abwedeln“.

## Rechtliches

MAD Studio Paint ist ein unabhängiges Projekt und steht in keiner Verbindung zu Celsys.
„Clip Studio Paint“ ist eine Marke von Celsys, Inc. und wird hier nur beschreibend als
Vorbild genannt. Es wurde kein Code, keine Grafik, kein Pinsel und keine Datei von Clip Studio
Paint verwendet. Das Programm wurde weder heruntergeladen noch installiert, dekompiliert oder
mit REA analysiert – das verbietet die Lizenzvereinbarung (§5.2/§5.3). Grundlage war die
öffentliche Dokumentation; Details in [RESEARCH.md](RESEARCH.md).

Mitgelieferte Open-Source-Bibliotheken (React, zustand, fflate, ag-psd mit pako und base64-js, gifenc)
stehen unter MIT- bzw. Zlib-Lizenz. Ihre Lizenztexte schreibt der Build nach
`dist/THIRD_PARTY_LICENSES.txt`, das mit der App ausgeliefert wird.
