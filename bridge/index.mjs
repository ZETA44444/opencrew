// OpenCrew Puente: connect YOUR ChatGPT and Claude subscriptions once, and use them from OpenCrew
// as if they were one more AI provider (OpenAI-compatible API). Personal use only.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { askClaude, askChatGPT, buildPrompt, parseToolCalls, chatgptConnected, claudeToken, saveClaudeToken, removeClaudeToken, env, ansi, HOME, DATA, getUsage, countUse, readChatgptLimits } from './cli.mjs';
import { PAGE } from './page.mjs';

const PORT = Number(process.env.PORT) || 8790;
const TOKEN = process.env.BRIDGE_TOKEN || '';
const MAX_RUNNING = Number(process.env.BRIDGE_CONCURRENCY) || 2;
if (TOKEN.length < 24) { console.error('Falta BRIDGE_TOKEN (al menos 24 caracteres)'); process.exit(1); }
await mkdir(join(HOME, '.codex'), { recursive: true }); // Codex refuses to start if its folder doesn't exist

const hash = (s) => createHash('sha256').update(String(s)).digest();
const authorized = (req) => { const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); return !!m && timingSafeEqual(hash(m[1]), hash(TOKEN)); };
const send = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
const body = (req) => new Promise((resolve, reject) => {
  let s = ''; req.on('data', (d) => { s += d; if (s.length > 20_000_000) { reject(new Error('Demasiado grande')); req.destroy(); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('JSON no válido')); } });
});

// ---------- which subscriptions OpenCrew may use (you choose; connected ≠ in use) ----------
const SETTINGS = join(DATA, 'settings.json');
let settings = { enabled: { chatgpt: true, claude: true } };
try { settings = { ...settings, ...JSON.parse(await readFile(SETTINGS, 'utf8')) }; } catch { /* first run */ }
const saveSettings = () => writeFile(SETTINGS, JSON.stringify(settings, null, 2));
const inUse = (p) => settings.enabled[p] !== false && (p === 'claude' ? !!claudeToken() : chatgptConnected());

