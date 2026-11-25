// OpenCrew gateway: user accounts in front of the engines. Each user has their own isolated engine
// (their own container, data and encryption key); the server owner keeps the original engine.
// Sessions use a secure cookie; nothing here needs a dependency (Node 22+).
import http from 'node:http';
import net from 'node:net';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createHash, createHmac, timingSafeEqual, randomBytes, scrypt as scryptCb, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { createAi, planOf, limitsOf, creditState, PLANS, EUR_PER_USD } from './ai.mjs';

const scrypt = promisify(scryptCb);
const TERMS_VERSION = '2026-11-24'; // version of the legal texts each account accepted (public/legal)
const PORT = Number(process.env.PORT) || 8786;
const DATA = (process.env.GATEWAY_DATA || '/data').replace(/\/?$/, '/');
const MASTER = Buffer.from(process.env.OPENCREW_SECRET_KEY || '', 'hex');
const OWNER_ENGINE = process.env.OWNER_ENGINE_URL || 'http://opencrew:8787';
const OWNER_TOKEN = process.env.OPENCREW_TOKEN || '';
const LAUNCHER = (process.env.LAUNCHER_URL || 'http://launcher:8788').replace(/\/$/, '');
const LAUNCHER_KEY = process.env.LAUNCHER_KEY || '';
const SETUP_CODE = process.env.GATEWAY_SETUP_CODE || '';
const HOST = process.env.OPENCREW_HOST || '';
if (MASTER.length !== 32 || OWNER_TOKEN.length < 24) { console.error('Faltan OPENCREW_SECRET_KEY u OPENCREW_TOKEN'); process.exit(1); }

const hmac = (label) => createHmac('sha256', MASTER).update(label).digest('hex');
const same = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());

// ---------- storage (sealed with the master key) ----------
const FILE = `${DATA}gateway.json`;
const seal = (text) => { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', MASTER, iv); const d = Buffer.concat([c.update(text, 'utf8'), c.final()]); return JSON.stringify({ opencrew: 'sealed-v1', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: d.toString('base64') }); };
const unseal = (raw) => { const b = JSON.parse(raw); const d = createDecipheriv('aes-256-gcm', MASTER, Buffer.from(b.iv, 'base64')); d.setAuthTag(Buffer.from(b.tag, 'base64')); return Buffer.concat([d.update(Buffer.from(b.data, 'base64')), d.final()]).toString('utf8'); };
await mkdir(DATA, { recursive: true });
let db = { users: [], sessions: {}, invites: {} };
try { db = { ...db, ...JSON.parse(unseal(await readFile(FILE, 'utf8'))) }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
let saving = Promise.resolve();
const save = () => { saving = saving.then(async () => { await writeFile(`${FILE}.tmp`, seal(JSON.stringify(db)), { mode: 0o600 }); await rename(`${FILE}.tmp`, FILE); }).catch((e) => console.error('No se pudo guardar:', e.message)); return saving; };
// OpenCrew's own AI (paid plans): credits, company keys and the internal /ai/ route (gateway/ai.mjs).
const ai = createAi({ db, save, hmac: (l) => hmac(l), same: (a, b) => same(a, b), data: DATA });
const AI_URL = process.env.OPENCREW_AI_URL_FOR_ENGINES || 'http://gateway:8786/ai';

// ---------- passwords and sessions ----------
async function hashPassword(pw) { const salt = randomBytes(16); const k = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }); return `scrypt$${salt.toString('hex')}$${k.toString('hex')}`; }
async function checkPassword(pw, stored) {
  const [, salt, key] = String(stored).split('$');
  if (!salt) return false;
  const k = await scrypt(pw, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(k, Buffer.from(key, 'hex'));
}
const SESSION_DAYS = 30;
const cookieOf = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, v.join('=')]));
function sessionUser(req) {
  const sid = cookieOf(req).oc_sid;
  const s = sid && db.sessions[createHash('sha256').update(sid).digest('hex')];
  if (!s || s.exp < Date.now()) return null;
  const u = db.users.find((x) => x.id === s.uid && !x.disabled);
  return u || null;
}
function startSession(res, user, req) {
  const sid = randomBytes(32).toString('hex');
  db.sessions[createHash('sha256').update(sid).digest('hex')] = { uid: user.id, exp: Date.now() + SESSION_DAYS * 864e5, at: Date.now(), ua: String(req.headers['user-agent'] || '').slice(0, 120) };
  for (const [k, v] of Object.entries(db.sessions)) if (v.exp < Date.now()) delete db.sessions[k];
  save();
  res.setHeader('set-cookie', `oc_sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`);
}
const publicUser = (u) => u && { id: u.id, email: u.email, role: u.role, plan: planOf(u), createdAt: u.createdAt };
// Plan and credits as the user sees them (euros).
const eur = (usd) => (usd == null || usd === Infinity ? null : Math.round(usd * EUR_PER_USD * 100) / 100);
const planView = (u) => { const c = creditState(u); return { plan: c.plan, label: c.label, trialEnds: c.trialEnds, creditsEur: eur(c.allowance === Infinity ? null : c.allowance + c.topup), usedEur: eur(c.used), remainingEur: eur(c.remaining), warned: c.warned, limits: limitsOf(u) }; };

