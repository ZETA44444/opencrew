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
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'] },
  { id: 'openai', label: 'OpenAI', kind: 'openai', env: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-5', 'gpt-5-mini'] },
  { id: 'xai', label: 'Grok (xAI)', kind: 'openai', env: 'XAI_API_KEY', baseUrl: 'https://api.x.ai/v1',
    keyUrl: 'https://console.x.ai',
    models: ['grok-4', 'grok-4-fast'] },
  { id: 'openrouter', label: 'OpenRouter (cualquier modelo)', kind: 'openai', env: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys',
    models: ['openrouter/auto'] },
  { id: 'ollama', label: 'Ollama (local, gratis)', kind: 'openai', noKey: true,
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
    models: ['llama3.2', 'qwen3'] },
  { id: 'demo', label: 'Demo (sin clave)', kind: 'demo', noKey: true, models: ['demo'] },
];

export const providerById = (id) => PROVIDERS.find((p) => p.id === id);

export function getKey(providerId) {
  const p = providerById(providerId);
  if (!p) return '';
  const saved = getDb().keys[providerId];
  if (saved) return saved;
  if (p.env && process.env[p.env]) return process.env[p.env];
  if (providerId === 'gemini' && process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  return '';
}

export const publicProviders = () => PROVIDERS.map((p) => ({
  id: p.id, label: p.label, models: p.models, keyUrl: p.keyUrl, noKey: !!p.noKey,
  hasKey: p.noKey ? true : !!getKey(p.id),
  keySource: p.noKey ? null : getDb().keys[p.id] ? 'app' : getKey(p.id) ? 'env' : null,
}));

// ---------- helpers ----------
async function postJson(url, headers, body, label) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || text.slice(0, 300);
    throw new Error(`${label} ${res.status}: ${msg}`);
  }
  return data;
}

// Merge consecutive plain-text messages with the same role (some APIs require alternation).
function normalize(messages) {
  const out = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && m.role === last.role && m.role !== 'tool' && !m.toolCalls?.length && !last.toolCalls?.length) {
      last.content = `${last.content}\n\n${m.content}`;
    } else out.push({ ...m });
  }
  return out;
}

// ---------- Anthropic ----------
async function callAnthropic({ model, apiKey, system, messages, tools }) {
  const out = [];
  for (const m of normalize(messages)) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content || '(vacío)' });
    else if (m.role === 'assistant') {
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
  const data = await postJson('https://api.anthropic.com/v1/messages',
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    {
      model, max_tokens: 8192, system, messages: out,
      ...(tools.length && { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }),
    }, 'Anthropic');
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const toolCalls = data.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input }));
  return { text, toolCalls, usage: data.usage };
}

// ---------- OpenAI-compatible (OpenAI, xAI, OpenRouter, Ollama) ----------
async function callOpenAI({ provider, model, apiKey, system, messages, tools }) {
  const out = [{ role: 'system', content: system }];
  for (const m of normalize(messages)) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || null };
      if (m.toolCalls?.length) msg.tool_calls = m.toolCalls.map((t) => ({
        id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args || {}) },
      }));
      out.push(msg);
    } else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
  }
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  if (provider.id === 'openrouter') { headers['HTTP-Referer'] = 'https://github.com/opencrew'; headers['X-Title'] = 'OpenCrew'; }
  const data = await postJson(`${provider.baseUrl}/chat/completions`, headers, {
    model, messages: out,
    ...(tools.length && { tools: tools.map((t) => ({ type: 'function', function: t })) }),
  }, provider.label);
  const msg = data.choices?.[0]?.message || {};
  const toolCalls = (msg.tool_calls || []).map((tc) => {
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* keep empty */ }
    return { id: tc.id || newId(), name: tc.function.name, args };
  });
  return { text: msg.content || '', toolCalls, usage: data.usage };
}

// ---------- Gemini ----------
function geminiSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'additionalProperties') continue;
    if (k === 'type') o.type = String(v).toUpperCase();
    else if (k === 'properties') o.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, geminiSchema(pv)]));
    else if (k === 'items') o.items = geminiSchema(v);
    else o[k] = v;
  }
  return o;
}

