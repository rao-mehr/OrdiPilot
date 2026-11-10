# Dienstplan (Klinik) → App und Apple-Kalender – einmalige Einrichtung

Gilt für OrdiPilot ab V7.3 und DienstSaldo (Kalender-Dienst). Beide Apps lesen denselben Dienstplan (PDF), erkennen deine Zeile über den Namen und tragen die Dienste in den iCloud-Kalender „Arbeit“ ein. Sie legen nichts doppelt an: Steht Datum + Titel schon im Kalender, bleibt der Eintrag unverändert und die App meldet „bereits vorhanden“.

## 1. Kalender-Dienst freischalten (Cloudflare, einmalig)

OrdiPilot ist eine reine Web-App ohne Server. In den iCloud-Kalender schreibt der Worker von DienstSaldo (`/api/plan-push`). Er verlangt ein Zugangstoken.

1. Cloudflare → Workers & Pages → Projekt von DienstSaldo → Settings → Variables and Secrets.
2. **Secret** `PLAN_PUSH_TOKEN` anlegen: eine zufällige Zeichenfolge mit mindestens 32 Zeichen (z. B. aus dem Passwort-Manager). Ohne dieses Secret antwortet der Dienst mit „nicht eingerichtet“.
3. **Variable** `PLAN_ALLOWED_ORIGINS` anlegen: die Adresse, unter der OrdiPilot läuft (steht in OrdiPilot unter Einstellungen → Dienstplan (Klinik), z. B. `https://…`). Mehrere Adressen mit Komma trennen.
4. Die Secrets `ICLOUD_USER`, `ICLOUD_APP_PASSWORD` (und optional `ICLOUD_CALENDAR_NAME`, Standard „Arbeit“) sind von DienstSaldo schon vorhanden.
5. Cloudflare Zero Trust → Access → Applications: für den Pfad `/api/plan-push` eine Ausnahme (Policy-Aktion **Bypass**) anlegen. Sonst blockiert Access die Anfragen von OrdiPilot. Der Schutz erfolgt dann über das Token. Alle anderen Pfade bleiben geschützt.

## 2. OrdiPilot einrichten

Einstellungen → **Dienstplan (Klinik)**:

- **Mein Name im Dienstplan:** Nachname wie in der Plan-Zeile (z. B. „Muster“). Wird einmal gespeichert und synchronisiert sich über Dropbox.
- **Kalender-Dienst (Adresse):** die Adresse des DienstSaldo-Projekts (`https://…pages.dev`).
- **Zugangstoken:** das Token aus Schritt 1. Es bleibt nur auf diesem Gerät (nicht in Dropbox) und muss pro Gerät einmal eingetragen werden.

## 3. Benutzung

„Dienstplan hochladen (PDF)“ → Vorschau → „Übernehmen“. Danach:

- Neu im Plan: wird in der App gespeichert und in den Kalender eingetragen (ganztägig am Dienstbeginn, feste Titel wie in DienstSaldo).
- Schon vorhanden (in der App oder im Kalender): bleibt unverändert, Hinweis in der Statuszeile.
- Nachträglich ergänzt: Plan erneut hochladen, es wird nur das Neue eingetragen.
- Im neuen Plan nicht mehr enthalten: wird in der App entfernt und im Kalender gelöscht.
- Beim Planen eines Einsatzes erscheint ein Hinweis, wenn an dem Tag Dienst, Urlaub oder „außer Dienst“ ist.

Kalender-Einträge entstehen für Dienste (HO, HT, OA, S, A1, A2, A4, LO, LT) und Urlaub. Wochenruhe, Kongress und „außer Dienst“ stehen nur in der App.
