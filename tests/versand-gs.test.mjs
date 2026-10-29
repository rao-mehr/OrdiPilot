// Tests für Honorarnote_Versand.gs (Apps Script) mit nachgebildeten Google-Diensten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../apps-script/Honorarnote_Versand.gs', import.meta.url), 'utf8');
const ROOT = '/Ordination & Selbständigkeit/Vertretungsdienste/Honorarnoten/';

function env({ token = 'geheim', dropboxStatus = 200 } = {}) {
  const props = new Map(Object.entries({ ORDIPILOT_SEND_TOKEN: token, DROPBOX_APP_KEY: 'k', DROPBOX_APP_SECRET: 's', DROPBOX_REFRESH_TOKEN: 'r' }));
  const sent = []; const fetches = [];
  const blob = { name: '', type: '', setName(n) { this.name = n; return this; }, setContentType(t) { this.type = t; return this; } };
  const sb = {
    console: { log() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    UrlFetchApp: { fetch: (url, opt) => { fetches.push({ url, opt }); if (url.includes('oauth2/token')) return { getResponseCode: () => 200, getContentText: () => '{"access_token":"t"}' }; return { getResponseCode: () => dropboxStatus, getContentText: () => 'err', getBlob: () => blob }; } },
    GmailApp: { sendEmail: (...a) => sent.push(a), getAliases: () => [] },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: () => '20261028', getUuid: () => 'aaaa-bbbb' },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'arzt@example.org' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
  };
  vm.createContext(sb); vm.runInContext(code, sb);
  const post = (obj) => JSON.parse(sb.doPost({ postData: { contents: JSON.stringify(obj) } }).text);
  return { post, sent, fetches, props };
}
const ok = { token: 'geheim', action: 'send', path: ROOT + '2026/2026-10_Honorarnote_X.pdf', to: 'praxis@example.org', subject: 'Honorarnote Oktober 2026', body: 'Text', fileName: '2026-10_Honorarnote_X.pdf' };

test('Ohne gültigen Schlüssel wird nichts gesendet', () => {
  const e = env();
  assert.equal(e.post({ ...ok, token: 'falsch' }).ok, false);
  assert.equal(e.sent.length, 0);
});

test('Verbindungstest liefert das Konto', () => {
  const r = env().post({ token: 'geheim', action: 'ping' });
  assert.equal(r.ok, true); assert.equal(r.account, 'arzt@example.org');
});

test('Sendet die PDF aus Dropbox als Anhang', () => {
  const e = env();
  const r = e.post(ok);
  assert.equal(r.ok, true);
  assert.equal(e.sent.length, 1);
  const [to, subject, body, opts] = e.sent[0];
  assert.equal(to, 'praxis@example.org'); assert.equal(subject, 'Honorarnote Oktober 2026'); assert.equal(body, 'Text');
  assert.equal(opts.attachments[0].name, '2026-10_Honorarnote_X.pdf');
  const dl = e.fetches.find((f) => f.url.includes('/files/download'));
  assert.match(dl.opt.headers['Dropbox-API-Arg'], /^[\x00-\x7f]*$/, 'Header nur ASCII');
  assert.equal(JSON.parse(dl.opt.headers['Dropbox-API-Arg']).path, ok.path);
});

test('Nur PDFs aus dem Ordner Honorarnoten', () => {
  const e = env();
  for (const path of ['/Ordination & Selbständigkeit/Vertretungsdienste/System/daten.json', ROOT + '../System/x.pdf', '/Privat/x.pdf', ROOT + 'x.txt']) assert.equal(e.post({ ...ok, path }).ok, false, path);
  assert.equal(e.sent.length, 0);
});

test('Ungültiger Empfänger oder mehrere Empfänger werden abgelehnt', () => {
  const e = env();
  for (const to of ['', 'keine-adresse', 'a@b.at, c@d.at']) assert.equal(e.post({ ...ok, to }).ok, false, to);
});

test('Tageslimit', () => {
  const e = env(); e.props.set('ORDIPILOT_SENT_20261028', '10');
  assert.equal(e.post(ok).ok, false);
});

test('Datei fehlt in Dropbox → verständlicher Fehler, nichts gesendet', () => {
  const e = env({ dropboxStatus: 409 });
  const r = e.post(ok);
  assert.equal(r.ok, false); assert.match(r.error, /nicht gefunden/); assert.equal(e.sent.length, 0);
});
