function myFunction() {
  
}
/**
 * Vertretungsabrechnung V4.5 – EasyPark -> Gmail -> Full Dropbox
 *
 * Liest EasyPark-Parkbestätigungen aus Gmail, extrahiert Parkdaten,
 * lädt den offiziellen EasyPark-PDF-Link und archiviert das PDF unter
 * /Parkscheine/JJJJ/MM/Belege/ im privaten Dropbox-App-Ordner.
 * Zusätzlich wird /Import/easypark.json für die Vertretungs-PWA gepflegt.
 *
 * Script Properties:
 *   DROPBOX_APP_KEY
 *   DROPBOX_APP_SECRET
 *   DROPBOX_REFRESH_TOKEN   (wird nach Erstautorisierung automatisch gesetzt)
 *   DROPBOX_PARK_ROOT       optional; Standard: /Ordination & Selbständigkeit/Vertretungsdienste/Parkbelege
 *   DROPBOX_IMPORT_PATH     optional; Standard: /Ordination & Selbständigkeit/Vertretungsdienste/System/Import/easypark.json
 */

const EP = {
  SENDER: 'no-reply@easypark.net',
  SUBJECT: 'EasyPark - Parkbestätigung',
  RECENT_QUERY: 'from:no-reply@easypark.net subject:"EasyPark - Parkbestätigung" newer_than:21d',
  BACKFILL_QUERY: 'from:no-reply@easypark.net subject:"EasyPark - Parkbestätigung" after:2026/01/01'
};

function setupEasyParkAutomation() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processEasyParkRecent')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('processEasyParkRecent')
    .timeBased()
    .everyMinutes(15)
    .create();

  console.log('EasyPark-Automatik aktiviert: alle 15 Minuten.');
}

function processEasyParkRecent() {
  processEasyParkQuery_(EP.RECENT_QUERY);
}

function backfillEasyPark2026() {
  processEasyParkQuery_(EP.BACKFILL_QUERY);
}

function testLatestEasyPark() {
  const threads = GmailApp.search(EP.RECENT_QUERY, 0, 1);
  if (!threads.length) throw new Error('Keine passende EasyPark-Mail gefunden.');
  const msgs = threads[0].getMessages().filter(m => /Parkbestätigung/i.test(m.getSubject() || ''));
  if (!msgs.length) throw new Error('Keine EasyPark-Parkbestätigung im gefundenen Thread.');
  const msg = msgs[msgs.length - 1];
  const rec = parseParkingConfirmation_(msg, msg.getPlainBody() || '', msg.getBody() || '');
  if (!rec) throw new Error('EasyPark-Mail konnte nicht gelesen werden.');
  console.log(JSON.stringify(rec, null, 2));
  return rec;
}

function processEasyParkQueryUnlocked_(query) {
  const index = loadIndex_();
  const known = new Set((index.records || []).map(r => String(r.messageId)));
  let changed = false;

  const threads = GmailApp.search(query, 0, 500);
  threads.forEach(thread => {
    thread.getMessages().forEach(msg => {
      const id = String(msg.getId());
      if (known.has(id)) return;
      if (!String(msg.getFrom() || '').toLowerCase().includes(EP.SENDER)) return;
      if (!/Parkbestätigung/i.test(msg.getSubject() || '')) return;

      const rec = parseParkingConfirmation_(msg, msg.getPlainBody() || '', msg.getBody() || '');
      if (!rec) return;

      if (rec.officialUrl) {
        try {
          const response = UrlFetchApp.fetch(rec.officialUrl, {
            followRedirects: true,
            muteHttpExceptions: true
          });
          if (response.getResponseCode() >= 300) {
            throw new Error('EasyPark PDF HTTP ' + response.getResponseCode());
          }
          const blob = response.getBlob().setName(rec.receiptName);
          dropboxUpload_(rec.dropboxReceiptPath, blob.getBytes(), 'application/pdf');
          rec.pdfArchived = true;
        } catch (err) {
          rec.pdfArchived = false;
          rec.downloadError = String(err);
          rec.dropboxReceiptPath = '';
        }
      }

      index.records.push(rec);
      known.add(id);
      changed = true;
    });
  });

  if (changed) {
    index.updatedAt = new Date().toISOString();
    index.records.sort((a, b) =>
      (a.date + (a.start || '')).localeCompare(b.date + (b.start || ''))
    );
    saveIndex_(index);
  }

  console.log(`EasyPark: ${changed ? 'Import aktualisiert' : 'keine neuen Parkvorgänge'}.`);
}

