/**
 * OrdiPilot / EasyPark Automation V3
 * Dauerhafte Gmail -> Dropbox Synchronisation für alle kommenden Monate.
 *
 * Dropbox:
 *   Index: /Ordination & Selbständigkeit/Vertretungsdienste/System/Import/easypark.json
 *   PDFs:  /Ordination & Selbständigkeit/Vertretungsdienste/Parkbelege/YYYY/MM/
 *          oder, falls vorhanden: /Ordination & Selbständigkeit/Vertretungsdienste/Parkbelege/YYYY/MM/EasyPark/
 *
 * Script Properties:
 *   DROPBOX_APP_KEY
 *   DROPBOX_APP_SECRET
 *   DROPBOX_REFRESH_TOKEN
 */

const EP = {
  ROOT: '/Ordination & Selbständigkeit/Vertretungsdienste',
  INDEX: '/Ordination & Selbständigkeit/Vertretungsdienste/System/Import/easypark.json',
  SENDER: 'no-reply@easypark.net',
  RECENT_QUERY: 'from:no-reply@easypark.net newer_than:35d',
  BACKFILL_QUERY: 'from:no-reply@easypark.net after:2026/01/01'
};

function setupEasyParkAutomation() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers
    .filter(t => t.getHandlerFunction() === 'processEasyParkRecent')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('processEasyParkRecent')
    .timeBased()
    .everyMinutes(15)
    .create();

  // Sofort einmal nachziehen, damit nicht bis zum ersten Trigger gewartet wird.
  processEasyParkRecent();
  console.log('EasyPark V3 aktiv: alle 15 Minuten + sofortiger Erstlauf.');
}

function processEasyParkRecent() {
  processEasyParkQuery_(EP.RECENT_QUERY);
}

function backfillEasyPark2026() {
  processEasyParkQuery_(EP.BACKFILL_QUERY);
}

function processEasyParkQuery_(query) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const index = loadIndex_();
    index.records = index.records || [];
    index.documents = index.documents || [];

    normalizeLegacyPaths_(index);

    const knownMessageIds = new Set([
      ...index.records.map(r => String(r.messageId || '')),
      ...index.documents.map(d => String(d.messageId || ''))
    ]);

    // Zusätzliche Deduplizierung, falls dieselbe Parkbestätigung mit neuer Mail-ID auftaucht.
    const knownParkingKeys = new Set(
      index.records.map(r => parkingKey_(r.date, r.start, r.end, r.amount))
    );

    let changed = false;
    const threads = GmailApp.search(query, 0, 500);

    threads.forEach(thread => {
      thread.getMessages().forEach(msg => {
        const id = String(msg.getId());
        if (knownMessageIds.has(id)) return;

        const from = String(msg.getFrom() || '').toLowerCase();
        if (!from.includes(EP.SENDER)) return;

        const subject = msg.getSubject() || '';
        const plain = msg.getPlainBody() || '';
        const html = msg.getBody() || '';

        if (isParkingConfirmation_(subject, plain)) {
          const rec = parseParkingConfirmation_(msg, plain, html);
          if (!rec) return;

          const dedupeKey = parkingKey_(rec.date, rec.start, rec.end, rec.amount);
          if (knownParkingKeys.has(dedupeKey)) {
            knownMessageIds.add(id);
            return;
          }

          archivePdf_(rec);

          index.records.push(rec);
          knownMessageIds.add(id);
          knownParkingKeys.add(dedupeKey);
          changed = true;
          return;
        }

        if (isReceiptMail_(subject, plain)) {
          const doc = parseReceiptMail_(msg, plain, html);
          if (!doc) return;

          archivePdf_(doc);

          index.documents.push(doc);
          knownMessageIds.add(id);
          changed = true;
        }
      });
    });

    if (changed) {
      index.records.sort((a,b) => ((a.date||'') + (a.start||'')).localeCompare((b.date||'') + (b.start||'')));
      index.documents.sort((a,b) => (a.date||'').localeCompare(b.date||''));
      index.updatedAt = new Date().toISOString();

      backupIndex_(index);
      saveIndex_(index);
    }
  } finally {
    lock.releaseLock();
  }
}

