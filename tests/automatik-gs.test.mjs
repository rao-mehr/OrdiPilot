// Tests für apps-script/OrdiPilot_Automatik.gs mit nachgebildeten Google-Diensten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const read = f => fs.readFileSync(new URL('../apps-script/' + f, import.meta.url), 'utf8');
const code = read('Honorarnote_Versand.gs') + '\n' + read('OrdiPilot_Automatik.gs');
const FUTURE = '2099-01-01T00:00:00Z'; // Lebenszeichen „frisch“ (Alter negativ)

function env({ data = {}, geo, sheetRows = [], props = {}, failDownload = false } = {}) {
  const P = new Map(
    Object.entries({
      DROPBOX_APP_KEY: 'k',
      DROPBOX_APP_SECRET: 's',
      DROPBOX_REFRESH_TOKEN: 'r',
      OP_HB_ki: FUTURE,
      OP_HB_easypark: FUTURE,
      OP_HB_check: FUTURE,
      ...props,
    })
  );
  for (const [k, v] of Object.entries(props)) if (v === null) P.delete(k);
  const sent = [],
    uploads = [],
    triggers = [];
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    KIA: { SPREADSHEET_ID: 'x', SHEET_NAME: 'Buchungen' },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: k => P.get(k) ?? null, setProperty: (k, v) => P.set(k, v) }),
    },
    UrlFetchApp: {
      fetch: (url, opt) => {
        if (url.includes('oauth2/token'))
          return { getResponseCode: () => 200, getContentText: () => '{"access_token":"t"}' };
        if (url.includes('/files/download')) {
          const path = JSON.parse(opt.headers['Dropbox-API-Arg']).path;
          if (failDownload) return { getResponseCode: () => 401, getContentText: () => 'expired' };
          if (path.endsWith('/standort.txt'))
            return geo === undefined
              ? { getResponseCode: () => 409, getContentText: () => 'not_found' }
              : { getResponseCode: () => 200, getContentText: () => geo };
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify(data) };
        }
        if (url.includes('/files/upload')) {
          uploads.push({ arg: opt.headers['Dropbox-API-Arg'], body: Buffer.from(opt.payload).toString('utf8') });
          return { getResponseCode: () => 200, getContentText: () => '{}' };
        }
        return { getResponseCode: () => 404, getContentText: () => '' };
      },
    },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: () => ({
          getLastRow: () => sheetRows.length + 1,
          getRange: () => ({ getValues: () => sheetRows }),
        }),
      }),
    },
    Utilities: {
      // Wien (Winterzeit) genügt für die Tests
      formatDate: (d, tz, f) => {
        const x = new Date(d.getTime() + 3600e3).toISOString();
        return f === 'yyyy-MM-dd' ? x.slice(0, 10) : `${x.slice(8, 10)}.${x.slice(5, 7)}.${x.slice(0, 4)}, ${x.slice(11, 16)}`;
      },
      newBlob: t => ({ getBytes: () => Buffer.from(t, 'utf8') }),
      computeDigest: (a, t) => [...crypto.createHash('sha256').update(t).digest()].map(b => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha' },
      Charset: { UTF_8: 'utf8' },
      getUuid: () => 'u',
    },
    GmailApp: { sendEmail: (...a) => sent.push(a) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'arzt@example.org' }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    ScriptApp: {
      getProjectTriggers: () => [],
      deleteTrigger() {},
      newTrigger: n => {
        const t = {
          n,
          atHour: h => ((t.h = h), t),
          everyDays: () => t,
          inTimezone: z => ((t.z = z), t),
          timeBased: () => t,
          create: () => triggers.push(t),
        };
        return t;
      },
    },
    ContentService: { MimeType: {}, createTextOutput: () => ({}) },
  };
  vm.createContext(sb);
  vm.runInContext(code, sb);
  return { sb, sent, uploads, P, triggers };
}
const at = iso => new Date(iso + 'T17:00:00Z'); // 18 Uhr Wien
const plain = v => JSON.parse(JSON.stringify(v));
const subjects = e => e.sent.map(m => m[1]);

