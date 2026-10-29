/**
 * OrdiPilot – EasyPark Gmail -> Dropbox V2
 *
 * Zielstruktur:
 *   Index:      /Ordination & Selbständigkeit/Vertretungsdienste/System/Import/easypark.json
 *   Parkbelege: /Ordination & Selbständigkeit/Vertretungsdienste/Parkbelege/JJJJ/MM/
 *               ODER /Ordination & Selbständigkeit/Vertretungsdienste/Parkbelege/JJJJ/MM/EasyPark/
 *
 * WICHTIG:
 * - Existiert im Monatsordner bereits ein Unterordner "EasyPark", wird er verwendet.
 * - Existiert er nicht, werden neue EasyPark-PDFs direkt im Monatsordner gespeichert.
 * - Vorhandene PDFs werden in BEIDEN Varianten erkannt, damit keine Dubletten entstehen.
 * - Alte Pfade wie /Ordination & Selbständigkeit/Vertretungsdienste/03 Parkbelege/... werden automatisch normalisiert.
 *
 * Script Properties (wie bisher):
 *   DROPBOX_APP_KEY
 *   DROPBOX_APP_SECRET
 *   DROPBOX_REFRESH_TOKEN
 */

const EP = {
  BASE: '/Ordination & Selbständigkeit/Vertretungsdienste',
  INDEX: '/Ordination & Selbständigkeit/Vertretungsdienste/System/Import/easypark.json',
  PARKING_ROOT: '/Ordination & Selbständigkeit/Vertretungsdienste/Parkbelege',
  SENDER: 'no-reply@easypark.net',
  RECENT_QUERY: 'from:no-reply@easypark.net newer_than:35d',
  BACKFILL_QUERY: 'from:no-reply@easypark.net after:2026/01/01'
};

function setupEasyParkAutomation() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.filter(t => t.getHandlerFunction() === 'processEasyParkRecent')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processEasyParkRecent').timeBased().everyMinutes(15).create();
  console.log('EasyPark Trigger installiert: alle 15 Minuten.');
}

function processEasyParkRecent() {
  processEasyParkQuery_(EP.RECENT_QUERY);
}

function backfillEasyPark2026() {
  processEasyParkQuery_(EP.BACKFILL_QUERY);
}

function backfillEasyParkOctober2026() {
  processEasyParkQuery_('from:no-reply@easypark.net after:2026/10/01 before:2026/11/01');
}