function isParkingConfirmation_(subject, body) {
  const s = `${subject}\n${body}`;
  return /Parkbestätigung/i.test(s)
    && /Gestartet:/i.test(body)
    && /Gestoppt:/i.test(body)
    && /Kosten:/i.test(body);
}

function isReceiptMail_(subject, body) {
  const s = `${subject}\n${body}`;
  return /easypark/i.test(s)
    && /(Dein\s+EasyPark-Beleg|Beleg|Quittung|Receipt|Rechnung)/i.test(s)
    && /(Beleg herunterladen|receipt\.pdf|billinginfos)/i.test(s);
}

function parseParkingConfirmation_(msg, plain, html) {
  const started = String(plain).match(/Gestartet:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/i);
  const stopped = String(plain).match(/Gestoppt:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/i);
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
  const officialUrl = extractConfirmationPdfUrl_(plain, html);

  const filename = `EasyPark_${date}_${start.replace(':','')}-${end.replace(':','')}_${moneyFile_(amount)}EUR.pdf`;
  const folder = preferredMonthFolder_(date);

  return {
    messageId: String(msg.getId()),
    provider: 'EasyPark',
    source: 'EasyPark/Gmail',
    recordType: 'parking',
    documentType: 'confirmation',
    date, start, end, amount, vat, city, zone, zoneCode, car,
    officialUrl,
    receiptName: filename,
    dropboxReceiptPath: `${folder}/${filename}`,
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pdfArchived: false
  };
}

function parseReceiptMail_(msg, plain, html) {
  const officialUrl = extractReceiptPdfUrl_(plain, html);
  if (!officialUrl) return null;

  const dateMatch = String(plain).match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const date = dateMatch
    ? dateMatch[1]
    : Utilities.formatDate(msg.getDate(), 'Europe/Vienna', 'yyyy-MM-dd');

  const filename = `EasyPark_Beleg_${date}_${String(msg.getId())}.pdf`;
  const folder = preferredMonthFolder_(date);

  return {
    messageId: String(msg.getId()),
    provider: 'EasyPark',
    source: 'EasyPark/Gmail',
    recordType: 'document',
    documentType: 'receipt',
    date,
    subject: msg.getSubject() || '',
    officialUrl,
    receiptName: filename,
    dropboxReceiptPath: `${folder}/${filename}`,
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pdfArchived: false
  };
}

function archivePdf_(obj) {
  if (!obj.officialUrl) return;
  try {
    const response = UrlFetchApp.fetch(obj.officialUrl, {
      followRedirects: true,
      muteHttpExceptions: true
    });
    if (response.getResponseCode() >= 300) {
      throw new Error(`HTTP ${response.getResponseCode()}`);
    }

    const blob = response.getBlob().setName(obj.receiptName);
    dropboxUpload_(obj.dropboxReceiptPath, blob.getBytes(), 'application/pdf');
    obj.pdfArchived = true;
    obj.downloadError = '';
  } catch (err) {
    obj.pdfArchived = false;
    obj.downloadError = String(err);
  }
}

function preferredMonthFolder_(date) {
  const year = date.slice(0,4);
  const month = date.slice(5,7);
  const base = `${EP.ROOT}/Parkbelege/${year}/${month}`;
  const easyPark = `${base}/EasyPark`;

  // Bestehenden EasyPark-Unterordner respektieren; sonst Hauptordner verwenden.
  return dropboxPathExists_(easyPark) ? easyPark : base;
}