test('KI-Export: echte Datumswerte und Text-Datum, stabile IDs, Dropbox-Pfad, ASCII-Header', () => {
  const rows = [
    [
      new Date('2026-09-02T23:30:00Z'),
      'OpenAI / ChatGPT',
      'PayPal-Zahlung',
      '9AB12345CD',
      'OpenAI',
      '',
      '',
      23,
      '',
      'PayPal',
      'm1',
      '/Finanzen & Steuern/Ausgaben/Software & Abos/OpenAI/a.pdf',
      'ok',
      'l',
    ],
    [
      '01.10.2026', // in der echten Tabelle steht das Datum oft als Text
      'Anthropic Claude',
      'Receipt',
      'Receipt-2358-0989-8248.pdf',
      'Claude Pro',
      18,
      '3,6',
      '21,6',
      '20%',
      'Karte',
      'm2',
      '/Finanzen & Steuern/Ausgaben/Software & Abos/Anthropic Claude/b.pdf',
      'ok',
      'l',
    ],
    ['kein Datum', 'OpenAI', '', 'X', '', '', '', 5, '', '', 'm3', '', '', ''],
    [new Date('2026-10-02T08:00:00Z'), 'OpenAI', '', 'Y', '', '', '', 0, '', '', 'm4', '', '', ''],
    ['01.10.2026', 'Anthropic Claude', 'Receipt', '2358-0989-8248', '', '', '', 21.6, '', '', 'm5', '', '', ''],
  ];
  const e = env({ sheetRows: rows });
  const r = e.sb.ordipilotKiExport();
  assert.deepEqual(plain(r), { written: true, records: 2 });
  assert.equal(e.uploads.length, 1);
  assert.match(e.uploads[0].arg, /^[\x00-\x7f]*$/);
  assert.equal(
    JSON.parse(e.uploads[0].arg).path,
    '/Ordination & Selbständigkeit/Vertretungsdienste/System/Import/ki-ausgaben.json'
  );
  const recs = JSON.parse(e.uploads[0].body).records;
  assert.deepEqual(
    recs.map(x => [x.id, x.date, x.gross, x.file.split('/').pop()]),
    [
      ['openai-9AB12345CD', '2026-09-03', 23, 'a.pdf'],
      ['anthropic-235809898248', '2026-10-01', 21.6, 'b.pdf'],
    ]
  );
  // unverändert → kein erneuter Upload
  assert.equal(e.sb.ordipilotKiExport().written, false);
  assert.equal(e.uploads.length, 1);
});

test('Nach dem KI-Lauf: Lebenszeichen, Export und Status-Datei für die App', () => {
  const e = env({ sheetRows: [], props: { OP_HB_ki: null } });
  e.sb.ordipilotNachKiLauf();
  assert.ok(e.P.get('OP_HB_ki'));
  const status = e.uploads.find(u => JSON.parse(u.arg).path.endsWith('/automatik-status.json'));
  assert.ok(status, 'Status-Datei geschrieben');
  const comp = JSON.parse(status.body).components;
  assert.deepEqual(
    comp.map(c => [c.key, c.ok]),
    [
      ['ki', true],
      ['easypark', true],
      ['check', true],
    ]
  );
});

const base = {
  settings: { recipients: [{ id: 'r1', name: 'Dr. Muster' }], reminderPaymentDays: 21 },
  entries: [
    { id: 'a', date: '2026-10-05', recipientId: 'r1', confirmedAt: 'x' },
    { id: 'b', date: '2026-10-20', recipientId: 'r1' },
  ],
  invoices: [],
  payments: [],
};