// ---------- limits ----------
const buckets = new Map();
const limited = (key, max, ms) => { const now = Date.now(); const b = buckets.get(key); if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + ms }); return false; } return ++b.n > max; };
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60_000).unref();
const ipOf = (req) => String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress || '?';

// ---------- engines: the owner's original one, or an isolated one per user ----------
const engineToken = (uid) => (uid === 'owner' ? OWNER_TOKEN : hmac(`engine-token:${uid}`));
const engineUrl = (uid) => (uid === 'owner' ? OWNER_ENGINE : `http://opencrew-engine-${uid}:8787`);
const starting = new Map();
async function ensureEngine(uid) {
  if (uid === 'owner') return;
  if (starting.has(uid)) return starting.get(uid);
  const job = (async () => {
    const r = await fetch(`${LAUNCHER}/engineStart`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-launcher-key': LAUNCHER_KEY },
      body: JSON.stringify({ tenant: uid, token: engineToken(uid), secretKey: hmac(`engine-data:${uid}`), host: HOST, aiUrl: AI_URL, aiKey: ai.keyFor(uid) }),
      signal: AbortSignal.timeout(60_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `No se pudo arrancar tu espacio (${r.status})`);
    for (let i = 0; i < 40; i++) { // wait until it answers
      try { const h = await fetch(`${engineUrl(uid)}/api/health`, { signal: AbortSignal.timeout(2000) }); if (h.ok) return; } catch { /* starting */ }
      await new Promise((res) => setTimeout(res, 500));
    }
    throw new Error('Tu espacio tarda en arrancar; vuelve a intentarlo');
  })().finally(() => starting.delete(uid));
  starting.set(uid, job);
  return job;
}

// Plain HTTP proxy to an engine (streams both ways, so live events work).
// Each request carries the user's plan limits (only the gateway can set this header: the engine trusts its token).
const limitsHeader = (uid) => { const u = db.users.find((x) => x.id === uid); return u ? { 'x-opencrew-limits': JSON.stringify(limitsOf(u)) } : {}; };
const proxy = (req, res, uid, path) => proxyTo(req, res, engineUrl(uid), engineToken(uid), path, limitsHeader(uid));
function proxyTo(req, res, base, token, path, extra = {}) {
  const target = new URL(path, base);
  const headers = { ...req.headers, host: target.host, authorization: `Bearer ${token}` };
  delete headers.cookie;
  delete headers['x-opencrew-limits'];
  Object.assign(headers, extra);
  const up = http.request(target, { method: req.method, headers }, (r) => {
    const h = { ...r.headers }; delete h['set-cookie'];
    res.writeHead(r.statusCode, h);
    r.pipe(res);
  });
  up.on('error', (e) => { console.error('Proxy:', target.host, e.code || e.message); if (!res.headersSent) send(res, 502, { error: 'Tu espacio no responde ahora mismo' }); else res.end(); });
  req.pipe(up);
  // Only cut the engine side if the browser really went away (not when the request body ends).
  res.on('close', () => { if (!res.writableFinished) up.destroy(); });
}

const send = (res, code, data) => { if (!res.headersSent) res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
const body = (req) => new Promise((resolve) => { let s = ''; req.on('data', (d) => { s += d; if (s.length > 100_000) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } }); });
// Requests that change things must come from the app itself (no other website can send this header).
const fromApp = (req) => req.headers['x-opencrew'] === '1' && (!req.headers.origin || req.headers.origin === `https://${HOST}` || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin));
const validEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(String(e || '').trim());

