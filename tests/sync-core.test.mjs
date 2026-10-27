// Unit-Tests für den Sync-Kern (#v612-sync-core in index.html). Start: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/<script id="v612-sync-core">([\s\S]*?)<\/script>/);
assert.ok(m, 'Sync-Kern nicht in index.html gefunden');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox);
const C = sandbox.OrdiPilotSyncCore;

// Einfacher, aber realistischer Merge: Vereinigung nach id bzw. key, neuerer Datensatz gewinnt.
const union = (a = [], b = [], key = 'id') => {
  const map = new Map();
  for (const x of [...b, ...a]) { const cur = map.get(x[key]); if (!cur || (x.updatedAt || '') > (cur.updatedAt || '')) map.set(x[key], x); }
  return [...map.values()];
};
const merge = (l, r) => ({
  entries: union(l.entries, r.entries), parkingRecords: union(l.parkingRecords, r.parkingRecords),
  invoices: union(l.invoices, r.invoices, 'key'), deletedEntries: { ...r.deletedEntries, ...l.deletedEntries },
  deletedParking: {}, settings: C.mergeSettings(l.settings, r.settings),
});
const clone = (x) => JSON.parse(JSON.stringify(x));
const st = (ids, settings = {}) => ({ entries: ids.map((id) => ({ id, updatedAt: '2026-10-01' })), parkingRecords: [], invoices: [], deletedEntries: {}, deletedParking: {}, settings });

function harness({ local, cloud, readError, conflictsOnce, confirm = false, failBackup = false }) {
  const h = { state: clone(local), cloud: cloud ? { data: clone(cloud), rev: 'r1' } : null, uploads: [], backups: 0, statuses: [] };
  let conflictPending = !!conflictsOnce;
  h.sync = C.createSync({
    isConnected: () => true, getState: () => h.state, setState: (s) => { h.state = s; }, path: () => '/daten.json',
    readCloud: async () => { if (readError) throw new Error(readError); return h.cloud ? clone(h.cloud) : null; },
    writeCloud: async (_p, data, how) => {
      if (conflictPending) { conflictPending = false; h.cloud = { data: { ...h.cloud.data, entries: [...h.cloud.data.entries, { id: 'other-device', updatedAt: '2026-10-02' }] }, rev: 'r2' }; }
      if (how.create && h.cloud) throw new Error('path/conflict/file');
      if (how.rev && h.cloud && how.rev !== h.cloud.rev) throw new Error('path/conflict/file/');
      h.uploads.push({ data: clone(data), how }); h.cloud = { data: clone(data), rev: 'r' + (h.uploads.length + 10) };
    },
    merge, afterMerge: async () => {}, clone,
    backup: async () => { if (failBackup) throw new Error('x'); h.backups++; },
    confirmCreate: async () => confirm, status: (t, k) => h.statuses.push([t, k]), persist: () => {}, refresh: () => {},
  });
  return h;
}

test('Lesefehler: niemals hochladen (Ursache des Datenverlusts vom 13.10.)', async () => {
  const h = harness({ local: st([]), cloud: st(['a', 'b']), readError: 'HTTP 500' });
  assert.equal(await h.sync(), false);
  assert.equal(h.uploads.length, 0);
});

test('Neues Gerät mit leerem Speicher übernimmt Cloud-Daten, ohne sie zu verkleinern', async () => {
  const h = harness({ local: st([]), cloud: st(['a', 'b']) });
  assert.equal(await h.sync(), true);
  assert.deepEqual(h.uploads[0].data.entries.map((e) => e.id).sort(), ['a', 'b']);
  assert.equal(h.uploads[0].how.rev, 'r1');
});

test('Datei fehlt + leeres Gerät: nichts anlegen', async () => {
  const h = harness({ local: st([]), cloud: null, confirm: true });
  assert.equal(await h.sync(), false);
  assert.equal(h.uploads.length, 0);
});

