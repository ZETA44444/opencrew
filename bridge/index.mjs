// OpenCrew Puente: connect YOUR ChatGPT and Claude subscriptions once, and use them from OpenCrew
// as if they were one more AI provider (OpenAI-compatible API). Personal use only.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { askClaude, askChatGPT, buildPrompt, parseToolCalls, chatgptConnected, claudeToken, saveClaudeToken, removeClaudeToken, env, ansi, HOME } from './cli.mjs';
import { PAGE } from './page.mjs';

const PORT = Number(process.env.PORT) || 8790;
const TOKEN = process.env.BRIDGE_TOKEN || '';
const MAX_RUNNING = Number(process.env.BRIDGE_CONCURRENCY) || 2;
if (TOKEN.length < 24) { console.error('Falta BRIDGE_TOKEN (al menos 24 caracteres)'); process.exit(1); }
await mkdir(HOME, { recursive: true });

const hash = (s) => createHash('sha256').update(String(s)).digest();
const authorized = (req) => { const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); return !!m && timingSafeEqual(hash(m[1]), hash(TOKEN)); };
const send = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
const body = (req) => new Promise((resolve, reject) => {
  let s = ''; req.on('data', (d) => { s += d; if (s.length > 20_000_000) { reject(new Error('Demasiado grande')); req.destroy(); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('JSON no válido')); } });
});

// ---------- account sign-in (you do it once, in the bridge page) ----------
const logins = {}; // provider -> { proc, state, url, code, output, error }
const status = () => ({
  chatgpt: { connected: chatgptConnected(), login: pub(logins.chatgpt) },
  claude: { connected: !!claudeToken(), login: pub(logins.claude) },
  usage: stats,
});
const pub = (l) => (l ? { state: l.state, url: l.url, code: l.code, error: l.error } : null);

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
  logins.claude?.proc?.kill();
  const l = (logins.claude = { state: 'starting', output: '' });
  // setup-token needs a terminal: `script` gives it one, wide enough that the token isn't wrapped.
  const p = spawn('script', ['-qfec', 'stty cols 1000 rows 50; claude setup-token', '/dev/null'], { env: env() });
  l.proc = p;
  const onData = async (d) => {
    l.output += ansi(d);
    l.url ||= (l.output.match(/https:\/\/claude\.ai\/\S+|https:\/\/\S*anthropic\S*/) || [])[0];
    if (l.url && l.state === 'starting') l.state = 'waiting';
    const tok = (l.output.match(/sk-ant-oat[\w-]{20,}/) || [])[0];
    if (tok && l.state !== 'ok') { await saveClaudeToken(tok); l.state = 'ok'; l.output = ''; setTimeout(() => p.kill(), 500); }
  };
  p.stdout.on('data', onData); p.stderr.on('data', onData);
  p.on('close', () => { l.proc = null; if (l.state !== 'ok') { l.state = 'error'; l.error ||= l.output.trim().split('\n').slice(-3).join(' ').slice(0, 400) || 'No se pudo conectar'; } });
  p.on('error', (e) => { l.state = 'error'; l.error = e.message; });
}

// ---------- the OpenAI-compatible API that OpenCrew uses ----------
const stats = { requests: 0, errors: 0, last: null };
let running = 0;
const queue = [];
const slot = () => new Promise((r) => { if (running < MAX_RUNNING) { running++; r(); } else queue.push(r); });
const free = () => { const n = queue.shift(); if (n) n(); else running--; };

function models() {
  const out = [];
  if (chatgptConnected()) out.push('chatgpt');
  if (claudeToken()) out.push('claude-sonnet', 'claude-opus', 'claude-haiku');
  return out;
}

async function complete(req) {
  const model = String(req.model || '');
  const tools = req.tools || [];
  const { system, prompt } = buildPrompt(req.messages, tools, req.tool_choice);
  await slot();
  try {
    stats.requests++; stats.last = new Date().toISOString();
    const r = model.startsWith('claude')
      ? await askClaude({ model: model.replace(/^claude-?/, '') || 'sonnet', system, prompt })
      : await askChatGPT({ model: model.replace(/^chatgpt-?/, ''), system, prompt });
    return { ...parseToolCalls(r.text, tools), usage: r.usage };
  } catch (e) { stats.errors++; throw e; } finally { free(); }
}

function chatResponse(res, model, r, stream) {
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
      l.proc.stdin.write(`${String(code || '').trim()}\r`);
      l.state = 'checking';
      return send(res, 200, { ok: true });
    }
    if (path === '/api/logout' && req.method === 'POST') {
      const { provider } = await body(req);
      if (provider === 'claude') await removeClaudeToken();
      if (provider === 'chatgpt') await rm(join(HOME, '.codex', 'auth.json'), { force: true });
      delete logins[provider];
      return send(res, 200, { ok: true });
    }
    if (path === '/api/test' && req.method === 'POST') {
      const { provider } = await body(req);
      const t0 = Date.now();
      const r = await complete({ model: provider === 'claude' ? 'claude-haiku' : 'chatgpt', messages: [{ role: 'user', content: 'Di hola en una frase corta, en español.' }] });
      return send(res, 200, { ok: true, text: r.content, ms: Date.now() - t0 });
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
server.listen(PORT, () => console.log(`OpenCrew Puente en :${PORT}`));
