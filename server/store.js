// Tiny JSON-file database. Everything lives in data/db.json (git-ignored).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

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
  return { keys: {}, bots, messages: {}, routines: [], runs: [] };
}

let db;
if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db.keys ??= {}; db.bots ??= []; db.messages ??= {}; db.routines ??= []; db.runs ??= [];
} else {
  db = seed();
}

export function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
save();

export const getDb = () => db;
export const getBot = (id) => db.bots.find((b) => b.id === id);
export const findBotByName = (name) => {
  const n = String(name || '').trim().toLowerCase().replace(/^@/, '');
  return db.bots.find((b) => b.name.toLowerCase() === n) ||
    db.bots.find((b) => b.name.toLowerCase().startsWith(n) || n.startsWith(b.name.toLowerCase()));
};
export const messagesOf = (botId) => (db.messages[botId] ??= []);
