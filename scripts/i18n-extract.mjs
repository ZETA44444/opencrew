// Collects every Spanish text the app shows (JSX text, labels, messages) so it can be translated in src/i18n/en.json.
// Usage: node scripts/i18n-extract.mjs → prints the texts still missing a translation (and writes src/i18n/missing.json).
import { parseSync } from 'rolldown/experimental';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const files = ['src/App.jsx', 'src/dialog.jsx', 'src/templates.js', 'src/uimode.js', 'src/core/errors.js', 'src/core/store.js',
  ...readdirSync('src/components').filter((f) => f.endsWith('.jsx')).map((f) => `src/components/${f}`)];
const SKIP_ATTR = new Set(['className', 'key', 'type', 'href', 'src', 'id', 'rel', 'target', 'role', 'accept', 'autoComplete', 'name', 'value', 'htmlFor', 'style', 'lang', 'mode', 'method', 'inputMode', 'sandbox', 'allow', 'referrerPolicy', 'download', 'color', 'icon']);
const human = (s) => /\p{L}/u.test(s) && !/^(https?:|\.\/|\/|#|[a-z]+:\/\/)/.test(s) && !/^[a-z0-9_.:/-]+$/.test(s) && !/^[A-Z0-9_]+$/.test(s) && !/^[\w-]+\.(js|jsx|json|css|png|jpg|svg|md)$/.test(s);
const texts = new Set(), patterns = new Set();
const norm = (s) => s.replace(/\s+/g, ' ').trim();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const { program } = parseSync(f, src, { lang: f.endsWith('.jsx') ? 'jsx' : 'js' });
  const walk = (n, parent, key) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach((c) => walk(c, parent, key)); return; }
    if (n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration') return;
    if (n.type === 'JSXAttribute' && SKIP_ATTR.has(n.name?.name)) return;
    if (n.type === 'Property' && key === 'properties') { if (n.computed) walk(n.key, n, 'key'); walk(n.value, n, 'value'); return; }
    if (n.type === 'JSXText') { const t = norm(n.value); if (t && /\p{L}/u.test(t) && !/^[A-Z0-9_]+$/.test(t)) texts.add(t); }
    else if (n.type === 'Literal' && typeof n.value === 'string') {
      if (parent?.type === 'BinaryExpression' || parent?.type === 'SwitchCase') return;
      if (parent?.type === 'CallExpression' && /^(querySelector|getElementById|addEventListener|removeEventListener|getItem|setItem|removeItem|startsWith|includes|endsWith|split|replace|match|test|get|has|set|delete|closest)$/.test(parent.callee?.property?.name || '')) return;
      const t = norm(n.value); if (t && human(t) && (t.includes(' ') || /[^\x00-\x7f]/.test(t) || /^[A-ZÁÉÍÓÚ¿¡]/.test(t))) texts.add(t);
    } else if (n.type === 'TemplateLiteral') {
      if (parent?.type === 'JSXAttribute' && parent.name?.name === 'className') return;
      const q = n.quasis.map((x) => x.value.cooked);
      if (q.join('').match(/\p{L}{3,}.*\s/u) && !/^[a-z0-9_ -]*$/.test(q.join(''))) {
        if (n.expressions.length) patterns.add(q.map((x) => x.replace(/\s+/g, ' ')).join('{}').trim());
        else { const t = norm(q[0]); if (human(t)) texts.add(t); }
      }
    }
    for (const [k, v] of Object.entries(n)) if (k !== 'type' && v && typeof v === 'object') walk(v, n, k);
  };
  walk(program.body, null, 'body');
}
const en = existsSync('src/i18n/en.json') ? JSON.parse(readFileSync('src/i18n/en.json', 'utf8')) : {};
const missing = [...texts, ...[...patterns].map((p) => p)].filter((t) => !(t in en) && !/^[{}\s\p{P}\p{S}\d]*$/u.test(t.replace(/\{\}/g, '')));
writeFileSync('src/i18n/missing.json', JSON.stringify(missing, null, 1));
console.log(`textos: ${texts.size} · patrones: ${patterns.size} · sin traducir: ${missing.length}`);
