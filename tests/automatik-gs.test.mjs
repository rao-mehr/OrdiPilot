// Tests für apps-script/OrdiPilot_Automatik.gs mit nachgebildeten Google-Diensten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const read = f => fs.readFileSync(new URL('../apps-script/' + f, import.meta.url), 'utf8');
const code = read('Honorarnote_Versand.gs') + '\n' + read('OrdiPilot_Automatik.gs');

function env({ data = {}, sheetRows = [], props = {} } = {}) {
  const P = new Map(
    Object.entries({ DROPBOX_APP_KEY: 'k', DROPBOX_APP_SECRET: 's', DROPBOX_REFRESH_TOKEN: 'r', ...props })
  );
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
        if (url.includes('/files/download'))
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify(data) };
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
      formatDate: (d, tz, f) => new Date(d.getTime() + 3600e3).toISOString().slice(0, 10), // Wien (Winterzeit) genügt für die Tests
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

test('KI-Export: gültige Zeilen, stabile IDs, Datum in Wiener Zeit, ASCII-Header', () => {
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
      '/p',
      'ok',
      'l',
    ],
    [
      new Date('2026-10-01T08:00:00Z'),
      'Anthropic / Claude',
      'Receipt',
      'Receipt-2358-0989-8248.pdf',
      'Claude Pro',
      18,
      3.6,
      21.6,
      '20%',
      'Karte',
      'm2',
      '/p',
      'ok',
      'l',
    ],
    ['kein Datum', 'OpenAI', '', 'X', '', '', '', 5, '', '', 'm3', '', '', ''],
    [new Date('2026-10-02T08:00:00Z'), 'OpenAI', '', 'Y', '', '', '', 0, '', '', 'm4', '', '', ''],
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
    recs.map(x => [x.id, x.date, x.gross]),
    [
      ['openai-9AB12345CD', '2026-09-03', 23],
      ['anthropic-235809898248', '2026-10-01', 21.6],
    ]
  );
  // unverändert → kein erneuter Upload
  assert.equal(e.sb.ordipilotKiExport().written, false);
  assert.equal(e.uploads.length, 1);
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

test('Probe sendet nichts; Einrichten legt einen täglichen 18-Uhr-Auslöser in Wien an', () => {
  const e = env({ data: base });
  e.sb.opReminders_(true, at('2026-10-31'));
  assert.equal(e.sent.length, 0);
  assert.equal([...e.P.keys()].filter(k => k.startsWith('ORDIPILOT_REM')).length, 0, 'Probe merkt sich nichts');
  e.sb.ordipilotErinnerungenEinrichten();
  assert.deepEqual(plain(e.triggers.map(t => [t.n, t.h, t.z])), [['ordipilotErinnerungen', 18, 'Europe/Vienna']]);
});
