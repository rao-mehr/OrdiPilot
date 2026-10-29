/**
 * OrdiPilot – Automatik im Google-Konto (gleiches Apps-Script-Projekt wie EasyPark, KI-Ausgaben und Versand)
 *
 * 1. ordipilotNachKiLauf()     – wird nach jedem KI-Lauf aufgerufen: meldet „KI läuft“, legt die gebuchten
 *                                KI-Belege als System/Import/ki-ausgaben.json in Dropbox ab (nur bei Änderung)
 *                                und aktualisiert System/Import/automatik-status.json für die App.
 * 2. ordipilotErinnerungen()   – täglich 18 Uhr: Mail an dich, wenn
 *                                  · am Monatsletzten (und nochmals am 3.) die Honorarnote eines Monats
 *                                    mit Einsätzen noch nicht erstellt ist,
 *                                  · eine versendete Honorarnote nach N Tagen (Einstellung in OrdiPilot,
 *                                    Standard 21) nicht als bezahlt erfasst ist – höchstens 1× pro Woche, 3× insgesamt,
 *                                  · an einem Einsatztag kein Standort-Signal vom iPhone kam,
 *                                  · eine Automatik (KI-Ausgaben, EasyPark) seit über einem Tag nicht gelaufen ist,
 *                                  · im Jänner das Steuerpaket für das Vorjahr noch fehlt.
 *                                Scheitert die Prüfung selbst (z. B. Dropbox-Zugang abgelaufen), kommt eine Fehler-Mail.
 *    ordipilotErinnerungenProbe() zeigt im Protokoll, was heute verschickt würde – ohne zu senden.
 *    ordipilotErinnerungenEinrichten() legt den täglichen Auslöser an (einmalig).
 *
 * Nutzt hnDropboxToken_() aus Honorarnote_Versand.gs und KIA aus der KI-Ausgaben-Automatik.
 * EasyPark.gs ruft opBeat_('easypark') nach jedem erfolgreichen Import auf.
 * Keine Geheimnisse im Code – alles liegt in den Script-Eigenschaften.
 */

const OP = {
  ROOT: '/Ordination & Selbständigkeit/Vertretungsdienste',
  TZ: 'Europe/Vienna',
  APP_URL: 'https://rao-mehr.github.io/OrdiPilot/',
  KI_FILE: '/System/Import/ki-ausgaben.json',
  DATA_FILE: '/System/daten.json',
  GEO_FILE: '/System/Import/standort.txt',
  STATUS_FILE: '/System/Import/automatik-status.json',
  PAY_REPEAT_DAYS: 7,
  PAY_MAX: 3,
  GEO_ACTIVE_DAYS: 60, // Standort-Automatik gilt als „in Verwendung“, wenn in diesem Zeitraum ein Signal kam
  GEO_LATE_START: '17:00', // Einsätze ab dieser Uhrzeit werden erst am Folgetag geprüft
};
const OP_MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const OP_DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
// Überwachte Automatiken: Name → höchstens so viele Stunden ohne erfolgreichen Lauf
const OP_WATCH = {
  ki: { label: 'KI-Ausgaben-Automatik', maxHours: 26 },
  easypark: { label: 'EasyPark-Import', maxHours: 24 },
  check: { label: 'Tägliche Prüfung (18 Uhr)', maxHours: 26, appOnly: true },
};

/* ---------- Lebenszeichen ---------- */

function opBeat_(name, when) {
  PropertiesService.getScriptProperties().setProperty('OP_HB_' + name, (when || new Date()).toISOString());
}

function opHealth_(now, props) {
  return Object.keys(OP_WATCH).map(function (k) {
    const last = props.getProperty('OP_HB_' + k) || '';
    const hours = last ? (now.getTime() - new Date(last).getTime()) / 36e5 : null;
    return { key: k, label: OP_WATCH[k].label, last: last, ok: hours !== null && hours <= OP_WATCH[k].maxHours, appOnly: !!OP_WATCH[k].appOnly };
  });
}

function opWriteStatus_(now, props) {
  const status = { version: 1, updatedAt: now.toISOString(), components: opHealth_(now, props) };
  opUpload_(OP.ROOT + OP.STATUS_FILE, JSON.stringify(status, null, 1));
}

