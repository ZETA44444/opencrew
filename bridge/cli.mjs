// Runs the official CLIs with YOUR subscription (no API key): Codex for ChatGPT, Claude Code for Claude.
// Their own tools are switched off: they only answer text. OpenCrew's tools are offered through a
// simple text protocol (<tool_calls>…</tool_calls>) that this bridge turns into normal tool calls.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DATA = process.env.BRIDGE_DATA || '/data';
export const HOME = join(DATA, 'home');
const CLAUDE_TOKEN_FILE = join(DATA, 'claude-token');
export const env = () => ({
  PATH: process.env.PATH, HOME, CODEX_HOME: join(HOME, '.codex'), LANG: 'es_ES.UTF-8', TERM: 'xterm-256color',
  NO_COLOR: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
});

// ---------- real plan usage, as the official programs report it (whole account, not only OpenCrew) ----------
const USAGE_FILE = join(DATA, 'usage.json');
let usage = { claude: null, chatgpt: null, counts: {} };
try { usage = { ...usage, ...JSON.parse(readFileSync(USAGE_FILE, 'utf8')) }; } catch { /* first run */ }
export const getUsage = () => usage;
const saveUsage = () => writeFile(USAGE_FILE, JSON.stringify(usage)).catch(() => {});
export function countUse(provider, model) {
  const month = new Date().toISOString().slice(0, 7);
  const c = ((usage.counts[month] ??= {})[provider] ??= { requests: 0, models: {} });
  c.requests++; c.models[model] = (c.models[model] || 0) + 1;
  saveUsage();
}
function setClaudeLimits(info) {
  const w = info?.unifiedWindows || {};
  const win = (x) => (x ? { used: Math.round((x.utilization || 0) * 1000) / 10, resetsAt: x.resetsAt ? x.resetsAt * 1000 : null, status: x.status } : null);
  usage.claude = {
    fiveHour: win(w.five_hour), sevenDay: win(w.seven_day),
    ...Object.fromEntries(Object.entries(w).filter(([k]) => !['five_hour', 'seven_day'].includes(k)).map(([k, v]) => [k, win(v)])),
    status: info.status, overage: { status: info.overageStatus, using: !!info.isUsingOverage, reason: info.overageDisabledReason || null },
    updatedAt: Date.now(),
  };
  saveUsage();
}
// Codex keeps the plan limits it receives in its session files: read the newest snapshot.
const pctWin = (x) => (x ? { used: Number(x.used_percent ?? x.usedPercent ?? 0), windowMinutes: Number(x.window_minutes ?? x.windowMinutes ?? x.windowDurationMins ?? 0) || null,
  resetsAt: x.resets_at ? x.resets_at * 1000 : x.resetsAt ? (x.resetsAt > 1e12 ? x.resetsAt : x.resetsAt * 1000) : x.resets_in_seconds ? Date.now() + x.resets_in_seconds * 1000 : null } : null);
export function setChatgptLimits(rl, source) {
  if (!rl || (!rl.primary && !rl.secondary)) return false;
  const p = pctWin(rl.primary), q = pctWin(rl.secondary);
  const byLen = [p, q].filter(Boolean).sort((a, b) => (a.windowMinutes || 0) - (b.windowMinutes || 0));
  usage.chatgpt = { fiveHour: byLen[0] || null, sevenDay: byLen[1] || null, plan: rl.plan_type || rl.planType || null, credits: rl.credits || null, source, updatedAt: Date.now() };
  saveUsage();
  return true;
}
async function latestCodexLimits() {
  const root = join(HOME, '.codex', 'sessions');
  const files = [];
  const walk = async (d, depth) => { for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) { const f = join(d, e.name); if (e.isDirectory() && depth < 4) await walk(f, depth + 1); else if (/rollout-.*\.jsonl$/.test(e.name)) files.push(f); } };
  await walk(root, 0);
  const withTime = await Promise.all(files.map(async (f) => ({ f, t: (await stat(f)).mtimeMs })));
  for (const { f } of withTime.sort((a, b) => b.t - a.t).slice(0, 3)) {
    const lines = (await readFile(f, 'utf8')).trim().split('\n').reverse();
    for (const l of lines) { if (!l.includes('rate_limits')) continue; try { const j = JSON.parse(l); const rl = j.payload?.rate_limits || j.rate_limits || j.msg?.rate_limits; if (setChatgptLimits(rl, 'sesión')) return true; } catch { /* skip */ } }
  }
  return false;
}

