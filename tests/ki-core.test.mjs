// Unit-Tests für die Übernahme der KI-Ausgaben (js/v710-ki-erinnerung.js). Start: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../js/v710-ki-erinnerung.js', import.meta.url), 'utf8');
const sb = { console };
vm.createContext(sb);
vm.runInContext(code, sb);
const K = sb.OrdiPilotKiCore;
const plain = v => JSON.parse(JSON.stringify(v));
const exp = {
  records: [
    { id: 'openai-ABC123', date: '2026-09-03', provider: 'OpenAI / ChatGPT', number: 'ABC123', gross: 23.0 },
    { id: 'anthropic-2358', date: '2026-10-01', provider: 'Anthropic / Claude', number: '2358', gross: 21.6 },
    { id: 'kaputt', date: '3.10.2026', gross: 5 },
    { id: 'null', date: '2026-10-02', gross: 0 },
  ],
};

test('Neue Belege werden mit Standardanteil übernommen, ungültige ignoriert', () => {
  const r = K.mergeKiExpenses(exp, { share: 50, expenses: [{ id: 'x1', amount: 120 }], now: 'T' });
  assert.equal(r.added, 2);
  assert.deepEqual(plain(r.expenses.map(x => x.id)), ['x1', 'ki-openai-ABC123', 'ki-anthropic-2358']);
  const a = r.expenses[1];
  assert.deepEqual(plain(a), {
    id: 'ki-openai-ABC123',
    date: '2026-09-03',
    category: K.CATEGORY,
    note: 'OpenAI / ChatGPT · ABC123',
    amount: 23,
    share: 50,
    source: 'ki',
    updatedAt: 'T',
  });
});

test('Wiederholter Import: keine Duplikate, keine Änderung ohne Grund', () => {
  const first = K.mergeKiExpenses(exp, { share: 50, expenses: [] });
  const again = K.mergeKiExpenses(exp, { share: 50, expenses: first.expenses });
  assert.equal(again.added, 0);
  assert.equal(again.updated, 0);
  assert.equal(again.expenses.length, 2);
});

test('Bewusst entfernte Belege kommen nicht wieder; Handänderung am Anteil bleibt', () => {
  const first = K.mergeKiExpenses(exp, { share: 50, expenses: [] });
  const list = first.expenses.map(x => (x.id === 'ki-anthropic-2358' ? { ...x, share: 80, shareManual: true } : x));
  const r = K.mergeKiExpenses(exp, {
    share: 30,
    expenses: list.filter(x => x.id !== 'ki-openai-ABC123'),
    deleted: { 'ki-openai-ABC123': 'T' },
  });
  assert.equal(r.added, 0);
  assert.equal(r.expenses.length, 1);
  assert.equal(r.expenses[0].share, 80);
});

test('Anteil ändern betrifft nur automatische Belege ohne Handänderung', () => {
  const list = [
    { id: 'a', source: 'ki', share: 50 },
    { id: 'b', source: 'ki', share: 80, shareManual: true },
    { id: 'c', share: 100 },
  ];
  const r = K.applyShare(list, '70', 'T');
  assert.equal(r.changed, 1);
  assert.deepEqual(plain(r.expenses.map(x => x.share)), [70, 80, 100]);
  assert.equal(K.clampShare('150'), 100);
  assert.equal(K.clampShare('abc'), K.DEFAULT_SHARE);
});
