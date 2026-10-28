/**
 * OrdiPilot – Honorarnote direkt über Gmail versenden (Web-App)
 *
 * Gehört in dasselbe Apps-Script-Projekt wie die EasyPark-Automatik und nutzt deren
 * Dropbox-Zugang (Script Properties DROPBOX_APP_KEY / DROPBOX_APP_SECRET / DROPBOX_REFRESH_TOKEN).
 *
 * Einrichtung (einmalig):
 *   1. Diese Datei im Apps-Script-Projekt als neue Datei „Honorarnote_Versand“ einfügen, speichern.
 *   2. Funktion setupHonorarnoteVersand ausführen → Zugriff erlauben → im Protokoll steht der Schlüssel.
 *   3. Bereitstellen → Neue Bereitstellung → Typ „Web-App“ → Ausführen als: Ich, Zugriff: Jeder → Bereitstellen.
 *   4. Web-App-URL und Schlüssel in OrdiPilot unter Honorar → „Versand über Gmail“ eintragen → „Verbindung testen“.
 *
 * Sicherheit:
 *   - Ohne den geheimen Schlüssel wird nichts versendet.
 *   - Es werden nur PDF-Dateien aus …/Vertretungsdienste/Honorarnoten/ verschickt.
 *   - Höchstens 10 Mails pro Tag; jede Sendung wird im Protokoll vermerkt.
 *   - Der Schlüssel steht nie im Code (öffentliches Repository), nur in den Script Properties.
 */

const HN = {
  ROOT: '/Ordination & Selbständigkeit/Vertretungsdienste/Honorarnoten/',
  MAX_PER_DAY: 10
};

function setupHonorarnoteVersand() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('ORDIPILOT_SEND_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    props.setProperty('ORDIPILOT_SEND_TOKEN', token);
  }
  // Berechtigungen einmal anfordern (Gmail senden, Dropbox-Zugang prüfen)
  GmailApp.getAliases();
  hnDropboxToken_();
  console.log('Honorarnote-Versand bereit. Schlüssel für OrdiPilot: ' + token);
  console.log('Jetzt: Bereitstellen → Neue Bereitstellung → Web-App (Ausführen als: Ich, Zugriff: Jeder).');
}

function doGet() {
  return hnJson_({ok: true, service: 'OrdiPilot Honorarnote-Versand'});
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty('ORDIPILOT_SEND_TOKEN');
    if (!token || req.token !== token) return hnJson_({ok: false, error: 'Schlüssel ungültig'});

    if (req.action === 'ping') {
      return hnJson_({ok: true, account: Session.getEffectiveUser().getEmail()});
    }
    if (req.action !== 'send') return hnJson_({ok: false, error: 'Unbekannte Aktion'});

    const path = String(req.path || '');
    if (path.indexOf(HN.ROOT) !== 0 || !/\.pdf$/i.test(path) || path.indexOf('..') >= 0) {
      return hnJson_({ok: false, error: 'Nur Honorarnoten aus dem Dropbox-Ordner Honorarnoten sind erlaubt'});
    }
    const to = String(req.to || '').trim();
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) return hnJson_({ok: false, error: 'Empfänger-Adresse ungültig'});

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const dayKey = 'ORDIPILOT_SENT_' + Utilities.formatDate(new Date(), 'Europe/Vienna', 'yyyyMMdd');
      const sentToday = Number(props.getProperty(dayKey) || 0);
      if (sentToday >= HN.MAX_PER_DAY) return hnJson_({ok: false, error: 'Tageslimit erreicht'});

      const pdf = dropboxDownloadBlob_(path).setName(String(req.fileName || path.split('/').pop()));
      const subject = String(req.subject || 'Honorarnote').slice(0, 200);
      const body = String(req.body || '').slice(0, 5000);
      const options = {attachments: [pdf]};
      if (req.senderName) options.name = String(req.senderName).slice(0, 100);
      GmailApp.sendEmail(to, subject, body, options);

      props.setProperty(dayKey, String(sentToday + 1));
      console.log('Honorarnote gesendet: ' + path + ' an ' + to);
      return hnJson_({ok: true, sentAt: new Date().toISOString(), to: to, account: Session.getEffectiveUser().getEmail()});
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error(err);
    return hnJson_({ok: false, error: String(err && err.message || err)});
  }
}

function dropboxDownloadBlob_(path) {
  const r = UrlFetchApp.fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + hnDropboxToken_(),
      // Dropbox verlangt reines ASCII im Header – Umlaute maskieren
      'Dropbox-API-Arg': JSON.stringify({path: path}).replace(/[\u007f-￿]/g, c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4))
    },
    muteHttpExceptions: true
  });
  if (r.getResponseCode() === 409) throw new Error('Datei in Dropbox nicht gefunden: ' + path);
  if (r.getResponseCode() >= 300) throw new Error(r.getContentText());
  return r.getBlob().setContentType('application/pdf');
}

// Eigener Token-Abruf (gleiche Script Properties wie die EasyPark-Automatik, unabhängig von deren Version)
function hnDropboxToken_() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('DROPBOX_APP_KEY');
  const secret = props.getProperty('DROPBOX_APP_SECRET');
  const refresh = props.getProperty('DROPBOX_REFRESH_TOKEN');
  if (!key || !secret || !refresh) throw new Error('Dropbox-Zugang fehlt (Script Properties DROPBOX_APP_KEY / DROPBOX_APP_SECRET / DROPBOX_REFRESH_TOKEN).');
  const r = UrlFetchApp.fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'post',
    payload: {grant_type: 'refresh_token', refresh_token: refresh, client_id: key, client_secret: secret},
    muteHttpExceptions: true
  });
  if (r.getResponseCode() >= 300) throw new Error(r.getContentText());
  return JSON.parse(r.getContentText()).access_token;
}

function hnJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
