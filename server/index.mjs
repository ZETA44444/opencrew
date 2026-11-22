// OpenCrew server: runs the same engine as the web app (src/core + src/localApi.js) 24/7,
// stores everything in a JSON file and lets your app connect over HTTPS with a secret token.
// No dependencies: Node 22+ only.
import http from 'node:http';
import { readFile, writeFile, rename, mkdir, stat, statfs, readdir, copyFile, unlink } from 'node:fs/promises';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { runInSandbox } from './sandbox.mjs';

const VERSION = '0.12.0';
const PORT = Number(process.env.PORT) || 8787;
const TOKEN = process.env.OPENCREW_TOKEN || '';
const DATA = (process.env.OPENCREW_DATA || new URL('./data/', import.meta.url).pathname).replace(/\/?$/, '/');
const ORIGINS = (process.env.OPENCREW_ORIGINS || 'https://zeta44444.github.io,http://localhost:5173,http://localhost:5175').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_BODY = 30 * 1024 * 1024;

if (TOKEN.length < 24) {
  console.error('Falta OPENCREW_TOKEN (al menos 24 caracteres). Genera uno con: openssl rand -hex 32');
  process.exit(1);
}

// ---------- storage: one JSON file, written atomically, with a daily backup (last 7 kept) ----------
await mkdir(`${DATA}backups`, { recursive: true });
const FILE = `${DATA}db.json`;
let lastBackupDay = '';
async function dailyBackup() {
  const day = new Date().toISOString().slice(0, 10);
  if (day === lastBackupDay) return;
  try {
    await copyFile(FILE, `${DATA}backups/db-${day}.json`);
    lastBackupDay = day; // only once the copy really exists
    const old = (await readdir(`${DATA}backups`)).filter((f) => f.startsWith('db-')).sort().slice(0, -7);
    await Promise.all(old.map((f) => unlink(`${DATA}backups/${f}`)));
  } catch { /* first run: nothing to back up yet */ }
}
globalThis.OPENCREW_STORAGE = {
  kind: 'file',
  async load() {
    try { return JSON.parse(await readFile(FILE, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  },
  async save(obj) {
    await dailyBackup();
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(obj));
    await rename(tmp, FILE);
  },
  async usage() {
    const [s, fs] = await Promise.all([stat(FILE).catch(() => null), statfs(DATA).catch(() => null)]);
    return { used: s?.size || 0, quota: fs ? fs.bavail * fs.bsize : null };
  },
};
globalThis.OPENCREW_RUN_JS = runInSandbox;
globalThis.OPENCREW_GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
globalThis.OPENCREW_PUBLIC_URL = (process.env.OPENCREW_PUBLIC_URL || (process.env.OPENCREW_HOST ? `https://${process.env.OPENCREW_HOST}` : `http://localhost:${PORT}`)).replace(/\/$/, '');

process.on('unhandledRejection', (e) => console.error('Error sin capturar:', e));

const store = await import('../src/core/store.js');
await store.ready;
const { subscribe } = await import('../src/core/events.js');
const { localApi } = await import('../src/localApi.js');
const { watchers } = await import('../src/core/watchers.js');
const { receiveWebhook } = await import('../src/core/webhooks.js');
const { finishGoogleServerAuth } = await import('../src/core/google.js');

const page = (title, text, ok) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#ededed;font:16px/1.5 system-ui,sans-serif;padding:16px;text-align:center}p{color:#a1a1aa;max-width:420px}</style></head>
<body><main><h1>${ok ? '✓' : '⚠️'} ${title}</h1><p>${text}</p></main>${ok ? '<script>setTimeout(()=>window.close(),2000)</script>' : ''}</body></html>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
await localApi.state(); // starts routines, watchers and the message queue

// Functions that only make sense inside a browser.
const BROWSER_ONLY = new Set(['subscribe', 'openArtifact', 'notifyPermission', 'askNotifyPermission', 'testNotification', 'connectGoogle']);
const extra = {
  async serverInfo() {
    const db = store.getDb();
    const messages = Object.values(db.messages || {}).reduce((n, list) => n + list.length, 0);
    return { version: VERSION, bots: db.bots.length, messages, fresh: messages === 0 && db.bots.every((b) => b.provider === 'demo') };
  },
};

// ---------- HTTP ----------
const hash = (s) => createHash('sha256').update(String(s)).digest();
const same = (a, b) => timingSafeEqual(hash(a), hash(b));

// POST /hooks/<watcher id>?k=<secret>  (or GitHub's X-Hub-Signature-256 made with the same secret)
async function handleHook(req, res, id, url) {
  const raw = await readBody(req, 2 * 1024 * 1024);
  const w = watchers().find((x) => x.id === id && x.type === 'webhook');
  const secret = w?.config?.secret;
  const sig = String(req.headers['x-hub-signature-256'] || '');
  const ok = !!secret && ((url.searchParams.get('k') && same(url.searchParams.get('k'), secret))
    || (sig && same(sig, `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`)));
  if (!ok) return send(res, 404, { error: 'No encontrado' });
  let body = {};
  const type = String(req.headers['content-type'] || '');
  try {
    if (type.includes('application/x-www-form-urlencoded')) {
      const form = new URLSearchParams(raw);
      body = form.get('payload') ? JSON.parse(form.get('payload')) : Object.fromEntries(form);
    } else body = raw ? JSON.parse(raw) : {};
  } catch { body = { text: raw.slice(0, 2000) }; }
  const r = receiveWebhook(w, req.headers, body);
  return send(res, r.status, r.body);
}
const authorized = (req) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  return !!m && timingSafeEqual(hash(m[1]), hash(TOKEN));
};

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-max-age', '600');
  }
}

