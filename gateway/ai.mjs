// OpenCrew's own AI for paid plans: the engines call the providers THROUGH the gateway, which
// 1) checks the user's plan and credits, 2) adds the company key (never stored in any engine),
// 3) streams the answer back and 4) charges the real cost of the call (tokens × published price).
// Only reachable from inside the server (Caddy doesn't route /ai), authenticated with a per-user key.
import { readFile, writeFile } from 'node:fs/promises';
import { downloadPriceLists, callCost, normModel } from '../src/core/pricelists.js';

// ---------- plans ----------
// Credits are dollars of AI at cost (what the providers charge us). Shown to users in euros.
export const EUR_PER_USD = 0.93;
export const PLANS = {
  owner: { label: 'Administrador', credits: Infinity, bots: Infinity, routines: Infinity, watchers: Infinity, computerHours: Infinity },
  trial: { label: 'Prueba', days: 7, credits: 1.1, bots: 10, routines: 10, watchers: 10, computerHours: 2 },
  pro: { label: 'Pro', monthly: true, credits: 5.4, bots: Infinity, routines: 100, watchers: 100, computerHours: 20 },
  founder: { label: 'Fundador', monthly: true, credits: 5.4, bots: Infinity, routines: 100, watchers: 100, computerHours: 20 },
  free: { label: 'Gratis (con tus claves)', credits: 0, bots: 3, routines: 3, watchers: 3, computerHours: 0 },
};
const month = () => new Date().toISOString().slice(0, 7);

// The plan that applies right now (a finished trial becomes «free»).
export function planOf(u) {
  if (u.role === 'owner') return 'owner';
  if (u.plan === 'trial' && Date.now() > (u.trialEnds || 0)) return 'free';
  return PLANS[u.plan] ? u.plan : 'free';
}

export function creditState(u) {
  const id = planOf(u);
  const p = PLANS[id];
  if (p.monthly && u.creditMonth !== month()) { u.creditMonth = month(); u.creditUsed = 0; u.creditWarned = 0; }
  const allowance = p.credits;
  const used = (id === 'trial' ? u.trialUsed : u.creditUsed) || 0;
  const topup = u.topup || 0;
  const remaining = allowance === Infinity ? Infinity : Math.max(0, allowance - used) + topup;
  return { plan: id, label: p.label, allowance, used, topup, remaining, trialEnds: id === 'trial' ? u.trialEnds : undefined,
    resets: p.monthly ? `${month()}` : undefined, warned: u.creditWarned || 0 };
}

// What the engine enforces (sent with every request the gateway forwards to it).
export function limitsOf(u) {
  const id = planOf(u);
  const p = PLANS[id];
  const fin = (n) => (n === Infinity ? null : n); // JSON has no Infinity: null = no limit
  return { plan: id, label: p.label, bots: fin(p.bots), routines: fin(p.routines), watchers: fin(p.watchers), computerHours: fin(p.computerHours) };
}

function charge(u, cost) {
  const id = planOf(u);
  const p = PLANS[id];
  if (p.credits === Infinity || !(cost > 0)) return;
  creditState(u); // rolls the month over if needed
  const field = id === 'trial' ? 'trialUsed' : 'creditUsed';
  const left = Math.max(0, p.credits - (u[field] || 0));
  const fromPlan = Math.min(left, cost);
  u[field] = (u[field] || 0) + fromPlan;
  if (cost > fromPlan) u.topup = Math.max(0, (u.topup || 0) - (cost - fromPlan));
  const s = creditState(u);
  const total = s.allowance + s.topup;
  const pct = total ? (s.used / total) * 100 : 100;
  u.creditWarned = s.remaining <= 0 ? 100 : pct >= 80 ? Math.max(u.creditWarned || 0, 80) : u.creditWarned || 0;
}