test('Datei fehlt + Daten auf Gerät: nur nach Bestätigung anlegen', async () => {
  const no = harness({ local: st(['a']), cloud: null, confirm: false });
  assert.equal(await no.sync(), false);
  assert.equal(no.uploads.length, 0);
  const yes = harness({ local: st(['a']), cloud: null, confirm: true });
  assert.equal(await yes.sync(), true);
  assert.equal(yes.uploads[0].how.create, true);
});

test('Gleichzeitige Änderung auf anderem Gerät: neu lesen, nichts verlieren', async () => {
  const h = harness({ local: st(['a', 'local-new']), cloud: st(['a']), conflictsOnce: true });
  assert.equal(await h.sync(), true);
  assert.deepEqual(h.cloud.data.entries.map((e) => e.id).sort(), ['a', 'local-new', 'other-device']);
});

test('Wächter: verschwindet ein Cloud-Datensatz, wird nicht hochgeladen und lokal zurückgesetzt', async () => {
  const h = harness({ local: st(['x']), cloud: st(['a', 'b']) });
  h.sync = C.createSync({ ...Object.fromEntries([]), // eigener Aufbau mit bösartigem Merge
    isConnected: () => true, getState: () => h.state, setState: (s) => { h.state = s; }, path: () => '/d',
    readCloud: async () => clone(h.cloud), writeCloud: async (_p, d) => h.uploads.push(d),
    merge: (l) => l, afterMerge: async () => {}, clone, backup: async () => {}, confirmCreate: async () => false,
    status: () => {}, persist: () => {}, refresh: () => {} });
  assert.equal(await h.sync(), false);
  assert.equal(h.uploads.length, 0);
  assert.deepEqual(h.state.entries.map((e) => e.id), ['x']);
});

test('Bewusste Löschung (Grabstein) ist erlaubt', () => {
  const remote = st(['a', 'b']);
  const merged = { ...st(['a']), deletedEntries: { b: '2026-10-05' } };
  assert.doesNotThrow(() => C.assertNothingLost(remote, merged));
});

test('Tagessicherung vor dem Schreiben; ein Fehler dabei blockiert den Sync nicht', async () => {
  const h = harness({ local: st(['a']), cloud: st(['a']) });
  await h.sync();
  assert.equal(h.backups, 1);
  const f = harness({ local: st(['a']), cloud: st(['a']), failBackup: true });
  assert.equal(await f.sync(), true);
});

test('Aufruf während eines laufenden Syncs: ein Nachlauf, kein paralleler Lauf', async () => {
  const h = harness({ local: st(['a']), cloud: st(['a']) });
  const [x, y] = [h.sync(), h.sync()];
  assert.equal(x, y);
  await x;
  assert.equal(h.uploads.length, 2, 'genau ein Nachlauf');
  await h.sync();
  assert.equal(h.uploads.length, 3);
});

test('Änderung während des Lesens geht nicht verloren', async () => {
  const h = harness({ local: st(['a']), cloud: st(['a', 'b']) });
  const p = h.sync();
  h.state.entries.push({ id: 'während', updatedAt: '2026-10-27' }); // Nutzer tippt, während Dropbox gelesen wird
  await p;
  assert.ok(h.state.entries.some((e) => e.id === 'während'), 'lokal erhalten');
  assert.ok(h.cloud.data.entries.some((e) => e.id === 'während'), 'mit hochgeladen');
});

test('Einstellungen: leerer neuerer Stand überschreibt keine gefüllten Felder (Fehler vom 13.10.)', () => {
  const good = { _updatedAt: '2026-10-13T20:37:51Z', iban: 'AT00 TEST', issuerName: 'Dr. Test', defaultRate: 170 };
  const wiped = { _updatedAt: '2026-10-13T22:11:21Z', iban: '', issuerName: '', defaultRate: 180 };
  const out = C.mergeSettings(wiped, good);
  assert.equal(out.iban, 'AT00 TEST');
  assert.equal(out.issuerName, 'Dr. Test');
  assert.equal(out.defaultRate, 180, 'gefüllte neuere Werte gewinnen weiterhin');
  assert.equal(out._updatedAt, '2026-10-13T22:11:21Z');
});

