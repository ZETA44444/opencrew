// Shows which model «Automático» would pick for typical tasks, with fake keys (no AI calls, no cost).
// Usage: OPENCREW_DATA=<empty folder> node scripts/router-check.mjs
const store = await import('../src/core/store.js');
await store.ready;
const db = store.getDb();
const only = process.env.PROVIDERS ? process.env.PROVIDERS.split(',') : ['anthropic', 'gemini', 'openai', 'xai'];
for (const id of only) db.keys[id] = 'x';
console.log(`Con claves de: ${only.join(', ')}\n`);
const { routeModel, recordRouteOutcome } = await import('../src/core/router.js');
const cases = [
  ['hola', {}],
  ['Escríbeme 5 posts para LinkedIn sobre mi tienda de café', {}],
  ['Busca los 3 mejores portátiles por menos de 800 € y compáralos', {}],
  ['Escribe una función en Python que valide un IBAN', {}],
  ['Analiza en detalle la estrategia de precios de mi competencia y propón un plan', {}],
  ['¿Cuánto es el 21 % de IVA sobre 1.250 € y cuánto queda neto?', {}],
  ['Mira esta factura y dime el total', { attachments: [{ kind: 'image' }] }],
  ['Busca los 3 mejores portátiles por menos de 800 € y compáralos', { boost: 1 }],
];
for (const [text, o] of cases) {
  const r = routeModel([{ role: 'user', content: text, attachments: o.attachments }], 0, { boost: o.boost, system: 'x'.repeat(8000), toolCount: 20 });
  console.log(`${text.slice(0, 48).padEnd(48)} → ${r.provider}/${r.model.padEnd(22)} ${r.reason.padEnd(28)} ~${(r.estimatedCost * 100).toFixed(3)} cént.`);
}
// Long conversation (over 100.000 tokens): Haiku 5.5 gets 5× more expensive there.
const long = [{ role: 'user', content: 'Resume este documento: ' + 'palabra '.repeat(90_000) }];
const rl = routeModel(long, 0, {});
console.log(`${'documento muy largo (>100k tokens)'.padEnd(48)} → ${rl.provider}/${rl.model.padEnd(22)} ${rl.reason}`);
// Learning: Haiku's research answers get retried a lot → it stops being chosen for research.
for (let i = 0; i < 10; i++) recordRouteOutcome({ skill: 'research', provider: 'anthropic', model: 'claude-haiku-5-5', ok: i % 2 === 0 });
const rr = routeModel([{ role: 'user', content: 'Busca los 3 mejores portátiles por menos de 800 € y compáralos' }], 0, {});
console.log(`${'investigación tras muchos reintentos'.padEnd(48)} → ${rr.provider}/${rr.model}`);
process.exit(0);
