// «Automático»: for each step, the CHEAPEST model that is still GOOD ENOUGH for the task.
// 1. Classify the task: what kind (chat, writing, research, code, reasoning, images) and how hard (1-3).
// 2. Keep only models that can do it (images, tools…) and reach the minimum quality for it (catalog.js).
// 3. Among those, pick the one with the lowest estimated cost for THIS request (long prompts, cache…).
// 4. Learn: if a model's answers for a kind of task get retried or fail, it stops being chosen for it;
//    when you press «Reintentar», the next answer goes one level up.
// No extra AI call: everything is decided from the request itself.
import { PROVIDERS, getKey, modelsOf } from './providers.js';
import { priceFor } from './usage.js';
import { healthRows } from './health.js';
import { getDb, save } from './store.js';
import { profileOf, FLOOR } from './catalog.js';

// Compare whole name parts: "gemini" must not count as "mini".
const parts = (model) => String(model).toLowerCase().split(/[-/._:]+/);
const hasPart = (model, words) => parts(model).some((p) => words.includes(p));
const SMALL_WORDS = ['lite', 'nano', 'haiku', 'mini', 'fast', 'small', 'tiny'];
const LARGE_WORDS = ['pro', 'opus', 'ultra', 'sonnet', 'large', 'max'];
const SKIP = /(\bexp\b|experimental|tts|image|audio|embed|search|realtime|transcribe|vision-only|customtools)/i;
const tierOf = (model) => (hasPart(model, SMALL_WORDS) ? 'small'
  : hasPart(model, LARGE_WORDS) || /^(gpt-5|grok-4)$/.test(model) ? 'large' : 'mid');

