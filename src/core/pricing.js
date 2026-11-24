// Live prices of every model of Anthropic, Google (Gemini), OpenAI and xAI (Grok), so «Automático» and the
// spending figures are always up to date, also when a company releases a new model or changes its prices.
// Sources (public, no key, refreshed every 12 hours):
//   1. LiteLLM's price list (each provider's own list price, with cache and long-prompt surcharges).
//   2. OpenRouter's model list (catches models released in the last hours; its prices may include a small markup).
// If both fail, the last good copy is kept, and the built-in table in usage.js is the final fallback.
import { getDb, save } from './store.js';
import { broadcast } from './events.js';

const LITELLM = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const OPENROUTER = 'https://openrouter.ai/api/v1/models';
const EVERY = 12 * 3600_000;
const M = 1_000_000;

// Same model, different spellings: «claude-haiku-5.5», «anthropic/claude-haiku-5-5-20261007» → «claude-haiku-5-5».
export const normModel = (m) => String(m).toLowerCase()
  .replace(/^(models|anthropic|google|gemini|vertex_ai|openai|x-ai|xai)\//, '')
  .replace(/:.*$/, '').replace(/-\d{8}$/, '').replace(/\./g, '-');

const PROVIDER_OF = { anthropic: 'anthropic', gemini: 'gemini', 'vertex_ai-language-models': 'gemini', openai: 'openai', xai: 'xai' };
const OR_PROVIDER = { anthropic: 'anthropic', google: 'gemini', openai: 'openai', 'x-ai': 'xai' };
const live = () => getDb().livePrices || null;

function fromLiteLLM(data) {
  const out = {};
  for (const [name, v] of Object.entries(data)) {
    const provider = PROVIDER_OF[v?.litellm_provider];
    if (!provider || v.mode && v.mode !== 'chat' || !(v.input_cost_per_token >= 0) || !(v.output_cost_per_token >= 0)) continue;
    const key = `${provider}/${normModel(name)}`;
    if (out[key] && v.litellm_provider !== provider) continue; // Gemini API price wins over Vertex
    const above = Object.keys(v).map((k) => /^input_cost_per_token_above_(\d+)k_tokens$/.exec(k)).find(Boolean);
    const t = above && Number(above[1]) * 1000;
    out[key] = {
      input: v.input_cost_per_token * M, output: v.output_cost_per_token * M,
      ...(v.cache_read_input_token_cost != null && { cacheRead: v.cache_read_input_token_cost * M }),
      ...(v.cache_creation_input_token_cost != null && { cacheWrite: v.cache_creation_input_token_cost * M }),
      ...(t && { long: { tokens: t, input: v[`input_cost_per_token_above_${above[1]}k_tokens`] * M, output: (v[`output_cost_per_token_above_${above[1]}k_tokens`] ?? v.output_cost_per_token) * M } }),
      ...(v.max_input_tokens && { context: v.max_input_tokens }),
      ...(v.supports_vision != null && { vision: !!v.supports_vision }),
      source: 'litellm',
    };
  }
  return out;
}

function fromOpenRouter(data) {
  const out = {};
  for (const m of data?.data || []) {
    if (m.id.startsWith('~') || m.id.includes(':')) continue; // aliases and batch variants
    const provider = OR_PROVIDER[m.id.split('/')[0]];
    const p = m.pricing || {};
    if (!provider || !(Number(p.prompt) >= 0) || !(Number(p.completion) >= 0)) continue;
    out[`${provider}/${normModel(m.id)}`] = {
      input: Number(p.prompt) * M, output: Number(p.completion) * M,
      ...(p.input_cache_read != null && { cacheRead: Number(p.input_cache_read) * M }),
      ...(p.input_cache_write != null && { cacheWrite: Number(p.input_cache_write) * M }),
      ...(m.context_length && { context: m.context_length }),
      vision: (m.architecture?.input_modalities || []).includes('image'),
      source: 'openrouter',
    };
  }
  return out;
}

const getJson = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
};

let running = null;
// Downloads both lists (at most every 12 h unless forced). Returns how many models have a live price.
export function refreshPrices({ force = false } = {}) {
  const cur = live();
  if (!force && cur && Date.now() - cur.at < EVERY) return Promise.resolve(Object.keys(cur.models).length);
  running ??= (async () => {
    const [ll, or] = await Promise.allSettled([getJson(LITELLM).then(fromLiteLLM), getJson(OPENROUTER).then(fromOpenRouter)]);
    const models = { ...(or.value || {}), ...(ll.value || {}) }; // provider list price first; OpenRouter fills the gaps
    if (!Object.keys(models).length) throw new Error('No se han podido descargar los precios');
    const errors = [ll, or].filter((r) => r.status === 'rejected').map((r) => r.reason?.message);
    getDb().livePrices = { at: Date.now(), models, sources: { litellm: !!ll.value, openrouter: !!or.value }, ...(errors.length && { errors }) };
    save();
    broadcast({ type: 'bots' });
    return Object.keys(models).length;
  })().finally(() => { running = null; });
  return running;
}

// Live price of one model, or null if neither list has it.
export function livePrice(provider, model) {
  const cur = live();
  return cur?.models[`${provider}/${normModel(model)}`] || null;
}

export const livePricesInfo = () => {
  const cur = live();
  return cur ? { at: cur.at, count: Object.keys(cur.models).length, sources: cur.sources, errors: cur.errors || [] } : null;
};

// Keep prices fresh while the app or the server runs (first check a few seconds after start).
let timer = null;
export function startPriceUpdates() {
  if (timer) return;
  const tick = () => refreshPrices().catch((e) => console.warn('Precios en vivo:', e.message));
  setTimeout(tick, 5000);
  timer = setInterval(tick, 3600_000); // checks hourly; downloads only when older than 12 h
  timer.unref?.();
}