// ---------- account sign-in (you do it once, in the bridge page) ----------
const logins = {}; // provider -> { proc, state, url, code, output, error }
const status = () => ({
  chatgpt: { connected: chatgptConnected(), enabled: settings.enabled.chatgpt !== false, login: pub(logins.chatgpt) },
  claude: { connected: !!claudeToken(), enabled: settings.enabled.claude !== false, login: pub(logins.claude) },
  usage: stats,
});
// What the program shows on screen, with anything that looks like a key or code hidden.
const tail = (l) => String(l?.screen || '').replace(/[A-Za-z0-9_#-]{24,}/g, '[…]').replace(/\s+/g, ' ').trim().slice(-500);
const pub = (l) => (l ? { state: l.state, url: l.url, code: l.code, error: l.error, startedAt: l.startedAt, checkingFor: l.checkingSince ? Math.round((Date.now() - l.checkingSince) / 1000) : 0, detail: l.state === 'checking' || l.state === 'error' ? tail(l) : '' } : null);

function startChatGPT() {
  logins.chatgpt?.proc?.kill();
  const l = (logins.chatgpt = { state: 'starting', output: '' });
  const p = spawn('codex', ['login', '--device-auth'], { env: env() });
  l.proc = p;
  const onData = (d) => {
    l.output += ansi(d);
    l.url ||= (l.output.match(/https:\/\/\S+/) || [])[0];
    l.code ||= (l.output.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/) || [])[0];
    if (l.url && l.code) l.state = 'waiting';
  };
  p.stdout.on('data', onData); p.stderr.on('data', onData);
  p.on('close', (code) => {
    l.proc = null;
    if (code === 0 && chatgptConnected()) l.state = 'ok';
    else { l.state = 'error'; l.error = l.output.trim().split('\n').slice(-3).join(' ').slice(0, 400) || 'No se pudo conectar'; }
  });
  p.on('error', (e) => { l.state = 'error'; l.error = e.message; });
}

function startClaude() {
  logins.claude?.proc?.kill('SIGKILL');
  const l = (logins.claude = { state: 'starting', output: '', screen: '', startedAt: Date.now() });
  // setup-token needs a terminal: `script` gives it one, wide enough that the token isn't wrapped.
  const p = spawn('script', ['-qfec', 'stty cols 1000 rows 50; claude setup-token', '/dev/null'], { env: env() });
  l.proc = p;
  const stopAfter = setTimeout(() => { if (l.state !== 'ok') { l.state = 'error'; l.error = 'Han pasado 10 minutos sin terminar. Pulsa «Conectar Claude» otra vez.'; p.kill('SIGKILL'); } }, 10 * 60_000);
  const onData = async (d) => {
    const clean = ansi(d).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    l.output = (l.output + clean).slice(-20_000);
    l.screen = (l.screen + clean).slice(-3000);
    // Some versions ask to press Enter to continue: do it.
    if (l.state === 'checking' && /Press ?Enter to (continue|confirm)|Presiona Enter/i.test(clean)) p.stdin.write('\r');
    l.url ||= (l.output.match(/https:\/\/claude\.ai\/oauth\S+|https:\/\/\S*anthropic\S*\/oauth\S*/) || [])[0];
    if (l.url && l.state === 'starting') l.state = 'waiting';
    const tok = (l.output.match(/sk-ant-[a-z]+\d*-[\w-]{30,}/) || l.output.replace(/[\r\n│║ ]+/g, '').match(/(?<=OAuthtoken[^:]*:)sk-ant-[a-z]+\d*-[\w-]{30,}?(?=Store|$)/) || [])[0];
    if (tok && l.state !== 'ok') { await saveClaudeToken(tok); l.state = 'ok'; l.output = ''; clearTimeout(stopAfter); setTimeout(() => p.kill('SIGKILL'), 500); return; }
    // Claude said no (wrong, expired or old code): tell you and stop this attempt.
    const flat = l.output.replace(/\s+/g, '');
    if (l.state === 'checking' && /OAuth ?error|wasn'?taccepted|Invalidcode|PressEntertoretry/i.test(flat)) {
      l.state = 'error';
      l.error = 'Claude no ha aceptado el código: puede que esté incompleto, caducado o sea de un intento anterior. Pulsa «Conectar Claude» otra vez y usa el enlace NUEVO (copia el código entero).';
      clearTimeout(stopAfter);
      p.kill('SIGKILL');
    }
  };
  p.stdout.on('data', onData); p.stderr.on('data', onData);
  p.on('close', () => { clearTimeout(stopAfter); l.proc = null; if (l.state !== 'ok' && l.state !== 'error') { l.state = 'error'; l.error = l.output.trim().split('\n').slice(-3).join(' ').slice(0, 400) || 'No se pudo conectar'; } });
  p.on('error', (e) => { l.state = 'error'; l.error = e.message; });
}

// ---------- the OpenAI-compatible API that OpenCrew uses ----------
const stats = { requests: 0, errors: 0, last: null };
let running = 0;
const queue = [];
const slot = () => new Promise((r) => { if (running < MAX_RUNNING) { running++; r(); } else queue.push(r); });
const free = () => { const n = queue.shift(); if (n) n(); else running--; };

// ---------- router: «auto» picks the subscription with most room left, and the right size ----------
const load = (u) => {
  if (!u) return 0;
  if (u.status === 'rejected' || u.fiveHour?.status === 'rejected' || u.sevenDay?.status === 'rejected') return 100;
  const fresh = (w) => (w && (!w.resetsAt || w.resetsAt > Date.now()) ? w.used || 0 : 0); // a window that already reset is empty
  return Math.max(fresh(u.fiveHour), fresh(u.sevenDay));
};
function taskSize(req) {
  const text = (req.messages || []).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''))).join(' ');
  const last = [...(req.messages || [])].reverse().find((m) => m.role === 'user');
  const ask = typeof last?.content === 'string' ? last.content : '';
  if (/(analiza|investiga|estrategia|arquitectura|programa|código|codigo|depura|informe completo|plan detallado|compara a fondo|razona)/i.test(ask) || text.length > 60_000) return 'large';
  if (ask.length < 120 && !(req.tools || []).length && text.length < 4000) return 'small';
  return 'mid';
}
export function route(req) {
  const u = getUsage();
  const size = taskSize(req);
  const cands = ['claude', 'chatgpt'].filter(inUse).map((p) => ({ p, load: load(u[p]) })).filter((c) => c.load < 95).sort((a, b) => a.load - b.load);
  if (!cands.length) throw Object.assign(new Error('Tus suscripciones están al límite o no hay ninguna activada'), { status: 429 });
  return cands.map(({ p, load: l }) => (p === 'chatgpt' ? 'chatgpt'
    : `claude-${size === 'small' ? 'haiku' : size === 'large' && l < 50 ? 'opus' : 'sonnet'}`));
}

