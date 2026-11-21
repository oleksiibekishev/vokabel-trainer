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
- „Mittel“ wird nach „Leicht“ freigeschaltet, „Schwer“ nach „Mittel“, „Endlos“ nach „Schwer“ – pro Wortliste.
- Wörter mit Fehlern kommen öfter dran.

### Spezialrunden (zufällig ab Runde 4)

Jede Runde ab Runde 4 wird mit 25 % zur Spezialrunde, nie zwei hintereinander. Höchstens 1 (Leicht), 2 (Mittel) bzw. 3 (Schwer) pro Spiel – oft auch gar keine.

| Spezialrunde | Spiele | Was passiert |
|---|---|---|
| Wirbel | Paare | Nach 3 richtigen Paaren verschwinden sie, an ihrer Stelle kommen 3 neue (9 statt 6 Paare, keine Extrazeit). |
| Kombo | Paare, Auswahl | Schnelle Antworten hintereinander: ×2 = +5 s, ×3 = +10 s, ×4 = +15 s, ×5 = +20 s. Diese Sekunden sind **Extrazeit** über dem Limit; sie wird erst benutzt, wenn die normale Zeit abgelaufen ist. Schnell = höchstens 3,5 s (Leicht), 3 s (Mittel), 2,5 s (Schwer) nach der letzten Antwort. |
| Zeitraffer | alle (ab Mittel) | Die Zeit läuft 1,5× so schnell. |

### Weitere Modi

- **Endlos** (nach „Schwer“): Runden ohne Ende mit allen Spielen, Start 30 s, **kein Limit**. Bonus: +10 s bis Runde 10, +8 s bis 20, +6 s bis 30, danach +5 s. Spezialrunden werden häufiger (25 % → 50 %), Zeitraffer ab Runde 21 2×. Ein Fehler beendet das Spiel, Rekord = geschaffte Runden.
- **Fehlertraining**: nur Wörter mit Fehlern, ohne Zeit. Jedes Wort muss 3× richtig sein (Auswahl → Lücken → Schreiben), dann steht sein Fehlerzähler wieder auf 0. Ein Fehler schickt das Wort zurück an den Anfang.

## Eigene Wortlisten

In der App: **Listen & Wörter → Liste hinzufügen** → Namen eingeben (Pflicht), Text einfügen oder Datei (.txt/.csv) wählen.
Mit **Teilen** entsteht ein Link, den man z. B. per WhatsApp an die Klasse schickt.

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

Schriften (selbst gehostet in `fonts/`, SIL Open Font License): Source Serif 4 (Titel, Timer), Manrope (Text), JetBrains Mono (Lücken, Buchstabenvergleich). Icons: Lucide (ISC-Lizenz).

## Für Entwickler

Reines HTML/CSS/JavaScript ohne Build-Schritt.

- `js/core.js` – Logik (Parser, Antwortprüfung, Wortauswahl), ohne DOM
- `js/game.js` – Spielablauf und die 4 Minispiele
- `js/main.js` – Bildschirme (Start, Listen, Wörter, Einstellungen)
- `js/builtin-lists.js` – Listen, die alle automatisch bekommen
- `sw.js` – Offline-Cache

Im Test lassen sich Spezialrunden mit `window.__vtMods = 'off'` abschalten oder mit `window.__vtMods = { 4: 'wirbel' }` erzwingen.

**Neue Version veröffentlichen:** `VERSION` in `sw.js` und `APP_VERSION` in `js/main.js` erhöhen, sonst bekommen installierte Apps die Änderung nicht.

Tests:

```bash
node --test tests/core.test.mjs
python3 -m http.server 8765 &
node tests/e2e.cjs http://localhost:8765/
```