async function callGemini({ model, apiKey, system, messages, tools }) {
  const contents = [];
  for (const m of normalize(messages)) {
    if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: m.content || '(vacío)' }] });
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const data = await postJson(url, { 'x-goog-api-key': apiKey }, {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    ...(tools.length && { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.parameters) })) }] }),
  }, 'Gemini');
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  const toolCalls = parts.filter((p) => p.functionCall).map((p) => ({ id: newId(), name: p.functionCall.name, args: p.functionCall.args || {} }));
  if (!parts.length && data.promptFeedback?.blockReason) throw new Error(`Gemini bloqueó la respuesta: ${data.promptFeedback.blockReason}`);
  return { text, toolCalls, raw: { gemini: parts }, usage: data.usageMetadata };
}

// ---------- Demo (no key, deterministic, for testing the app) ----------
async function callDemo({ system, messages, tools }) {
  await new Promise((r) => setTimeout(r, 400));
  const me = system.match(/^Eres (.+?),/)?.[1] || 'un bot';
  const last = messages[messages.length - 1];
  if (last?.role === 'tool') {
    return { text: `**(modo demo)** Listo. Resultado de \`${last.name}\`:\n\n> ${String(last.content).slice(0, 400).replace(/\n/g, '\n> ')}`, toolCalls: [] };
  }
  const userText = String(last?.content || '').replace(/^\[Tarea delegada por .+?\]\n/, '');
  const has = (n) => tools.some((t) => t.name === n);
  const mention = userText.match(/@([\p{L}\d_-]+)/u);
  if (mention && has('delegate_to_bot')) {
    return { text: '', toolCalls: [{ id: newId(), name: 'delegate_to_bot', args: { bot_name: mention[1], task: userText.replace(mention[0], '').trim() } }] };
  }
  const url = userText.match(/https?:\/\/\S+/);
  if (url && has('fetch_url')) return { text: '', toolCalls: [{ id: newId(), name: 'fetch_url', args: { url: url[0] } }] };
  const rem = userText.match(/^(?:recuerda|remember)(?: que)?[:,]?\s+(.+)/i);
  if (rem && has('save_memory')) return { text: '', toolCalls: [{ id: newId(), name: 'save_memory', args: { fact: rem[1] } }] };
  if (/^(?:guarda|crea) (?:un )?(?:archivo|documento)/i.test(userText) && has('write_artifact')) {
    return { text: '', toolCalls: [{ id: newId(), name: 'write_artifact', args: { filename: 'nota-demo.md', content: `# Nota\n\n${userText}\n` } }] };
  }
  return {
    text: `**(modo demo)** Hola, soy ${me}. No estoy conectado a ningún modelo real todavía.\n\nHas dicho: _"${userText.slice(0, 200)}"_\n\nPara que piense de verdad, abre **Ajustes → Claves**, añade tu API key y cambia mi modelo en la pestaña **Bot**. Prueba también:\n- \`@Nova investiga algo\` (delegar)\n- \`recuerda que me gusta el café\` (memoria)\n- \`guarda un archivo con ideas\` (artefacto)`,
    toolCalls: [],
  };
}

export async function callModel({ providerId, model, system, messages, tools }) {
  const provider = providerById(providerId);
  if (!provider) throw new Error(`Proveedor desconocido: ${providerId}`);
  const apiKey = getKey(providerId);
  if (!provider.noKey && !apiKey) throw new Error(`Falta la API key de ${provider.label}. Añádela en Ajustes → Claves.`);
  const args = { provider, model, apiKey, system, messages, tools };
  switch (provider.kind) {
    case 'anthropic': return callAnthropic(args);
    case 'gemini': return callGemini(args);
    case 'openai': return callOpenAI(args);
    case 'demo': return callDemo(args);
    default: throw new Error(`Tipo de proveedor no soportado: ${provider.kind}`);
  }
}
