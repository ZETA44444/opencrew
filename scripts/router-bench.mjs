// Measures how well each model does typical OpenCrew tasks, so «Automático» picks by real quality and
// not by guesses. A strong model grades every answer from 1 to 10; the averages per kind of task are saved
// in src/core/catalog-scores.json (they override the estimates in catalog.js).
//
// Costs money (each model answers ~18 tasks, plus the grading): with Haiku/Flash it's cents, with large
// models a few dollars. Run it when prices or models change, with the company keys:
//   ANTHROPIC_API_KEY=… GEMINI_API_KEY=… OPENAI_API_KEY=… OPENCREW_DATA=$(mktemp -d) node scripts/router-bench.mjs [model…]
import { writeFileSync, readFileSync } from 'node:fs';

const store = await import('../src/core/store.js');
await store.ready;
const db = store.getDb();
for (const [id, env] of [['anthropic', 'ANTHROPIC_API_KEY'], ['gemini', 'GEMINI_API_KEY'], ['openai', 'OPENAI_API_KEY'], ['xai', 'XAI_API_KEY']]) if (process.env[env]) db.keys[id] = process.env[env];
const { callModel, modelsOf, refreshModels, PROVIDERS } = await import('../src/core/providers.js');

// Representative tasks (Spanish, as most users write), 3 per kind of task, from easy to hard.
const TASKS = [
  ['chat', '¿Qué diferencia hay entre un autónomo y una sociedad limitada en España? Respuesta corta.'],
  ['chat', 'Dame 3 ideas para el nombre de una cafetería de especialidad en Valencia.'],
  ['chat', 'Un cliente me dice que mi precio es caro. ¿Cómo le respondo sin bajar el precio?'],
  ['writing', 'Escribe un post de LinkedIn (máx. 120 palabras) anunciando que abrimos una tienda online de café.'],
  ['writing', 'Redacta un correo amable a un cliente cuyo pedido llega con 3 días de retraso, ofreciéndole un 10 % de descuento.'],
  ['writing', 'Traduce al inglés, con tono profesional: «Le adjunto la propuesta revisada; quedo a la espera de sus comentarios.»'],
  ['research', 'Con lo que sepas, compara Shopify, WooCommerce y PrestaShop para una tienda pequeña en España: tabla con precio, facilidad y pagos.'],
  ['research', 'Resume en 5 viñetas qué exige el RGPD a una web que recoge correos para una newsletter.'],
  ['research', 'Estoy eligiendo CRM para 3 comerciales. Dame criterios de decisión y 3 opciones con pros y contras.'],
  ['code', 'Escribe una función JavaScript que valide un IBAN español y explica brevemente cómo funciona.'],
  ['code', 'Este SQL es lento: SELECT * FROM pedidos WHERE YEAR(fecha) = 2026 AND cliente_id = 42. ¿Por qué y cómo lo arreglo?'],
  ['code', 'Escribe un script de Python que lea un CSV de ventas (fecha, producto, importe) y saque el total por mes.'],
  ['reasoning', 'Vendo a 15 € con IVA (21 %) incluido. La pasarela cobra 5 % + 0,50 € sobre el total. ¿Cuánto me queda neto por venta?'],
  ['reasoning', 'Tengo 3 tareas: A tarda 2 h y vence mañana, B tarda 5 h y vence en 3 días, C tarda 1 h y vence hoy. Tengo 4 h hoy y 4 h mañana. ¿En qué orden?'],
  ['reasoning', 'Si subo el precio un 20 % y pierdo un 10 % de clientes, ¿gano o pierdo facturación? Explica el cálculo.'],
];

const judgeFor = () => {
  for (const [p, re] of [['anthropic', /opus/], ['anthropic', /sonnet/], ['openai', /^gpt-5(\.\d)?$/], ['gemini', /pro/]]) {
    if (!db.keys[p]) continue;
    const m = modelsOf(p).find((x) => re.test(x));
    if (m) return { provider: p, model: m };
  }
  throw new Error('Hace falta una clave de un modelo grande (Claude Opus/Sonnet, GPT-5 o Gemini Pro) para corregir');
};

const ask = async (provider, model, text, system = 'Eres un asistente útil. Responde en español.') => {
  const r = await callModel({ providerId: provider, model, system, messages: [{ role: 'user', content: text }], tools: [] });
  return r.text;
};

const grade = async (judge, task, answer) => {
  const t = await ask(judge.provider, judge.model,
    `Tarea: ${task}\n\nRespuesta a evaluar:\n${answer}\n\nPuntúa la respuesta de 1 a 10 (corrección, utilidad, claridad, seguir las instrucciones). Responde SOLO con el número.`,
    'Eres un evaluador exigente y justo.');
  return Math.max(1, Math.min(10, Number(String(t).match(/\d+(\.\d+)?/)?.[0]) || 1));
};

for (const p of PROVIDERS) if (db.keys[p.id]) await refreshModels(p.id).catch(() => {});
const only = process.argv.slice(2);
const judge = judgeFor();
const out = JSON.parse(readFileSync('src/core/catalog-scores.json', 'utf8'));
for (const p of PROVIDERS) {
  if (!db.keys[p.id]) continue;
  for (const model of modelsOf(p.id)) {
    if (only.length ? !only.includes(model) : /(preview|exp|tts|image|audio|embed|search|realtime|transcribe)/i.test(model)) continue;
    const per = {};
    for (const [skill, task] of TASKS) {
      try {
        const a = await ask(p.id, model, task);
        (per[skill] ??= []).push(await grade(judge, task, a));
      } catch (e) { console.warn(`${model}: ${e.message}`); }
    }
    const scores = Object.fromEntries(Object.entries(per).map(([k, v]) => [k, Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10]));
    if (Object.keys(scores).length) out[model] = scores;
    console.log(model, scores);
  }
}
writeFileSync('src/core/catalog-scores.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(`Corregido por ${judge.provider}/${judge.model}. Guardado en src/core/catalog-scores.json`);
process.exit(0);