test('Empfänger werden feldweise zusammengeführt, keiner geht verloren', () => {
  const l = { _updatedAt: '2026-10-20', recipients: [{ id: 'p', name: 'Dr. A', salutation: '' }] };
  const r = { _updatedAt: '2026-10-01', recipients: [{ id: 'p', name: '', salutation: 'Liebe A' }, { id: 'q', name: 'Dr. B' }] };
  const out = C.mergeSettings(l, r);
  assert.deepEqual(out.recipients.map((x) => x.id), ['p', 'q']);
  assert.equal(out.recipients[0].name, 'Dr. A');
  assert.equal(out.recipients[0].salutation, 'Liebe A');
});

test('Reparatur füllt nur leere Rechnungsfelder und den Empfänger mit reinem Titel', () => {
  const s = { issuerName: '', iban: '', defaultRate: 170, activeRecipientId: 'p', recipients: [{ id: 'p', name: 'Dr. med.', address: '' }] };
  assert.equal(C.settingsLookWiped(s), true);
  const filled = C.repairSettingsFrom(s, { issuerName: 'Dr. Test', iban: 'AT00', recipientName: 'Dr. med. X Y', recipientAddress: 'Str. 1', defaultRate: 999 });
  assert.equal(s.iban, 'AT00');
  assert.equal(s.recipients[0].name, 'Dr. med. X Y');
  assert.equal(s.recipients[0].address, 'Str. 1');
  assert.equal(s.defaultRate, 170);
  assert.ok(filled.includes('iban'));
});

test('Honorarnoten-Schlüsselmigration (2026-09 -> 2026-09::Empfänger) gilt nicht als Verlust', () => {
  const remote = { ...st([]), invoices: [{ key: '2026-09' }] };
  assert.doesNotThrow(() => C.assertNothingLost(remote, { ...st([]), invoices: [{ key: '2026-09::recipient-primary' }] }));
  assert.throws(() => C.assertNothingLost(remote, { ...st([]), invoices: [{ key: '2026-10::recipient-primary' }] }), /INVOICES/);
});

test('Reparatur auch bei unvollständigem Empfänger (nur Titel), Backup mit vollem Namen wird gewählt', () => {
  const s = { issuerName: 'Dr. Test', iban: 'AT00', activeRecipientId: 'p', recipients: [{ id: 'p', name: 'Dr. med.', address: '' }] };
  assert.equal(C.settingsNeedRepair(s), true);
  assert.equal(C.backupUsable({ issuerName: 'x', iban: 'y', recipientName: 'Dr. med.' }), false);
  assert.equal(C.backupUsable({ issuerName: 'x', iban: 'y', recipientName: 'Dr. med. Erika Muster' }), true);
  C.repairSettingsFrom(s, { recipientName: 'Dr. med. Erika Muster', recipientAddress: 'Weg 1' });
  assert.equal(s.recipients[0].name, 'Dr. med. Erika Muster');
  assert.equal(C.settingsNeedRepair(s), false);
});

test('Doppelte Honorarnoten nach Schlüsselmigration werden zusammengefasst', () => {
  const out = C.dedupeInvoices([{ key: 'k', number: '1', updatedAt: '2026-10-01' }, { key: 'k', signedAt: '2026-10-05' }, { key: 'j' }]);
  assert.equal(out.length, 2);
  assert.equal(out.find((x) => x.key === 'k').number, '1');
  assert.equal(out.find((x) => x.key === 'k').signedAt, '2026-10-05');
});

test('Zahlungen und Fahrten: Wächter erkennt Verlust, erlaubt bewusste Löschung', () => {
  const remote = { ...st([]), payments: [{ id: 'p1' }], trips: [{ id: 't1' }] };
  assert.throws(() => C.assertNothingLost(remote, { ...st([]), payments: [], trips: [{ id: 't1' }] }), /PAYMENTS/);
  assert.throws(() => C.assertNothingLost(remote, { ...st([]), payments: [{ id: 'p1' }], trips: [] }), /TRIPS/);
  assert.doesNotThrow(() => C.assertNothingLost(remote, { ...st([]), payments: [], deletedPayments: { p1: 'x' }, trips: [], deletedTrips: { t1: 'x' } }));
});
