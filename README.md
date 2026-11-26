# Vokabeltrainer Englisch ↔ Deutsch

Lernspiel für Vokabellisten, läuft als App im Browser (PWA) – auch offline, ohne Konto, ohne Server.

**App öffnen:** https://oleksiibekishev.github.io/vokabel-trainer/

Auf dem Handy installieren:
- **Android (Chrome):** Menü ⋮ → „App installieren“ / „Zum Startbildschirm hinzufügen“
- **iPhone (Safari):** Teilen-Symbol → „Zum Home-Bildschirm“

## Spielregeln

| Level | Runden | Startzeit | Bonus pro Runde | Limit | Spiele |
|---|---|---|---|---|---|
| Leicht | 6 | 60 s | +10 s | 60 s | Paare (Englisch links, Deutsch rechts), Auswahl |
| Mittel | 10 | 40 s | +10 s | 40 s | Paare (gemischt, jedes Paar links/rechts geteilt), Auswahl, Lücken |
| Schwer | 15 | 30 s | +10 s | 30 s | Paare, Auswahl, Lücken, Schreiben |

- Ein Timer für das ganze Level, jede geschaffte Runde gibt Bonuszeit – aber nur bis zum Limit.
- Ein Fehler → zurück zu Runde 1 (mit Animation, was falsch war).
- Runde 1–3 haben dieselben Wörter, bis man das Level schafft – danach werden sie neu gemischt (andere Wörter). Ab Runde 4 immer zufällig.
- „Mittel“ wird nach „Leicht“ freigeschaltet, „Schwer“ nach „Mittel“ – pro Wortliste.
- „Endlos“ öffnet sich, sobald „Mittel“ in irgendeiner Liste geschafft ist – dann für alle Listen und für immer (auch nach „Fortschritt zurücksetzen“).
- Wörter mit Fehlern kommen öfter dran.
- Die Zeiten sind fest (eigene Zeiten in den Einstellungen gibt es seit 1.9 nicht mehr).

Beim ersten Start erklärt eine **Einführung** in 7 Schritten das Spiel (wischen oder „Weiter“, „Überspringen“ jederzeit). Sie kommt nur einmal; in den Einstellungen lässt sie sich mit „Einführung → Ansehen“ wieder öffnen. Wird die App über einen geteilten Listen-Link zum ersten Mal geöffnet, kommt erst die Liste, dann die Einführung.

### Spezialrunden (zufällig ab Runde 4)

Jede Runde ab Runde 4 wird mit 25 % zur Spezialrunde, nie zwei hintereinander. Höchstens 1 (Leicht), 2 (Mittel) bzw. 3 (Schwer) pro Spiel – oft auch gar keine. Alle erlaubten Spezialrunden sind gleich häufig; das Spiel der Runde wird passend gemacht (Wirbel → Paare, Kombo → Paare/Auswahl).

| Spezialrunde | Spiele | Was passiert |
|---|---|---|
| Wirbel | Paare | Nach 3 richtigen Paaren verschwinden sie, an ihrer Stelle kommen 3 neue (9 statt 6 Paare, keine Extrazeit); danach wirbeln alle Kärtchen auf neue Plätze (Leicht: innerhalb ihrer Spalte, sonst bleibt jedes Paar links/rechts geteilt). Während der Animation steht die Zeit. |
| Kombo | Paare, Auswahl | Schnelle richtige Antworten hintereinander (auch die erste, ab Rundenbeginn): ×2 = +5 s, ×3 = +10 s, ×4 = +15 s, ×5 = +20 s; bei jeder Stufe leuchten die beantworteten Kärtchen kurz blau. Diese Sekunden sind **Extrazeit** über dem Limit; sie wird erst benutzt, wenn die normale Zeit abgelaufen ist. Schnell = höchstens 3,5 s (Leicht), 3 s (Mittel), 2,5 s (Schwer) nach der letzten Antwort. |
| Zeitraffer | alle (ab Mittel) | Die Zeit läuft 1,5× so schnell. |
| Zeitbombe | eigenes Feld (ab Mittel) | 5 Paare in 10 s auf einem Feld mit 4 × 2 Kärtchen. Nach je 2 gefundenen Paaren kommen 4 ganz neue Paare (die Zeit wartet so lange, ~0,4 s). Ein falsches Paar sperrt das Feld 1 s, die Zeit läuft weiter. Geschafft: Zeit wieder voll (Mittel 40 s, Schwer 30 s; Endlos +20 s statt des Rundenbonus). Zeit abgelaufen: Spielende, ohne Wortliste. Keine Pause; wird die App weggeklickt, startet die Bombe danach mit neuen Wörtern neu. Nur bei Listen mit mindestens 8 Wörtern. |

