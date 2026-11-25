// Public price lists of the AI providers, turned into one table: «provider/model» → $ per million tokens.
// Shared by the user's engine (src/core/pricing.js) and the gateway (which charges OpenCrew credits),
// so both compute exactly the same cost. No imports: it must run in the browser, Node and the gateway.
export const LITELLM = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
export const OPENROUTER = 'https://openrouter.ai/api/v1/models';
const M = 1_000_000;

// Same model, different spellings: «claude-haiku-5.5», «anthropic/claude-haiku-5-5-20261007» → «claude-haiku-5-5».
export const normModel = (m) => String(m).toLowerCase()
  .replace(/^(models|anthropic|google|gemini|vertex_ai|openai|x-ai|xai)\//, '')
  .replace(/:.*$/, '').replace(/-\d{8}$/, '').replace(/\./g, '-');

const PROVIDER_OF = { anthropic: 'anthropic', gemini: 'gemini', 'vertex_ai-language-models': 'gemini', openai: 'openai', xai: 'xai' };
const OR_PROVIDER = { anthropic: 'anthropic', google: 'gemini', openai: 'openai', 'x-ai': 'xai' };

export function fromLiteLLM(data) {
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

export function fromOpenRouter(data) {
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


// Both lists merged: each provider's own list price first; OpenRouter fills the gaps (newest models).
export async function downloadPriceLists(fetchJson) {
  const [ll, or] = await Promise.allSettled([fetchJson(LITELLM).then(fromLiteLLM), fetchJson(OPENROUTER).then(fromOpenRouter)]);
  const models = { ...(or.value || {}), ...(ll.value || {}) };
  const errors = [ll, or].filter((r) => r.status === 'rejected').map((r) => String(r.reason?.message || r.reason));
  return { models, sources: { litellm: !!ll.value, openrouter: !!or.value }, errors };
}

// Cost in $ of one call. `input` is the whole prompt; part of it may have been read from / written to the
// provider's cache. Very long prompts use the provider's higher price when it has one.
export function callCost(p, { input = 0, output = 0, cacheRead = 0, cacheWrite = 0 }, provider = '') {
  const long = p.long && input > p.long.tokens;
  const pin = long ? p.long.input : p.input;
  const pout = long ? p.long.output : p.output;
  const rRead = p.cacheRead != null && p.input ? p.cacheRead / p.input : 0.1;
  const rWrite = p.cacheWrite != null && p.input ? p.cacheWrite / p.input : provider === 'anthropic' ? 1.25 : 1;
  const plain = Math.max(0, input - cacheRead - cacheWrite);
  return ((plain + cacheRead * rRead + cacheWrite * rWrite) * pin + output * pout) / M;
}
