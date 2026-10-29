// Unit-Tests für Steuer-Rücklage und Vorauszahlungstermine (#v619-reserve). Start: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../js/v619-reserve.js', import.meta.url), 'utf8');
const sb = { console };
vm.createContext(sb);
vm.runInContext(code, sb);
const R = sb.OrdiPilotReserveCore;
const plain = (v) => JSON.parse(JSON.stringify(v));

test('Rücklage: Prozent vom Überschuss, nie negativ, Eingaben robust', () => {
  assert.equal(R.reserve(10000, 45), 4500);
  assert.equal(R.reserve(10000, '42,5'), 4250);
  assert.equal(R.reserve(-500, 45), 0);
  assert.equal(R.reserve(10000, ''), 0);
  assert.equal(R.reserve(10000, 'abc'), 0);
  assert.equal(R.pct(150), 100);
});

test('Vorauszahlung: Hinweis 14 Tage vorher, bis 10 Tage danach, erledigt blendet aus', () => {
  assert.equal(R.dueSoon('2026-10-31', ''), null);
  assert.deepEqual(plain(R.dueSoon('2026-11-01', '')), { date: '2026-11-15', inDays: 14 });
  assert.deepEqual(plain(R.dueSoon('2026-11-20', '')), { date: '2026-11-15', inDays: -5 });
  assert.equal(R.dueSoon('2026-11-26', ''), null);
  assert.equal(R.dueSoon('2026-11-10', '2026-08-15,2026-11-15'), null);
  // Jahreswechsel
  assert.deepEqual(plain(R.dueSoon('2027-02-05', '')), { date: '2027-02-15', inDays: 10 });
});
