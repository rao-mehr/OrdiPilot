import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
test('V7.5.0: Kalender ist erster Tab und Startseite, Import liegt darunter, Datei ist offline/im Release', () => {
  const html = read('index.html');
  assert.match(html, /data-tab="calendar"/);
  assert.match(html, /<section class="panel active" id="panel-calendar">/);
  assert.match(html, /id="v750Import"/);
  assert.ok(html.indexOf('data-tab="calendar"') < html.indexOf('data-tab="dashboard"'));
  assert.doesNotMatch(html, /<section class="panel active" id="panel-dashboard">/);
  assert.match(read('service-worker.js'), /js\/v750-home\.js/);
  assert.match(html, /js\/v750-home\.js\?v=750/);
});