// Spanish and English cues (word beginnings, so «escríbeme» counts as «escrib…»).
const cue = (words) => new RegExp(`(^|[^\\p{L}])(${words})`, 'iu');
const HARD = cue('analiza|análisis|estrategi|razona|demuestr|plan detallado|arquitectur|investiga a fondo|en detalle|optimiz|depura|refactor|algoritm|matemátic|ecuaci|ensayo|informe completo|tesis|contrato|legal|analy[sz]|strateg|prove|in-depth|in detail|detailed plan|architect|debug|algorithm|equation|essay|full report|thesis|contract');
const CODE = /```|(^|[^\p{L}])(funci[oó]n|function|class |c[oó]digo|code|programa|script|bug|compil|sql|regex|api|javascript|python|typescript|html|css)/iu;
const REASON = cue('calcul|cuánto|cuanto|porcentaje|lógic|deduc|resuelv|problema|decid|elige entre|pros y contras|analiza|estrategi|plan |how much|percentage|logic|solve|problem|pros and cons|trade-?off|analy[sz]|strateg');
const RESEARCH = cue('busc|investig|encuentr|noticia|últim|precio|compar|fuente|web|https?://|search|research|find|news|latest|price|compare|source');
const WRITING = cue('escrib|redact|post|correo|email|artículo|traduc|resum|propuesta|carta|guion|write|draft|article|translat|summari|proposal|letter');
const EASY = /^(hola|hey|buenas|gracias|ok|vale|sí|si|no|adiós|qué tal|perfecto|hi|hello|thanks|thank you|yes|bye|great)\b/i;
const NAMES = { chat: 'conversación', writing: 'redacción', research: 'investigación', code: 'código', reasoning: 'razonamiento', vision: 'imágenes o PDF' };

// Returns { skill, level, vision, reason } for the conversation as it stands.
export function classifyTask(convo, step = 0) {
  const lastUser = [...convo].reverse().find((m) => m.role === 'user');
  const text = String(lastUser?.content || '');
  const vision = (lastUser?.attachments || []).some((a) => a.kind === 'image' || a.kind === 'pdf');
  const skill = vision ? 'vision' : CODE.test(text) ? 'code' : REASON.test(text) && !RESEARCH.test(text) ? 'reasoning'
    : RESEARCH.test(text) ? 'research' : WRITING.test(text) ? 'writing' : 'chat';
  // Hard: explicit analysis/strategy/proofs… Easy: greetings and short questions or sums. Long text alone isn't «hard».
  let level = HARD.test(text) ? 3 : EASY.test(text.trim()) || (text.length < 120 && (skill === 'chat' || skill === 'reasoning')) ? 1 : 2;
  if (step >= 3 && level < 2) level = 2; // long tool loops: never the weakest model
  return { skill, level, vision, reason: `${NAMES[skill]} · ${['', 'fácil', 'normal', 'difícil'][level]}` };
}

// ---------- learning from results ----------
const stats = () => (getDb().routerStats ??= {});
const statKey = (skill, provider, model) => `${skill}|${provider}/${model}`;
// A model loses a point for a kind of task when 25 % or more of its recent answers were retried or failed.
function penalty(skill, provider, model) {
  const s = stats()[statKey(skill, provider, model)];
  return s && s.n >= 8 && s.bad / s.n >= 0.25 ? 1 : 0;
}
export function recordRouteOutcome({ skill, provider, model, ok }) {
  if (!skill || !provider || provider === 'demo') return;
  const s = (stats()[statKey(skill, provider, model)] ??= { n: 0, bad: 0 });
  // Rolling window: halve old counts so models can recover after improvements.
  if (s.n >= 40) { s.n = Math.round(s.n / 2); s.bad = Math.round(s.bad / 2); }
  s.n += 1;
  if (!ok) s.bad += 1;
  save();
}
// «Reintentar» on an answer: that answer counted as fine, now it counts as not good enough.
export function markRetried({ skill, provider, model }) {
  const s = stats()[statKey(skill, provider, model)];
  if (s && s.bad < s.n) { s.bad += 1; save(); }
}

// ---------- cost estimate for THIS request ----------
const tokensOf = (convo, extra = '') => Math.ceil((JSON.stringify(convo).length + extra.length) / 3.6);
const OUTPUT = [0, 400, 1200, 2500]; // typical answer length per difficulty
function estimate(c, inputTokens, level, step) {
  const long = c.longContext && inputTokens > c.longContext.tokens ? c.longContext.factor : 1;
  // Anthropic prompt cache: after the first step most of the prompt is read from cache at ~10 % of the price.
  const cached = c.provider === 'anthropic' && step > 0 ? 0.7 : 0;
  return (inputTokens * c.price.input * long * (1 - cached + cached * 0.1) + OUTPUT[level] * c.price.output * long) / 1_000_000;
}

function candidates() {
  // Skip models that failed as overloaded/quota in the last 10 minutes.
  const recentBad = new Set(healthRows()
    .filter((r) => r.lastError && ['saturado', 'límite o cuota agotada', 'modelo retirado'].includes(r.lastError.kind) && Date.now() - new Date(r.lastError.at) < 10 * 60_000 && (!r.lastOkAt || r.lastOkAt < r.lastError.at))
    .map((r) => r.key));
  const out = [];
  for (const p of PROVIDERS) {
    if (p.noKey || !getKey(p.id)) continue; // only providers with a key (yours, or OpenCrew's on paid plans)
    for (const m of modelsOf(p.id)) {
      if (SKIP.test(m) || recentBad.has(`${p.id}/${m}`)) continue;
      const price = priceFor(p.id, m);
      if (price.unknown) continue;
      out.push({ provider: p.id, model: m, price, ...profileOf(m, tierOf(m)) });
    }
  }
  return out;
}

// Picks { provider, model, reason, skill, level, estimatedCost } or null if there are no keys.
// opts.boost: levels to go up (after «Reintentar»); opts.system / opts.toolCount: to size the prompt.
export function routeModel(convo, step = 0, opts = {}) {
  const task = classifyTask(convo, step);
  const all = candidates();
  if (!all.length) return null;
  const inputTokens = tokensOf(convo, opts.system || '') + (opts.toolCount || 0) * 120;
  const wanted = task.level + (opts.boost || 0);
  const level = Math.min(3, wanted);
  const need = FLOOR[task.skill][level - 1] + Math.max(0, wanted - 3); // beyond «hard»: one more point
  const score = (c) => (c.scores[task.skill] ?? 0) - penalty(task.skill, c.provider, c.model);
  // Good enough for this task, then the cheapest; if none reaches the level, the best available.
  const good = all.filter((c) => score(c) >= need);
  const pool = good.length ? good : [...all].sort((a, b) => score(b) - score(a)).slice(0, 1);
  const best = pool.map((c) => ({ c, cost: estimate(c, inputTokens, level, step) })).sort((a, b) => a.cost - b.cost || score(b.c) - score(a.c))[0];
  return { provider: best.c.provider, model: best.c.model, reason: `${task.reason}${opts.boost ? ' · subo de nivel' : ''}`, skill: task.skill, level, estimatedCost: best.cost };
}