const APP_URL = process.env.OPENCREW_APP_URL || 'https://zeta44444.github.io/opencrew/';
const HOME = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Servidor OpenCrew</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#ededed;font:16px/1.5 system-ui,-apple-system,sans-serif;padding:16px;box-sizing:border-box}
main{max-width:460px;text-align:center}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{color:#a1a1aa;margin:0 0 20px}
.ok{display:inline-block;margin-bottom:18px;padding:4px 12px;border-radius:999px;background:#12301f;color:#86efac;font-size:13px}
a.btn{display:inline-block;padding:10px 18px;border-radius:999px;background:#ededed;color:#0b0b0c;text-decoration:none;font-weight:600}
small{display:block;margin-top:22px;color:#71717a}</style></head><body><main>
<div class="ok">● Funcionando · v${VERSION}</div>
<h1>Este es tu servidor de OpenCrew</h1>
<p>Aquí trabajan tus bots 24/7, pero la app se abre desde su web. Para usarlo, abre la app y conéctala en <b>Ajustes → Servidor</b> con esta dirección y tu token.</p>
<a class="btn" href="${APP_URL}">Abrir OpenCrew</a>
<small>Dirección del servidor: la de esta página</small>
</main></body></html>`;

const send = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Demasiado grande'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const clients = new Set();
subscribe((ev) => {
  if (!clients.size) return;
  let line;
  try { line = `data: ${JSON.stringify(ev)}\n\n`; } catch { return; }
  for (const res of clients) res.write(line);
});
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25_000);

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, app: 'opencrew', version: VERSION });
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(HOME);
      return;
    }
    if (url.pathname === '/oauth/google/callback' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      try {
        if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error') === 'access_denied' ? 'Has cancelado el permiso.' : url.searchParams.get('error'));
        const r = await finishGoogleServerAuth(url.searchParams.get('code') || '', url.searchParams.get('state') || '');
        res.end(page('Google conectado', `Tus bots ya pueden usar el correo y la agenda de ${esc(r.email || 'tu cuenta')} sin caducar. Puedes cerrar esta ventana.`, true));
      } catch (e) { res.end(page('No se pudo conectar Google', esc(e.message), false)); }
      return;
    }
    const hook = /^\/hooks\/([\w-]{6,40})$/.exec(url.pathname);
    if (hook && req.method === 'POST') return handleHook(req, res, hook[1], url);
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'No encontrado' });
    if (!authorized(req)) return send(res, 401, { error: 'Token no válido' });

    if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(': hola\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (url.pathname === '/api/rpc' && req.method === 'POST') {
      const { method, args = [] } = JSON.parse((await readBody(req)) || '{}');
      const fn = extra[method] || (!BROWSER_ONLY.has(method) && typeof localApi[method] === 'function' && localApi[method]);
      if (!fn) return send(res, 400, { error: `Función desconocida: ${method}` });
      const result = await fn.apply(localApi, Array.isArray(args) ? args : []);
      return send(res, 200, { result: result === undefined ? null : result });
    }
    return send(res, 404, { error: 'No encontrado' });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 400, { error: e.message || String(e) });
  }
});

server.listen(PORT, () => console.log(`OpenCrew ${VERSION} escuchando en :${PORT} · datos en ${DATA}`));

async function shutdown() {
  console.log('Guardando y cerrando…');
  server.close();
  for (const res of clients) res.end();
  await store.saveNow().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
