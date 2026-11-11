# OrdiPilot

Persönliche Web-App (PWA) für ärztliche Vertretungsdienste: Einsätze, Parkbelege, Fahrten, Honorarnoten, Steuer-Übersicht. Daten liegen ausschließlich in der eigenen Dropbox – dieses Repository enthält **keine** persönlichen Daten, Schlüssel oder Tokens.

## Aufbau

| Datei | Zweck |
|---|---|
| `index.html` | Seitengerüst; bindet `css/` und `js/` in fester Reihenfolge ein |
| `js/` | App-Code, ein Modul pro Bereich |
| `css/` | Gestaltung |
| `service-worker.js`, `manifest.webmanifest`, `icons/` | Offline-Betrieb und Installation am Home-Bildschirm |
| `apps-script/` | Code im Google-Apps-Script-Projekt „Vertretungsabrechnung EasyPark“: `Honorarnote_Versand.gs` (Versand über Gmail, Einrichtung: `SETUP_Gmail_Versand.md`), `EasyPark.gs` (laufender Stand des EasyPark-Imports), `OrdiPilot_Automatik.gs` (KI-Belege nach Dropbox, Mail-Erinnerungen), `appsscript.json`. Geheimnisse liegen nur in den Script-Eigenschaften bei Google. |
| `vendor/` | pdf.js (Mozilla, Apache-2.0), nur lokal im Browser zum Lesen des Dienstplan-PDFs |
| `SETUP_*` | Einrichtungsanleitungen |
| `tests/` | Unit-Tests (`node --test tests/*.test.mjs`), Browser-Tests (`python tests/browser_smoke.py`) und Charakterisierung (`python tests/characterize.py`) |
| `archiv/` | Ältere Versionen, nicht mehr in Verwendung |

## Aufbau des Codes

- `js/boot.js` wird zuerst geladen, `js/main.js` zuletzt. Module **definieren** beim Laden nur Funktionen; was beim Start passieren soll, melden sie mit `OrdiPilotBoot.add(name, fn)` an. `main.js` führt das in Ladereihenfolge aus – so läuft immer die endgültige Fassung jeder Funktion.
- Eine bestehende globale Funktion wird **nur** über `OrdiPilotExt.extend('name', base => function () { … base.apply(this, arguments) … })` erweitert. Direktes Überschreiben (`name = function …`) verbietet der Release-Test. `OrdiPilotExt.list()` zeigt alle Erweiterungen in Reihenfolge.
- Die Dateinamen `v6xx-…` geben an, mit welcher Version ein Bereich dazukam (z. B. `v614-tax.js` = Steuer & Belege, `v616-auto.js` = Standort/Zahlungsnachweise, `v617-send.js` = Senden).

## Prüfungen

```
npm install                     # einmalig, nur Prüfwerkzeuge
npm run check                   # Formatierung, statische Prüfung, Unit- und Release-Tests
python3 tests/browser_smoke.py  # ganze App im Browser mit simulierter Dropbox
python3 tests/characterize.py   # Verhalten unverändert?
```

## Regeln

- Änderungen nur über Pull Requests; der Test-Workflow muss grün sein.
- Bei jeder Version gemeinsam anheben: alle `?v=` in `index.html`, `start_url` in `manifest.webmanifest`, `'Version x'` und `const VERSION`, im `service-worker.js` den Cache-Namen und `V`. Neue Dateien in `js/`/`css/` auch in `FILES` im Service Worker eintragen (der Release-Test prüft das). Die `id` im Manifest bleibt immer gleich.
- Die Charakterisierung muss unverändert bleiben. Ist eine Verhaltensänderung gewollt: `UPDATE_SNAPSHOT=1 python3 tests/characterize.py` und den Unterschied im PR erklären.
- Geheimnisse (Dropbox-Zugang, Versand-Schlüssel) gehören nur in die Script-Eigenschaften bei Google bzw. in die App-Einstellungen – nie ins Repository.

## Kalender (ab 7.4.0)

Im Kalender (Übersicht → „Nächster Einsatz“) zeigt jeder Tag das Kürzel des Klinikdienstes (dunkelblau = 25-Stunden-Dienst, bernstein = Langer Dienst, grün = Urlaub, violett umrandet = Vertretung). Antippen eines Tages zeigt den Dienst mit Status; „Ändern“, „Entfernen“ und „+ Klinikdienst eintragen“ speichern in der App und schreiben dieselbe Änderung über den gemeinsamen Kalender-Dienst in den Apple-Kalender (hinzufügen, ersetzen, löschen). Nicht erreichbar → die Änderung wartet und wird automatisch nachgereicht. Von Hand Geändertes bleibt beim erneuten Hochladen des Dienstplans erhalten. DienstSaldo liest den Apple-Kalender.
