/**
 * OrdiPilot – Automatik im Google-Konto (gleiches Apps-Script-Projekt wie EasyPark, KI-Ausgaben und Versand)
 *
 * 1. ordipilotKiExport()       – legt die gebuchten KI-Belege (Tabelle der KI-Ausgaben-Automatik) als
 *                                System/Import/ki-ausgaben.json in Dropbox ab. Wird nach jedem
 *                                erfolgreichen KI-Lauf aufgerufen; schreibt nur, wenn sich etwas geändert hat.
 * 2. ordipilotErinnerungen()   – täglich 18 Uhr: Mail an dich, wenn
 *                                  · am Monatsletzten (und nochmals am 3.) die Honorarnote eines Monats
 *                                    mit Einsätzen noch nicht erstellt ist,
 *                                  · eine versendete Honorarnote nach N Tagen (Einstellung in OrdiPilot,
 *                                    Standard 21) nicht als bezahlt erfasst ist – höchstens 1× pro Woche, 3× insgesamt.
 *    ordipilotErinnerungenProbe() zeigt im Protokoll, was heute verschickt würde – ohne zu senden.
 *    ordipilotErinnerungenEinrichten() legt den täglichen Auslöser an (einmalig).
 *
 * Nutzt hnDropboxToken_() aus Honorarnote_Versand.gs und KIA aus der KI-Ausgaben-Automatik.
 * Keine Geheimnisse im Code – alles liegt in den Script-Eigenschaften.
 */

const OP = {
  ROOT: '/Ordination & Selbständigkeit/Vertretungsdienste',
  TZ: 'Europe/Vienna',
  APP_URL: 'https://rao-mehr.github.io/OrdiPilot/',
  KI_FILE: '/System/Import/ki-ausgaben.json',
  DATA_FILE: '/System/daten.json',
  PAY_REPEAT_DAYS: 7,
  PAY_MAX: 3,
};
const OP_MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/* ---------- 1. KI-Ausgaben für OrdiPilot bereitstellen ---------- */

function ordipilotKiExport() {
  const sheet = SpreadsheetApp.openById(KIA.SPREADSHEET_ID).getSheetByName(KIA.SHEET_NAME);
  if (!sheet) throw new Error('Tabellenblatt ' + KIA.SHEET_NAME + ' nicht gefunden.');
  const last = sheet.getLastRow();
  const rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, 14).getValues();
  const records = opKiRecords_(rows);
  const json = JSON.stringify({ version: 1, source: 'KI-Ausgaben-Automatik', records: records }, null, 1);
  const hash = opHash_(json);
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ORDIPILOT_KI_EXPORT_HASH') === hash) return { written: false, records: records.length };
  opUpload_(OP.ROOT + OP.KI_FILE, json);
  props.setProperty('ORDIPILOT_KI_EXPORT_HASH', hash);
  console.log('OrdiPilot: ' + records.length + ' KI-Belege bereitgestellt.');
  return { written: true, records: records.length };
}

/** Tabellenzeilen → Belege. Spalten: Datum, Anbieter, Typ, Nummer, Beschreibung, Netto, USt, Brutto, … */
function opKiRecords_(rows) {
  const out = [];
  const seen = {};
  (rows || []).forEach(function (v) {
    const d = v[0];
    const gross = typeof v[7] === 'number' ? v[7] : Number(String(v[7] || '').replace(',', '.'));
    if (Object.prototype.toString.call(d) !== '[object Date]' || isNaN(d.getTime()) || !(gross > 0)) return;
    const provider = String(v[1] || '').trim();
    const p = /anthropic|claude/i.test(provider) ? 'anthropic' : /openai|chatgpt/i.test(provider) ? 'openai' : 'ki';
    const number = String(v[3] || '').trim();
    const key = number.toUpperCase().replace(/^(RECEIPT|INVOICE)[-_\s#]*/i, '').replace(/\.PDF$/i, '').replace(/[^A-Z0-9]/g, '');
    const id = p + '-' + (key || String(v[10] || '').replace(/[^A-Za-z0-9]/g, ''));
    if (!key && !v[10]) return;
    if (seen[id]) return;
    seen[id] = true;
    out.push({
      id: id,
      date: Utilities.formatDate(d, OP.TZ, 'yyyy-MM-dd'),
      provider: provider,
      type: String(v[2] || ''),
      number: number,
      description: String(v[4] || ''),
      gross: Math.round(gross * 100) / 100,
    });
  });
  out.sort(function (a, b) {
    return (a.date + a.id).localeCompare(b.date + b.id);
  });
  return out;
}

/* ---------- 2. Erinnerungen ---------- */

function ordipilotErinnerungen() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log('OrdiPilot-Erinnerungen: Skript belegt, morgen erneut.');
    return [];
  }
  try {
    return opReminders_(false);
  } finally {
    lock.releaseLock();
  }
}

