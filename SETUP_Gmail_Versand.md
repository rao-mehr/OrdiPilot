# Honorarnote direkt über Gmail senden – Einrichtung (einmalig, ca. 5 Minuten, am Computer)

1. **script.google.com** öffnen → das Projekt mit der **EasyPark-Automatik** öffnen.
2. Links bei „Dateien“ auf **+ → Skript** → Name: `Honorarnote_Versand`.
3. Den gesamten Inhalt von [`Honorarnote_Versand.gs`](Honorarnote_Versand.gs) hineinkopieren (vorhandenen Beispieltext ersetzen) → **Speichern**.
4. Oben in der Funktionsauswahl **`setupHonorarnoteVersand`** wählen → **Ausführen** → Zugriff erlauben
   (Google fragt einmal nach „E-Mails in deinem Namen senden“ – das ist genau diese Funktion).
5. Im **Ausführungsprotokoll** steht: `Schlüssel für OrdiPilot: …` → diesen Schlüssel kopieren.
6. **Bereitstellen → Neue Bereitstellung** → Zahnrad → **Web-App**
   - Beschreibung: `OrdiPilot Versand`
   - Ausführen als: **Ich**
   - Zugriff: **Jeder**
   → **Bereitstellen** → die **Web-App-URL** (endet auf `/exec`) kopieren.
7. In OrdiPilot: **Honorar → „Versand über Gmail“** aufklappen → URL und Schlüssel eintragen → **Verbindung testen**
   → es muss „✓ Verbunden mit …@gmail.com“ erscheinen.

Ab dann: **„Honorarnote erstellen & senden“** → kurze Rückfrage (Empfänger, Betreff, Anhang) → **OK** → die Mail geht aus deinem Gmail raus
und liegt dort unter „Gesendet“. Die App markiert den Monat erst nach der Bestätigung von Gmail als versendet.

**Sicherheit:** Ohne den Schlüssel sendet die Web-App nichts. Sie verschickt nur PDFs aus dem Dropbox-Ordner `Honorarnoten`,
an genau eine gültige Adresse, höchstens 10 Mails pro Tag. Der Schlüssel steht nicht im Code.

**Wenn sich der Code später ändert:** Bereitstellen → Bereitstellungen verwalten → Bearbeiten → Version „Neue Version“ → Bereitstellen
(die URL bleibt gleich).