async function auth(req, res, path) {
  const ip = ipOf(req);
  if (path === '/api/auth/state' && req.method === 'GET') {
    return send(res, 200, { gateway: true, setupNeeded: !db.users.some((u) => u.role === 'owner'), user: publicUser(sessionUser(req)) });
  }
  if (req.method !== 'POST' || !fromApp(req)) return send(res, 403, { error: 'Prohibido' });
  const b = await body(req);
  const email = String(b.email || '').trim().toLowerCase();
  // New accounts must confirm they are 18+ and accept the terms (version recorded with the date).
  const accepted = { version: TERMS_VERSION, at: new Date().toISOString() };
  const needsAccept = () => (b.accept === true ? null : 'Para crear la cuenta tienes que confirmar que tienes 18 años o más y aceptar las condiciones');
  if (path === '/api/auth/setup') {
    if (db.users.some((u) => u.role === 'owner')) return send(res, 409, { error: 'La cuenta de administrador ya existe' });
    if (limited(`setup:${ip}`, 10, 15 * 60_000)) return send(res, 429, { error: 'Demasiados intentos; espera 15 minutos' });
    if (!SETUP_CODE || !same(String(b.code || '').trim(), SETUP_CODE)) return send(res, 401, { error: 'El código de configuración no es correcto' });
    if (!validEmail(email)) return send(res, 400, { error: 'Correo no válido' });
    if (needsAccept()) return send(res, 400, { error: needsAccept() });
    if (String(b.password || '').length < 10) return send(res, 400, { error: 'La contraseña debe tener al menos 10 caracteres' });
    const user = { id: 'owner', email, hash: await hashPassword(String(b.password)), role: 'owner', plan: 'owner', accepted, createdAt: new Date().toISOString() };
    db.users.push(user); startSession(res, user, req); await save();
    return send(res, 200, { user: publicUser(user) });
  }
  if (path === '/api/auth/login') {
    if (limited(`login:${ip}`, 20, 15 * 60_000) || limited(`login:${email}`, 10, 15 * 60_000)) return send(res, 429, { error: 'Demasiados intentos; espera 15 minutos' });
    const user = db.users.find((u) => u.email === email && !u.disabled);
    const okPw = user ? await checkPassword(String(b.password || ''), user.hash) : await checkPassword('x', `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`).then(() => false);
    if (!user || !okPw) return send(res, 401, { error: 'Correo o contraseña incorrectos' });
    startSession(res, user, req); await save();
    return send(res, 200, { user: publicUser(user) });
  }
  if (path === '/api/auth/signup') {
    if (limited(`signup:${ip}`, 10, 60 * 60_000)) return send(res, 429, { error: 'Demasiados intentos; espera un rato' });
    const code = String(b.invite || '').trim();
    const inv = db.invites[createHash('sha256').update(code).digest('hex')];
    if (!inv || inv.usedBy || inv.exp < Date.now()) return send(res, 403, { error: 'Hace falta una invitación válida (OpenCrew aún no está abierto a todo el mundo)' });
    if (!validEmail(email)) return send(res, 400, { error: 'Correo no válido' });
    if (db.users.some((u) => u.email === email)) return send(res, 409, { error: 'Ya hay una cuenta con ese correo' });
    if (needsAccept()) return send(res, 400, { error: needsAccept() });
    if (String(b.password || '').length < 10) return send(res, 400, { error: 'La contraseña debe tener al menos 10 caracteres' });
    const user = { id: randomBytes(6).toString('hex'), email, hash: await hashPassword(String(b.password)), role: 'user', plan: 'trial', trialEnds: Date.now() + PLANS.trial.days * 864e5, accepted, createdAt: new Date().toISOString() };
    db.users.push(user); inv.usedBy = user.id; inv.usedAt = Date.now();
    startSession(res, user, req); await save();
    return send(res, 200, { user: publicUser(user) });
  }
  if (path === '/api/auth/logout') {
    const sid = cookieOf(req).oc_sid;
    if (sid) delete db.sessions[createHash('sha256').update(sid).digest('hex')];
    await save();
    res.setHeader('set-cookie', 'oc_sid=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    return send(res, 200, { ok: true });
  }
  if (path === '/api/auth/password') {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: 'Inicia sesión' });
    if (!(await checkPassword(String(b.current || ''), user.hash))) return send(res, 401, { error: 'La contraseña actual no es correcta' });
    if (String(b.password || '').length < 10) return send(res, 400, { error: 'La contraseña debe tener al menos 10 caracteres' });
    user.hash = await hashPassword(String(b.password));
    for (const [k, v] of Object.entries(db.sessions)) if (v.uid === user.id) delete db.sessions[k]; // sign out everywhere
    startSession(res, user, req); await save();
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'No encontrado' });
}