test('Monatsende: am Monatsletzten und am 3., nur einmal je Termin, nicht wenn erstellt', () => {
  const e = env({ data: base });
  assert.equal(e.sb.opReminders_(false, at('2026-10-30')).length, 0, 'nicht am Vortag');
  const m = e.sb.opReminders_(false, at('2026-10-31'));
  assert.equal(m.length, 1);
  assert.match(e.sent[0][1], /Honorarnote Oktober 2026 erstellen – Dr\. Muster/);
  assert.match(e.sent[0][2], /2 Einsätze: 1 bestätigt, 1 noch zu bestätigen/);
  assert.equal(e.sb.opReminders_(false, at('2026-10-31')).length, 0, 'nicht doppelt');
  assert.equal(e.sb.opReminders_(false, at('2026-11-03')).length, 1, 'am 3. nochmals');
  const done = env({ data: { ...base, invoices: [{ key: '2026-10::r1', createdAt: 'x' }] } });
  assert.equal(done.sb.opReminders_(false, at('2026-10-31')).length, 0);
});

test('Unbezahlt: ab N Tagen, wöchentlich, höchstens 3×; bezahlt oder ausgeschaltet → nichts', () => {
  const data = {
    ...base,
    entries: [],
    invoices: [{ key: '2026-09::r1', number: '2026-008', mailOpenedAt: '2026-10-01T10:00:00Z' }],
  };
  const e = env({ data });
  assert.equal(e.sb.opReminders_(false, at('2026-10-21')).length, 0, '20 Tage');
  assert.equal(e.sb.opReminders_(false, at('2026-10-22')).length, 1, '21 Tage');
  assert.match(e.sent[0][1], /Zahlung offen: Honorarnote 2026-008 \(September 2026\)/);
  assert.equal(e.sb.opReminders_(false, at('2026-10-28')).length, 0, 'erst nach 7 Tagen wieder');
  assert.equal(e.sb.opReminders_(false, at('2026-10-29')).length, 1);
  assert.equal(e.sb.opReminders_(false, at('2026-11-05')).length, 1);
  assert.equal(e.sb.opReminders_(false, at('2026-11-12')).length, 0, 'höchstens 3×');
  const paid = env({ data: { ...data, payments: [{ id: 'p', key: '2026-09::r1' }] } });
  assert.equal(paid.sb.opReminders_(false, at('2026-10-22')).length, 0);
  const off = env({ data: { ...data, settings: { ...data.settings, reminderMail: false } } });
  assert.equal(off.sb.opReminders_(false, at('2026-10-31')).length, 0);
});

test('Standort: Einsatztag ohne Signal → Mail; mit Signal, ohne Automatik oder Abendeinsatz → anders', () => {
  const data = {
    ...base,
    entries: [
      { id: 't', date: '2026-11-03', recipientId: 'r1', plannedStart: '08:00' },
      { id: 'n', date: '2026-11-04', recipientId: 'r1', plannedStart: '19:00' },
      { id: 'g', date: '2026-11-05', recipientId: 'r1', source: 'geo' },
    ],
  };
  const geoOld = '2026-10-29T18:06:00+01:00 klinik\n';
  const e = env({ data, geo: geoOld });
  assert.deepEqual(plain(e.sb.opReminders_(false, at('2026-11-03')).map(m => m.kind)), ['geo']);
  assert.match(e.sent[0][1], /Kein Standort-Signal am Di, 3\.11\. – Einsatz bei Dr\. Muster/);
  assert.equal(e.sb.opReminders_(false, at('2026-11-03')).length, 0, 'nur einmal');
  // Abendeinsatz am 4.: nicht am selben Tag, aber am 5. (Vortag)
  assert.equal(e.sb.opReminders_(false, at('2026-11-04')).length, 0);
  assert.deepEqual(plain(e.sb.opReminders_(false, at('2026-11-05')).map(m => m.kind)), ['geo']);
  assert.match(e.sent[1][1], /Mi, 4\.11\./);
  // Signal vorhanden → keine Mail
  const ok = env({ data, geo: geoOld + '03.11.2026, 07:52 ankunft\n' });
  assert.equal(ok.sb.opReminders_(false, at('2026-11-03')).length, 0);
  // Automatik nicht in Verwendung (kein Signal in 60 Tagen / keine Datei) → keine Mail
  assert.equal(env({ data, geo: '2026-01-01T08:00:00+01:00 ankunft\n' }).sb.opReminders_(false, at('2026-11-03')).length, 0);
  assert.equal(env({ data }).sb.opReminders_(false, at('2026-11-03')).length, 0);
});

