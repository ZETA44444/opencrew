// One function, callModel(), that talks to every supported AI provider.
// Internal message format (provider-neutral):
//   { role: 'user', content }
//   { role: 'assistant', content, toolCalls: [{ id, name, args }], raw }
//   { role: 'tool', toolCallId, name, content }
import { getDb, newId } from './store.js';

export const PROVIDERS = [
  { id: 'anthropic', label: 'Claude (Anthropic)', kind: 'anthropic', env: 'ANTHROPIC_API_KEY',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'] },
  { id: 'gemini', label: 'Gemini (Google)', kind: 'gemini', env: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey',
    models: ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview'] }, // with a key, the live list replaces these
  { id: 'openai', label: 'OpenAI', kind: 'openai', env: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'] },
  { id: 'xai', label: 'Grok (xAI)', kind: 'openai', env: 'XAI_API_KEY', baseUrl: 'https://api.x.ai/v1',
    keyUrl: 'https://console.x.ai',
    models: ['grok-4.7', 'grok-4.3', 'grok-4-fast'] }, // with a key, the live list replaces these
  { id: 'openrouter', label: 'OpenRouter (cualquier modelo)', kind: 'openai', env: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys',
    models: ['openrouter/auto'] },
  { id: 'ollama', label: 'Ollama (local, gratis)', kind: 'openai', noKey: true,
    baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.2', 'qwen3'] },
  { id: 'auto', label: 'Automático (el más barato que sirva)', kind: 'auto', noKey: true, models: ['auto'] },
  { id: 'demo', label: 'Demo (sin clave)', kind: 'demo', noKey: true, models: ['demo'] },
];

export const providerById = (id) => PROVIDERS.find((p) => p.id === id);

// OpenCrew's own AI (paid plans, only on an OpenCrew server): set by server/index.mjs as
// { url, key, providers: Set }. Your own key always comes first and is never charged in credits.
const ocAi = () => globalThis.OPENCREW_AI;
export const usesOpenCrew = (providerId) => !getDb().keys[providerId] && !!ocAi()?.providers?.has(providerId);
export function getKey(providerId) {
  return getDb().keys[providerId] || (usesOpenCrew(providerId) ? ocAi().key : '');
}
// Where to send the calls: the provider itself, or the gateway, which adds OpenCrew's key and charges credits.
const DIRECT = { anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com' };
const apiBase = (providerId) => (usesOpenCrew(providerId) ? `${ocAi().url}/${providerId}` : DIRECT[providerId]);
const openaiBase = (p) => (usesOpenCrew(p.id) ? `${ocAi().url}/${p.id}/v1` : p.baseUrl);

// Models fetched live from each provider's API (so the list never goes stale).
const liveModels = {};

const SKIP_MODEL = /(embed|tts|audio|image|imagen|veo|live|native|aqa|learnlm|robotics|computer-use|whisper|dall-e|moderation|transcribe|realtime|search|sora|codex)/i;

export async function refreshModels(providerId) {
  const p = providerById(providerId);
  if (!p || p.kind === 'demo') return null;
  const key = getKey(providerId);
  if (!p.noKey && !key) return null;
  let ids = [];
  try {
    if (p.kind === 'gemini') {
      const res = await fetch(`${apiBase('gemini')}/v1beta/models?pageSize=1000`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15_000) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || res.status);
      ids = (data.models || [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''))
        .filter((id) => id.startsWith('gemini') && !SKIP_MODEL.test(id));
    } else if (p.kind === 'anthropic') {
      const res = await fetch(`${apiBase('anthropic')}/v1/models?limit=100`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, signal: AbortSignal.timeout(15_000) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || res.status);
      ids = (data.data || []).map((m) => m.id);
    } else {
      const res = await fetch(`${openaiBase(p)}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(15_000) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || res.status);
      ids = (data.data || []).map((m) => m.id).filter((id) => !SKIP_MODEL.test(id));
    }
  } catch (e) {
    if (!p.noKey) console.warn(`No se pudo leer la lista de modelos de ${p.label}: ${e.message}`);
    return null;
  }
  if (!ids.length) return null;
  // Newest-looking first (higher version numbers sort first), "latest" aliases on top.
  ids.sort((a, b) => Number(/latest/.test(b)) - Number(/latest/.test(a)) || b.localeCompare(a, undefined, { numeric: true }));
  liveModels[providerId] = ids;
  return ids;
}

// Only ask providers we can use: ones with a key, and Ollama only if some bot uses it.
export const refreshAllModels = () => Promise.all(PROVIDERS
  .filter((p) => (p.noKey ? getDb().bots.some((b) => b.provider === p.id) : !!getKey(p.id)))
  .map((p) => refreshModels(p.id)));

export const modelsOf = (providerId) => liveModels[providerId] || providerById(providerId)?.models || [];

// A sensible default: newest stable "flash" for Gemini, "sonnet" for Claude, "mini" for OpenAI, else the first.
export function defaultModel(providerId) {
  const list = modelsOf(providerId);
  const prefer = { gemini: /^gemini-[\d.]+-flash$/, anthropic: /sonnet/, openai: /^gpt-[\d.]+-mini$/ }[providerId];
  return (prefer && list.find((m) => prefer.test(m))) || list[0];
}

export const publicProviders = () => PROVIDERS.map((p) => ({
  id: p.id, label: p.label, models: modelsOf(p.id), defaultModel: defaultModel(p.id), live: !!liveModels[p.id], keyUrl: p.keyUrl, noKey: !!p.noKey, bridge: !!p.bridge,
  hasKey: p.noKey ? true : !!getKey(p.id),
  included: usesOpenCrew(p.id), // comes with your OpenCrew plan (no key needed)
  keySource: p.noKey ? null : getKey(p.id) ? 'app' : null,
}));

// ---------- helpers ----------
const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch with automatic retries when the provider is overloaded or rate-limited.
// Returns an OK Response (body not read yet) or throws a friendly error.
async function request(url, headers, body, label, signal, attempts = 3) {
  for (let i = 1; ; i++) {
    let res;
    try {
      const timeout = AbortSignal.timeout(180_000);
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (e) {
      if (signal?.aborted) throw abortError();
      if (i < attempts) { await sleep(2000 * i); continue; }
      const local = /localhost|127\.0\.0\.1/.test(url);
      throw Object.assign(new Error(`${label}: sin respuesta (${e.name === 'TimeoutError' ? 'tardó demasiado' : e.message}).${local ? ' ¿Está Ollama abierto? Arráncalo con OLLAMA_ORIGINS="*" ollama serve' : ' Prueba otro modelo.'}`), { status: 0 });
    }
    if (res.ok) return res;
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (RETRYABLE.has(res.status) && i < attempts) { await sleep(2000 * i); continue; }
    const err = Array.isArray(data) ? data[0]?.error : data?.error;
    const msg = err?.message || data?.message || text.slice(0, 300);
    const hint = res.status === 503 || res.status === 529 ? ' → El modelo está saturado ahora mismo. Elige otro modelo en el selector (p. ej. uno "lite" o "latest") o inténtalo en un rato.'
      : res.status === 429 ? ' → Has llegado al límite de uso de tu clave. Espera un poco o usa otro modelo.'
      : res.status === 404 ? ' → Ese modelo ya no existe. Elige otro en el selector de modelo.'
      : res.status === 401 || res.status === 403 ? ' → La API key no es válida o no tiene permiso. Revísala en Ajustes.' : '';
    throw Object.assign(new Error(`${label} ${res.status}: ${msg}${hint}`), { status: res.status });
  }
}

function abortError() {
  const e = new Error('Detenido por el usuario');
  e.name = 'AbortError';
  return e;
}

// Reads a Server-Sent Events body and yields each parsed `data:` JSON payload.
async function* sse(res, signal) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      if (signal?.aborted) throw abortError();
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
        const data = chunk.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        try { yield JSON.parse(data); } catch { /* ignore keep-alives */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Merge consecutive plain-text messages with the same role (some APIs require alternation).
function normalize(messages) {
  const out = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && m.role === last.role && m.role !== 'tool' && !m.toolCalls?.length && !last.toolCalls?.length) {
      last.content = `${last.content}\n\n${m.content}`;
      if (m.attachments?.length) last.attachments = [...(last.attachments || []), ...m.attachments];
    } else out.push({ ...m });
  }
  return out;
}

// ---------- attachments ----------
// Text files are already inlined into the message text by the UI; here we only send images and PDFs.
const split = (dataUrl) => { const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl || ''); return m ? { mime: m[1], data: m[2] } : null; };
const media = (m) => (m.attachments || []).filter((a) => a.dataUrl && (a.kind === 'image' || a.kind === 'pdf'));

const parseArgs = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

// ---------- Anthropic ----------
async function callAnthropic({ model, apiKey, system, messages, tools, onText, signal, forceTool }) {
  const out = [];
  for (const m of normalize(messages)) {
    if (m.role === 'user') {
      const files = media(m);
      if (!files.length) out.push({ role: 'user', content: m.content || '(vacío)' });
      else {
        const blocks = files.map((a) => {
          const { mime, data } = split(a.dataUrl);
          return a.kind === 'pdf'
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
            : { type: 'image', source: { type: 'base64', media_type: mime, data } };
        });
        out.push({ role: 'user', content: [...blocks, { type: 'text', text: m.content || '(mira el adjunto)' }] });
      }
    } else if (m.role === 'assistant') {
      const c = [];
      if (m.content) c.push({ type: 'text', text: m.content });
      for (const t of m.toolCalls || []) c.push({ type: 'tool_use', id: t.id, name: t.name, input: t.args || {} });
      out.push({ role: 'assistant', content: c.length ? c : [{ type: 'text', text: '…' }] });
    } else if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    }
  }
  // Prompt cache: tools, instructions and the conversation so far are the same on every step of a task,
  // so they are marked for caching and re-read at ~10 % of the price (Anthropic keeps them ~5 minutes).
  const CACHE = { type: 'ephemeral' };
  const last = out[out.length - 1];
  if (last) {
    if (typeof last.content === 'string') last.content = [{ type: 'text', text: last.content || '(vacío)' }];
    last.content[last.content.length - 1] = { ...last.content[last.content.length - 1], cache_control: CACHE };
  }
  const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  if (toolDefs.length) toolDefs[toolDefs.length - 1].cache_control = CACHE;
  const res = await request(`${apiBase('anthropic')}/v1/messages`,
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    {
      model, max_tokens: 8192, system: [{ type: 'text', text: system, cache_control: CACHE }], messages: out, stream: true,
      ...(tools.length && { tools: toolDefs }),
      ...(tools.length && forceTool && { tool_choice: { type: 'any' } }),
    }, 'Anthropic', signal);
  let text = '';
  const blocks = {};
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for await (const ev of sse(res, signal)) {
    if (ev.type === 'message_start') {
      const u = ev.message?.usage || {};
      usage.cacheRead = u.cache_read_input_tokens || 0;
      usage.cacheWrite = u.cache_creation_input_tokens || 0;
      usage.input = (u.input_tokens || 0) + usage.cacheRead + usage.cacheWrite; // total; the cached part is priced apart
    }
    if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
      blocks[ev.index] = { id: ev.content_block.id, name: ev.content_block.name, json: '' };
    } else if (ev.type === 'content_block_delta') {
      if (ev.delta.type === 'text_delta') { text += ev.delta.text; onText?.(ev.delta.text); }
      else if (ev.delta.type === 'input_json_delta' && blocks[ev.index]) blocks[ev.index].json += ev.delta.partial_json;
    } else if (ev.type === 'message_delta') usage.output = ev.usage?.output_tokens || usage.output;
    else if (ev.type === 'error') throw Object.assign(new Error(`Anthropic: ${ev.error?.message || 'error en el streaming'}`), { status: ev.error?.type === 'overloaded_error' ? 529 : ev.error?.type === 'rate_limit_error' ? 429 : 500 });
  }
  const toolCalls = Object.values(blocks).map((b) => ({ id: b.id, name: b.name, args: parseArgs(b.json) }));
  return { text, toolCalls, usage };
}

// ---------- OpenAI-compatible (OpenAI, xAI, OpenRouter, Ollama) ----------
async function callOpenAI({ provider, model, apiKey, system, messages, tools, onText, signal, forceTool }) {
  const out = [{ role: 'system', content: system }];
  for (const m of normalize(messages)) {
    if (m.role === 'user') {
      const files = media(m);
      if (!files.length) out.push({ role: 'user', content: m.content });
      else {
        out.push({ role: 'user', content: [
          { type: 'text', text: m.content || '(mira el adjunto)' },
          ...files.map((a) => (a.kind === 'pdf'
            ? { type: 'file', file: { filename: a.name, file_data: a.dataUrl } }
            : { type: 'image_url', image_url: { url: a.dataUrl } })),
        ] });
      }
    } else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || null };
      if (m.toolCalls?.length) msg.tool_calls = m.toolCalls.map((t) => ({
        id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args || {}) },
      }));
      out.push(msg);
    } else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
  }
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  if (provider.id === 'openrouter') headers['X-Title'] = 'OpenCrew';
  const res = await request(`${openaiBase(provider)}/chat/completions`, headers, {
    model, messages: out, stream: true, stream_options: { include_usage: true },
    ...(tools.length && { tools: tools.map((t) => ({ type: 'function', function: t })) }),
    ...(tools.length && forceTool && { tool_choice: 'required' }),
  }, provider.label, signal);
  let text = '';
  const calls = [];
  let usage;
  for await (const ev of sse(res, signal)) {
    if (ev.error) throw Object.assign(new Error(`${provider.label}: ${ev.error.message || 'error en el streaming'}`), { status: Number(ev.error.code) || 503 });
    const delta = ev.choices?.[0]?.delta || {};
    if (delta.content) { text += delta.content; onText?.(delta.content); }
    for (const tc of delta.tool_calls || []) {
      const c = (calls[tc.index ?? calls.length] ??= { id: '', name: '', args: '' });
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.name += tc.function.name;
      if (tc.function?.arguments) c.args += tc.function.arguments;
    }
    if (ev.usage) usage = { input: ev.usage.prompt_tokens || 0, output: ev.usage.completion_tokens || 0, cacheRead: ev.usage.prompt_tokens_details?.cached_tokens || 0 }; // automatic cache (OpenAI, xAI)
  }
  const toolCalls = calls.filter(Boolean).map((c) => ({ id: c.id || newId(), name: c.name, args: parseArgs(c.args) }));
  return { text, toolCalls, usage };
}

// ---------- Gemini ----------
// Gemini accepts only a subset of JSON Schema: keep the parts it understands.
function geminiSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const o = {};
  let type = s.type;
  if (Array.isArray(type)) { type = type.find((t) => t !== 'null') || 'string'; o.nullable = true; }
  if (!type && (s.anyOf || s.oneOf)) {
    const alt = (s.anyOf || s.oneOf).find((x) => x && x.type && x.type !== 'null');
    if (alt) return { ...geminiSchema(alt), ...(s.description && { description: s.description }) };
  }
  if (type) o.type = String(type).toUpperCase();
  if (s.description) o.description = String(s.description).slice(0, 1000);
  if (Array.isArray(s.enum)) o.enum = s.enum.map(String);
  if (s.format && ['enum', 'date-time'].includes(s.format)) o.format = s.format;
  if (s.properties && typeof s.properties === 'object') {
    o.type ??= 'OBJECT';
    o.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, geminiSchema(v)]));
    if (Array.isArray(s.required)) o.required = s.required.filter((r) => r in s.properties);
  }
  if (s.items) o.items = geminiSchema(Array.isArray(s.items) ? s.items[0] : s.items);
  if (o.type === 'ARRAY' && !o.items) o.items = { type: 'STRING' };
  if (!o.type) o.type = 'STRING';
  return o;
}

async function callGemini({ model, apiKey, system, messages, tools, onText, signal, forceTool }) {
  const contents = [];
  for (const m of normalize(messages)) {
    if (m.role === 'user') {
      const parts = media(m).map((a) => { const { mime, data } = split(a.dataUrl); return { inlineData: { mimeType: mime, data } }; });
      contents.push({ role: 'user', parts: [...parts, { text: m.content || '(mira el adjunto)' }] });
    }
    else if (m.role === 'assistant') {
      // Re-send Gemini's own parts when we have them (keeps "thought signatures" intact).
      if (m.raw?.gemini) contents.push({ role: 'model', parts: m.raw.gemini });
      else {
        const parts = [];
        if (m.content) parts.push({ text: m.content });
        for (const t of m.toolCalls || []) parts.push({ functionCall: { name: t.name, args: t.args || {} } });
        contents.push({ role: 'model', parts: parts.length ? parts : [{ text: '…' }] });
      }
    } else if (m.role === 'tool') {
      const part = { functionResponse: { name: m.name, response: { result: m.content } } };
      const last = contents[contents.length - 1];
      if (last?.role === 'user' && last.parts[0]?.functionResponse) last.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
    }
  }
  const url = `${apiBase('gemini')}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const res = await request(url, { 'x-goog-api-key': apiKey }, {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    ...(tools.length && { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.parameters) })) }] }),
    ...(tools.length && forceTool && { toolConfig: { functionCallingConfig: { mode: 'ANY' } } }),
  }, 'Gemini', signal);
  const parts = [];
  let usage;
  let blocked;
  for await (const ev of sse(res, signal)) {
    if (ev.error) throw Object.assign(new Error(`Gemini: ${ev.error.message}`), { status: Number(ev.error.code) || 503 });
    for (const p of ev.candidates?.[0]?.content?.parts || []) {
      parts.push(p);
      if (p.text && !p.thought) onText?.(p.text);
    }
    if (ev.usageMetadata) usage = { input: ev.usageMetadata.promptTokenCount || 0, output: (ev.usageMetadata.candidatesTokenCount || 0) + (ev.usageMetadata.thoughtsTokenCount || 0), cacheRead: ev.usageMetadata.cachedContentTokenCount || 0 }; // implicit cache
    if (ev.promptFeedback?.blockReason) blocked = ev.promptFeedback.blockReason;
  }
  if (!parts.length && blocked) throw new Error(`Gemini bloqueó la respuesta: ${blocked}`);
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  const toolCalls = parts.filter((p) => p.functionCall).map((p) => ({ id: newId(), name: p.functionCall.name, args: p.functionCall.args || {} }));
  return { text, toolCalls, raw: { gemini: parts }, usage };
}

// ---------- Demo (no key, deterministic, for testing the app) ----------
async function demoStream(text, onText, signal) {
  // Simulate a model typing, a few words at a time.
  const pieces = text.match(/\S+\s*/g) || [];
  for (let i = 0; i < pieces.length; i += 3) {
    if (signal?.aborted) throw abortError();
    onText?.(pieces.slice(i, i + 3).join(''));
    await sleep(35);
  }
  return { text, toolCalls: [], usage: { input: 50 + Math.round(text.length / 8), output: Math.round(text.length / 4) } };
}

async function callDemo({ system, messages, tools, onText, signal }) {
  await sleep(400);
  if (signal?.aborted) throw abortError();
  const me = system.match(/^Eres (.+?),/)?.[1] || 'un bot';
  const last = messages[messages.length - 1];
  if (/PROPUESTAS_JSON/.test(system)) {
    return { text: JSON.stringify([
      { title: 'Resumen de noticias de IA', prompt: '@Nova resume las noticias más importantes de inteligencia artificial de esta semana' },
      { title: 'Ideas de posts para redes', prompt: '@Quill escribe 3 ideas de posts para LinkedIn sobre mi proyecto' },
      { title: 'Crear una rutina matinal', prompt: 'Ayúdame a crear una rutina que cada mañana a las 8 me haga un resumen del día' },
    ]), toolCalls: [] };
  }
  if (last?.role === 'tool') {
    return demoStream(`**(modo demo)** Listo. Resultado de \`${last.name}\`:\n\n> ${String(last.content).slice(0, 400).replace(/\n/g, '\n> ')}`, onText, signal);
  }
  const userText = String(last?.content || '').replace(/^\[Tarea delegada por .+?\]\n/, '');
  const atts = last?.attachments || [];
  if (atts.length) {
    return demoStream(`**(modo demo)** He recibido ${atts.length === 1 ? 'un adjunto' : `${atts.length} adjuntos`}: ${atts.map((a) => `**${a.name}** (${a.kind}, ${Math.round((a.size || 0) / 1024)} KB)`).join(', ')}. Con un modelo real (Claude, Gemini u OpenAI) podría leerlos y analizarlos.`, onText, signal);
  }
  const has = (n) => tools.some((t) => t.name === n);
  if (/chat de grupo/.test(system)) {
    // Group demo: the lead hands off to whoever you @mention; others just answer.
    const fromUser = userText.startsWith('[Usuario]: ');
    const text = userText.replace(/^\[[^\]]+\]: /, '');
    const other = [...text.matchAll(/@([\p{L}\d_-]+)/gu)].map((m) => m[1]).find((n) => n.toLowerCase() !== me.toLowerCase());
    if (fromUser && other) return demoStream(`**(modo demo)** Entendido. @${other}, ¿te encargas tú de esta parte?`, onText, signal);
    return demoStream(`**(modo demo)** Soy ${me}. Aquí va mi parte sobre: _"${text.slice(0, 120)}"_`, onText, signal);
  }
  const mention = userText.match(/@([\p{L}\d_-]+)/u);
  if (mention && has('delegate_to_bot')) {
    return { text: '', toolCalls: [{ id: newId(), name: 'delegate_to_bot', args: { bot_name: mention[1], task: userText.replace(mention[0], '').trim() } }] };
  }
  const sk = userText.match(/guarda (?:una )?skill (?:llamada )?«?([^:»]+)»?:\s*([\s\S]+)/i);
  if (sk && has('save_skill')) return { text: '', toolCalls: [{ id: newId(), name: 'save_skill', args: { name: sk[1].trim(), description: 'Guardada desde el chat', steps: sk[2].trim() } }] };
  const us = userText.match(/usa (?:la )?skill «?([^»]+?)»?$/i);
  if (us && has('use_skill')) return { text: '', toolCalls: [{ id: newId(), name: 'use_skill', args: { name: us[1].trim() } }] };
  if (/gast|cuota|consumo|cuánto (he|llevo)/i.test(userText) && has('usage_report')) return { text: '', toolCalls: [{ id: newId(), name: 'usage_report', args: { days: 30 } }] };
  if (/proveedor|clave|salud|saturad/i.test(userText) && has('provider_status')) return { text: '', toolCalls: [{ id: newId(), name: 'provider_status', args: {} }] };
  const mc = userText.match(/^usa (?:la herramienta )?((?:mcp|github)_[\w-]+)\s*(\{[\s\S]*\})?/i);
  if (mc && has(mc[1])) {
    let args = {};
    try { args = mc[2] ? JSON.parse(mc[2]) : {}; } catch { /* keep empty */ }
    return { text: '', toolCalls: [{ id: newId(), name: mc[1], args }] };
  }
  const im = userText.match(/^(?:genera|dibuja|crea)(?:me)? (?:una )?imagen (?:de |con )?(.+)/i);
  if (im && has('generate_image')) return { text: '', toolCalls: [{ id: newId(), name: 'generate_image', args: { prompt: im[1] } }] };
  const js = userText.match(/^(?:ejecuta|run)(?: este código)?:\s*([\s\S]+)/i);
  if (js && has('run_javascript')) return { text: '', toolCalls: [{ id: newId(), name: 'run_javascript', args: { code: js[1] } }] };
  const se = userText.match(/^(?:busca|buscar|search)(?: en internet)?:?\s+(.+)/i);
  if (se && has('web_search')) return { text: '', toolCalls: [{ id: newId(), name: 'web_search', args: { query: se[1] } }] };
  const rt = userText.match(/(?:todos los|cada) (lunes|martes|miércoles|jueves|viernes|sábados?|domingos?|días?|laborables) a las (\d{1,2})(?::(\d{2}))?,?\s*(.+)/i);
  if (rt && has('create_routine')) {
    return { text: '', toolCalls: [{ id: newId(), name: 'create_routine', args: { name: rt[4].slice(0, 40), prompt: rt[4], schedule_type: 'daily', time: `${rt[2]}:${rt[3] || '00'}`, days: /^d[ií]a/i.test(rt[1]) ? 'todos' : rt[1] } }] };
  }
  const mk = userText.match(/crea(?:r|me)? un bot (?:llamado|que se llame) ([\p{L}\d_-]+)(?:,? (?:que|para) (.+))?/iu);
  if (mk && has('create_bot')) {
    return { text: '', toolCalls: [{ id: newId(), name: 'create_bot', args: { name: mk[1], title: 'Asistente', description: mk[2] || 'Bot creado desde el chat', provider: 'demo' } }] };
  }
  const url = userText.match(/https?:\/\/\S+/);
  if (url && has('fetch_url')) return { text: '', toolCalls: [{ id: newId(), name: 'fetch_url', args: { url: url[0] } }] };
  const rem = userText.match(/^(?:recuerda|remember)(?: que)?[:,]?\s+(.+)/i);
  if (rem && has('save_memory')) return { text: '', toolCalls: [{ id: newId(), name: 'save_memory', args: { fact: rem[1] } }] };
  if (/^(?:crea|haz)(?:me)? (?:una? )?(?:página|dashboard|panel)/i.test(userText) && has('write_artifact')) {
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>Dashboard demo</title><style>body{font-family:system-ui;background:#0b0b0c;color:#eee;padding:24px}h1{font-weight:600}.kpis{display:flex;gap:12px}.kpi{background:#1c1c1e;border-radius:12px;padding:14px 18px}.kpi b{display:block;font-size:26px}canvas{margin-top:20px;background:#141415;border-radius:12px}</style></head><body><h1>Dashboard demo</h1><div class="kpis"><div class="kpi">Visitas<b>12.480</b></div><div class="kpi">Ventas<b>312</b></div><div class="kpi">Conversión<b>2,5 %</b></div></div><canvas id="c" width="560" height="220"></canvas><script>const c=document.getElementById("c").getContext("2d");const d=[30,45,38,60,72,66,90];c.strokeStyle="#7dd3fc";c.lineWidth=3;c.beginPath();d.forEach((v,i)=>{const x=30+i*80,y=200-v*2;i?c.lineTo(x,y):c.moveTo(x,y)});c.stroke();</script></body></html>';
    return { text: '', toolCalls: [{ id: newId(), name: 'write_artifact', args: { filename: 'dashboard.html', content: html } }] };
  }
  if (/^(?:guarda|crea) (?:un )?(?:archivo|documento)/i.test(userText) && has('write_artifact')) {
    return { text: '', toolCalls: [{ id: newId(), name: 'write_artifact', args: { filename: 'nota-demo.md', content: `# Nota\n\n${userText}\n` } }] };
  }
  return demoStream(
    `**(modo demo)** Hola, soy ${me}. No estoy conectado a ningún modelo real todavía.\n\nHas dicho: _"${userText.slice(0, 200)}"_\n\nPara que piense de verdad, abre **Ajustes y claves**, añade tu API key y cámbiame el modelo en el selector de abajo. Prueba también:\n- \`@Nova investiga algo\` (delegar)\n- \`recuerda que me gusta el café\` (memoria)\n- \`guarda un archivo con ideas\` (artefacto)`,
    onText, signal);
}

// When a model is overloaded, rate-limited, retired or not answering, these are tried next:
// other models of the same provider first, then the default model of other providers you have a key for.
export function fallbackModels(providerId, model, { otherProvidersOnly = false } = {}) {
  const out = [];
  if (otherProvidersOnly) model = null;
  const same = modelsOf(providerId).filter((m) => m !== model);
  // Cheapest/most available first.
  const pref = [/flash-lite-latest/, /flash-latest/, /lite|mini|haiku|fast|nano/, /-latest$/, /./];
  if (!otherProvidersOnly) for (const re of pref) for (const m of same) if (re.test(m) && !out.some((o) => o.model === m) && out.length < 2) out.push({ provider: providerId, model: m });
  for (const p of PROVIDERS) {
    if (p.id === providerId || p.noKey || !getKey(p.id) || !defaultModel(p.id)) continue;
    out.push({ provider: p.id, model: defaultModel(p.id) });
  }
  return out.slice(0, 4);
}
export const shouldFallBack = (e) => !!e && e.name !== 'AbortError' && [0, 401, 403, 404, 408, 429, 500, 502, 503, 504, 529].includes(e.status);

// onText(delta) is called as text arrives; signal (AbortSignal) stops the call.
export async function callModel({ providerId, model, system, messages, tools, onText, signal, forceTool = false }) {
  const provider = providerById(providerId);
  if (!provider) throw new Error(`Proveedor desconocido: ${providerId}`);
  const apiKey = getKey(providerId);
  if (!provider.noKey && !apiKey) throw Object.assign(new Error(`Falta la API key de ${provider.label}. Añádela en Ajustes y claves.`), { status: 401 });
  const args = { provider, model, apiKey, system, messages, tools, onText, signal, forceTool };
  switch (provider.kind) {
    case 'anthropic': return callAnthropic(args);
    case 'gemini': return callGemini(args);
    case 'openai': return callOpenAI(args);
    case 'demo': return callDemo(args);
    case 'auto': return callDemo(args); // only reached when you have no keys at all (the agent routes first)
    default: throw new Error(`Tipo de proveedor no soportado: ${provider.kind}`);
  }
}
