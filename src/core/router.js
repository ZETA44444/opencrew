// «Automático»: picks, for each step, the cheapest model that is good enough for the task,
// among the providers you have a key for. No extra AI call: it looks at the task itself.
import { PROVIDERS, getKey, modelsOf } from './providers.js';
import { priceFor } from './usage.js';
import { healthRows } from './health.js';
import { getDb } from './store.js';

// Compare whole name parts: "gemini" must not count as "mini".
const parts = (model) => String(model).toLowerCase().split(/[-/._:]+/);
const hasPart = (model, words) => parts(model).some((p) => words.includes(p));
const SMALL_WORDS = ['lite', 'nano', 'haiku', 'mini', 'fast', 'small', 'tiny'];
const LARGE_WORDS = ['pro', 'opus', 'ultra', 'sonnet', 'large', 'max'];
const SKIP = /(preview|exp|tts|image|audio|embed|search|realtime|transcribe|vision-only|customtools)/i;
const tierOf = (model) => (hasPart(model, SMALL_WORDS) ? 'small'
  : hasPart(model, LARGE_WORDS) || /^(gpt-5|grok-4)$/.test(model) ? 'large' : 'mid');

const HARD = /\b(analiza|análisis|estrategia|razona|demuestra|plan detallado|arquitectura|investiga a fondo|compara en detalle|optimiza|depura|debug|refactor|algoritmo|matemátic|ecuación|ensayo|trabajo (de|sobre)|informe completo|tesis|contrato|legal)\b/i;
const CODE = /```|\b(función|function|class |código|programa|script|bug|error de compilación|sql|regex|api)\b/i;
const EASY = /^(hola|hey|buenas|gracias|ok|vale|sí|si|no|adiós|qué tal|perfecto)\b/i;

// Returns { tier, reason } for the conversation as it stands.
export function classifyTask(convo, step = 0) {
  const lastUser = [...convo].reverse().find((m) => m.role === 'user');
  const text = String(lastUser?.content || '');
  const hasMedia = (lastUser?.attachments || []).some((a) => a.kind === 'image' || a.kind === 'pdf');
  if (step >= 3) return { tier: 'mid', reason: 'tarea de varios pasos', vision: hasMedia };
  if (HARD.test(text) || text.length > 2500) return { tier: 'large', reason: 'tarea compleja', vision: hasMedia };
  if (CODE.test(text)) return { tier: 'mid', reason: 'código o datos técnicos', vision: hasMedia };
  if (hasMedia) return { tier: 'mid', reason: 'hay imágenes o PDF', vision: true };
  if (EASY.test(text.trim()) || text.length < 160) return { tier: 'small', reason: 'tarea sencilla', vision: false };
  return { tier: 'mid', reason: 'tarea normal', vision: false };
}

function candidates() {
  // Skip models that failed as overloaded/quota in the last 10 minutes.
  const recentBad = new Set(healthRows()
    .filter((r) => r.lastError && ['saturado', 'límite o cuota agotada', 'modelo retirado'].includes(r.lastError.kind) && Date.now() - new Date(r.lastError.at) < 10 * 60_000 && (!r.lastOkAt || r.lastOkAt < r.lastError.at))
    .map((r) => r.key));
  const out = [];
  for (const p of PROVIDERS) {
    if (p.noKey || p.bridge || !getKey(p.id)) continue; // only providers you pay for with your own key (subscriptions are chosen by hand)
    for (const m of modelsOf(p.id)) {
      if (SKIP.test(m) || recentBad.has(`${p.id}/${m}`)) continue;
      const price = priceFor(p.id, m);
      if (price.unknown) continue;
      out.push({ provider: p.id, model: m, tier: tierOf(m), cost: price.input + price.output * 3 }); // output weighs more in practice
    }
  }
  return out;
}

const ORDER = { small: ['small', 'mid', 'large'], mid: ['mid', 'large', 'small'], large: ['large', 'mid', 'small'] };

// Picks { provider, model, reason } or null if you have no keys.
export function routeModel(convo, step = 0) {
  const task = classifyTask(convo, step);
  const all = candidates();
  if (!all.length) return null;
  for (const tier of ORDER[task.tier]) {
    const pool = all.filter((c) => c.tier === tier).sort((a, b) => a.cost - b.cost);
    if (pool.length) return { provider: pool[0].provider, model: pool[0].model, reason: task.reason, tier: task.tier };
  }
  return null;
}
