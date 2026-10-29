// Release-Prüfungen: Struktur, Versionen, keine persönlichen Daten. Start: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const index = read('index.html');
// Alle eingebundenen eigenen Dateien (Reihenfolge wie in index.html)
const assets = [...index.matchAll(/(?:src|href)="((?:js|css)\/[^"?]+)\?v=(\d+)"/g)].map((m) => ({ file: m[1], v: m[2] }));
const scripts = assets.filter((a) => a.file.endsWith('.js'));
// Gesamter App-Code wie früher in einer Datei – für die inhaltlichen Prüfungen
const html = index + '\n' + assets.map((a) => read(a.file)).join('\n');
// Für Inhaltsprüfungen: ohne Leerraum und mit einheitlichen Anführungszeichen (unabhängig von der Formatierung)
const flat = html.replace(/\s+/g, '').replace(/'/g, '"');
const sw = read('service-worker.js');
const manifest = JSON.parse(read('manifest.webmanifest'));
const ROOT = '/Ordination & Selbständigkeit/Vertretungsdienste';
const [, MA, MI, PA] = sw.match(/ordipilot-v(\d+)-(\d+)-(\d+)/);
const VERSION = `${MA}.${MI}.${PA}`;

test('Alle Skripte und der Service Worker sind gültiges JavaScript', () => {
  assert.ok(scripts.length >= 10, 'Skripte nicht gefunden');
  for (const a of scripts) new vm.Script(read(a.file), { filename: a.file });
  for (const m of index.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if (!/src=/.test(m[1])) new vm.Script(m[2]);
  new vm.Script(sw);
});

test('Jede eingebundene Datei existiert, hat die aktuelle Version und wird offline gespeichert', () => {
  const swFiles = JSON.parse(sw.match(/const FILES=(\[[\s\S]*?\]);/)[1]);
  assert.equal(sw.match(/const V="(\d+)"/)[1], `${MA}${MI}${PA}`, 'V im Service Worker passt nicht zur Version');
  for (const a of assets) {
    assert.ok(fs.existsSync(new URL('../' + a.file, import.meta.url)), a.file + ' fehlt');
    assert.equal(a.v, `${MA}${MI}${PA}`, a.file + ' hat einen veralteten ?v=');
  }
  assert.deepEqual([...swFiles].sort(), assets.map((a) => a.file).sort(), 'Service Worker muss genau die eingebundenen Dateien speichern');
});

test('Startreihenfolge: boot.js vor allen Modulen, main.js als letztes', () => {
  const own = scripts.map((a) => a.file);
  assert.equal(own[0], 'js/boot.js');
  assert.equal(own[own.length - 1], 'js/main.js');
  // Kein Modul (außer main.js) startet die App selbst
  for (const a of scripts.slice(0, -1)) assert.doesNotMatch(read(a.file), /OrdiPilotBoot\.run\(/, a.file);
});

test('Keine versteckten Überschreibungen: globale Funktionen nur über OrdiPilotExt.extend erweitern', () => {
  const declared = new Map(); // oberste Ebene: function NAME (Spalte 0)
  const assigned = new Map(); // NAME = function … / window.NAME = function …
  for (const a of scripts) {
    const code = read(a.file);
    for (const m of code.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) declared.set(m[1], a.file);
    for (const m of code.matchAll(/^\s*(?:window\.)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>)/gm)) {
      if (!assigned.has(m[1])) assigned.set(m[1], []);
      assigned.get(m[1]).push(a.file);
    }
  }
  const problems = [];
  for (const [name, files] of assigned) {
    if (declared.has(name)) problems.push(`${name}: in ${declared.get(name)} definiert und in ${files.join(', ')} überschrieben`);
    else if (files.length > 1) problems.push(`${name}: mehrfach zugewiesen (${files.join(', ')})`);
  }
  assert.deepEqual(problems, [], 'Statt zu überschreiben: OrdiPilotExt.extend(name, base => …) verwenden');
  assert.ok(flat.includes('OrdiPilotExt.extend("renderInvoice"'), 'Prüfung greift nicht (Muster geändert?)');
});

test('Sicherheitslogik steckt in index.html selbst, nicht im Service Worker', () => {
  assert.ok(scripts.some((a) => a.file === 'js/v612-sync-core.js'));
  assert.ok(scripts.some((a) => a.file === 'js/v612-recipients.js'));
  assert.doesNotMatch(sw, /injectHotfix|\.replace\(\/<\\\/body>/, 'Service Worker darf die Seite nicht verändern');
  assert.ok(!fs.existsSync(new URL('../v6113-hotfix.js', import.meta.url)), 'alter Hotfix soll entfernt sein');
  assert.match(index, /v6113-hotfix\.js ist seit V6\.12 fest eingebaut/, 'Marker gegen Einschleusen durch alte Service Worker fehlt');
});

test('Kein ungeprüfter Upload der Datendatei mehr', () => {
  const calls = [...flat.matchAll(/uploadCloudState\(/g)].length;
  assert.equal(calls, 0, 'der alte ungeprüfte Upload (uploadCloudState) darf nicht zurückkommen');
  assert.doesNotMatch(flat, /mode:"overwrite"[^}]*daten\.json/);
  assert.doesNotMatch(flat, /setTimeout\(syncWithDropbox,/, 'Referenz würde vor dem Laden des Kerns eingefangen');
  assert.doesNotMatch(flat, /onclick=syncWithDropbox/);
});

test('Dropbox-Header werden ASCII-maskiert', () => {
  assert.doesNotMatch(flat, /"?Dropbox-API-Arg"?:JSON\.stringify/);
  assert.match(flat, /"Dropbox-API-Arg":dbxArg\(/, 'Prüfung greift nicht mehr (Schreibweise geändert?)');
});

test('Kanonische Dropbox-Pfade und stabiler Speicher-Schlüssel', () => {
  for (const suffix of ['/System/daten.json', '/System/Import/easypark.json', '/Honorarnoten', '/Parkbelege']) assert.ok(html.includes(ROOT + suffix), suffix);
  assert.ok(flat.includes('"vertretungsabrechnung-v3"'), 'localStorage-Schlüssel darf sich nie ändern');
});

test('Versionen konsistent, PWA-ID unverändert (sonst startet iOS mit leerem Speicher)', () => {
  assert.equal(manifest.id, './ordipilot-v6110');
  assert.ok(manifest.start_url.includes(`v=${MA}${MI}${PA}`), 'start_url passt nicht zur Version');
  assert.ok(html.includes(`Version ${VERSION}`), 'Versionsanzeige passt nicht');
  assert.ok(flat.includes(`constVERSION="${VERSION}"`));
  assert.equal([...html.matchAll(/\?v=(\d+)"/g)].filter((m) => m[1] !== `${MA}${MI}${PA}`).length, 0, 'veraltete ?v= Parameter');
});

test('Keine persönlichen Daten im Repository', () => {
  for (const f of ['easypark.json', 'daten.json']) assert.ok(!fs.existsSync(new URL('../' + f, import.meta.url)), f);
  const files = fs.readdirSync(new URL('..', import.meta.url));
  assert.ok(!files.some((f) => /^backup.*\.json$/i.test(f)));
  assert.doesNotMatch(flat, /"?iban"?:"AT/i);
  assert.doesNotMatch(html, /\bW\d{4,6}[A-Z]\b/, 'Kennzeichen im Code');
});