// ---------- your data (GDPR): download everything, or delete the account and its space ----------
async function engineCall(uid, method, args = []) {
  const r = await fetch(`${engineUrl(uid)}/api/rpc`, { method: 'POST', headers: { authorization: `Bearer ${engineToken(uid)}`, 'content-type': 'application/json' }, body: JSON.stringify({ method, args }), signal: AbortSignal.timeout(60_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `Tu espacio respondió ${r.status}`);
  return j.result;
}
async function removeUser(u) {
  const r = await fetch(`${LAUNCHER}/engineRemove`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-launcher-key': LAUNCHER_KEY }, body: JSON.stringify({ tenant: u.id, deleteData: true }), signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error('No se pudo borrar el espacio del usuario; inténtalo de nuevo');
  db.users = db.users.filter((x) => x.id !== u.id);
  for (const [k, v] of Object.entries(db.sessions)) if (v.uid === u.id) delete db.sessions[k];
  for (const inv of Object.values(db.invites)) if (inv.usedBy === u.id) inv.usedBy = 'cuenta borrada';
  await save();
}
async function account(req, res, path, user) {
  if (!user) return send(res, 401, { error: 'Inicia sesión', login: true });
  if (path === '/api/account/plan' && req.method === 'GET') return send(res, 200, planView(user));
  if (path === '/api/account/export' && req.method === 'GET') {
    await ensureEngine(user.id);
    const data = await engineCall(user.id, 'exportData', [{ includeKeys: false }]);
    const out = { account: { ...publicUser(user), exportedAt: new Date().toISOString() }, ...data };
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="opencrew-mis-datos-${new Date().toISOString().slice(0, 10)}.json"` });
    return res.end(JSON.stringify(out, null, 2));
  }
  if (path === '/api/account/delete' && req.method === 'POST') {
    if (!fromApp(req)) return send(res, 403, { error: 'Prohibido' });
    if (user.role === 'owner') return send(res, 400, { error: 'La cuenta del administrador no se borra desde aquí' });
    if (limited(`delete:${user.id}`, 5, 15 * 60_000)) return send(res, 429, { error: 'Demasiados intentos; espera 15 minutos' });
    const b = await body(req);
    if (b.confirm !== 'BORRAR') return send(res, 400, { error: 'Escribe BORRAR para confirmar' });
    if (!(await checkPassword(String(b.password || ''), user.hash))) return send(res, 401, { error: 'La contraseña no es correcta' });
    await removeUser(user);
    res.setHeader('set-cookie', 'oc_sid=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'No encontrado' });
}

async function admin(req, res, path, user) {
  if (user?.role !== 'owner') return send(res, 403, { error: 'Solo el administrador' });
  if (path === '/api/admin/users' && req.method === 'GET') return send(res, 200, { users: db.users.map((u) => ({ ...publicUser(u), disabled: !!u.disabled, planView: planView(u), aiCostEur: eur(db.aiStats?.[new Date().toISOString().slice(0, 7)]?.[u.id]?.cost || 0) })), invites: Object.values(db.invites).map(({ note, exp, usedBy, at }) => ({ note, exp, usedBy, at })) });
  if (req.method !== 'POST' || !fromApp(req)) return send(res, 403, { error: 'Prohibido' });
  const b = await body(req);
  if (path === '/api/admin/invite') {
    const code = randomBytes(9).toString('base64url');
    db.invites[createHash('sha256').update(code).digest('hex')] = { note: String(b.note || '').slice(0, 80), at: Date.now(), exp: Date.now() + 14 * 864e5 };
    await save();
    return send(res, 200, { code, url: `https://${HOST}/?invitacion=${code}` });
  }
  // Until payments are connected (M2.5), the administrator sets plans and adds credits by hand.
  if (path === '/api/admin/plan') {
    const u = db.users.find((x) => x.id === b.id && x.role !== 'owner');
    if (!u) return send(res, 404, { error: 'No encontrado' });
    if (b.plan) {
      if (!PLANS[b.plan] || b.plan === 'owner') return send(res, 400, { error: 'Plan no válido' });
      u.plan = b.plan;
      if (b.plan === 'trial') { u.trialEnds = Date.now() + PLANS.trial.days * 864e5; u.trialUsed = 0; }
    }
    if (b.topupEur) u.topup = Math.max(0, (u.topup || 0) + Number(b.topupEur) / EUR_PER_USD);
    await save();
    return send(res, 200, { ok: true, planView: planView(u) });
  }
  if (path === '/api/admin/delete') {
    const u = db.users.find((x) => x.id === b.id && x.role !== 'owner');
    if (!u) return send(res, 404, { error: 'No encontrado' });
    await removeUser(u);
    return send(res, 200, { ok: true });
  }
  if (path === '/api/admin/disable') {
    const u = db.users.find((x) => x.id === b.id && x.role !== 'owner');
    if (!u) return send(res, 404, { error: 'No encontrado' });
    u.disabled = !!b.disabled;
    for (const [k, v] of Object.entries(db.sessions)) if (v.uid === u.id) delete db.sessions[k];
    await save();
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'No encontrado' });
}

// Which engine owns a device link, webhook or Google sign-in: the tenant id is the prefix
// («tenant.key», «/hooks/tenant/id», «state=tenant.random»); without prefix it's the owner.
const tenantOf = (v) => { const m = /^([a-f0-9]{12})\./.exec(String(v || '')); return m && db.users.some((u) => u.id === m[1] && !u.disabled) ? m[1] : 'owner'; };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    if (path === '/api/health') return send(res, 200, { ok: true, app: 'opencrew', gateway: true });
    if (path.startsWith('/ai/')) return await ai.handle(req, res, path); // internal: engines → providers with OpenCrew's keys
    if (path.startsWith('/api/auth/')) return await auth(req, res, path);
    const hook = /^\/hooks\/([a-f0-9]{12})\/([\w-]{6,40})$/.exec(path);
    if (hook) { await ensureEngine(hook[1]); return proxy(req, res, hook[1], `/hooks/${hook[2]}${url.search}`); }
    if (path.startsWith('/hooks/')) return proxy(req, res, 'owner', req.url);
    if (path.startsWith('/oauth/')) { const t = tenantOf(url.searchParams.get('state')); await ensureEngine(t); return proxy(req, res, t, req.url); }
    // Old clients (and the owner's scripts) that use the owner's engine token directly.
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    if (bearer && same(bearer, OWNER_TOKEN)) return proxy(req, res, 'owner', req.url);
    const user = sessionUser(req);
    if (path.startsWith('/api/admin/')) return await admin(req, res, path, user);
    if (path.startsWith('/api/account/')) return await account(req, res, path, user);
    if (!user) return send(res, 401, { error: 'Inicia sesión', login: true });
    if (req.method === 'POST' && !fromApp(req)) return send(res, 403, { error: 'Prohibido' });
    if (limited(`rpc:${user.id}`, 600, 60_000)) return send(res, 429, { error: 'Demasiadas peticiones seguidas. Espera un momento.' });
    await ensureEngine(user.id);
    return proxy(req, res, user.id, req.url);
  } catch (e) { send(res, 500, { error: e.message }); }
});

