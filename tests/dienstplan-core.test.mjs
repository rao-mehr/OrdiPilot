// Unit-Tests für den Dienstplan-Import (js/v730-dienstplan.js). Start: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../js/v730-dienstplan.js', import.meta.url), 'utf8');
const sb = { console };
vm.createContext(sb);
vm.runInContext(code, sb);
const P = sb.OrdiPilotPlanCore;
const plain = v => JSON.parse(JSON.stringify(v));

// Synthetische Plan-Seite: Kopfzeile 01..31, eigene Zeile „Muster“, eine fremde Zeile darunter
function page({ month = 'Dez 26', mine = {}, other = {}, extra = [] } = {}) {
  const days = month.startsWith('Feb') ? 28 : 31;
  const items = [{ str: month, x: 20, w: 30, top: 20 }, ...extra];
  for (let d = 1; d <= days; d++) items.push({ str: String(d).padStart(2, '0'), x: 200 + d * 20, w: 10, top: 40 });
  items.push({ str: 'Muster', x: 20, w: 30, top: 100 }, { str: 'Anderer', x: 20, w: 30, top: 120 });
  for (const [d, c] of Object.entries(mine)) items.push({ str: c, x: 200 + d * 20 + 2, w: 8, top: 100 });
  for (const [d, c] of Object.entries(other)) items.push({ str: c, x: 200 + d * 20 + 2, w: 8, top: 120 });
  return items;
}

test('Parser: Monat, eigene Zeile über den Namen, fremde Zeilen werden ignoriert', () => {
  const r = P.parsePage(page({ mine: { 2: 'S', 3: 'AD', 6: 'WR', 7: 'LO', 25: '#' }, other: { 2: 'HO' } }), 'Muster');
  assert.equal(r.month, '2026-12');
  assert.deepEqual(plain(r.days), { 2: ['S'], 3: ['AD'], 6: ['WR'], 7: ['LO'], 25: ['#'] });
  const e = P.toEntries(r);
  // # erzeugt nichts; AD, WR und Dienste werden gemerkt
  assert.deepEqual(
    plain(e.entries).map(x => x.date.slice(8) + x.code),
    ['02S', '03AD', '06WR', '07LO']
  );
});

test('Parser: Name nur mit Anfang, Groß-/Kleinschreibung egal; fremder oder leerer Name → null', () => {
  const items = page({ mine: { 4: 'HO' } });
  assert.equal(P.parsePage(items, 'muster').days[4][0], 'HO');
  assert.equal(P.parsePage(items, 'Unbekannt'), null);
  assert.equal(P.parsePage(items, ''), null);
  assert.equal(P.parsePage([{ str: 'irgendwas', x: 1, w: 1, top: 1 }], 'Muster'), null);
});

test('Parser: Jänner-Plan, „vorläufig“ wird erkannt, unbekannte Kürzel werden gemeldet', () => {
  const items = page({
    month: 'Jän 27',
    mine: { 1: 'OA', 4: 'U', 6: 'XY', 19: 'A4' },
    extra: [{ str: 'VORLÄUFIG', x: 5, w: 30, top: 5 }],
  });
  assert.equal(P.detectMonth(items), '2027-01');
  assert.equal(P.isPreliminary(items), true);
  assert.equal(P.isPreliminary(page()), false);
  const e = P.toEntries(P.parsePage(items, 'Muster'));
  assert.deepEqual(plain(e.unknown), ['XY']);
  assert.deepEqual(
    plain(e.entries).map(x => x.date.slice(8) + x.code),
    ['01OA', '04U', '19A4']
  );
});

test('Vergleich: bereits Vorhandenes bleibt, Nachtrag wird ergänzt, Entfallenes wird entfernt', () => {
  const stored = [
    { date: '2026-12-02', code: 'S' },
    { date: '2026-12-07', code: 'LO' },
  ];
  const incoming = [
    { date: '2026-12-02', code: 'S' },
    { date: '2026-12-11', code: 'OA' },
  ];
  const d = P.diffMonth(stored, incoming);
  assert.deepEqual(plain(d.same), [{ date: '2026-12-02', code: 'S' }]);
  assert.deepEqual(plain(d.add), [{ date: '2026-12-11', code: 'OA' }]);
  assert.deepEqual(plain(d.drop), [{ date: '2026-12-07', code: 'LO' }]);
  const again = P.diffMonth(incoming, incoming);
  assert.deepEqual([again.add.length, again.drop.length, again.same.length], [0, 0, 2]);
  assert.equal(P.diffMonth(undefined, incoming).add.length, 2);
});

