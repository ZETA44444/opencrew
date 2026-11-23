// OpenCrew server: runs the same engine as the web app (src/core + src/localApi.js) 24/7,
// stores everything in a JSON file and lets your app connect over HTTPS with a secret token.
// No dependencies: Node 22+ only.
import http from 'node:http';
import { readFile, writeFile, rename, mkdir, stat, statfs, readdir, copyFile, unlink } from 'node:fs/promises';
import { createHash, createHmac, timingSafeEqual, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { runInSandbox, computer } from './launcher-client.mjs';
import { extension, desktop } from './extension-link.mjs';

const VERSION = '0.19.0';
const PORT = Number(process.env.PORT) || 8787;
const TOKEN = process.env.OPENCREW_TOKEN || '';
const DATA = (process.env.OPENCREW_DATA || new URL('./data/', import.meta.url).pathname).replace(/\/?$/, '/');
const ORIGINS = (process.env.OPENCREW_ORIGINS || 'https://zeta44444.github.io,http://localhost:5173,http://localhost:5175').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_BODY = 30 * 1024 * 1024;

if (TOKEN.length < 24) {
  console.error('Falta OPENCREW_TOKEN (al menos 24 caracteres). Genera uno con: openssl rand -hex 32');
  process.exit(1);
}

// ---------- encryption at rest: your keys, chats and backups are unreadable without the master key ----------
// The master key (OPENCREW_SECRET_KEY, 64 hex chars) lives in server/.env, outside the data folder and its backups.
const MASTER = /^[0-9a-f]{64}$/i.test(process.env.OPENCREW_SECRET_KEY || '') ? Buffer.from(process.env.OPENCREW_SECRET_KEY, 'hex') : null;
if (!MASTER) console.warn('⚠️ Sin OPENCREW_SECRET_KEY: los datos se guardan sin cifrar.');
function seal(text) {
  if (!MASTER) return text;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', MASTER, iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return JSON.stringify({ opencrew: 'sealed-v1', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}
function unseal(raw) {
  let box;
  try { box = JSON.parse(raw); } catch { return raw; }
  if (box?.opencrew !== 'sealed-v1') return raw; // old unencrypted file: it gets encrypted on the next save
  if (!MASTER) throw new Error('Los datos están cifrados y falta OPENCREW_SECRET_KEY');
  const d = createDecipheriv('aes-256-gcm', MASTER, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8');
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
    let raw;
    try { raw = await readFile(FILE, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    return JSON.parse(unseal(raw));
  },
  async save(obj) {
    await dailyBackup();
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, seal(JSON.stringify(obj)), { mode: 0o600 });
    await rename(tmp, FILE);
  },
  async usage() {
    const [s, fs] = await Promise.all([stat(FILE).catch(() => null), statfs(DATA).catch(() => null)]);
    return { used: s?.size || 0, quota: fs ? fs.bavail * fs.bsize : null };
  },
};
globalThis.OPENCREW_RUN_JS = runInSandbox;
// Real DNS answers for the network guard (src/core/netguard.js): bots can't reach internal addresses.
{
  const dns = await import('node:dns');
  globalThis.OPENCREW_RESOLVE = async (host) => (await dns.promises.lookup(host, { all: true, verbatim: true })).map((a) => a.address);
}
globalThis.OPENCREW_COMPUTER = computer;
globalThis.OPENCREW_EXT = extension;
globalThis.OPENCREW_DESKTOP = desktop;
// OpenCrew Puente (your ChatGPT/Claude subscriptions), if installed next to this server.
if (process.env.OPENCREW_BRIDGE_URL) globalThis.OPENCREW_BRIDGE = { url: process.env.OPENCREW_BRIDGE_URL.replace(/\/$/, ''), token: process.env.OPENCREW_BRIDGE_TOKEN || TOKEN };
globalThis.OPENCREW_GOOGLE_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
globalThis.OPENCREW_PUBLIC_URL = (process.env.OPENCREW_PUBLIC_URL || (process.env.OPENCREW_HOST ? `https://${process.env.OPENCREW_HOST}` : `http://localhost:${PORT}`)).replace(/\/$/, '');

process.on('unhandledRejection', (e) => console.error('Error sin capturar:', e));

const store = await import('../src/core/store.js');
await store.ready;
if (MASTER) await store.saveNow(); // encrypt an old plain file right away
const { subscribe } = await import('../src/core/events.js');
const { localApi } = await import('../src/localApi.js');
const { watchers } = await import('../src/core/watchers.js');
{
  const { subscribe: sub } = await import('../src/core/events.js');
  const pushBots = () => desktop.push({ type: 'bots', bots: store.getDb().bots.map((b) => ({ id: b.id, name: b.name, enabled: !!b.userComputer })) });
  desktop.onHello(pushBots);
  sub((ev) => { if (ev.type === 'bots') pushBots(); });
}
const { receiveWebhook } = await import('../src/core/webhooks.js');
const { finishGoogleServerAuth } = await import('../src/core/google.js');

const page = (title, text, ok) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#ededed;font:16px/1.5 system-ui,sans-serif;padding:16px;text-align:center}p{color:#a1a1aa;max-width:420px}</style></head>
<body><main><h1>${ok ? '✓' : '⚠️'} ${title}</h1><p>${text}</p></main>${ok ? '<script>setTimeout(()=>window.close(),2000)</script>' : ''}</body></html>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
await localApi.state(); // starts routines, watchers and the message queue
if (globalThis.OPENCREW_BRIDGE) {
  // Notice when you connect or disconnect a subscription in the bridge page.
  const { refreshModels, modelsOf } = await import('../src/core/providers.js');
  const { broadcast } = await import('../src/core/events.js');
  let last = '';
  const check = async () => { await refreshModels('puente').catch(() => {}); const now = modelsOf('puente').join(','); if (now !== last) { last = now; broadcast({ type: 'bots' }); } };
  check(); setInterval(check, 30_000).unref();
}

// Functions that only make sense inside a browser.
const BROWSER_ONLY = new Set(['subscribe', 'openArtifact', 'notifyPermission', 'askNotifyPermission', 'testNotification', 'connectGoogle']);
// Short, single-use passes to open a bot's screen (a browser WebSocket can't send our token header).
const viewTickets = new Map(); // ticket -> { botId, exp }
const extra = {
  async computerViewTicket(botId) {
    const bot = store.getBot(botId);
    if (!bot?.computer) throw new Error('Este bot no tiene ordenador (actívalo en su configuración).');
    for (const [k, v] of viewTickets) if (v.exp < Date.now()) viewTickets.delete(k);
    const ticket = randomBytes(24).toString('hex');
    viewTickets.set(ticket, { botId, exp: Date.now() + 60_000 });
    return ticket;
  },
  // Real plan usage from the official programs (via OpenCrew Puente).
  async subscriptionUsage(refresh) {
    const b = globalThis.OPENCREW_BRIDGE;
    if (!b) return null;
    const base = b.url.replace(/\/v1$/, '');
    const h = { authorization: `Bearer ${b.token}`, 'content-type': 'application/json' };
    if (refresh) await fetch(`${base}/api/usage/refresh`, { method: 'POST', headers: h, body: JSON.stringify({ provider: refresh }), signal: AbortSignal.timeout(90_000) }).catch(() => {});
    const r = await fetch(`${base}/api/usage`, { headers: h, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`El Puente respondió ${r.status}`);
    return r.json();
  },
  // Pair the browser extension: a separate key just for it (shown once, revocable).
  async extensionPair() {
    const k = randomBytes(24).toString('hex');
    store.getDb().keys.extensionKey = k;
    store.save();
    return { key: k };
  },
  async extensionRevoke() { delete store.getDb().keys.extensionKey; store.save(); return { ok: true }; },
  async extensionStatus() { return { paired: !!store.getDb().keys.extensionKey, connected: extension.connected(), info: extension.info() }; },
  // Same for the desktop app (OpenCrew Escritorio).
  async desktopPair() { const k = randomBytes(24).toString('hex'); store.getDb().keys.desktopKey = k; store.save(); return { key: k }; },
  async desktopRevoke() { delete store.getDb().keys.desktopKey; store.save(); return { ok: true }; },
  async desktopStatus() { return { paired: !!store.getDb().keys.desktopKey, connected: desktop.connected(), info: desktop.info() }; },
  async computerControl(botId, on) { return computer.setControl(botId, !!on); },
  async computerInControl(botId) { return computer.inControl(botId); },
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

// ---------- live screen of a bot's computer: WebSocket ↔ VNC (hand-made, no dependencies) ----------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function wsFrame(data, opcode = 2) {
  const len = data.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, data]);
}

server.on('upgrade', async (req, socket) => {
  const url = new URL(req.url, 'http://x');
  const fail = (code, text) => { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`); };
  if (url.pathname === '/api/ext' || url.pathname === '/api/desktop') {
    const { getDb } = store;
    const isDesktop = url.pathname === '/api/desktop';
    const link = isDesktop ? desktop : extension;
    return link.handleUpgrade(req, socket, url, () => getDb().keys[isDesktop ? 'desktopKey' : 'extensionKey'] || '', async () => {
      const { broadcast } = await import('../src/core/events.js');
      broadcast({ type: 'connectors' });
    });
  }
  if (url.pathname !== '/api/computer/vnc') return fail(404, 'Not Found');
  const origin = req.headers.origin;
  if (origin && !ORIGINS.includes(origin)) return fail(403, 'Forbidden');
  const t = viewTickets.get(url.searchParams.get('ticket') || '');
  viewTickets.delete(url.searchParams.get('ticket') || '');
  if (!t || t.exp < Date.now()) return fail(401, 'Unauthorized');
  const key = req.headers['sec-websocket-key'];
  if (!key) return fail(400, 'Bad Request');
  let child;
  try { child = await computer.vnc(t.botId); } catch (e) { console.error('Pantalla:', e.message); return fail(503, 'Service Unavailable'); }
  const proto = String(req.headers['sec-websocket-protocol'] || '').split(',')[0].trim();
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${createHash('sha1').update(key + WS_GUID).digest('base64')}`,
    ...(proto ? [`Sec-WebSocket-Protocol: ${proto}`] : []), '', ''].join('\r\n'));
  socket.setNoDelay(true);
  const close = () => { try { child.kill(); } catch { /* gone */ } socket.destroy(); };
  child.stdout.on('data', (d) => { if (!socket.destroyed) socket.write(wsFrame(d)); });
  child.on('close', () => { if (!socket.destroyed) { socket.write(wsFrame(Buffer.alloc(0), 8)); socket.end(); } });
  child.stdin.on('error', () => {});
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 0x0f;
      const masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 16 * 1024 * 1024) return close();
      const mask = masked ? buf.subarray(off, off + 4) : null;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      buf = buf.subarray(off + len);
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      if (op === 0 || op === 1 || op === 2) child.stdin.write(payload);
      else if (op === 8) { socket.write(wsFrame(Buffer.alloc(0), 8)); return close(); }
      else if (op === 9) socket.write(wsFrame(payload, 10));
    }
  });
  socket.on('close', close);
  socket.on('error', close);
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
