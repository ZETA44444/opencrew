// Token usage and estimated cost, per day, bot and model. Prices are approximate (USD per
// million tokens) and you can edit them in «Uso y coste»; your provider's bill is the real number.
import { getDb, save } from './store.js';
import { livePrice } from './pricing.js';
import { callCost } from './pricelists.js';

// [pattern, input $/M, output $/M] — first match wins.
const DEFAULT_PRICES = [
  [/opus/i, 15, 75], [/sonnet-5/i, 2, 10], [/haiku-5/i, 0.1, 0.5], [/sonnet/i, 3, 15], [/haiku/i, 1, 5],
  // Gemini (Nov 2026). 3.8 Flash: intro price 0,75/3,75 until the end of 2026; we count the later 1,50/7,50.
  [/gemini-4/i, null], [/gemini-3.*pro/i, 2, 12], [/gemini.*pro/i, 1.25, 10],
  [/gemini-3\.5.*flash-lite/i, 0.3, 2.5], [/gemini-3.*flash-lite/i, 0.25, 1.5], [/gemini.*flash-lite|gemini.*lite/i, 0.1, 0.4],
  [/gemini-3\.[6-9].*flash/i, 1.5, 7.5], [/gemini-3.*flash/i, 0.5, 3], [/gemini.*flash|gemini/i, 0.3, 2.5],
  [/gpt-5.*nano/i, 0.05, 0.4], [/gpt-5.*mini/i, 0.25, 2], [/gpt-5|gpt-4\.1/i, 1.25, 10], [/gpt-4o-mini/i, 0.15, 0.6], [/gpt-4o/i, 2.5, 10],
  // Grok (Nov 2026): fast models 0,20/0,50; flagship 4.6/4.7 at 2/6; 4.3 at 1,25/2,50.
  [/grok.*(fast|mini)/i, 0.2, 0.5], [/grok-4\.[67]/i, 2, 6], [/grok-4\.3/i, 1.25, 2.5], [/grok-build/i, null], [/grok-4/i, 2, 6], [/grok/i, 3, 15],
];

const today = () => new Date().toISOString().slice(0, 10);
const u = () => (getDb().usage ??= { days: {}, prices: {} });

export function priceFor(provider, model) {
  if (provider === 'demo' || provider === 'ollama') return { input: 0, output: 0, custom: false };
  const custom = u().prices[`${provider}/${model}`];
  if (custom) return { ...custom, custom: true };
  // Live price list (updated every 12 h from the providers' published prices), then the built-in table.
  const lp = livePrice(provider, model);
  if (lp) return { ...lp, custom: false, live: true };
  const hit = DEFAULT_PRICES.find(([re]) => re.test(model));
  return hit && hit[1] != null ? { input: hit[1], output: hit[2], custom: false } : { input: 0, output: 0, custom: false, unknown: true };
}

// `input` is the whole prompt; the part read from the provider's cache costs 10 % and the part written to
// it 125 % (Anthropic's prompt caching prices).
// With the live price list, the provider's own cache prices and its surcharge for very long prompts
// (e.g. above 100.000 or 200.000 tokens) are used; otherwise the usual cache discounts.
export const costOf = (provider, model, input, output, cacheRead = 0, cacheWrite = 0) => callCost(priceFor(provider, model), { input, output, cacheRead, cacheWrite }, provider);

export function recordUsage({ botId, provider, model, input = 0, output = 0, cacheRead = 0, cacheWrite = 0 }) {
  if (!input && !output) return 0;
  const day = (u().days[today()] ??= {});
  const key = `${botId}|${provider}|${model}`;
  const row = (day[key] ??= { input: 0, output: 0, calls: 0 });
  row.input += input;
  row.output += output;
  if (cacheRead) row.cacheRead = (row.cacheRead || 0) + cacheRead;
  if (cacheWrite) row.cacheWrite = (row.cacheWrite || 0) + cacheWrite;
  row.calls += 1;
  // The exact cost of each call, at that moment's price (prices may change later).
  const cost = costOf(provider, model, input, output, cacheRead, cacheWrite);
  row.cost = (row.cost || 0) + cost;
  save();
  return cost;
}

// Rows for the last N days (or all): [{ day, botId, provider, model, input, output, calls, cost }]
export function usageRows(days = 30) {
  const from = days ? new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10) : '0000';
  const rows = [];
  for (const [day, entries] of Object.entries(u().days)) {
    if (day < from) continue;
    for (const [key, r] of Object.entries(entries)) {
      const [botId, provider, ...m] = key.split('|');
      const model = m.join('|');
      rows.push({ day, botId, provider, model, ...r, cost: r.cost ?? costOf(provider, model, r.input, r.output, r.cacheRead, r.cacheWrite) });
    }
  }
  return rows;
}

export function setPrice(provider, model, input, output) {
  const key = `${provider}/${model}`;
  if (input == null && output == null) delete u().prices[key];
  else u().prices[key] = { input: Number(input) || 0, output: Number(output) || 0 };
  save();
}

export function clearUsage() {
  u().days = {};
  save();
}

// Spent this calendar month by one bot (all models).
export function monthCost(botId) {
  const month = new Date().toISOString().slice(0, 7);
  let total = 0;
  for (const [day, entries] of Object.entries(u().days)) {
    if (!day.startsWith(month)) continue;
    for (const [key, r] of Object.entries(entries)) {
      const [id, provider, ...m] = key.split('|');
      if (id === botId) total += costOf(provider, m.join('|'), r.input, r.output);
    }
  }
  return total;
}

// Throws if the bot has a monthly limit and already reached it.
export function checkBudget(bot) {
  const limit = Number(bot.monthlyLimit) || 0;
  if (!limit) return;
  const spent = monthCost(bot.id);
  if (spent >= limit) {
    const e = new Error(`${bot.name} ha llegado a su límite de gasto de este mes (${spent.toFixed(2).replace('.', ',')} $ de ${limit.toFixed(2).replace('.', ',')} $). Súbelo al editar el bot o espera al mes que viene.`);
    e.budget = true;
    throw e;
  }
}
