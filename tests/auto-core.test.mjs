// Unit-Tests für die Automatik (#v616-auto in index.html). Start: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sb = { console };
vm.createContext(sb);
vm.runInContext(html.match(/<script id="v616-auto">([\s\S]*?)<\/script>/)[1], sb);
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
