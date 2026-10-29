VERTRETUNGSABRECHNUNG – VERSION 6.1
===================================

Update auf V6.1 – Einsatzplanung + Tagesbestätigung + Honorarnoten-Workflow.

Neu:
- Monatskalender unter „Einsätze“ für zukünftige Termine.
- Geplante Beginn-/Endzeit wird getrennt von der tatsächlichen Arbeitszeit gespeichert.
- Hauptseite zeigt automatisch „HEUTIGER EINSATZ“, „MORGEN“, „IN X TAGEN“ bzw. „BESTÄTIGUNG OFFEN“.
- Am Einsatztag: tatsächliche Beginn-/Endzeit, Pause, optional Stundenkorrektur bestätigen.
- Datumsfeld im Einsatzdialog optisch zentriert; native iPhone-Datumsauswahl bleibt antippbar.
- Dokumentbereich vereinfacht: Honorarnote erstellen → für ID Austria bereitstellen → signierte PDF übernehmen → Dropbox → E-Mail.
- Signierte Honorarnote wird nach Übernahme automatisch in Dropbox archiviert, wenn Dropbox verbunden ist.
- Bei fehlgeschlagenem Upload gibt es „In Dropbox archivieren“ zum Wiederholen.
- Empfänger-E-Mail, Dropbox-Zielordner und Apple-Kurzbefehl für den Versand sind in „Mehr“ konfigurierbar.
- Status der Honorarnote wird mit den normalen App-Daten über Dropbox synchronisiert; PDF-Dateien selbst liegen lokal bzw. signiert in Dropbox.

WICHTIG ZU ID AUSTRIA:
Die persönliche Freigabe einer qualifizierten Signatur bleibt bewusst bei dir. Diese Version stellt die PDF für die Signatur bereit und übernimmt anschließend die signierte PDF. Eine direkte vollautomatische A-Trust/ID-Austria-API-Anbindung benötigt einen kommerziellen A-Trust-Zugang samt Zugangsdaten und kann später an genau diesen Workflow angeschlossen werden.

UPDATE:
index.html und service-worker.js auf GitHub ersetzen. Danach die PWA auf dem iPhone einmal vollständig schließen und neu öffnen. Bei hartnäckigem Cache Safari/Web-App neu laden; der Cache-Name wurde auf vertretung-v6-1 erhöht.