Die Zeitbombe lässt sich in den Einstellungen abschalten (Schalter „Zeitbombe“); dann kommt sie in keinem Spiel mehr.

### Weitere Modi

- **Endlos** (nach „Mittel“, siehe oben): Runden ohne Ende mit allen Spielen, Start 30 s, **kein Limit**. Bonus: +10 s bis Runde 10, +8 s bis 20, +6 s bis 30, danach +5 s. Spezialrunden werden häufiger (25 % → 50 %), Zeitraffer ab Runde 21 2×. Ein Fehler beendet das Spiel, Rekord = geschaffte Runden.
- **Fehlertraining**: nur Wörter mit Fehlern, ohne Zeit, höchstens 10 Wörter pro Durchgang (die schwierigsten zuerst). Jedes Wort muss 3× richtig sein (Auswahl → Lücken → Schreiben), dann steht sein Fehlerzähler wieder auf 0. Ein Fehler schickt das Wort zurück an den Anfang. Im Fehler-Fenster eines Levels startet „Dieses Wort üben“ das Fehlertraining mit genau diesem Wort.
- **Artikel** (von Anfang an offen): der, die oder das? 12 Nomen der aktuellen Liste pro Runde, ohne Zeit; das englische Wort steht als Hilfe darunter (z. B. „Lager – stock“). Ein Fehler beendet die Runde nicht: die richtige Antwort wird gezeigt, am Ende stehen die falschen Nomen mit Artikel, „Fehler wiederholen“ übt genau diese. Nomen mit Fehlern kommen in der nächsten Runde zuerst (höchstens die Hälfte). Genommen werden alle deutschen Übersetzungen, die mit der/die/das beginnen – ohne Plural-Markierung („die Daten (Pl.)“), Klammern oder Doppelformen („der/die Verbraucher/-in“). Braucht mindestens 4 solche Nomen in der Liste. Zählt für die Tagesserie.

### Tagesserie

- Der erste zu Ende gespielte Durchgang des Tages (gewonnen oder verloren – Level, Endlos oder Fehlertraining) zählt den Tag; „Beenden“ zählt nicht.
- Oben im Kopf und in der Kachel über der Liste: Tage in Folge, Rekord und die Woche Mo–So. Ein verpasster Tag setzt die Serie auf 0, der Rekord bleibt.
- Ein Tipp auf die Kachel (oder den Zähler) öffnet den Kalender mit allen gespielten Tagen; blättern mit ‹ › oder Wischen.
- Gespeichert werden nur die Tage (`YYYY-MM-DD`, Ortszeit); sie sind im Sicherungscode enthalten und werden mit „Fortschritt zurücksetzen“ gelöscht.

## Eigene Wortlisten