test('Ausfall: fehlendes Lebenszeichen → eine Mail pro Tag; Status-Datei für die App', () => {
  const e = env({ data: { ...base, entries: [] }, props: { OP_HB_easypark: '2026-11-01T08:00:00Z', OP_HB_ki: null } });
  const m = e.sb.opReminders_(false, at('2026-11-03'));
  assert.deepEqual(plain(m.map(x => x.kind)), ['health']);
  assert.match(e.sent[0][1], /KI-Ausgaben-Automatik und EasyPark-Import läuft nicht/);
  assert.match(e.sent[0][2], /noch nie erfolgreich/);
  assert.match(e.sent[0][2], /zuletzt erfolgreich am 01\.11\.2026, 09:00 Uhr/);
  assert.equal(e.sb.opReminders_(false, at('2026-11-03')).length, 0, 'nicht doppelt am selben Tag');
  assert.ok(e.P.get('OP_HB_check'), 'Prüfung meldet sich selbst');
  const st = e.uploads.filter(u => JSON.parse(u.arg).path.endsWith('/automatik-status.json')).pop();
  assert.deepEqual(
    JSON.parse(st.body).components.filter(c => !c.ok).map(c => c.key),
    ['ki', 'easypark']
  );
});

test('Prüfung scheitert (Dropbox-Zugang abgelaufen) → Fehler-Mail, einmal pro Tag', () => {
  const e = env({ failDownload: true });
  assert.throws(() => e.sb.ordipilotErinnerungen(), /Dropbox-Download 401/);
  assert.equal(e.sent.length, 1);
  assert.match(e.sent[0][1], /tägliche Prüfung fehlgeschlagen/);
  assert.throws(() => e.sb.ordipilotErinnerungen());
  assert.equal(e.sent.length, 1, 'nicht doppelt');
});

test('Jänner: Steuerpaket fürs Vorjahr am 15.1. und 1.2., nicht wenn schon erstellt', () => {
  const data = { ...base };
  const e = env({ data });
  assert.equal(e.sb.opReminders_(false, at('2027-01-14')).length, 0);
  assert.deepEqual(plain(e.sb.opReminders_(false, at('2027-01-15')).map(m => m.kind)), ['tax']);
  assert.match(e.sent[0][1], /Steuerpaket 2026 für den Steuerberater erstellen/);
  assert.deepEqual(plain(e.sb.opReminders_(false, at('2027-02-01')).map(m => m.kind)), ['tax']);
  const done = env({ data: { ...data, settings: { ...data.settings, lastTaxExport: { year: '2026' } } } });
  assert.equal(done.sb.opReminders_(false, at('2027-01-15')).length, 0);
});

test('Probe sendet nichts; Einrichten legt einen täglichen 18-Uhr-Auslöser in Wien an', () => {
  const e = env({ data: base });
  e.sb.opReminders_(true, at('2026-10-31'));
  assert.equal(e.sent.length, 0);
  assert.equal([...e.P.keys()].filter(k => k.startsWith('ORDIPILOT_REM')).length, 0, 'Probe merkt sich nichts');
  assert.equal(e.uploads.length, 0, 'Probe schreibt keinen Status');
  e.sb.ordipilotErinnerungenEinrichten();
  assert.deepEqual(plain(e.triggers.map(t => [t.n, t.h, t.z])), [['ordipilotErinnerungen', 18, 'Europe/Vienna']]);
});