test('Kalender: nur Dienste und Urlaub, feste Titel wie DienstSaldo, ganztägig am Dienstbeginn, nur Änderungen schreiben', () => {
  const plan = {
    '2026-12': [
      { date: '2026-12-02', code: 'S' },
      { date: '2026-12-03', code: 'AD' },
      { date: '2026-12-06', code: 'WR' },
      { date: '2026-12-07', code: 'LO' },
      { date: '2026-12-22', code: 'U' },
      { date: '2026-12-25', code: 'C' },
    ],
  };
  const p = P.calendarPlan(plan, {});
  assert.deepEqual(
    plain(p.put).map(x => [x.date, x.summary, x.allDay]),
    [
      ['2026-12-02', '25 Stunden Dienst (Schockdienst)', true],
      ['2026-12-07', 'Langer Dienst (LO)', true],
      ['2026-12-22', 'Urlaub Raouf', true],
    ]
  );
  assert.equal(p.del.length, 0);
  // gleicher Stand → nichts zu tun
  const same = P.calendarPlan(plan, p.next);
  assert.deepEqual([same.put.length, same.del.length], [0, 0]);
  // Nachtrag → nur der Nachtrag
  plan['2026-12'].push({ date: '2026-12-11', code: 'OA' });
  const add = P.calendarPlan(plan, p.next);
  assert.deepEqual(
    plain(add.put).map(x => x.summary),
    ['25 Stunden Dienst (Oberarztdienst)']
  );
  // Dienst entfällt → Löschung mit Datum + Titel (damit der Dienst auch bei fremder Kalender-UID gefunden wird)
  plan['2026-12'] = plan['2026-12'].filter(e => e.code !== 'LO');
  const del = P.calendarPlan(plan, add.next);
  assert.deepEqual(
    plain(del.del).map(x => [x.date, x.summary]),
    [['2026-12-07', 'Langer Dienst (LO)']]
  );
  assert.equal(del.put.length, 0);
});

test('Kalendertitel sind identisch mit DienstSaldo', () => {
  assert.deepEqual(plain(P.TITLES), {
    HO: '25 Stunden Dienst (Hauptdienst Orthopädie)',
    S: '25 Stunden Dienst (Schockdienst)',
    HT: '25 Stunden Dienst (Hauptdienst Trauma)',
    OA: '25 Stunden Dienst (Oberarztdienst)',
    A1: '25 Stunden Dienst (Ambulanzdienst A1)',
    A2: '25 Stunden Dienst (Ambulanzdienst A2)',
    A4: 'Langer Dienst (A4)',
    LT: 'Langer Dienst (LT)',
    LO: 'Langer Dienst (LO)',
    U: 'Urlaub Raouf',
  });
});

test('Hinweis beim Planen: Dienst, Urlaub und frei nach Dienst', () => {
  const plan = {
    '2026-12': [
      { date: '2026-12-02', code: 'S' },
      { date: '2026-12-03', code: 'AD' },
      { date: '2026-12-06', code: 'WR' },
    ],
  };
  const a = P.dayInfo(plan, '2026-12-02');
  assert.equal(a.busy, true);
  assert.match(a.text, /Schockdienst/);
  const b = P.dayInfo(plan, '2026-12-03');
  assert.equal(b.busy, false);
  assert.match(b.text, /Außer Dienst/);
  assert.equal(P.dayInfo(plan, '2026-12-09').text, '');
  assert.equal(P.dayInfo({}, '2027-02-01').text, '');
});