/* ---------- 1. Nach jedem KI-Lauf ---------- */

function ordipilotNachKiLauf() {
  opBeat_('ki');
  try {
    ordipilotKiExport();
  } catch (e) {
    console.warn('OrdiPilot-Export: ' + e);
  }
  try {
    opWriteStatus_(new Date(), PropertiesService.getScriptProperties());
  } catch (e) {
    console.warn('OrdiPilot-Status: ' + e);
  }
}

function ordipilotKiExport() {
  const sheet = SpreadsheetApp.openById(KIA.SPREADSHEET_ID).getSheetByName(KIA.SHEET_NAME);
  if (!sheet) throw new Error('Tabellenblatt ' + KIA.SHEET_NAME + ' nicht gefunden.');
  const last = sheet.getLastRow();
  const rows = last < 2 ? [] : sheet.getRange(2, 1, last - 1, 14).getValues();
  const records = opKiRecords_(rows);
  const json = JSON.stringify({ version: 2, source: 'KI-Ausgaben-Automatik', records: records }, null, 1);
  const hash = opHash_(json);
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ORDIPILOT_KI_EXPORT_HASH') === hash) return { written: false, records: records.length };
  opUpload_(OP.ROOT + OP.KI_FILE, json);
  props.setProperty('ORDIPILOT_KI_EXPORT_HASH', hash);
  console.log('OrdiPilot: ' + records.length + ' KI-Belege bereitgestellt.');
  return { written: true, records: records.length };
}

/** Datumszelle → 'yyyy-MM-dd'. Die Tabelle enthält echte Datumswerte und Text („14.10.2026“). */
function opDate_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, OP.TZ, 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

/** Tabellenzeilen → Belege. Spalten: Datum, Anbieter, Typ, Nummer, Beschreibung, Netto, USt, Brutto, USt-Satz,
 *  Zahlungsweg, Gmail-ID, Dropbox-Datei, Status, Gmail-Link */
