// Release-Prüfungen: Struktur, Versionen, keine persönlichen Daten. Start: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = read('index.html');
const sw = read('service-worker.js');
const manifest = JSON.parse(read('manifest.webmanifest'));
const ROOT = '/Ordination & Selbständigkeit/Vertretungsdienste';

test('Alle Inline-Skripte und der Service Worker sind gültiges JavaScript', () => {
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (!/src=/.test(m[1])) new vm.Script(m[2]);
  new vm.Script(sw);
});

test('Sicherheitslogik steckt in index.html selbst, nicht im Service Worker', () => {
  assert.match(html, /<script id="v612-sync-core">/);
  assert.match(html, /<script id="v612-recipients">/);
  assert.doesNotMatch(sw, /injectHotfix|\.replace\(\/<\\\/body>/, 'Service Worker darf die Seite nicht verändern');
  assert.ok(!fs.existsSync(new URL('../v6113-hotfix.js', import.meta.url)), 'alter Hotfix soll entfernt sein');
  assert.match(html, /v6113-hotfix\.js ist seit V6\.12 fest eingebaut/, 'Marker gegen Einschleusen durch alte Service Worker fehlt');
});

test('Kein ungeprüfter Upload der Datendatei mehr', () => {
  const calls = [...html.matchAll(/uploadCloudState\(/g)].length;
  assert.equal(calls, 1, 'uploadCloudState darf nur noch definiert, nicht aufgerufen werden');
  assert.doesNotMatch(html, /mode:"overwrite"[^}]*daten\.json/);
  assert.doesNotMatch(html, /setTimeout\(syncWithDropbox,/, 'Referenz würde vor dem Laden des Kerns eingefangen');
  assert.doesNotMatch(html, /onclick=syncWithDropbox/);
});

test('Dropbox-Header werden ASCII-maskiert', () => {
  assert.doesNotMatch(html, /Dropbox-API-Arg["']\s*:\s*JSON\.stringify/);
});

test('Kanonische Dropbox-Pfade und stabiler Speicher-Schlüssel', () => {
  for (const suffix of ['/System/daten.json', '/System/Import/easypark.json', '/Honorarnoten', '/Parkbelege']) assert.ok(html.includes(ROOT + suffix), suffix);
  assert.ok(html.includes('"vertretungsabrechnung-v3"'), 'localStorage-Schlüssel darf sich nie ändern');
});

test('Versionen konsistent, PWA-ID unverändert (sonst startet iOS mit leerem Speicher)', () => {
  assert.equal(manifest.id, './ordipilot-v6110');
  assert.match(manifest.start_url, /v=6120/);
  assert.match(sw, /ordipilot-v6-12-0/);
  assert.match(html, /Version 6\.12\.0/);
});

test('Keine persönlichen Daten im Repository', () => {
  for (const f of ['easypark.json', 'daten.json']) assert.ok(!fs.existsSync(new URL('../' + f, import.meta.url)), f);
  const files = fs.readdirSync(new URL('..', import.meta.url));
  assert.ok(!files.some((f) => /^backup.*\.json$/i.test(f)));
  assert.doesNotMatch(html, /"iban":"AT/i);
  assert.doesNotMatch(html, /\bW\d{4,6}[A-Z]\b/, 'Kennzeichen im Code');
});