// Ask Codex for the plan limits without using any (app-server «account/rateLimits/read»).
export function readChatgptLimits() {
  return new Promise((resolve) => {
    const p = spawn('codex', ['app-server'], { env: env() });
    let buf = '';
    let done = false;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(t); p.kill('SIGKILL'); resolve(ok); };
    const t = setTimeout(() => finish(false), 20_000);
    const send = (o) => p.stdin.write(`${JSON.stringify(o)}\n`);
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) { send({ jsonrpc: '2.0', method: 'initialized', params: {} }); send({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: {} }); }
        if (m.id === 2) {
          const r = m.result || {};
          const rl = r.rateLimits || r.rate_limits || r;
          finish(setChatgptLimits(rl.primary || rl.secondary ? rl : rl.rateLimits || rl, 'consulta'));
        }
      }
    });
    p.on('error', () => finish(false));
    p.on('close', () => finish(false));
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'opencrew-puente', version: '1.0.0' } } });
  });
}

export const claudeToken = () => { try { return readFileSync(CLAUDE_TOKEN_FILE, 'utf8').trim(); } catch { return ''; } };
export const saveClaudeToken = async (t) => { await mkdir(DATA, { recursive: true }); await writeFile(CLAUDE_TOKEN_FILE, t, { mode: 0o600 }); };
export const removeClaudeToken = () => rm(CLAUDE_TOKEN_FILE, { force: true });
export const chatgptConnected = () => existsSync(join(HOME, '.codex', 'auth.json'));

// Never let a secret of yours leave the bridge inside an answer.
function secrets() {
  const out = [claudeToken()];
  try {
    const a = JSON.parse(readFileSync(join(HOME, '.codex', 'auth.json'), 'utf8'));
    const walk = (o) => { for (const v of Object.values(o || {})) { if (typeof v === 'string' && v.length > 20) out.push(v); else if (v && typeof v === 'object') walk(v); } };
    walk(a);
  } catch { /* not connected */ }
  return out.filter((s) => s && s.length > 20);
}
export function redact(text) {
  let t = String(text || '');
  for (const s of secrets()) t = t.split(s).join('[oculto]');
  return t.replace(/sk-ant-[a-z0-9]+-[A-Za-z0-9_-]{20,}/g, '[oculto]').replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, '[oculto]');
}

export const ansi = (s) => String(s).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[=>()][0-9A-Za-z]?/g, '');

function run(cmd, args, { input, timeoutMs = 300_000, extraEnv = {}, cwd } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env: { ...env(), ...extraEnv }, cwd });
    let out = '';
    let err = '';
    let killed = false;
    const t = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, timeoutMs);
    p.stdout.on('data', (d) => { if (out.length < 2_000_000) out += d; });
    p.stderr.on('data', (d) => { if (err.length < 200_000) err += d; });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message, killed }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err, killed }); });
    p.stdin.on('error', () => {});
    p.stdin.end(input ?? '');
  });
}

// Plan limits reached → 429 so OpenCrew falls back to another model on its own.
function failure(text, fallback) {
  const t = ansi(text || '').trim();
  const limit = /usage limit|rate limit|limit reached|hit your|quota|too many requests|límite/i.test(t);
  const auth = /log ?in|unauthori[sz]ed|authenticat|expired|invalid.*token|not logged/i.test(t);
  return Object.assign(new Error(`${fallback}: ${t.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300) || 'sin respuesta'}`), { status: limit ? 429 : auth ? 401 : 502 });
}

const CLAUDE_BUILTIN = 'Bash Edit Write MultiEdit NotebookEdit Read Glob Grep LS WebFetch WebSearch Task TodoWrite BashOutput KillShell SlashCommand ExitPlanMode';

export async function askClaude({ model = 'sonnet', system, prompt }) {
  const token = claudeToken();
  if (!token) throw Object.assign(new Error('Claude no está conectado en el Puente'), { status: 401 });
  const cwd = await mkdtemp(join(tmpdir(), 'puente-'));
  try {
    const r = await run('claude', ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--max-turns', '1',
      '--system-prompt', system, '--disallowedTools', ...CLAUDE_BUILTIN.split(' ')], { input: prompt, cwd, extraEnv: { CLAUDE_CODE_OAUTH_TOKEN: token } });
    if (r.killed) throw Object.assign(new Error('Claude tardó demasiado'), { status: 504 });
    let result = null;
    for (const line of r.out.split('\n')) {
      if (!line.trim()) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.type === 'rate_limit_event' && j.rate_limit_info) setClaudeLimits(j.rate_limit_info);
      if (j.type === 'result') result = j;
    }
    if (!result) throw failure(r.err || r.out, 'Claude');
    if (result.is_error || r.code !== 0) throw failure(result.result || r.err, 'Claude');
    return { text: redact(result.result || ''), usage: { input: result.usage?.input_tokens || 0, output: result.usage?.output_tokens || 0 }, model: result.modelUsage ? Object.keys(result.modelUsage)[0] : model };
  } finally { rm(cwd, { recursive: true, force: true }).catch(() => {}); }
}

