// Unit-Tests für den Steuer-Kern (#v614-tax in index.html). Start: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Werte aus dem VM-Kontext in normale Objekte überführen (deepEqual prüft sonst die Prototypen)
const plain = (v) => JSON.parse(JSON.stringify(v));

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = html.match(/<script id="v614-tax">([\s\S]*?)<\/script>/)[1];
const sb = { console };
vm.createContext(sb);
vm.runInContext(src, sb);
const T = sb.OrdiPilotTaxCore;

const rec = { id: 'r1', name: 'Dr. Muster', address: 'Weg 1\n2100 Korneuburg', travelKm: 23 };
const e = (id, date, h = 6, extra = {}) => ({ id, date, h, recipientId: 'r1', ...extra });
const fns = { isEarned: (x) => !x.planned, hours: (x) => x.h, gross: (x) => x.h * 170 };
const base = (over = {}) => ({
  year: 2026, fns, invoices: [], payments: [], trips: [], parking: [],
  settings: { recipients: [rec], travelHome: 'Wien', travelRate: 0.5 },
  entries: [e('a', '2026-09-03'), e('b', '2026-09-10'), e('c', '2026-12-15'), e('d', '2026-11-20', 6, { planned: true })], ...over,
});

test('Leistungen je Monat, geplante Einsätze zählen nicht', () => {
  const r = T.yearReport(base());
  assert.deepEqual(plain(r.servicesY.map((x) => [x.ym, x.gross, x.count])), [['2026-09', 2040, 2], ['2026-12', 1020, 1]]);
  assert.equal(r.totals.services, 3060);
  assert.equal(r.totals.income, 0);
  assert.equal(r.totals.open, 3060);
});

test('Zuflussprinzip: Dezember-Honorar, bezahlt im Jänner, zählt im Folgejahr', () => {
  const payments = [{ id: 'p1', key: '2026-09::r1', paidAt: '2026-10-03', amount: 2040 }, { id: 'p2', key: '2026-12::r1', paidAt: '2027-01-08', amount: 1020 }];
  const r26 = T.yearReport(base({ payments }));
  assert.equal(r26.totals.income, 2040);
  assert.equal(r26.servicesY.find((x) => x.ym === '2026-12').status, 'bezahlt');
  const r27 = T.yearReport(base({ payments, year: 2027 }));
  assert.equal(r27.totals.income, 1020);
  assert.equal(r27.services.length, 1, 'Dezember 2026 erscheint 2027 als Zahlung');
  assert.equal(r27.totals.services, 0, 'aber nicht als Leistung 2027');
});

test('Zahlung ohne genaues Datum zählt im angegebenen Jahr', () => {
  const r = T.yearReport(base({ payments: [{ id: 'p', key: '2026-09::r1', paidYear: '2026', amount: 2040 }] }));
  assert.equal(r.totals.income, 2040);
  assert.match(T.csvFiles(r)['Einnahmen_2026.csv'], /nicht erfasst/);
});

test('Teilzahlung', () => {
  const r = T.yearReport(base({ payments: [{ id: 'p', key: '2026-09::r1', paidAt: '2026-10-01', amount: 1000 }] }));
  const sep = r.servicesY[0];
  assert.equal(sep.status, 'teilweise');
  assert.equal(sep.open, 1040);
});

test('Fahrten: Hin- und Rückfahrt, Abweichungen pro Einsatz, kein Auto', () => {
  const trips = [{ id: 'trip-b', entryId: 'b', mode: 'none' }, { id: 'trip-c', entryId: 'c', mode: 'car', km: 60 }];
  const r = T.yearReport(base({ trips, parking: [{ id: 'x', date: '2026-09-03', amount: 4.14, entryId: 'a' }] }));
  assert.deepEqual(plain(r.carTrips.map((t) => [t.entryId, t.km, t.amount, t.hasParking])), [['a', 46, 23, true], ['c', 60, 30, false]]);
  assert.equal(r.totals.trips, 53);
  assert.equal(r.totals.tripKm, 106);
  assert.equal(r.tripsWithoutParking, 1);
  assert.equal(r.carTrips[0].from, 'Wien');
  assert.equal(r.carTrips[0].via, 'Dr. Muster, Weg 1');
  assert.equal(r.carTrips[0].to, 'Wien');
});