function processEasyParkQuery_(query) {
  const index = loadIndex_();
  let changed = repairIndexPaths_(index);

  const knownMessages = new Set([
    ...(index.records || []).map(r => String(r.messageId)),
    ...(index.documents || []).map(r => String(r.messageId))
  ]);

  const threads = GmailApp.search(query, 0, 500);
  threads.forEach(thread => {
    thread.getMessages().forEach(msg => {
      const id = String(msg.getId());
      if (knownMessages.has(id)) return;
      const from = (msg.getFrom() || '').toLowerCase();
      if (!from.includes(EP.SENDER)) return;

      const subject = msg.getSubject() || '';
      const plain = msg.getPlainBody() || '';
      const html = msg.getBody() || '';

      if (isParkingConfirmation_(subject, plain)) {
        const rec = parseParkingConfirmation_(msg, plain, html);
        if (!rec) return;
        if (rec.officialUrl) {
          try {
            rec.dropboxReceiptPath = archiveEasyParkPdf_(rec.officialUrl, rec.date, rec.receiptName);
            rec.pdfArchived = true;
          } catch (err) {
            rec.downloadError = String(err);
            rec.dropboxReceiptPath = '';
            rec.pdfArchived = false;
          }
        }
        index.records.push(rec);
        knownMessages.add(id);
        changed = true;
        return;
      }

      if (isReceiptMail_(subject, plain)) {
        const doc = parseReceiptMail_(msg, plain, html);
        if (!doc) return;
        if (doc.officialUrl) {
          try {
            doc.dropboxReceiptPath = archiveEasyParkPdf_(doc.officialUrl, doc.date, doc.receiptName);
            doc.pdfArchived = true;
          } catch (err) {
            doc.downloadError = String(err);
            doc.dropboxReceiptPath = '';
            doc.pdfArchived = false;
          }
        }
        index.documents.push(doc);
        knownMessages.add(id);
        changed = true;
      }
    });
  });

  if (changed) {
    index.version = 2;
    index.updatedAt = new Date().toISOString();
    index.records.sort((a,b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
    index.documents.sort((a,b) => (a.date || '').localeCompare(b.date || ''));
    saveIndex_(index);
  }
}

function isParkingConfirmation_(subject, body) {
  return /Parkbestätigung/i.test(subject + '\n' + body)
    && /Gestartet:/i.test(body)
    && /Gestoppt:/i.test(body);
}

function isReceiptMail_(subject, body) {
  return /(Quittung|Receipt|Rechnung|Beleg)/i.test(subject + '\n' + body)
    && /easypark/i.test(subject + '\n' + body);
}

function parseParkingConfirmation_(msg, plain, html) {
  const started = match_(plain, /Gestartet:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/i);
  const stopped = match_(plain, /Gestoppt:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/i);
  const amount = number_(match1_(plain, /Kosten:\s*([0-9.,]+)\s*EUR/i));
  if (!started || !stopped || !Number.isFinite(amount)) return null;

  const date = started[1];
  const start = started[2];
  const end = stopped[2];
  const vat = number_(match1_(plain, /VAT:\s*([0-9.,]+)\s*EUR/i)) || 0;
  const city = (match1_(plain, /Stadt\/Parkplatz:\s*([^\r\n]+)/i) || '').trim();
  const zone = (match1_(plain, /Zone:\s*([^\r\n]+)/i) || '').trim();
  const zoneCode = (match1_(plain, /Zonencode:\s*([^\r\n]+)/i) || '').trim();
  const car = (match1_(plain, /Auto:\s*([^\r\n]+)/i) || '').trim();
  const url = extractPdfUrl_(plain, html);
  const filename = `EasyPark_${date}_${start.replace(':','')}-${end.replace(':','')}_${amount.toFixed(2).replace('.', '-')}EUR.pdf`;

  return {
    messageId: String(msg.getId()),
    recordType: 'parking',
    provider: 'EasyPark',
    source: 'EasyPark/Gmail',
    documentType: 'confirmation',
    date, start, end, amount, vat, city, zone, zoneCode, car,
    officialUrl: url,
    receiptName: filename,
    dropboxReceiptPath: '',
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function parseReceiptMail_(msg, plain, html) {
  const url = extractPdfUrl_(plain, html);
  if (!url) return null;
  const dateMatch = plain.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const date = dateMatch ? dateMatch[1] : Utilities.formatDate(msg.getDate(), 'Europe/Vienna', 'yyyy-MM-dd');
  const filename = `EasyPark_Beleg_${date}_${String(msg.getId())}.pdf`;
  return {
    messageId: String(msg.getId()),
    recordType: 'document',
    provider: 'EasyPark',
    source: 'EasyPark/Gmail',
    documentType: 'receipt',
    date,
    officialUrl: url,
    receiptName: filename,
    dropboxReceiptPath: '',
    subject: msg.getSubject() || '',
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function extractPdfUrl_(plain, html) {
  const combined = (html || '') + '\n' + (plain || '');
  const m = combined.match(/https?:\/\/epic\.easyparksystem\.net\/rest\/resources\/parkingconfirmation\/[A-Za-z0-9_\-\/]+/i)
    || combined.match(/href=["'](https?:\/\/[^"']+)["'][^>]*>\s*(?:PDF|Quittung|Receipt|Download|Beleg)/i);
  if (!m) return '';
  return htmlDecode_(m[1] || m[0]);
}

function archiveEasyParkPdf_(url, date, filename) {
  const existing = findExistingReceiptPath_(date, filename);
  if (existing) return existing;

  const target = preferredReceiptPath_(date, filename);
  const blob = UrlFetchApp.fetch(url, {
    followRedirects: true,
    muteHttpExceptions: false
  }).getBlob().setName(filename);
  dropboxUpload_(target, blob.getBytes(), 'application/pdf');
  return target;
}

function monthBase_(date) {
  const y = String(date).slice(0,4);
  const m = String(date).slice(5,7);
  return `${EP.PARKING_ROOT}/${y}/${m}`;
}

function receiptCandidates_(date, filename) {
  const base = monthBase_(date);
  return [
    `${base}/${filename}`,
    `${base}/EasyPark/${filename}`,
    `${base}/Bestaetigungen/${filename}`,
    `${base}/Belege/${filename}`
  ];
}

function findExistingReceiptPath_(date, filename) {
  for (const path of receiptCandidates_(date, filename)) {
    if (dropboxPathExists_(path)) return path;
  }
  return '';
}

function preferredReceiptPath_(date, filename) {
  const base = monthBase_(date);
  // Wenn der Nutzer einen EasyPark-Unterordner angelegt hat, respektieren wir ihn.
  if (dropboxPathExists_(`${base}/EasyPark`, true)) return `${base}/EasyPark/${filename}`;
  return `${base}/${filename}`;
}

function normalizeParkingPath_(path) {
  return String(path || '')
    .replace(/^\/Vertretungsdienste\/03 Parkbelege/i, EP.PARKING_ROOT)
    .replace(/^\/Vertretungsdienste\/Parkbelege/i, EP.PARKING_ROOT)
    .replace(/^\/Vertretungsabrechnung\/Parkscheine/i, EP.PARKING_ROOT);
}

function repairIndexPaths_(index) {
  let changed = false;
  for (const listName of ['records','documents']) {
    for (const r of (index[listName] || [])) {
      const normalized = normalizeParkingPath_(r.dropboxReceiptPath || '');
      if (normalized !== (r.dropboxReceiptPath || '')) {
        r.dropboxReceiptPath = normalized;
        changed = true;
      }
      if (r.date && r.receiptName) {
        const current = r.dropboxReceiptPath || '';
        if (!current || !dropboxPathExists_(current)) {
          const found = findExistingReceiptPath_(r.date, r.receiptName);
          if (found && found !== current) {
            r.dropboxReceiptPath = found;
            r.pdfArchived = true;
            r.updatedAt = new Date().toISOString();
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}

function loadIndex_() {
  try {
    const text = dropboxDownloadText_(EP.INDEX);
    const obj = JSON.parse(text);
    obj.records = obj.records || [];
    obj.documents = obj.documents || [];
    return obj;
  } catch (err) {
    return {version: 2, records: [], documents: [], updatedAt: new Date().toISOString()};
  }
}

function saveIndex_(obj) {
  dropboxUpload_(EP.INDEX, Utilities.newBlob(JSON.stringify(obj, null, 2), 'application/json').getBytes(), 'application/json');
}

function dropboxDownloadText_(path) {
  const token = dropboxAccessToken_();
  const r = UrlFetchApp.fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + token,
      'Dropbox-API-Arg': JSON.stringify({path})
    },
    muteHttpExceptions: true
  });
  if (r.getResponseCode() === 409) throw new Error('Dropbox-Datei nicht vorhanden: ' + path);
  if (r.getResponseCode() >= 300) throw new Error(r.getContentText());
  return r.getContentText();
}

function dropboxUpload_(path, bytes, contentType) {
  ensureDropboxFolders_(path);
  const token = dropboxAccessToken_();
  const r = UrlFetchApp.fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'post',
    contentType: contentType || 'application/octet-stream',
    payload: bytes,
    headers: {
      Authorization: 'Bearer ' + token,
      'Dropbox-API-Arg': JSON.stringify({path, mode: 'overwrite', autorename: false, mute: true})
    },
    muteHttpExceptions: true
  });
  if (r.getResponseCode() >= 300) throw new Error(r.getContentText());
  return JSON.parse(r.getContentText());
}

function dropboxPathExists_(path, expectFolder) {
  const token = dropboxAccessToken_();
  const r = UrlFetchApp.fetch('https://api.dropboxapi.com/2/files/get_metadata', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({path, include_deleted: false}),
    headers: {Authorization: 'Bearer ' + token},
    muteHttpExceptions: true
  });
  if (r.getResponseCode() === 409) return false;
  if (r.getResponseCode() >= 300) throw new Error(r.getContentText());
  if (!expectFolder) return true;
  try { return JSON.parse(r.getContentText())['.tag'] === 'folder'; } catch (_) { return false; }
}

function ensureDropboxFolders_(filePath) {
  const parts = filePath.split('/').filter(Boolean).slice(0,-1);
  let cur = '';
  parts.forEach(part => {
    cur += '/' + part;
    const token = dropboxAccessToken_();
    const r = UrlFetchApp.fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({path: cur, autorename: false}),
      headers: {Authorization: 'Bearer ' + token},
      muteHttpExceptions: true
    });
    if (r.getResponseCode() >= 300 && !/conflict/i.test(r.getContentText())) {
      throw new Error(r.getContentText());
    }
  });
}

function dropboxAccessToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('DROPBOX_ACCESS_TOKEN');
  if (cached) return cached;

  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('DROPBOX_APP_KEY');
  const secret = props.getProperty('DROPBOX_APP_SECRET');
  const refresh = props.getProperty('DROPBOX_REFRESH_TOKEN');
  if (!key || !secret || !refresh) throw new Error('Dropbox OAuth Script Properties fehlen.');
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
  const token = JSON.parse(r.getContentText()).access_token;
  cache.put('DROPBOX_ACCESS_TOKEN', token, 10800); // 3 Stunden
  return token;
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
  if (!key || !secret || !code) throw new Error('APP_KEY, APP_SECRET oder AUTH_CODE fehlt.');
  const r = UrlFetchApp.fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'post',
    payload: {code, grant_type: 'authorization_code', client_id: key, client_secret: secret},
    muteHttpExceptions: true
  });
  if (r.getResponseCode() >= 300) throw new Error(r.getContentText());
  const data = JSON.parse(r.getContentText());
  if (!data.refresh_token) throw new Error('Kein Refresh Token erhalten. token_access_type=offline prüfen.');
  props.setProperty('DROPBOX_REFRESH_TOKEN', data.refresh_token);
  props.deleteProperty('DROPBOX_AUTH_CODE');
  CacheService.getScriptCache().remove('DROPBOX_ACCESS_TOKEN');
  console.log('Dropbox-Hintergrundzugriff eingerichtet.');
}

function match_(s, re) { const m = String(s || '').match(re); return m || null; }
function match1_(s, re) { const m = String(s || '').match(re); return m ? m[1] : ''; }
function number_(s) { if (s === '' || s == null) return NaN; return Number(String(s).replace(',', '.')); }
function htmlDecode_(s) { return String(s || '').replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/'); }
