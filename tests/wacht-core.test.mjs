// Unit-Tests für Automatik-Status und Kontoumsätze (js/v720-wacht.js). Start: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../js/v720-wacht.js', import.meta.url), 'utf8');
const sb = { console };
vm.createContext(sb);
vm.runInContext(code, sb);
const W = sb.OrdiPilotWatchCore;
const plain = v => JSON.parse(JSON.stringify(v));
const NOW = Date.parse('2026-11-03T17:00:00Z');

test('Status: frisch → ok; einzelne Automatik alt → Problem; Datei alt → „meldet sich nicht“', () => {
  const st = {
    updatedAt: '2026-11-03T16:06:00Z',
    components: [
      { key: 'ki', label: 'KI', last: '2026-11-03T16:06:00Z' },
      { key: 'easypark', label: 'EasyPark', last: '2026-11-03T16:56:00Z' },
      { key: 'check', label: 'Prüfung', last: '2026-11-02T17:00:00Z' },
    ],
  };
  assert.equal(W.evaluateStatus(st, NOW).ok, true);
  const old = { ...st, components: st.components.map(c => (c.key === 'easypark' ? { ...c, last: '2026-11-02T10:00:00Z' } : c)) };
  const ev = W.evaluateStatus(old, NOW);
  assert.equal(ev.ok, false);
  assert.deepEqual(plain(ev.items.filter(i => !i.ok).map(i => i.key)), ['easypark']);
  const stale = W.evaluateStatus({ ...st, updatedAt: '2026-11-01T16:00:00Z' }, NOW);
  assert.equal(stale.stale, true);
  assert.equal(W.evaluateStatus(null, NOW).known, false);
});

test('George-JSON: Betrag mit Genauigkeit, nur Gutschriften', () => {
  const txt = JSON.stringify([
    {
      booking: '2026-11-02T00:00:00.000+0100',
      partnerName: 'Ordination Dr. Muster',
      amount: { value: 238000, precision: 2, currency: 'EUR' },
      reference: 'Honorarnote 2026-009',
    },
    { booking: '2026-11-02T00:00:00.000+0100', partnerName: 'Billa', amount: { value: -2350, precision: 2 } },
  ]);
  assert.deepEqual(plain(W.parseBank(txt)), [
    { date: '2026-11-02', amount: 2380, partner: 'Ordination Dr. Muster', text: 'Honorarnote 2026-009' },
  ]);
});

test('CSV (Semikolon, deutsches Zahlenformat, Anführungszeichen)', () => {
  const txt =
    '﻿Buchungsdatum;Partnername;Partner IBAN;Betrag;Währung;Buchungs-Info;Zahlungsreferenz\r\n' +
    '02.11.2026;"Muster, Dr. Eva";AT00;"+2.380,00";EUR;Gutschrift;HN 2026-009\r\n' +
    '03.11.2026;Hofer;AT00;-12,50;EUR;Einkauf;\r\n';
  assert.deepEqual(plain(W.parseBank(txt)), [
    { date: '2026-11-02', amount: 2380, partner: 'Muster, Dr. Eva', text: 'Gutschrift HN 2026-009' },
  ]);
  assert.equal(W.parseAmount('1.234,56'), 1234.56);
  assert.equal(W.parseAmount('1234.56'), 1234.56);
  assert.equal(W.parseDate('2.11.26'), '2026-11-02');
});

const open = [
  { key: '2026-09::r1', ym: '2026-09', open: 2380, invoiceNumber: '2026-008', recipientName: 'Dr. Eva Muster' },
  { key: '2026-10::r1', ym: '2026-10', open: 2380, invoiceNumber: '2026-009', recipientName: 'Dr. Eva Muster' },
  { key: '2026-10::r2', ym: '2026-10', open: 1530, invoiceNumber: '2026-010', recipientName: 'Ordination Huber' },
];

test('Zuordnung: Betrag genau, Nummer entscheidet zwischen gleich hohen Honorarnoten', () => {
  const m = W.matchCredits(
    [
      { date: '2026-11-02', amount: 2380, partner: 'Dr. Eva Muster', text: 'HN 2026-009' },
      { date: '2026-11-05', amount: 1530, partner: 'Huber Ordination', text: '' },
    ],
    open
  );
  assert.deepEqual(plain(m.map(x => x.key)), ['2026-10::r1', '2026-10::r2']);
});

test('Zuordnung: mehrdeutig, falscher Betrag oder Buchung vor dem Leistungsmonat → nichts', () => {
  assert.equal(W.matchCredits([{ date: '2026-11-02', amount: 2380, partner: 'Dr. Eva Muster', text: '' }], open).length, 0, 'zwei gleich gute Kandidaten');
  assert.equal(W.matchCredits([{ date: '2026-11-02', amount: 2379.99, partner: '', text: '2026-009' }], open).length, 0);
  assert.equal(W.matchCredits([{ date: '2026-09-30', amount: 1530, partner: 'Huber', text: '' }], open).length, 0);
  // eindeutig über den Betrag allein
  assert.deepEqual(plain(W.matchCredits([{ date: '2026-11-02', amount: 1530, partner: 'X', text: '' }], open).map(x => x.key)), ['2026-10::r2']);
});

test('Gleiche Gutschrift → gleiche ID (kein Doppel-Eintrag beim nächsten Sync)', () => {
  const c = { date: '2026-11-02', amount: 2380, partner: 'Dr. Eva Muster', text: 'HN 2026-009' };
  assert.equal(W.creditId(c), W.creditId({ ...c }));
  assert.notEqual(W.creditId(c), W.creditId({ ...c, amount: 2381 }));
});