export async function askChatGPT({ model, system, prompt }) {
  if (!chatgptConnected()) throw Object.assign(new Error('ChatGPT no está conectado en el Puente'), { status: 401 });
  const cwd = await mkdtemp(join(tmpdir(), 'puente-'));
  const outFile = join(cwd, 'respuesta.txt');
  try {
    const full = `${system}\n\n${prompt}`.slice(-120_000); // one argument must stay under the OS limit
    const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '-o', outFile, ...(model && model !== 'chatgpt' ? ['-m', model] : []), full];
    const r = await run('codex', args, { cwd });
    if (r.killed) throw Object.assign(new Error('ChatGPT tardó demasiado'), { status: 504 });
    const text = await readFile(outFile, 'utf8').catch(() => (r.code === 0 ? r.out : ''));
    latestCodexLimits().catch(() => {}); // the plan limits Codex just received
    if (r.code !== 0 || !text.trim()) throw failure(r.err || r.out, 'ChatGPT');
    return { text: redact(ansi(text).trim()), usage: { input: 0, output: 0 } };
  } finally { rm(cwd, { recursive: true, force: true }).catch(() => {}); }
}

// ---------- OpenAI chat format ⇄ plain prompt ----------
const contentText = (c) => (Array.isArray(c) ? c.map((p) => (p.type === 'text' ? p.text : `[${p.type === 'image_url' ? 'imagen adjunta (no disponible por suscripción)' : 'archivo adjunto'}]`)).join('\n') : String(c ?? ''));

export function buildPrompt(messages = [], tools = [], toolChoice) {
  const system = messages.filter((m) => m.role === 'system').map((m) => contentText(m.content)).join('\n\n');
  const lines = [];
  for (const m of messages) {
    if (m.role === 'user') lines.push(`### Usuario\n${contentText(m.content)}`);
    else if (m.role === 'assistant') {
      const calls = (m.tool_calls || []).map((c) => ({ id: c.id, name: c.function?.name, arguments: safeJson(c.function?.arguments) }));
      lines.push(`### Tú (asistente)\n${contentText(m.content) || ''}${calls.length ? `\n<tool_calls>${JSON.stringify(calls)}</tool_calls>` : ''}`.trim());
    } else if (m.role === 'tool') lines.push(`### Resultado de la herramienta (${m.tool_call_id})\n${contentText(m.content).slice(0, 20_000)}`);
  }
  let toolText = '';
  if (tools.length) {
    const list = tools.map((t) => ({ name: t.function?.name || t.name, description: String(t.function?.description || t.description || '').slice(0, 600), parameters: t.function?.parameters || t.parameters }));
    toolText = `\n\n## Herramientas\nPuedes usar estas herramientas (JSON Schema):\n${JSON.stringify(list)}\n\n`
      + 'Para usar una o varias, responde ÚNICAMENTE con este bloque, sin nada más:\n<tool_calls>[{"name":"nombre_exacto","arguments":{…}}]</tool_calls>\n'
      + 'Después recibirás los resultados y podrás seguir. Si no necesitas ninguna, responde con normalidad y no escribas esa etiqueta.'
      + (toolChoice === 'required' || toolChoice === 'any' ? '\nEn esta respuesta DEBES usar al menos una herramienta.' : '');
  }
  const sys = `${system}${toolText}\n\nNo tienes acceso a archivos ni a comandos propios: solo a las herramientas de arriba (si las hay). Responde en el idioma del usuario.`;
  const prompt = `${lines.join('\n\n').slice(-150_000)}\n\n### Tú (asistente)\n`;
  return { system: sys, prompt };
}

function safeJson(s) { try { return typeof s === 'string' ? JSON.parse(s || '{}') : s || {}; } catch { return {}; } }

let seq = 0;
export function parseToolCalls(text, tools = []) {
  const names = new Set(tools.map((t) => t.function?.name || t.name));
  const m = /<tool_calls>\s*([\s\S]*?)\s*<\/tool_calls>/.exec(text) || (names.size && /```(?:json)?\s*(\[\s*\{[\s\S]*?"name"[\s\S]*?\])\s*```/.exec(text));
  if (!m) return { content: text.trim(), calls: [] };
  let list;
  try { list = JSON.parse(m[1]); } catch { return { content: text.trim(), calls: [] }; }
  if (!Array.isArray(list)) list = [list];
  const calls = list.filter((c) => c && names.has(c.name)).map((c) => ({ id: `call_${Date.now().toString(36)}${(seq++).toString(36)}`, name: c.name, arguments: JSON.stringify(c.arguments || c.args || {}) }));
  if (!calls.length) return { content: text.trim(), calls: [] };
  return { content: text.replace(m[0], '').trim(), calls };
}