test('Handänderung: Dienst eintragen, ändern, entfernen – Kalender bekommt genau die Differenz', () => {
  let plan = { '2027-01': [{ date: '2027-01-13', code: 'HO' }] };
  const w = { ...P.calendarPlan(plan, {}).next }; // alles geschrieben
  // eintragen
  plan = P.addEntry(plan, '2027-01-17', 'S');
  assert.deepEqual(plain(plan['2027-01'][1]), { date: '2027-01-17', code: 'S', m: 1 });
  let c = P.calendarPlan(plan, w);
  assert.equal(c.put.length, 1);
  assert.equal(c.put[0].summary, '25 Stunden Dienst (Schockdienst)');
  assert.equal(c.del.length, 0);
  // schon vorhanden: nichts ändern
  assert.equal(P.addEntry(plan, '2027-01-17', 'S'), plan);
  // ändern: HO → OA = altes löschen, neues schreiben
  const changed = P.replaceEntry(plan, '2027-01-13', 'HO', 'OA');
  c = P.calendarPlan(changed, w);
  assert.deepEqual(plain(c.del.map(d => d.summary)), ['25 Stunden Dienst (Hauptdienst Orthopädie)']);
  assert.ok(c.put.some(e => e.summary === '25 Stunden Dienst (Oberarztdienst)' && e.date === '2027-01-13'));
  // entfernen eines Plan-Eintrags: Merker x, Kalender löscht
  const removed = P.removeEntry(plan, '2027-01-13', 'HO');
  assert.ok(removed['2027-01'].some(e => e.code === 'HO' && e.x));
  assert.equal(P.dayInfo(removed, '2027-01-13').codes.length, 0);
  assert.equal(P.calendarPlan(removed, w).del.length, 1);
  // entfernen eines von Hand eingetragenen Dienstes: verschwindet ganz
  assert.equal(P.removeEntry(plan, '2027-01-17', 'S')['2027-01'].length, 1);
  // ungültige Eingaben ändern nichts
  assert.equal(P.addEntry(plan, '2027-01-18', 'WR'), plan);
  assert.equal(P.addEntry(plan, 'kaputt', 'S'), plan);
  assert.equal(P.removeEntry(plan, '2027-01-20', 'LT'), plan);
});

test('Handänderung bleibt beim erneuten PDF-Import erhalten', () => {
  let plan = {
    '2027-01': [
      { date: '2027-01-13', code: 'HO' },
      { date: '2027-01-19', code: 'A4' },
    ],
  };
  plan = P.removeEntry(plan, '2027-01-13', 'HO'); // von Hand entfernt
  plan = P.addEntry(plan, '2027-01-17', 'S'); // von Hand ergänzt
  const incoming = [
    { date: '2027-01-13', code: 'HO' },
    { date: '2027-01-19', code: 'A4' },
  ];
  const d = P.diffMonth(plan['2027-01'], incoming);
  assert.equal(d.add.length, 0, 'entfernter Dienst wird nicht wieder angelegt');
  assert.equal(d.drop.length, 0, 'von Hand Ergänztes wird nicht entfernt');
  assert.deepEqual(plain(d.same.map(e => e.code)), ['A4']);
  const merged = P.mergeMonth(plan['2027-01'], incoming);
  assert.deepEqual(plain(merged.map(e => e.code + (e.x ? '!' : '') + (e.m ? '+' : ''))), ['HO!', 'S+', 'A4']);
  // Dienst fällt im neuen Plan weg: Plan-Eintrag entfällt, Handänderung nicht
  const later = P.mergeMonth(plan['2027-01'], [{ date: '2027-01-19', code: 'A4' }]);
  assert.deepEqual(plain(later.map(e => e.code)), ['S', 'A4']);
  const d2 = P.diffMonth([{ date: '2027-01-19', code: 'A4' }], []);
  assert.equal(d2.drop.length, 1);
});

test('Gruppen für die Darstellung', () => {
  assert.equal(P.groupOf('HO'), 'g25');
  assert.equal(P.groupOf('A4'), 'long');
  assert.equal(P.groupOf('U'), 'leave');
  assert.equal(P.groupOf('WR'), 'other');
  assert.ok(P.PICKER.every(c => P.CALENDAR.has(c)));
});

test('Datenschutz: keine Namen aus echten Dienstplänen im Code', () => {
  assert.doesNotMatch(code, /Mehrabi|Mousavi|Donauspital/);
});
