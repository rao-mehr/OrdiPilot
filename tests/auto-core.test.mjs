// Unit-Tests für die Automatik (js/v616-auto.js). Start: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../js/v616-auto.js', import.meta.url), 'utf8');
const sb = { console };
vm.createContext(sb);
vm.runInContext(code, sb);
const A = sb.OrdiPilotAutoCore;
const plain = (v) => JSON.parse(JSON.stringify(v));

test('Protokoll lesen: ISO-Format und deutsches Format, Unbekanntes ignorieren', () => {
  const ev = A.parseLog('2026-10-28T08:47:12+01:00 ankunft\n28.10.2026, 13:05 abfahrt\n# Kommentar\nunsinn\n2026-10-28T16:10:00+01:00 essen');
  assert.deepEqual(plain(ev), [{ date: '2026-10-28', time: '08:47', type: 'arrive' }, { date: '2026-10-28', time: '13:05', type: 'leave' }]);
});

test('Tag zusammenfassen: erste Ankunft, letzte Abfahrt danach', () => {
  const d = A.summarize(A.parseLog('2026-10-28T08:47 ankunft\n2026-10-28T10:00 abfahrt\n2026-10-28T10:20 ankunft\n2026-10-28T13:05 abfahrt'));
  assert.deepEqual(plain(d), [{ date: '2026-10-28', arrive: '08:47', leave: '13:05', fromWork: false }]);
});

test('„ab Arbeit“ nur, wenn die Klinik höchstens 3 h vor der Ankunft verlassen wurde', () => {
  const near = A.summarize(A.parseLog('2026-10-29T13:40 klinik\n2026-10-29T14:20 ankunft\n2026-10-29T18:00 abfahrt'));
  assert.equal(near[0].fromWork, true);
  const far = A.summarize(A.parseLog('2026-10-29T07:00 klinik\n2026-10-29T14:20 ankunft'));
  assert.equal(far[0].fromWork, false);
  const after = A.summarize(A.parseLog('2026-10-29T14:20 ankunft\n2026-10-29T19:00 klinik'));
  assert.equal(after[0].fromWork, false);
});

test('Nur Abfahrt ohne Ankunft ergibt keinen Einsatz', () => {
  assert.equal(A.summarize(A.parseLog('2026-10-30T13:00 abfahrt')).length, 0);
});

test('Zahlungsnachweise: Monat aus dem Dateinamen, Jahr aus dem Ablagedatum', () => {
  const r = A.proofsToMonths([{ name: '2026-12_Zahlungsnachweis_X.pdf', client_modified: '2027-01-09T10:00:00Z' }, { name: 'Notiz.pdf' }]);
  assert.deepEqual(plain(r), [{ ym: '2026-12', paidYear: '2027', file: '2026-12_Zahlungsnachweis_X.pdf' }]);
});

test('Einrichtungstexte (iOS 27): drei Kurzbefehle, drei Automationen, Wörter passen zum Leser', () => {
  const log = '/X/System/Import/standort.txt';
  const T = A.guideTexts(log, 'Ordinationsweg 2, 2100 Korneuburg', 'Spital, Hauptstraße 1, 1220 Wien');
  assert.deepEqual(plain(T.shortcuts.map(s => s.name)), ['OrdiPilot Ankunft', 'OrdiPilot Abfahrt', 'OrdiPilot Klinik']);
  for (const s of T.shortcuts) {
    assert.ok(s.prompt.includes(log) && s.prompt.includes('ISO 8601') && s.prompt.includes(`Wort ${s.word}.`));
    // Was der Kurzbefehl schreibt, muss der Leser verstehen
    const ev = A.parseLog(`2026-10-29T08:00:00+01:00 ${s.word}`);
    assert.equal(ev.length, 1);
  }
  assert.equal(T.automations.length, 3);
  assert.match(T.automations[0].prompt, /bei Ordinationsweg 2, 2100 Korneuburg ankomme.*„OrdiPilot Ankunft“/);
  assert.match(T.automations[1].prompt, /Ordinationsweg 2, 2100 Korneuburg verlasse.*„OrdiPilot Abfahrt“/);
  assert.match(T.automations[2].prompt, /Spital, Hauptstraße 1, 1220 Wien verlasse.*„OrdiPilot Klinik“/);
  assert.match(T.monthEnd, /letzten Tag jedes Monats/);
});

test('Aufenthalte: Testlauf/Vorbeifahrt unter 20 Min. zählt nicht, GPS-Sprünge werden zusammengefasst', () => {
  // Testlauf beim Einrichten der Automation (1 Minute) → kein Dienst
  assert.deepEqual(plain(A.summarize(A.parseLog('2026-10-29T11:51:46+01:00 ankunft\n2026-10-29T11:52:49+01:00 abfahrt'))), []);
  // Testlauf am Vormittag, echter Dienst am Nachmittag → nur der Dienst
  assert.deepEqual(
    plain(A.summarize(A.parseLog('2026-11-03T08:00 ankunft\n2026-11-03T08:01 abfahrt\n2026-11-03T13:58 ankunft\n2026-11-03T18:02 abfahrt'))),
    [{ date: '2026-11-03', arrive: '13:58', leave: '18:02', fromWork: false }]
  );
  // GPS-Sprung: kurz „weg“ und wieder da → ein Aufenthalt ab der ersten Ankunft
  assert.deepEqual(
    plain(A.summarize(A.parseLog('2026-11-03T08:50 ankunft\n2026-11-03T08:55 abfahrt\n2026-11-03T09:02 ankunft\n2026-11-03T12:40 abfahrt'))),
    [{ date: '2026-11-03', arrive: '08:50', leave: '12:40', fromWork: false }]
  );
  // Ankunft ohne Abfahrt (Abfahrt nicht gemeldet) bleibt erhalten
  assert.deepEqual(plain(A.summarize(A.parseLog('2026-11-03T09:00 ankunft'))), [{ date: '2026-11-03', arrive: '09:00', leave: '', fromWork: false }]);
  // „ab Arbeit“ bezieht sich auf die erste echte Ankunft
  assert.equal(A.summarize(A.parseLog('2026-11-03T13:20 klinik\n2026-11-03T13:58 ankunft\n2026-11-03T18:02 abfahrt'))[0].fromWork, true);
});