function opKiRecords_(rows) {
  const out = [];
  const seen = {};
  (rows || []).forEach(function (v) {
    const date = opDate_(v[0]);
    const gross = typeof v[7] === 'number' ? v[7] : Number(String(v[7] || '').replace(',', '.'));
    if (!date || !(gross > 0)) return;
    const provider = String(v[1] || '').trim();
    const p = /anthropic|claude/i.test(provider) ? 'anthropic' : /openai|chatgpt/i.test(provider) ? 'openai' : 'ki';
    const number = String(v[3] || '').trim();
    const key = number.toUpperCase().replace(/^(RECEIPT|INVOICE)[-_\s#]*/i, '').replace(/\.PDF$/i, '').replace(/[^A-Z0-9]/g, '');
    const id = p + '-' + (key || String(v[10] || '').replace(/[^A-Za-z0-9]/g, ''));
    if (!key && !v[10]) return;
    if (seen[id]) return;
    seen[id] = true;
    const file = String(v[11] || '').trim();
    out.push({
      id: id,
      date: date,
      provider: provider,
      type: String(v[2] || ''),
      number: number,
      description: String(v[4] || ''),
      gross: Math.round(gross * 100) / 100,
      file: file.charAt(0) === '/' ? file : '',
    });
  });
  out.sort(function (a, b) {
    return (a.date + a.id).localeCompare(b.date + b.id);
  });
  return out;
}

/* ---------- 2. Tägliche Prüfung ---------- */

function ordipilotErinnerungen() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log('OrdiPilot-Erinnerungen: Skript belegt, morgen erneut.');
    return [];
  }
  try {
    return opReminders_(false);
  } catch (e) {
    opFailMail_(e);
    throw e;
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

function opFailMail_(err) {
  try {
    const props = PropertiesService.getScriptProperties();
    const today = Utilities.formatDate(new Date(), OP.TZ, 'yyyy-MM-dd');
    if (props.getProperty('ORDIPILOT_FAIL_MAIL') === today) return;
    GmailApp.sendEmail(
      Session.getEffectiveUser().getEmail(),
      'OrdiPilot: tägliche Prüfung fehlgeschlagen',
      'Die tägliche Prüfung deines OrdiPilot-Skripts ist abgebrochen:\n\n' + String(err && err.message ? err.message : err) +
        '\n\nHäufigste Ursache: Der Dropbox-Zugang des Google-Skripts ist abgelaufen. Erinnerungen, KI-Belege und EasyPark-Import ' +
        'brauchen ihn. Bitte im Apps-Script-Projekt „Vertretungsabrechnung EasyPark“ das Ausführungsprotokoll ansehen.' +
        '\n\nOrdiPilot öffnen: ' + OP.APP_URL,
      { name: 'OrdiPilot' }
    );
    props.setProperty('ORDIPILOT_FAIL_MAIL', today);
  } catch (e) {
    console.error('Fehler-Mail nicht möglich: ' + e);
  }
}

function opReminders_(dryRun, now) {
  now = now || new Date();
  const props = PropertiesService.getScriptProperties();
  const data = JSON.parse(opDownloadText_(OP.ROOT + OP.DATA_FILE));
  let geoText = null;
  try {
    geoText = opDownloadText_(OP.ROOT + OP.GEO_FILE);
  } catch (e) {
    geoText = null; // keine Standort-Datei → Standort-Prüfung entfällt
  }
  const due = opDueReminders_(data, now, props, { geoText: geoText, health: opHealth_(now, props) });
  if (!dryRun) {
    const to = Session.getEffectiveUser().getEmail();
    due.forEach(function (m) {
      GmailApp.sendEmail(to, m.subject, m.body + '\n\nOrdiPilot öffnen: ' + OP.APP_URL, { name: 'OrdiPilot' });
      m.mark();
      console.log('Erinnerung gesendet: ' + m.subject);
    });
    opBeat_('check', now);
    try {
      opWriteStatus_(now, props);
    } catch (e) {
      console.warn('OrdiPilot-Status: ' + e);
    }
  }
  return due;
}

function opAddDays_(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Tage mit mindestens einem Standort-Signal (gleiche Zeilenformate wie in der App). */
function opGeoDays_(text) {
  const days = {};
  String(text || '').split(/\r?\n/).forEach(function (raw) {
    const line = raw.trim();
    let m = line.match(/^(\d{4})-(\d{2})-(\d{2})[T ]\d{1,2}:\d{2}\S*\s+[A-Za-zäöü_]+/);
    if (m) {
      days[m[1] + '-' + m[2] + '-' + m[3]] = true;
      return;
    }
    m = line.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s+\d{1,2}:\d{2}\S*\s+[A-Za-zäöü_]+/);
    if (m) days[m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2)] = true;
  });
  return days;
}

/** Ermittelt fällige Erinnerungen (ohne zu senden). props: Script-Eigenschaften (für „schon erinnert“).
 *  opts: { geoText: Inhalt von standort.txt oder null, health: opHealth_() } */
function opDueReminders_(data, now, props, opts) {
  opts = opts || {};
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
  const deleted = data.deletedEntries || {};
  const entries = (data.entries || []).filter(function (e) { return e && e.date && !deleted[e.id]; });
  const out = [];

  // a) Monatsende: am Monatsletzten für den laufenden, am 3. für den Vormonat
  let month = null, round = null;
  if (D === lastDay) { month = today.slice(0, 7); round = 'last'; }
  else if (D === 3) { const pm = M === 1 ? 12 : M - 1, py = M === 1 ? Y - 1 : Y; month = py + '-' + String(pm).padStart(2, '0'); round = 'day3'; }
  if (month) {
    const byRid = {};
    entries.forEach(function (e) {
      if (e.date.slice(0, 7) !== month) return;
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
        '(oder einen Umsatz-Export aus George in Dropbox unter Kontoumsaetze ablegen – OrdiPilot ordnet ihn beim nächsten Sync zu).',
      mark: function () { props.setProperty(flag, today + '|' + (count + 1)); },
    });
  });

  // c) Einsatztag ohne Standort-Signal (nur wenn die Standort-Automatik in Verwendung ist)
  if (opts.geoText !== null && opts.geoText !== undefined && s.geoWatch !== false) {
    const geo = opGeoDays_(opts.geoText);
    const since = opAddDays_(today, -OP.GEO_ACTIVE_DAYS);
    const inUse = Object.keys(geo).some(function (d) { return d >= since && d <= today; });
    if (inUse) {
      const startOf = function (e) { return String(e.start || e.plannedStart || ''); };
      [
        { date: today, test: function (e) { return startOf(e) < OP.GEO_LATE_START; } }, // auch ohne Uhrzeit
        { date: opAddDays_(today, -1), test: function (e) { return startOf(e) >= OP.GEO_LATE_START; } },
      ].forEach(function (c) {
        if (geo[c.date]) return;
        const es = entries.filter(function (e) { return e.date === c.date && e.source !== 'geo' && c.test(e); });
        if (!es.length) return;
        const flag = 'ORDIPILOT_REM_GEO_' + c.date;
        if (props.getProperty(flag)) return;
        const d = new Date(c.date + 'T12:00:00Z');
        const label = OP_DAYS[d.getUTCDay()] + ', ' + d.getUTCDate() + '.' + (d.getUTCMonth() + 1) + '.';
        out.push({
          kind: 'geo',
          subject: 'Kein Standort-Signal am ' + label + ' – Einsatz bei ' + nameOf(es[0].recipientId || primary),
          body: 'Für ' + label + ' ist ein Einsatz eingetragen, vom iPhone kam an diesem Tag aber kein Standort-Signal.\n' +
            'Bitte prüfen: Kurzbefehle → Automation → „Ankommen Ordination“ ist aktiv und auf „Sofort ausführen“ gestellt, ' +
            'Ortungsdienste für Kurzbefehle sind erlaubt.\nDie Zeiten des Einsatzes bitte in OrdiPilot von Hand eintragen.',
          mark: function () { props.setProperty(flag, today); },
        });
      });
    }
  }

  // d) Automatik ausgefallen (höchstens eine Mail pro Tag)
  const broken = (opts.health || []).filter(function (h) { return !h.ok && !h.appOnly; });
  if (broken.length && !props.getProperty('ORDIPILOT_REM_HEALTH_' + today)) {
    out.push({
      kind: 'health',
      subject: 'OrdiPilot: ' + broken.map(function (h) { return h.label; }).join(' und ') + ' läuft nicht',
      body: broken.map(function (h) {
        return '• ' + h.label + ': ' + (h.last ? 'zuletzt erfolgreich am ' + Utilities.formatDate(new Date(h.last), OP.TZ, 'dd.MM.yyyy, HH:mm') + ' Uhr' : 'noch nie erfolgreich gemeldet');
      }).join('\n') +
        '\n\nBitte im Apps-Script-Projekt „Vertretungsabrechnung EasyPark“ unter „Ausführungen“ nachsehen. ' +
        'Häufigste Ursachen: abgelaufener Dropbox-Zugang, entzogene Google-Berechtigung, gelöschter Auslöser.',
      mark: function () { props.setProperty('ORDIPILOT_REM_HEALTH_' + today, '1'); },
    });
  }

  // e) Jänner: Steuerpaket für das Vorjahr
  if ((M === 1 && D === 15) || (M === 2 && D === 1)) {
    const py = String(Y - 1);
    const le = s.lastTaxExport || {};
    const flag = 'ORDIPILOT_REM_TAX_' + py + '_' + M;
    if (String(le.year) !== py && entries.some(function (e) { return e.date.slice(0, 4) === py; }) && !props.getProperty(flag)) {
      out.push({
        kind: 'tax',
        subject: 'Steuerpaket ' + py + ' für den Steuerberater erstellen',
        body: 'Für ' + py + ' wurde noch kein Steuerpaket erstellt.\n' +
          'In OrdiPilot unter Honorar → Steuer & Belege → Jahr ' + py + ' → „Steuerpaket in Dropbox“. ' +
          'Vorher prüfen: alle Zahlungseingänge erfasst, Kilometer eingetragen, KI-Anteil mit dem Steuerberater abgestimmt.',
        mark: function () { props.setProperty(flag, today); },
      });
    }
  }
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