// WebSockets: the live screen (app, with session) and device links (extension, desktop app: by key prefix).
server.on('upgrade', async (req, socket, head) => {
  try {
    const url = new URL(req.url, 'http://x');
    let uid;
    if (url.pathname === '/api/ext' || url.pathname === '/api/desktop') {
      const k = url.searchParams.get('k') || '';
      uid = tenantOf(k);
      if (uid !== 'owner') url.searchParams.set('k', k.slice(uid.length + 1));
    } else if (url.pathname === '/api/computer/vnc') {
      uid = sessionUser(req)?.id;
      if (!uid) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
    } else { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return; }
    await ensureEngine(uid);
    const target = new URL(engineUrl(uid));
    const up = net.connect(Number(target.port) || 80, target.hostname, () => {
      const lines = [`${req.method} ${url.pathname}${url.search} HTTP/1.1`];
      for (const [k, v] of Object.entries(req.headers)) if (k !== 'cookie') lines.push(`${k}: ${v}`);
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      up.pipe(socket); socket.pipe(up);
    });
    const close = () => { up.destroy(); socket.destroy(); };
    up.on('error', close); socket.on('error', close); up.on('close', close); socket.on('close', close);
  } catch { socket.destroy(); }
});

server.listen(PORT, () => console.log(`OpenCrew pasarela en :${PORT} · ${db.users.length} usuarios`));
