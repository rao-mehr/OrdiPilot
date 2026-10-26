# Tests

| Befehl | Prüft |
|---|---|
| `node --test tests/*.test.mjs` | Sync-Kern (kein Upload bei Lesefehler, Revisionsprüfung, Konflikte, Wächter, Einstellungen), Release-Struktur, keine persönlichen Daten |
| `python3 tests/browser_smoke.py` | Komplette App in Chromium mit simulierter Dropbox: neues Gerät, Lesefehler, fehlende Datei, Update vom alten Service Worker |

Mit echten Daten testen (Dateien bleiben lokal, nie committen):
`REAL_DATA=/pfad/daten.json REAL_BACKUP=/pfad/backup.json python3 tests/browser_smoke.py`
