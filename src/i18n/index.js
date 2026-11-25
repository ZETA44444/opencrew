// Languages: the app is written in Spanish and, when English is chosen, every text on screen is swapped for
// its translation in en.json as it is drawn (texts, placeholders, titles). What bots and people write (chat
// messages, files, names, form values) is never touched.
// Adding texts: write them in Spanish as always, then run `node scripts/i18n-extract.mjs` and translate
// the ones listed in src/i18n/missing.json into en.json.
const KEY = 'oc.lang';
export const LANGS = [['es', 'Español'], ['en', 'English']];

export function getLang() {
  let saved = '';
  try { saved = localStorage.getItem(KEY) || ''; } catch { /* private mode */ }
  if (saved === 'es' || saved === 'en') return saved;
  return /^es\b/i.test(navigator.language || 'es') ? 'es' : 'en';
}
export function setLang(lang) {
  try { localStorage.setItem(KEY, lang); } catch { /* private mode */ }
  location.reload();
}

// Places whose text comes from people or bots, not from the app.
const SKIP = '.md, .bubble, .speaker, pre, code, [contenteditable], .notranslate, [data-notranslate]';
const ATTRS = ['placeholder', 'title', 'aria-label'];

let exact = null;
let patterns = [];
const done = new WeakMap(); // node → the English text we put there (to know when React changed it again)

function lookup(raw) {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || !/\p{L}/u.test(text)) return null;
  let out = exact.get(text) ?? (text.endsWith('…') ? exact.get(text.replace(/…$/, ':'))?.replace(/:$/, '…') : undefined);
  if (out === undefined) {
    for (const [re, en] of patterns) {
      const m = re.exec(text);
      if (m) { let i = 1; out = en.replace(/\{\}/g, () => m[i++] ?? ''); break; }
    }
  }
  if (out === undefined) return null;
  const lead = /^\s*/.exec(raw)[0], trail = /\s*$/.exec(raw)[0];
  return lead + out + trail;
}

function translateNode(node) {
  if (node.nodeType === 3) {
    const p = node.parentElement;
    if (!p || p.tagName === 'TEXTAREA' || p.closest(SKIP) || done.get(node) === node.nodeValue) return;
    const t = lookup(node.nodeValue);
    if (t !== null && t !== node.nodeValue) { node.nodeValue = t; done.set(node, t); }
    return;
  }
  if (node.nodeType !== 1 || node.closest(SKIP)) return;
  for (const a of ATTRS) {
    const v = node.getAttribute(a);
    if (v) { const t = lookup(v); if (t !== null && t !== v) node.setAttribute(a, t); }
  }
  for (let c = node.firstChild; c; c = c.nextSibling) translateNode(c);
}

export async function startI18n() {
  const lang = getLang();
  document.documentElement.lang = lang;
  if (lang === 'es') return;
  const { default: en } = await import('./en.json');
  exact = new Map();
  patterns = [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [es, tr] of Object.entries(en)) {
    if (es.includes('{}')) patterns.push([new RegExp(`^${es.split('{}').map(esc).join('(.+?)')}$`, 's'), tr]);
    else exact.set(es, tr);
  }
  translateNode(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') translateNode(m.target);
      else if (m.type === 'attributes') translateNode(m.target);
      else m.addedNodes.forEach(translateNode);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

// Legal pages in the app's language.
const LEGAL = { condiciones: 'terms', privacidad: 'privacy', 'uso-aceptable': 'acceptable-use' };
export const legalUrl = (name) => (getLang() === 'en' ? `./legal/en/${LEGAL[name]}.html` : `./legal/${name}.html`);