function models() {
  const out = [];
  if (inUse('chatgpt') || inUse('claude')) out.push('auto');
  if (inUse('chatgpt')) out.push('chatgpt');
  if (inUse('claude')) out.push('claude-sonnet', 'claude-opus', 'claude-haiku');
  return out;
}

async function complete(req) {
  const wanted = String(req.model || '');
  const order = wanted === 'auto' ? route(req) : [wanted];
  let lastErr;
  for (const model of order) {
    try { return { ...(await completeWith(model, req)), routedTo: wanted === 'auto' ? model : undefined }; }
    catch (e) { lastErr = e; if (wanted !== 'auto' || ![429, 401, 504].includes(e.status)) throw e; } // auto: try the next subscription
  }
  throw lastErr;
}

async function completeWith(model, req) {
  const tools = req.tools || [];
  const which = model.startsWith('claude') ? 'claude' : 'chatgpt';
  if (!req.test && !inUse(which)) throw Object.assign(new Error(`${which === 'claude' ? 'Claude' : 'ChatGPT'} no está activado en el Puente`), { status: 401 });
  const { system, prompt } = buildPrompt(req.messages, tools, req.tool_choice);
  await slot();
  try {
    stats.requests++; stats.last = new Date().toISOString();
    const r = which === 'claude'
      ? await askClaude({ model: model.replace(/^claude-?/, '') || 'sonnet', system, prompt })
      : await askChatGPT({ model: model.replace(/^chatgpt-?/, ''), system, prompt });
    if (!req.test) countUse(which, model);
    return { ...parseToolCalls(r.text, tools), usage: r.usage };
  } catch (e) { stats.errors++; throw e; } finally { free(); }
}