function parseParkingConfirmation_(msg, plain, html) {
  const started = String(plain).match(/Gestartet:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/i);
  const stopped = String(plain).match(/Gestoppt:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/i);
  const amount = parseNumber_(match1_(plain, /Kosten:\s*([0-9.,]+)\s*EUR/i));

  if (!started || !stopped || !Number.isFinite(amount)) return null;

  const date = started[1];
  const start = started[2];
  const end = stopped[2];
  const vat = parseNumber_(match1_(plain, /VAT:\s*([0-9.,]+)\s*EUR/i));
  const city = (match1_(plain, /Stadt\/Parkplatz:\s*([^\r\n]+)/i) || '').trim();
  const zone = (match1_(plain, /Zone:\s*([^\r\n]+)/i) || '').trim();
  const zoneCode = (match1_(plain, /Zonencode:\s*([^\r\n]+)/i) || '').trim();
  const car = (match1_(plain, /Auto:\s*([^\r\n]+)/i) || '').trim();
  const url = extractPdfUrl_(plain, html);

  const [year, month] = date.split('-');
  const filename = `EasyPark_${date}_${start.replace(':','')}-${end.replace(':','')}_${amount.toFixed(2).replace('.', '-') }EUR.pdf`;

  return {
    messageId: String(msg.getId()),
    provider: 'EasyPark',
    source: 'EasyPark/Gmail',
    documentType: 'confirmation',
    date,
    start,
    end,
    amount,
    vat: Number.isFinite(vat) ? vat : 0,
    city,
    zone,
    zoneCode,
    car,
    officialUrl: url,
    receiptName: filename,
    dropboxReceiptPath: `${parkRoot_()}/${year}/${month}/${filename}`,
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function extractPdfUrl_(plain, html) {
  const combined = String(html || '') + '\n' + String(plain || '');
  const direct = combined.match(/https?:\/\/epic\.easyparksystem\.net\/rest\/resources\/parkingconfirmation\/[A-Za-z0-9_\-\/]+/i);
  if (direct) return htmlDecode_(direct[0]);

  const href = combined.match(/href=["'](https?:\/\/[^"']+)["'][^>]*>\s*(?:PDF|Beleg|Quittung|Receipt|Download)/i);
  return href ? htmlDecode_(href[1]) : '';
}

function loadIndex_() {
  const obj = JSON.parse(dropboxDownloadText_(indexPath_()));
  if (!obj || !Array.isArray(obj.records)) {
    throw new Error('EasyPark-Index ist ungültig. Import abgebrochen; bestehende Daten bleiben erhalten.');
  }
  obj.version = obj.version || 1;
  return obj;
}

function saveIndex_(obj) {
  const blob = Utilities.newBlob(JSON.stringify(obj, null, 2), 'application/json');
  dropboxUpload_(indexPath_(), blob.getBytes(), 'application/json');
}

function normalizeDropboxPath_(raw) {
  return ('/' + String(raw || '')).replace(/\/+/g, '/').replace(/\/$/, '');
}

function parkRoot_() {
  const raw = PropertiesService.getScriptProperties().getProperty('DROPBOX_PARK_ROOT');
  return normalizeDropboxPath_(raw || '/Ordination & Selbständigkeit/Vertretungsdienste/Parkbelege');
}

function indexPath_() {
  const raw = PropertiesService.getScriptProperties().getProperty('DROPBOX_IMPORT_PATH');
  return normalizeDropboxPath_(raw || '/Ordination & Selbständigkeit/Vertretungsdienste/System/Import/easypark.json');
}

function dropboxDownloadText_(path) {
  const r = UrlFetchApp.fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + dropboxAccessToken_(),
      'Dropbox-API-Arg': JSON.stringify({ path })
    },
    muteHttpExceptions: true
  });

  if (r.getResponseCode() === 409) throw new Error('Datei existiert noch nicht: ' + path);
  if (r.getResponseCode() >= 300) throw new Error(r.getContentText());
  return r.getContentText();
}

function dropboxUpload_(path, bytes, contentType) {
  ensureDropboxFolders_(path);
  // Dropbox /files/upload requires the HTTP Content-Type to be
  // application/octet-stream (the file's actual MIME type is irrelevant here).
  const r = UrlFetchApp.fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'post',
    contentType: 'application/octet-stream',
    payload: bytes,
    headers: {
      Authorization: 'Bearer ' + dropboxAccessToken_(),
      'Dropbox-API-Arg': JSON.stringify({
        path,
        mode: 'overwrite',
        autorename: false,
        mute: true
      })
    },
    muteHttpExceptions: true
  });

  if (r.getResponseCode() >= 300) throw new Error(r.getContentText());
  return JSON.parse(r.getContentText());
}