In der App: **Listen & Wörter → Liste hinzufügen** → Namen eingeben (Pflicht), Text einfügen oder Datei (.txt/.csv) wählen.
Mit dem **Stift** lässt sich eine Liste später ändern (Name, Wörter hinzufügen/ändern/löschen – eine Zeile pro Paar). Der Fortschritt bleibt, die Fehler gelöschter Wörter verschwinden. Eine geänderte mitgelieferte Liste wird nicht mehr durch App-Updates überschrieben.
Mit **Teilen** entsteht ein Link, den man z. B. per WhatsApp an die Klasse schickt. Der Link enthält die ganze Liste (~1000 Zeichen für 36 Wörter); die App macht daraus über [is.gd](https://is.gd) einen Kurzlink (die Liste geht dabei an is.gd). Ohne Internet wird der lange Link geteilt – er funktioniert genauso.

**Sprachen:** Die App erkennt die Sprachen der beiden Spalten selbst – Englisch–Deutsch (Standard), aber z. B. auch Deutsch–Ukrainisch („der Tisch - стіл“), Englisch–Ukrainisch oder Deutsch–Englisch. Kyrillisch = Ukrainisch; von zwei lateinischen Spalten ist die mit Artikeln, Umlauten und typisch deutschen Endungen die deutsche. Im Formular (neue Liste / bearbeiten) stehen die erkannten Sprachen unter „Sprachen der Spalten“ und lassen sich ändern; sie werden mit der Liste gespeichert und beim Teilen mitgeschickt. Danach richten sich alle Beschriftungen (z. B. „DEUTSCH → UKRAINISCH“), und der Modus „Artikel“ nimmt die deutsche Spalte – egal ob links oder rechts.

Format – eine Zeile pro Wort:

```
switch cabinet - Schaltschrank
colleague = workmate - Kollege / Kollegin
to record - erfassen, aufnehmen
```

- Trenner: ` - ` (mit Leerzeichen), Tab oder `;`
- Mehrere richtige englische Antworten mit `=` oder `/` trennen
- Mehrere Übersetzungen (z. B. `das Verzeichnis, der Bericht`): im Spiel erscheint jeweils eine zufällig, bei einem Fehler werden alle richtigen Antworten gezeigt
- Beim Schreiben ist Groß-/Kleinschreibung egal, `to` am Anfang ist optional

## Design

Warmer, ruhiger Stil: Ivory-Hintergrund, dunkle Hauptbuttons, Clay (`#D97757`) nur für „spannende“ Stellen (Zeitbalken, aktuelle Runde, Auswahl, „+10 s“). Hell- und Dunkelmodus folgen dem Handy.

Übergänge: Listen und Einstellungen kommen als Blatt von unten (der Startbildschirm tritt zurück), ein Spiel blendet ruhig ein und aus. Ein Blatt schließt man auch, indem man es oben (Griff oder Titelzeile, die beim Scrollen oben bleiben) nach unten zieht; Scrollen im Inhalt schließt es nie. Die Statusleiste behält immer die Seitenfarbe (sie wird mit Dialogen nicht abgedunkelt – Android färbt sie spürbar später um).

Systemleisten der installierten App: `theme_color` und `background_color` im Manifest sind dunkel (`#262624`). Chrome färbt damit die Navigationsleiste und den Fensterhintergrund (sichtbar z. B. beim Öffnen der Tastatur) – im Manifest gibt es nur eine Farbe für beide Modi. Installierte Apps übernehmen Manifest-Änderungen erst beim nächsten WebAPK-Update (bis ~1 Tag) oder nach Neuinstallation.

Spezialrunden: Wirbel in Clay, Kombo und Extrazeit in Blau (`--extra` `#2A65A8`), Zeitraffer in Violett (`--rush` `#8E5FD0`, gestreifter Zeitbalken), Zeitbombe in Graphit (`--bomb` `#3E434A`, dunkel Stahl `#BEC4CC`; der Zeitbalken wird zur Zündschnur, Timer mit Hundertsteln in der Mitte). Eine Spezialrunde ist in der Punktreihe eine Raute. Bei „Bewegung reduzieren“ gibt es statt Bewegung nur Ein- und Ausblenden.

Schriften (selbst gehostet in `fonts/`, SIL Open Font License): Source Serif 4 (Titel, Timer), Manrope (Text), JetBrains Mono (Lücken, Buchstabenvergleich). Icons: Lucide (ISC-Lizenz).

## Für Entwickler

Reines HTML/CSS/JavaScript ohne Build-Schritt.

- `js/core.js` – Logik (Parser, Antwortprüfung, Wortauswahl), ohne DOM
- `js/game.js` – Spielablauf und die 4 Minispiele
- `js/streak.js` – Tagesserie: Zähler, Kachel, Kalender
- `js/bomb.js` + `css/zeitbombe.css` – Spezialrunde Zeitbombe
- `js/intro.js` – Einführung (erster Start, Einstellungen)
- `js/artikel.js` – Modus Artikel (der, die, das)
- `js/main.js` – Bildschirme (Start, Listen, Wörter, Einstellungen)
- `js/builtin-lists.js` – Listen, die alle automatisch bekommen
- `sw.js` – Offline-Cache

Im Test lassen sich Spezialrunden mit `window.__vtMods = 'off'` abschalten oder mit `window.__vtMods = { 4: 'wirbel' }` (auch `'zeitbombe'`) erzwingen; andere Zeiten mit `window.__vtTiming = { easy: { start: 10 } }`.

**Neue Version veröffentlichen:** `VERSION` in `sw.js` und `APP_VERSION` in `js/main.js` erhöhen, sonst bekommen installierte Apps die Änderung nicht.

Tests:

```bash
node --test tests/core.test.mjs
python3 -m http.server 8765 &
node tests/e2e.cjs http://localhost:8765/
```