function chatResponse(res, model, r, stream) {
  if (r.routedTo) model = `auto→${r.routedTo}`;
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  const toolCalls = r.calls.map((c, index) => ({ index, id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }));
  const usage = { prompt_tokens: r.usage?.input || 0, completion_tokens: r.usage?.output || 0, total_tokens: (r.usage?.input || 0) + (r.usage?.output || 0) };
  const finish = toolCalls.length ? 'tool_calls' : 'stop';
  if (!stream) {
    return send(res, 200, { id, object: 'chat.completion', created, model, usage,
      choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content: r.content || null, ...(toolCalls.length && { tool_calls: toolCalls.map(({ index, ...t }) => t) }) } }] });
  }
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
  const chunk = (delta, finish_reason = null, extra = {}) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason }], ...extra })}\n\n`);
  chunk({ role: 'assistant' });
  for (const piece of (r.content || '').match(/[\s\S]{1,120}/g) || []) chunk({ content: piece });
  if (toolCalls.length) chunk({ tool_calls: toolCalls });
  chunk({}, finish);
  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [], usage })}\n\n`);
  res.end('data: [DONE]\n\n');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace(/^\/puente/, '') || '/';
  try {
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
      return res.end(PAGE);
    }
    if (path === '/health') return send(res, 200, { ok: true, app: 'opencrew-puente' });
    if (!authorized(req)) return send(res, 401, { error: { message: 'Token no válido' } });

    if (path === '/api/status' && req.method === 'GET') return send(res, 200, status());
    if (path === '/api/login/chatgpt' && req.method === 'POST') { startChatGPT(); return send(res, 200, { ok: true }); }
    if (path === '/api/login/claude' && req.method === 'POST') { startClaude(); return send(res, 200, { ok: true }); }
    if (path === '/api/login/claude/code' && req.method === 'POST') {
      const { code } = await body(req);
      const l = logins.claude;
      if (!l?.proc) return send(res, 400, { error: { message: 'Primero pulsa «Conectar Claude»' } });
      const c = String(code || '').replace(/\s+/g, '');
      if (c.length < 10) return send(res, 400, { error: { message: 'Ese código parece incompleto: cópialo entero desde la página de Claude.' } });
      l.output = ''; l.screen = '';
      // Type the code, then press Enter apart: sent together, Claude takes a long code as a
      // paste and the Enter as part of it (the code stays in the box, never submitted).
      l.proc.stdin.write(c);
      l.state = 'checking';
      l.checkingSince = Date.now();
      const proc = l.proc;
      const enter = () => { if (logins.claude === l && l.state === 'checking' && proc.exitCode === null) proc.stdin.write('\r'); };
      setTimeout(enter, 800);
      // If nothing happened (no «Finishing sign-in», no answer), press Enter once more.
      setTimeout(() => { if (!/Finishing|token|error|accepted/i.test(l.screen)) enter(); }, 5000);
      return send(res, 200, { ok: true });
    }
    if (path === '/api/logout' && req.method === 'POST') {
      const { provider } = await body(req);
      if (provider === 'claude') await removeClaudeToken();
      if (provider === 'chatgpt') await rm(join(HOME, '.codex', 'auth.json'), { force: true });
      logins[provider]?.proc?.kill('SIGKILL');
      delete logins[provider];
      return send(res, 200, { ok: true });
    }
    if (path === '/api/cancel' && req.method === 'POST') {
      const { provider } = await body(req);
      logins[provider]?.proc?.kill('SIGKILL');
      delete logins[provider];
      return send(res, 200, { ok: true });
    }
    if (path === '/api/enable' && req.method === 'POST') {
      const { provider, enabled } = await body(req);
      if (!['chatgpt', 'claude'].includes(provider)) return send(res, 400, { error: { message: 'Proveedor no válido' } });
      settings.enabled[provider] = !!enabled;
      await saveSettings();
      return send(res, 200, { ok: true });
    }
    if (path === '/api/test' && req.method === 'POST') {
      const { provider } = await body(req);
      const t0 = Date.now();
      const r = await complete({ test: true, model: provider === 'claude' ? 'claude-haiku' : 'chatgpt', messages: [{ role: 'user', content: 'Di hola en una frase corta, en español.' }] });
      return send(res, 200, { ok: true, text: r.content, ms: Date.now() - t0 });
    }

    if (path === '/api/usage' && req.method === 'GET') {
      const u = getUsage();
      const month = new Date().toISOString().slice(0, 7);
      return send(res, 200, {
        claude: { connected: !!claudeToken(), enabled: settings.enabled.claude !== false, limits: u.claude },
        chatgpt: { connected: chatgptConnected(), enabled: settings.enabled.chatgpt !== false, limits: u.chatgpt },
        thisMonth: u.counts[month] || {}, month,
      });
    }
    if (path === '/api/usage/refresh' && req.method === 'POST') {
      const { provider } = await body(req);
      if (provider === 'chatgpt' && chatgptConnected()) await readChatgptLimits();
      // Claude only reports its limits with an answer: a tiny one with Haiku (a negligible part of your plan).
      if (provider === 'claude' && claudeToken()) await completeWith('claude-haiku', { test: true, messages: [{ role: 'user', content: 'Responde solo: ok' }] }).catch(() => {});
      return send(res, 200, { ok: true });
    }
    if (path === '/v1/models' && req.method === 'GET') return send(res, 200, { object: 'list', data: models().map((id) => ({ id, object: 'model', owned_by: 'tu-suscripcion' })) });
    if (path === '/v1/chat/completions' && req.method === 'POST') {
      const b = await body(req);
      const r = await complete(b);
      return chatResponse(res, b.model, r, !!b.stream);
    }
    return send(res, 404, { error: { message: 'No encontrado' } });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: { message: e.message, code: e.status || 500 } });
  }
});
server.requestTimeout = 0;
// ChatGPT's limits can be read for free: keep them fresh.
setInterval(() => { if (chatgptConnected()) readChatgptLimits().catch(() => {}); }, 15 * 60_000).unref();
server.listen(PORT, () => console.log(`OpenCrew Puente en :${PORT}`));