function ensureDropboxFolders_(filePath) {
  const parts = String(filePath).split('/').filter(Boolean).slice(0, -1);
  let current = '';

  parts.forEach(part => {
    current += '/' + part;
    const r = UrlFetchApp.fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ path: current, autorename: false }),
      headers: { Authorization: 'Bearer ' + dropboxAccessToken_() },
      muteHttpExceptions: true
    });

    if (r.getResponseCode() >= 300 && !/conflict/i.test(r.getContentText())) {
      throw new Error(r.getContentText());
    }
  });
}

function dropboxAccessToken_() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('DROPBOX_APP_KEY');
  const secret = props.getProperty('DROPBOX_APP_SECRET');
  const refresh = props.getProperty('DROPBOX_REFRESH_TOKEN');

  if (!key || !secret || !refresh) {
    throw new Error('Dropbox OAuth fehlt. APP_KEY, APP_SECRET und REFRESH_TOKEN prüfen.');
  }

  const r = UrlFetchApp.fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'post',
    payload: {
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: key,
      client_secret: secret
    },
    muteHttpExceptions: true
  });

  if (r.getResponseCode() >= 300) throw new Error(r.getContentText());
  return JSON.parse(r.getContentText()).access_token;
}

function getDropboxAuthorizationUrl() {
  const key = PropertiesService.getScriptProperties().getProperty('DROPBOX_APP_KEY');
  if (!key) throw new Error('DROPBOX_APP_KEY fehlt.');

  const url = 'https://www.dropbox.com/oauth2/authorize?client_id=' + encodeURIComponent(key)
    + '&response_type=code&token_access_type=offline';

  console.log(url);
  return url;
}

function exchangeDropboxAuthorizationCode() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('DROPBOX_APP_KEY');
  const secret = props.getProperty('DROPBOX_APP_SECRET');
  const code = props.getProperty('DROPBOX_AUTH_CODE');

  if (!key || !secret || !code) {
    throw new Error('DROPBOX_APP_KEY, DROPBOX_APP_SECRET oder DROPBOX_AUTH_CODE fehlt.');
  }

  const r = UrlFetchApp.fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'post',
    payload: {
      code,
      grant_type: 'authorization_code',
      client_id: key,
      client_secret: secret
    },
    muteHttpExceptions: true
  });

  if (r.getResponseCode() >= 300) throw new Error(r.getContentText());

  const data = JSON.parse(r.getContentText());
  if (!data.refresh_token) throw new Error('Kein Refresh Token erhalten.');

  props.setProperty('DROPBOX_REFRESH_TOKEN', data.refresh_token);
  props.deleteProperty('DROPBOX_AUTH_CODE');
  console.log('Dropbox-Hintergrundzugriff erfolgreich eingerichtet.');
}

function match1_(s, re) {
  const m = String(s || '').match(re);
  return m ? m[1] : '';
}

function parseNumber_(s) {
  if (s == null || s === '') return NaN;
  return Number(String(s).replace(',', '.'));
}

function htmlDecode_(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/');
}
function migrateEasyParkPathsToFullDropbox() {
  const index = loadIndex_();
  let changed = 0;

  (index.records || []).forEach(rec => {
    if (!rec.date || !rec.receiptName) return;

    const parts = String(rec.date).split('-');
    const year = parts[0];
    const month = parts[1];

    const newPath =
      `${parkRoot_()}/${year}/${month}/${rec.receiptName}`;

    if (rec.dropboxReceiptPath !== newPath) {
      rec.dropboxReceiptPath = newPath;
      rec.updatedAt = new Date().toISOString();
      changed++;
    }
  });

  index.updatedAt = new Date().toISOString();
  saveIndex_(index);

  console.log('EasyPark-Pfade migriert: ' + changed);
}
// Migration 2026-10-13: protects the index against concurrent imports.
function processEasyParkQuery_(query) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return processEasyParkQueryUnlocked_(query);
  } finally {
    lock.releaseLock();
  }
}

function activateEasyParkAfterMigration() {
  const root = '/Ordination & Selbständigkeit/Vertretungsdienste';
  const target = root + '/System/Import/easypark.json';
  const props = PropertiesService.getScriptProperties();
  const index = JSON.parse(dropboxDownloadText_(target));
  if (!Array.isArray(index.records) || index.records.length < 14) {
    throw new Error('Migrierter Index fehlt oder ist unvollständig. Automatik bleibt pausiert.');
  }
  props.setProperty('DROPBOX_PARK_ROOT', root + '/Parkbelege');
  props.setProperty('DROPBOX_IMPORT_PATH', target);
  // Trigger is only restored after the first import succeeds.
  processEasyParkRecent();
  setupEasyParkAutomation();
  console.log('Migration aktiv: neuer Dropbox-Pfad, erster Import erfolgreich, 15-Minuten-Trigger eingerichtet.');
}
