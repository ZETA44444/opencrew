// Live prices of every model of Anthropic, Google (Gemini), OpenAI and xAI (Grok), so «Automático» and the
// spending figures are always up to date, also when a company releases a new model or changes its prices.
// Sources (public, no key, refreshed every 12 hours):
//   1. LiteLLM's price list (each provider's own list price, with cache and long-prompt surcharges).
//   2. OpenRouter's model list (catches models released in the last hours; its prices may include a small markup).
// If both fail, the last good copy is kept, and the built-in table in usage.js is the final fallback.
import { getDb, save } from './store.js';
import { broadcast } from './events.js';

import { normModel, downloadPriceLists, guardPrices } from './pricelists.js';

export { normModel };
const EVERY = 12 * 3600_000;
const live = () => getDb().livePrices || null;

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
    const { models, sources, errors } = await downloadPriceLists(getJson);
    if (!Object.keys(models).length) throw new Error('No se han podido descargar los precios');
    const g = guardPrices(live()?.models, models);
    getDb().livePrices = { at: Date.now(), models: g.models, sources, ...(errors.length && { errors }), ...(g.ignored.length && { held: g.ignored }) };
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
