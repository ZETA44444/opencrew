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
      'Usa fetch_url para leer páginas. Resume en viñetas y cita siempre las URLs.',
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

function fill(d) {
  d.keys ??= {}; d.bots ??= []; d.messages ??= {}; d.routines ??= []; d.runs ??= [];
  d.artifacts ??= {}; d.settings ??= {};
  d.settings.webReader ??= true;
  return d;
}

let db;
try {
  const raw = localStorage.getItem(KEY);
  db = raw ? fill(JSON.parse(raw)) : seed();
} catch {
  db = seed();
}

let lastSaveError = null;
export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    lastSaveError = null;
  } catch (e) {
    lastSaveError = e;
    console.error('No se pudo guardar en el navegador:', e);
  }
}
save();

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
  if (!includeKeys) copy.keys = {};
  return { app: 'opencrew', version: 1, exportedAt: now(), data: copy };
}

export function importData(json) {
  const data = json?.data;
  if (json?.app !== 'opencrew' || !data?.bots) throw new Error('Este archivo no es una copia de seguridad de OpenCrew');
  const keys = db.keys;
  db = fill(data);
  if (!Object.keys(db.keys).length) db.keys = keys; // keep current keys if the backup has none
  save();
}