function ordipilotErinnerungenProbe() {
  const mails = opReminders_(true);
  console.log(mails.length ? mails.map(function (m) { return '• ' + m.subject; }).join('\n') : 'Heute keine Erinnerung fällig.');
  return mails;
}

function ordipilotErinnerungenEinrichten() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'ordipilotErinnerungen'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('ordipilotErinnerungen').timeBased().atHour(18).everyDays(1).inTimezone(OP.TZ).create();
  console.log('OrdiPilot-Erinnerungen: täglich um 18 Uhr eingerichtet.');
}

function opReminders_(dryRun, now) {
  const data = JSON.parse(opDownloadText_(OP.ROOT + OP.DATA_FILE));
  const due = opDueReminders_(data, now || new Date(), PropertiesService.getScriptProperties());
  if (!dryRun) {
    const to = Session.getEffectiveUser().getEmail();
    due.forEach(function (m) {
      GmailApp.sendEmail(to, m.subject, m.body + '\n\nOrdiPilot öffnen: ' + OP.APP_URL, { name: 'OrdiPilot' });
      m.mark();
      console.log('Erinnerung gesendet: ' + m.subject);
    });
  }
  return due;
}

/** Ermittelt fällige Erinnerungen (ohne zu senden). props: Script-Eigenschaften (für „schon erinnert“). */
function opDueReminders_(data, now, props) {
  const s = (data && data.settings) || {};
  if (s.reminderMail === false) return [];
  const today = Utilities.formatDate(now, OP.TZ, 'yyyy-MM-dd');
  const [Y, M, D] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  const recipients = Array.isArray(s.recipients) && s.recipients.length ? s.recipients : [{ id: 'recipient-primary', name: s.recipientName || '' }];
  const primary = recipients[0].id;
  const nameOf = function (rid) {
    const r = recipients.filter(function (x) { return x.id === rid; })[0];
    return (r && r.name) || 'Empfänger';
  };
  const invoices = (data.invoices || []).filter(function (r) { return r && r.key && !r.archivedRecord; });
  const inv = function (key) { return invoices.filter(function (r) { return r.key === key; })[0]; };
  const out = [];

  // a) Monatsende: am Monatsletzten für den laufenden, am 3. für den Vormonat
  let month = null, round = null;
  if (D === lastDay) { month = today.slice(0, 7); round = 'last'; }
  else if (D === 3) { const pm = M === 1 ? 12 : M - 1, py = M === 1 ? Y - 1 : Y; month = py + '-' + String(pm).padStart(2, '0'); round = 'day3'; }
  if (month) {
    const deleted = data.deletedEntries || {};
    const byRid = {};
    (data.entries || []).forEach(function (e) {
      if (!e || !e.date || e.date.slice(0, 7) !== month || deleted[e.id]) return;
      const rid = e.recipientId || primary;
      (byRid[rid] = byRid[rid] || []).push(e);
    });
    Object.keys(byRid).forEach(function (rid) {
      const r = inv(month + '::' + rid);
      if (r && (r.createdAt || r.mailOpenedAt || r.signedAt)) return;
      const flag = 'ORDIPILOT_REM_ME_' + month + '_' + rid + '_' + round;
      if (props.getProperty(flag)) return;
      const es = byRid[rid], done = es.filter(function (e) { return !!e.confirmedAt; }).length, open = es.length - done;
      const [yy, mm] = month.split('-');
      out.push({
        kind: 'monthEnd',
        subject: 'Honorarnote ' + OP_MONTHS[Number(mm) - 1] + ' ' + yy + ' erstellen – ' + nameOf(rid),
        body: 'Für ' + OP_MONTHS[Number(mm) - 1] + ' ' + yy + ' (' + nameOf(rid) + ') ist noch keine Honorarnote erstellt.\n' +
          es.length + (es.length === 1 ? ' Einsatz' : ' Einsätze') + ': ' + done + ' bestätigt' + (open ? ', ' + open + ' noch zu bestätigen' : '') + '.',
        mark: function () { props.setProperty(flag, today); },
      });
    });
  }

  // b) Versendet, aber nach N Tagen nicht als bezahlt erfasst
  const days = Number(s.reminderPaymentDays) >= 7 && Number(s.reminderPaymentDays) <= 90 ? Number(s.reminderPaymentDays) : 21;
  const paid = {};
  (data.payments || []).forEach(function (p) { if (p && p.key && !(data.deletedPayments || {})[p.id]) paid[p.key] = true; });
  invoices.forEach(function (r) {
    const sent = r.mailOpenedAt || (r.signedAt && r.signedDropboxPath ? r.signedAt : '');
    if (!sent || paid[r.key]) return;
    const age = Math.floor((now.getTime() - new Date(sent).getTime()) / 864e5);
    if (age < days) return;
    const flag = 'ORDIPILOT_REM_PAY_' + r.key;
    const prev = String(props.getProperty(flag) || '').split('|');
    const count = Number(prev[1] || 0);
    if (count >= OP.PAY_MAX) return;
    if (prev[0] && (new Date(today) - new Date(prev[0])) / 864e5 < OP.PAY_REPEAT_DAYS) return;
    const [yy, mm] = r.key.split('::')[0].split('-');
    out.push({
      kind: 'unpaid',
      subject: 'Zahlung offen: Honorarnote ' + (r.number || '') + ' (' + OP_MONTHS[Number(mm) - 1] + ' ' + yy + ')',
      body: 'Die Honorarnote ' + (r.number || '') + ' für ' + OP_MONTHS[Number(mm) - 1] + ' ' + yy + ' an ' + nameOf(r.recipientId || r.key.split('::')[1]) +
        ' wurde vor ' + age + ' Tagen versendet und ist in OrdiPilot noch nicht als bezahlt erfasst.\n' +
        'Ist das Geld schon da? Dann in OrdiPilot unter Honorar → Steuer & Belege → Zahlungseingänge erfassen ' +
        '(oder den Zahlungsnachweis in Dropbox unter Zahlungsnachweise ablegen).',
      mark: function () { props.setProperty(flag, today + '|' + (count + 1)); },
    });
  });
  return out;
}

/* ---------- Dropbox ---------- */

function opArg_(obj) {
  // Dropbox verlangt reines ASCII im Header – Umlaute maskieren
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, function (c) { return '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4); });
}

function opDownloadText_(path) {
  const r = UrlFetchApp.fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + hnDropboxToken_(), 'Dropbox-API-Arg': opArg_({ path: path }) },
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() >= 300) throw new Error('Dropbox-Download ' + r.getResponseCode() + ': ' + path);
  return r.getContentText('UTF-8');
}

function opUpload_(path, text) {
  const r = UrlFetchApp.fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'post',
    contentType: 'application/octet-stream',
    payload: Utilities.newBlob(text, 'application/json').getBytes(),
    headers: { Authorization: 'Bearer ' + hnDropboxToken_(), 'Dropbox-API-Arg': opArg_({ path: path, mode: 'overwrite', autorename: false, mute: true }) },
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() >= 300) throw new Error('Dropbox-Upload ' + r.getResponseCode() + ': ' + r.getContentText());
}

function opHash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); })
    .join('');
}