// ---------- providers ----------
const UPSTREAM = {
  anthropic: { base: 'https://api.anthropic.com', key: 'OC_AI_ANTHROPIC_KEY', paths: [/^\/v1\/messages$/, /^\/v1\/models$/], auth: (k) => ({ 'x-api-key': k }), keyHeader: 'x-api-key' },
  gemini: { base: 'https://generativelanguage.googleapis.com', key: 'OC_AI_GEMINI_KEY', paths: [/^\/v1beta\/models$/, /^\/v1beta\/models\/[\w.-]+:(streamGenerateContent|generateContent)$/], auth: (k) => ({ 'x-goog-api-key': k }), keyHeader: 'x-goog-api-key' },
  openai: { base: 'https://api.openai.com', key: 'OC_AI_OPENAI_KEY', paths: [/^\/v1\/chat\/completions$/, /^\/v1\/models$/], auth: (k) => ({ authorization: `Bearer ${k}` }), keyHeader: 'authorization' },
  xai: { base: 'https://api.x.ai', key: 'OC_AI_XAI_KEY', paths: [/^\/v1\/chat\/completions$/, /^\/v1\/models$/], auth: (k) => ({ authorization: `Bearer ${k}` }), keyHeader: 'authorization' },
};
const companyKey = (p) => process.env[UPSTREAM[p].key] || '';
const upstreamBase = (p) => process.env[`OC_AI_UPSTREAM_${p.toUpperCase()}`] || UPSTREAM[p].base; // tests point it to a fake server
export const aiProviders = () => Object.keys(UPSTREAM).filter(companyKey);

// Reads the usage the provider reports inside its answer, line by line as it streams (or the whole JSON).
function usageReader(provider) {
  const u = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let buf = '';
  let whole = '';
  const take = (o) => {
    if (provider === 'anthropic') {
      const s = o.type === 'message_start' ? o.message?.usage : !o.type || o.type === 'message' ? o.usage : null;
      if (s) { u.cacheRead = s.cache_read_input_tokens || 0; u.cacheWrite = s.cache_creation_input_tokens || 0; u.input = (s.input_tokens || 0) + u.cacheRead + u.cacheWrite; if (s.output_tokens) u.output = s.output_tokens; }
      if (o.type === 'message_delta' && o.usage?.output_tokens) u.output = o.usage.output_tokens;
    } else if (provider === 'gemini') {
      const m = o.usageMetadata;
      if (m) { u.input = m.promptTokenCount || 0; u.output = (m.candidatesTokenCount || 0) + (m.thoughtsTokenCount || 0); u.cacheRead = m.cachedContentTokenCount || 0; }
    } else if (o.usage) {
      u.input = o.usage.prompt_tokens || 0; u.output = o.usage.completion_tokens || 0; u.cacheRead = o.usage.prompt_tokens_details?.cached_tokens || 0;
    }
  };
  const line = (l) => { const t = l.startsWith('data:') ? l.slice(5).trim() : ''; if (t.startsWith('{')) { try { take(JSON.parse(t)); } catch { /* not JSON */ } } };
  return {
    push(text) {
      buf += text;
      if (whole.length < 5_000_000) whole += text;
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(line);
    },
    result() {
      line(buf);
      if (!u.input && !u.output) { try { const o = JSON.parse(whole); take(o); if (Array.isArray(o)) o.forEach(take); } catch { /* streamed */ } }
      return u;
    },
  };
}