test('Ohne Entfernung: Fahrt unbekannt, Empfänger als fehlend gemeldet', () => {
  const r = T.yearReport(base({ settings: { recipients: [{ ...rec, travelKm: '' }] } }));
  assert.equal(r.carTrips.length, 0);
  assert.equal(r.missingKm.length, 1);
  assert.equal(r.trips[0].missing, 'home');
  assert.equal(r.rate, 0.5, 'Standardsatz 0,50 €/km');
});

test('Parkkosten nur im Jahr, ausgeschlossene nicht', () => {
  const parking = [{ id: 1, date: '2026-09-03', amount: 4.14, entryId: 'a' }, { id: 2, date: '2026-09-04', amount: 3.1, excluded: true, entryId: 'a' }, { id: 3, date: '2025-12-01', amount: 9, entryId: 'a' }, { id: 4, date: '2026-06-22', amount: 2.55 }];
  const r = T.yearReport(base({ parking }));
  assert.equal(r.totals.parking, 4.14);
  assert.equal(r.parkingUnassigned.length, 1, 'Parkvorgang ohne Einsatz wird nicht abgezogen');
  assert.equal(r.totals.surplus, -(4.14 + r.totals.trips));
});

test('CSV: BOM, Semikolon, Dezimalkomma, Quoting', () => {
  const out = T.csv([['a;b', 'x"y', 1234.5, null]]);
  assert.ok(out.startsWith('﻿'));
  assert.equal(out.slice(1).trim(), '"a;b";"x""y";1234,50;');
  const files = T.csvFiles(T.yearReport(base()));
  assert.deepEqual(plain(Object.keys(files).sort()), ['Einnahmen_2026.csv', 'Fahrten_2026.csv', 'Leistungen_2026.csv', 'Parkkosten_2026.csv']);
  assert.match(files['Fahrten_2026.csv'], /Ärztliche Vertretung – Dr. Muster;46,00;0,50;23,00/);
});

test('Fahrt ab Arbeitsplatz: Arbeit → Ordination → Wohnung', () => {
  const settings = { recipients: [{ ...rec, travelKmWork: 25 }], travelHome: 'Wohnung 5', travelWork: 'Klinik 22', travelRate: 0.5 };
  const trips = [{ id: 'trip-a', entryId: 'a', mode: 'work' }];
  const r = T.yearReport(base({ settings, trips }));
  const a = r.carTrips.find((t) => t.entryId === 'a');
  assert.equal(a.km, 48, '25 km Arbeit→Ordination + 23 km Ordination→Wohnung');
  assert.equal(a.from, 'Klinik 22');
  assert.equal(a.to, 'Wohnung 5');
  assert.equal(a.route, 'Arbeitsplatz → Ordination → Wohnung');
  assert.equal(r.fromWork, 1);
  assert.equal(r.fromHome, 2);
  assert.match(T.csvFiles(r)['Fahrten_2026.csv'], /Arbeitsplatz → Ordination → Wohnung;Klinik 22;Dr. Muster, Weg 1;Wohnung 5;.*;48,00;0,50;24,00;nein/);
});

test('Standard-Start Arbeitsplatz gilt für alle Fahrten ohne eigene Angabe', () => {
  const settings = { recipients: [{ ...rec, travelKmWork: 25 }], travelDefaultStart: 'work', travelRate: 0.5 };
  const r = T.yearReport(base({ settings, trips: [{ id: 'trip-b', entryId: 'b', mode: 'car' }] }));
  assert.deepEqual(plain(r.trips.map((t) => [t.entryId, t.mode, t.km])), [['a', 'work', 48], ['b', 'car', 46], ['c', 'work', 48]]);
});

test('Fehlt die Entfernung ab Arbeit, wird das gemeldet statt falsch gerechnet', () => {
  const settings = { recipients: [rec], travelDefaultStart: 'work' };
  const r = T.yearReport(base({ settings }));
  assert.equal(r.carTrips.length, 0);
  assert.equal(r.missingWorkKm.length, 1);
  assert.equal(r.trips[0].missing, 'work');
});

test('Manuelle Kilometer haben Vorrang und werden gekennzeichnet', () => {
  const r = T.yearReport(base({ trips: [{ id: 'trip-a', entryId: 'a', mode: 'work', km: 51 }] }));
  const a = r.carTrips.find((t) => t.entryId === 'a');
  assert.equal(a.km, 51);
  assert.equal(a.custom, true);
});
