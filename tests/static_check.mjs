// Statische Prüfungen über alle App-Skripte (ein gemeinsamer globaler Raum wie im Browser).
// Start: npm install && node tests/static_check.mjs
//  1. keine nicht definierten Namen (Tippfehler, gelöschte Funktionen)
//  2. keine ungenutzten lokalen Funktionen/Variablen und keine ungenutzten globalen Funktionen
//  3. kein Element-Handler (x.onclick = …) wird beim Laden mehrfach gesetzt (der letzte würde die anderen still ersetzen)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { ESLint } from 'eslint';

const R = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(R, 'index.html'), 'utf8');
const files = [...index.matchAll(/src="(js\/[^"?]+)\?v=/g)].map(m => m[1]);
const srcs = files.map(f => fs.readFileSync(path.join(R, f), 'utf8'));
const all = index + '\n' + srcs.join('\n');
const problems = [];

// Bekannte globale Namen: Element-IDs (benannter Zugriff), window.X/X-Zuweisungen, Bibliotheken
const globals = new Set(['PDFLib', 'fontkit']);
for (const m of all.matchAll(/id=\\?["']([A-Za-z_$][\w$]*)\\?["']/g)) globals.add(m[1]);
for (const m of all.matchAll(/\.id\s*=\s*['"]([A-Za-z_$][\w$]*)['"]/g)) globals.add(m[1]);
for (const m of all.matchAll(/^\s*(?:window\.)?([A-Za-z_$][\w$]*)\s*=\s*/gm)) globals.add(m[1]);
for (const m of all.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) globals.add(m[1]);

// 1 + 2a: ESLint über alle Dateien zusammen
const offsets = [];
let code = '';
files.forEach((f, i) => {
  offsets.push({ f, start: code.split('\n').length });
  code += srcs[i] + '\n';
});
const where = l => {
  let cur = offsets[0];
  for (const x of offsets) if (x.start <= l) cur = x;
  return `${cur.f}:${l - cur.start + 1}`;
};
const eslint = new ESLint({
  useEslintrc: false,
  overrideConfig: {
    env: { browser: true, es2022: true },
    parserOptions: { ecmaVersion: 'latest', sourceType: 'script' },
    globals: Object.fromEntries([...globals].map(g => [g, 'writable'])),
    rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }] },
  },
});
const [res] = await eslint.lintText(code);
for (const m of res.messages) problems.push(`${where(m.line)} ${m.message}`);

// 2b: ungenutzte globale Funktionen; 3: mehrfach gesetzte Handler beim Laden
const defs = new Map(),
  refs = new Map(),
  texts = [index],
  handlers = new Map();
const inc = n => refs.set(n, (refs.get(n) || 0) + 1);
files.forEach((f, i) => {
  const ast = acorn.parse(srcs[i], { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  for (const n of ast.body) if (n.type === 'FunctionDeclaration') defs.set(n.id.name, `${f}:${n.loc.start.line}`);
  walk.fullAncestor(ast, (node, _s, anc) => {
    const parent = anc[anc.length - 2];
    if (node.type === 'Identifier') {
      if (parent?.type === 'FunctionDeclaration' && parent.id === node) return;
      if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed && parent.object.name !== 'window') return;
      inc(node.name);
    }
    if (node.type === 'Literal' && typeof node.value === 'string') {
      texts.push(node.value);
      if (/^[A-Za-z_$][\w$]*$/.test(node.value)) inc(node.value);
    }
    if (node.type === 'TemplateElement') texts.push(node.value.raw);
    // Handler-Zuweisung, die beim Laden läuft: kein umschließender Funktionskörper außer IIFE/Start-Block
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && /^on[a-z]+$/.test(node.left.property.name || '') && node.left.object.type === 'Identifier') {
      const fns = anc.filter(a => /Function|Arrow/.test(a.type));
      const loadTime = fns.every(fn => {
        const p = anc[anc.indexOf(fn) - 1];
        const iife = p && p.type === 'CallExpression' && p.callee === fn;
        return iife;
      });
      if (loadTime) {
        const k = `${node.left.object.name}.${node.left.property.name}`;
        if (!handlers.has(k)) handlers.set(k, []);
        handlers.get(k).push(`${f}:${node.loc.start.line}`);
      }
    }
  });
});
const text = texts.join('\n');
for (const [n, w] of defs) if (!refs.get(n) && !new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\s*\\(').test(text)) problems.push(`${w} globale Funktion ${n} wird nirgends verwendet`);
for (const [k, list] of handlers) if (list.length > 1) problems.push(`${k} wird beim Laden mehrfach gesetzt: ${list.join(', ')}`);

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} Problem(e)`);
  process.exit(1);
}
console.log(`Statische Prüfung ✓ (${files.length} Dateien, ${defs.size} globale Funktionen)`);