export function createAi({ db, save, hmac, same, data }) {
  // ---------- prices (same lists and formula as the engines) ----------
  const FILE = `${data}prices.json`;
  let prices = { at: 0, models: {} };
  const loadPrices = async () => {
    try { prices = JSON.parse(await readFile(FILE, 'utf8')); } catch { /* first run */ }
    if (Date.now() - prices.at < 12 * 3600_000) return;
    const got = await downloadPriceLists(async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(30_000) }); if (!r.ok) throw new Error(`${r.status}`); return r.json(); });
    if (Object.keys(got.models).length) { prices = { at: Date.now(), models: got.models }; await writeFile(FILE, JSON.stringify(prices)).catch(() => {}); }
  };
  loadPrices().catch((e) => console.warn('Precios:', e.message));
  setInterval(() => loadPrices().catch(() => {}), 3600_000).unref();
  // Unknown model: charge as an expensive one, never less than it costs us.
  const SAFE = { input: 15, output: 75 };
  const priceOf = (provider, model) => prices.models[`${provider}/${normModel(model)}`] || SAFE;

  // ---------- who is calling ----------
  // Engine key: «oc_<user>_<proof>»; the proof is derived from the server's master key.
  const keyFor = (uid) => `oc_${uid}_${hmac(`ai-key:${uid}`)}`;
  const userOfKey = (raw) => {
    const k = String(raw || '').replace(/^Bearer /i, '');
    const m = /^oc_(owner|[a-f0-9]{12})_([a-f0-9]{64})$/.exec(k);
    if (!m || !same(k, keyFor(m[1]))) return null;
    return db.users.find((u) => u.id === m[1] && !u.disabled) || null;
  };

  const stat = (uid, cost) => {
    const s = ((db.aiStats ??= {})[month()] ??= {});
    const r = (s[uid] ??= { cost: 0, calls: 0 });
    r.cost += cost; r.calls += 1;
  };

  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const providerError = (res, code, message) => json(res, code, { error: { type: 'opencrew', message } });

  async function handle(req, res, path) {
    // Never from the internet: Caddy adds X-Forwarded-For to everything it forwards.
    if (req.headers['x-forwarded-for']) return json(res, 404, { error: 'No encontrado' });
    if (path === '/ai/status') {
      const u = userOfKey(req.headers.authorization);
      if (!u) return json(res, 401, { error: 'Clave no válida' });
      const c = creditState(u);
      return json(res, 200, { providers: c.remaining > 0 ? aiProviders() : [], credits: { ...c, allowance: c.allowance === Infinity ? null : c.allowance, remaining: c.remaining === Infinity ? null : c.remaining }, limits: limitsOf(u) });
    }
    const m = /^\/ai\/(anthropic|gemini|openai|xai)(\/.*)$/.exec(path);
    if (!m) return json(res, 404, { error: 'No encontrado' });
    const [, provider, rest] = m;
    const up = UPSTREAM[provider];
    if (!up.paths.some((re) => re.test(rest))) return providerError(res, 404, 'Ruta no permitida');
    const u = userOfKey(req.headers[up.keyHeader]);
    if (!u) return providerError(res, 401, 'Clave de OpenCrew no válida');
    if (!companyKey(provider)) return providerError(res, 503, 'OpenCrew no ofrece este proveedor ahora mismo');
    const generating = req.method === 'POST';
    if (generating && !(creditState(u).remaining > 0)) {
      const id = planOf(u);
      return providerError(res, 402, id === 'free' ? 'Tu plan no incluye IA de OpenCrew: añade tu propia clave en Ajustes o pásate a Pro.'
        : id === 'trial' ? 'Te has quedado sin créditos de la prueba gratis. Pásate a Pro o añade tu propia clave en Ajustes.'
          : 'Te has quedado sin créditos de IA este mes. Puedes recargar o esperar al mes que viene (o usar tu propia clave).');
    }
    // Body: read it whole (images and PDFs travel inside), make sure the answer reports its usage.
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > 30_000_000) return providerError(res, 413, 'Petición demasiado grande'); chunks.push(c); }
    let payload = Buffer.concat(chunks);
    let model = (/models\/([\w.-]+):/.exec(rest) || [])[1] || '';
    if (generating && provider !== 'gemini') {
      try {
        const b = JSON.parse(payload.toString('utf8'));
        model = String(b.model || '');
        if (b.stream && (provider === 'openai' || provider === 'xai')) b.stream_options = { ...(b.stream_options || {}), include_usage: true };
        payload = Buffer.from(JSON.stringify(b));
      } catch { return providerError(res, 400, 'Petición no válida'); }
    }
    const url = new URL(`${upstreamBase(provider)}${rest}`);
    for (const [k, v] of new URL(req.url, 'http://x').searchParams) if (k !== 'key') url.searchParams.set(k, v);
    const headers = { 'content-type': 'application/json', ...up.auth(companyKey(provider)) };
    if (provider === 'anthropic') { headers['anthropic-version'] = req.headers['anthropic-version'] || '2023-06-01'; if (req.headers['anthropic-beta']) headers['anthropic-beta'] = req.headers['anthropic-beta']; }
    let r;
    const ctrl = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ctrl.abort(); });
    try {
      r = await fetch(url, { method: req.method, headers, body: generating ? payload : undefined, signal: ctrl.signal });
    } catch (e) { return providerError(res, 502, `El proveedor no responde (${e.message})`); }
    const h = { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' };
    for (const k of ['retry-after', 'x-ratelimit-reset-requests']) if (r.headers.get(k)) h[k] = r.headers.get(k);
    res.writeHead(r.status, h);
    const reader = usageReader(provider);
    const dec = new TextDecoder();
    try {
      for await (const c of r.body) {
        res.write(c);
        if (generating) reader.push(dec.decode(c, { stream: true }));
      }
    } catch { /* client went away: still charge what was produced */ }
    res.end();
    if (generating && r.ok) {
      const usage = reader.result();
      const cost = callCost(priceOf(provider, model), usage, provider);
      charge(u, cost);
      stat(u.id, cost);
      save();
    }
  }

  return { handle, keyFor, creditState, limitsOf, planOf };
}
