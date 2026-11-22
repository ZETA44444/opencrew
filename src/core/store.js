// Local database stored in the browser (localStorage). Nothing leaves your machine
// except the calls each bot makes to the AI provider you chose for it.
const KEY = 'opencrew.db.v1';

export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
export const now = () => new Date().toISOString();

function seed() {
  const bot = (name, title, description, instructions, color, shape, starred = false) => ({
    id: newId(), name, title, description, instructions, color, shape,
    provider: 'demo', model: 'demo', memory: [], starred, createdAt: now(),
  });
  const bots = [
    bot('Atlas', 'Jefe de gabinete',
      'Coordina al equipo. Recibe cualquier encargo, lo divide y lo delega al bot adecuado.',
      'Si una tarea encaja mejor con otro bot del equipo, delégala con delegate_to_bot y luego resume el resultado para el usuario.',
      '#e5e5e5', 'diamond', true),
    bot('Nova', 'Investigadora',
      'Busca y resume información de páginas web. Da fuentes.',
      'Usa web_search para buscar y fetch_url para leer páginas. Resume en viñetas y cita siempre las URLs.',
      '#7dd3fc', 'circle'),
    bot('Quill', 'Redactor',
      'Escribe posts, correos y textos con buen estilo.',
      'Escribe claro y directo. Si te piden un documento, guárdalo con write_artifact.',
      '#fca5a5', 'square'),
    bot('Byte', 'Programador',
      'Escribe y revisa código, scripts y explica errores técnicos.',
      'Da código completo y funcional. Guarda los archivos largos con write_artifact.',
      '#86efac', 'hexagon'),
  ];
  return fill({ bots });
}

// The Tesorero bot comes with every profile: it watches spending, limits and provider quotas.
export const TREASURER_BOT = {
  name: 'Tesorero', title: 'Gestor de cuotas y gasto', role: 'treasurer', color: '#86efac', shape: 'diamond',
  description: 'Vigila cuánto gasta cada bot y cada modelo, los límites y las cuotas de tus proveedores de IA, y recomienda cómo gastar menos.',
  instructions: 'Usa usage_report para el gasto y provider_status para claves, cuotas y modelos que fallan. Da cifras concretas y recomendaciones prácticas (p. ej. qué bot pasar a un modelo más barato o qué límite poner). Si te piden cambiar un límite usa set_bot_limit. Recuerda que los costes son estimados.',
};

function fill(d) {
  d.keys ??= {}; d.bots ??= []; d.messages ??= {}; d.routines ??= []; d.runs ??= [];
  d.artifacts ??= {}; d.settings ??= {}; d.groups ??= []; d.skills ??= []; d.connectors ??= []; d.projects ??= [];
  d.settings.webReader ??= true;
  d.settings.proactive ??= true;
  d.settings.notifications ??= { routines: true, replies: true };
  d.settings.approvals ??= { enabled: true, always: {} };
  if (!d.settings.treasurerAdded) {
    d.settings.treasurerAdded = true;
    if (!d.bots.some((b) => b.role === 'treasurer')) {
      const name = d.bots.some((b) => b.name === 'Tesorero') ? 'Tesorería' : 'Tesorero';
      d.bots.push({ id: newId(), ...TREASURER_BOT, name, provider: 'demo', model: 'demo', memory: [], starred: false, createdAt: now() });
    }
  }
  return d;
}

// ---------- persistence: IndexedDB (no 5 MB limit), with migration from the old localStorage copy ----------
// ?perfil=nombre opens a separate, independent set of bots and data (handy for testing).
const PROFILE = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('perfil') || '').replace(/[^\w-]/g, '');
const IDB_NAME = PROFILE ? `opencrew-${PROFILE}` : 'opencrew';
const IDB_STORE = 'kv';
const IDB_KEY = 'db';

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb(mode, fn) {
  return idbHandle.then((h) => new Promise((resolve, reject) => {
    const tx = h.transaction(IDB_STORE, mode);
    const req = fn(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

let idbHandle;
let db;
let storage = 'indexeddb';

// Resolves once the data is loaded. main.jsx waits for it before rendering.
export const ready = (async () => {
  try {
    idbHandle = openIdb();
    const stored = await idb('readonly', (st) => st.get(IDB_KEY));
    if (stored) db = fill(stored);
    else {
      let legacy = null;
      if (!PROFILE) try { legacy = localStorage.getItem(KEY); } catch { /* ignore */ }
      db = legacy ? fill(JSON.parse(legacy)) : seed();
      await idb('readwrite', (st) => st.put(db, IDB_KEY));
      if (legacy) try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    }
    navigator.storage?.persist?.().catch(() => {}); // ask the browser not to evict our data
  } catch (e) {
    // Private windows / blocked storage: fall back to localStorage.
    console.warn('IndexedDB no disponible, uso localStorage:', e);
    storage = 'localstorage';
    try {
      const raw = localStorage.getItem(KEY);
      db = raw ? fill(JSON.parse(raw)) : seed();
    } catch { db = seed(); }
  }
})();

let lastSaveError = null;
let timer = null;
let writing = Promise.resolve();

function flush() {
  clearTimeout(timer);
  timer = null;
  if (storage === 'indexeddb') {
    const snapshot = structuredClone(db);
    writing = writing.then(() => idb('readwrite', (st) => st.put(snapshot, IDB_KEY)))
      .then(() => { lastSaveError = null; })
      .catch((e) => { lastSaveError = e; console.error('No se pudo guardar:', e); });
    return writing;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    lastSaveError = null;
  } catch (e) {
    lastSaveError = e;
    console.error('No se pudo guardar en el navegador:', e);
  }
  return Promise.resolve();
}

// Writes are batched (many changes in a row become one write).
export function save() {
  if (!timer) timer = setTimeout(flush, 120);
}
export const saveNow = () => flush();

if (typeof window !== 'undefined') {
  // Don't lose the last changes if the tab is closed right after a change.
  window.addEventListener('pagehide', () => { if (timer) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer) flush(); });
}

export const storageKind = () => storage;
export async function storageUsage() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  return est ? { used: est.usage, quota: est.quota } : null;
}

export const saveError = () => lastSaveError;
export const getDb = () => db;
export const getBot = (id) => db.bots.find((b) => b.id === id);
export const findBotByName = (name) => {
  const n = String(name || '').trim().toLowerCase().replace(/^@/, '');
  return db.bots.find((b) => b.name.toLowerCase() === n) ||
    db.bots.find((b) => b.name.toLowerCase().startsWith(n) || n.startsWith(b.name.toLowerCase()));
};
export const messagesOf = (botId) => (db.messages[botId] ??= []);

// Backup: everything except API keys unless asked.
export function exportData({ includeKeys = false } = {}) {
  const copy = JSON.parse(JSON.stringify(db));
  if (!includeKeys) {
    copy.keys = {};
    for (const c of copy.connectors || []) c.token = '';
  }
  return { app: 'opencrew', version: 1, exportedAt: now(), data: copy };
}

export async function importData(json) {
  const data = json?.data;
  if (json?.app !== 'opencrew' || !data?.bots) throw new Error('Este archivo no es una copia de seguridad de OpenCrew');
  const keys = db.keys;
  db = fill(data);
  if (!Object.keys(db.keys).length) db.keys = keys; // keep current keys if the backup has none
  return flush();
}
