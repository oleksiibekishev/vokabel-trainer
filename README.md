# Vokabeltrainer Englisch ↔ Deutsch

Lernspiel für Vokabellisten, läuft als App im Browser (PWA) – auch offline, ohne Konto, ohne Server.

**App öffnen:** https://oleksiibekishev.github.io/vokabel-trainer/

Auf dem Handy installieren:
- **Android (Chrome):** Menü ⋮ → „App installieren“ / „Zum Startbildschirm hinzufügen“
- **iPhone (Safari):** Teilen-Symbol → „Zum Home-Bildschirm“

## Spielregeln

| Level | Runden | Startzeit | Bonus pro Runde | Spiele |
|---|---|---|---|---|
| Leicht | 6 | 60 s | +10 s | Paare (Englisch links, Deutsch rechts) |
| Mittel | 10 | 40 s | +10 s | Paare (gemischt), Auswahl, Lücken, Schreiben |
| Schwer | 15 | 30 s | +10 s | wie Mittel, mehr Schreiben und mehr Lücken |

- Ein Timer für das ganze Level, jede geschaffte Runde gibt Bonuszeit.
- Ein Fehler → zurück zu Runde 1 (mit Animation, was falsch war).
- Runde 1–3 haben immer dieselben Wörter, ab Runde 4 zufällig.
- „Mittel“ wird nach „Leicht“ freigeschaltet, „Schwer“ nach „Mittel“ – pro Wortliste.
- Wörter mit Fehlern kommen öfter dran.

## Eigene Wortlisten

In der App: **Listen → Neue Liste hinzufügen** → Datei (.txt/.csv) wählen oder Text einfügen.
Mit **Teilen** entsteht ein Link, den man z. B. per WhatsApp an die Klasse schickt.

Format – eine Zeile pro Wort:

```
switch cabinet - Schaltschrank
colleague = workmate - Kollege / Kollegin
to record - erfassen, aufnehmen
```

- Trenner: ` - ` (mit Leerzeichen), Tab oder `;`
- Mehrere richtige englische Antworten mit `=` oder `/` trennen
- Beim Schreiben ist Groß-/Kleinschreibung egal, `to` am Anfang ist optional

## Für Entwickler

Reines HTML/CSS/JavaScript ohne Build-Schritt.

- `js/core.js` – Logik (Parser, Antwortprüfung, Wortauswahl), ohne DOM
- `js/game.js` – Spielablauf und die 4 Minispiele
- `js/main.js` – Bildschirme (Start, Listen, Wörter, Einstellungen)
- `js/builtin-lists.js` – Listen, die alle automatisch bekommen
- `sw.js` – Offline-Cache

**Neue Version veröffentlichen:** `VERSION` in `sw.js` und `APP_VERSION` in `js/main.js` erhöhen, sonst bekommen installierte Apps die Änderung nicht.

Tests:

```bash
node --test tests/core.test.mjs
python3 -m http.server 8765 &
node tests/e2e.cjs http://localhost:8765/
```