function dropboxPathExists_(path) {
  const token = dropboxAccessToken_();
  const r = UrlFetchApp.fetch('https://api.dropboxapi.com/2/files/get_metadata', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({path}),
    headers: {Authorization: 'Bearer ' + token},
    muteHttpExceptions: true
  });
  return r.getResponseCode() === 200;
}

function normalizeLegacyPaths_(index) {
  const all = [...(index.records || []), ...(index.documents || [])];
  all.forEach(x => {
    if (!x.dropboxReceiptPath) return;
    x.dropboxReceiptPath = x.dropboxReceiptPath
      .replace('/Vertretungsdienste/03 Parkbelege/', '/Ordination & Selbständigkeit/Vertretungsdienste/Parkbelege/')
      .replace('/Vertretungsdienste/Parkbelege/', '/Ordination & Selbständigkeit/Vertretungsdienste/Parkbelege/')
      .replace('/Vertretungsabrechnung/Parkscheine/', '/Ordination & Selbständigkeit/Vertretungsdienste/Parkbelege/');
  });
}

function parkingKey_(date, start, end, amount) {
  return `${date||''}|${start||''}|${end||''}|${Number(amount||0).toFixed(2)}`;
}

function extractConfirmationPdfUrl_(plain, html) {
  const combined = `${html || ''}\n${plain || ''}`;
  const m = combined.match(/https?:\/\/epic\.easyparksystem\.net\/rest\/resources\/parkingconfirmation\/[A-Za-z0-9_\-\/]+/i);
  return m ? htmlDecode_(m[0]) : '';
}

function extractReceiptPdfUrl_(plain, html) {
  const combined = `${html || ''}\n${plain || ''}`;
  const m =
    combined.match(/https?:\/\/epic-api\.easyparksystem\.net\/rest\/resources\/billinginfos\/[A-Za-z0-9_\-\/]+\/receipt\.pdf/i) ||
    combined.match(/href=["'](https?:\/\/[^"']+)["'][^>]*>\s*(?:Beleg herunterladen|PDF|Quittung|Receipt|Download)/i);
  return m ? htmlDecode_(m[1] || m[0]) : '';
}

function loadIndex_() {
  try {
    const obj = JSON.parse(dropboxDownloadText_(EP.INDEX));
    obj.records = obj.records || [];
    obj.documents = obj.documents || [];
    return obj;
  } catch (err) {
    return {version: 2, records: [], documents: [], updatedAt: new Date().toISOString()};
  }
}

function saveIndex_(obj) {
  obj.version = Math.max(Number(obj.version || 1), 2);
  dropboxUpload_(
    EP.INDEX,
    Utilities.newBlob(JSON.stringify(obj, null, 2), 'application/json').getBytes(),
    'application/json'
  );
}

function backupIndex_(obj) {
  try {
    const stamp = Utilities.formatDate(new Date(), 'Europe/Vienna', 'yyyyMMdd_HHmmss');
    const path = `${EP.ROOT}/System/Backups/EasyPark/easypark_${stamp}.json`;
    dropboxUpload_(
      path,
      Utilities.newBlob(JSON.stringify(obj, null, 2), 'application/json').getBytes(),
      'application/json'
    );
  } catch (err) {
    console.log('EasyPark-Backup fehlgeschlagen, Hauptsync läuft weiter: ' + err);
  }
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
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('DROPBOX_APP_KEY');
  const secret = props.getProperty('DROPBOX_APP_SECRET');
  const refresh = props.getProperty('DROPBOX_REFRESH_TOKEN');

  if (!key || !secret || !refresh) {
    throw new Error('Dropbox OAuth Script Properties fehlen.');
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

function match1_(s, re) {
  const m = String(s || '').match(re);
  return m ? m[1] : '';
}

function number_(s) {
  if (s === '' || s == null) return NaN;
  return Number(String(s).replace(',', '.'));
}

function moneyFile_(n) {
  return Number(n || 0).toFixed(2).replace('.', '-');
}

function htmlDecode_(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/');
}
