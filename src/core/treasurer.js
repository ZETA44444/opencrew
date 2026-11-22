// Tools for the Tesorero bot: spending reports, provider/quota status and spending limits.
import { getDb, save, findBotByName } from './store.js';
import { usageRows, monthCost, priceFor } from './usage.js';
import { healthRows } from './health.js';
import { PROVIDERS, getKey } from './providers.js';
import { broadcast } from './events.js';

const usd = (n) => `${n.toFixed(n < 1 ? 3 : 2)} $`;
const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(n));

function sumBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    const g = m.get(k) || { input: 0, output: 0, calls: 0, cost: 0 };
    g.input += r.input; g.output += r.output; g.calls += r.calls; g.cost += r.cost;
    m.set(k, g);
  }
  return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost);
}

// OpenRouter is the only provider that tells a normal key its credit/limit.
async function openRouterKeyInfo() {
  const key = getKey('openrouter');
  if (!key) return null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
    const d = (await res.json())?.data;
    if (!res.ok || !d) return `OpenRouter: no se pudo leer la información de la clave (${res.status}).`;
    return `OpenRouter: gastado ${usd(Number(d.usage) || 0)}${d.limit != null ? ` de un límite de ${usd(Number(d.limit))} (quedan ${usd(Number(d.limit_remaining ?? d.limit - d.usage))})` : ', sin límite en la clave'}${d.is_free_tier ? ' · cuenta gratuita' : ''}.`;
  } catch (e) {
    return `OpenRouter: sin respuesta (${e.message}).`;
  }
}

export const TREASURER_TOOLS = {
  usage_report: {
    description: 'Informe de gasto y uso: por bot y por modelo, gasto del mes frente a los límites y los que más consumen.',
    parameters: { type: 'object', properties: { days: { type: 'number', description: 'Periodo en días (1, 7, 30; 0 = todo). Por defecto 30.' } } },
    async run({ days = 30 }) {
      const rows = usageRows(Number(days) || 0);
      const d = getDb();
      if (!rows.length) return `No hay uso registrado en ${days ? `los últimos ${days} días` : 'total'}.`;
      const total = rows.reduce((t, r) => ({ cost: t.cost + r.cost, input: t.input + r.input, output: t.output + r.output, calls: t.calls + r.calls }), { cost: 0, input: 0, output: 0, calls: 0 });
      const byBot = sumBy(rows, (r) => r.botId).map(([id, g]) => {
        const b = d.bots.find((x) => x.id === id);
        const lim = Number(b?.monthlyLimit) || 0;
        return `- ${b?.name || 'bot borrado'}: ${usd(g.cost)} · ${g.calls} llamadas · ${tok(g.input + g.output)} tokens${lim ? ` · este mes ${usd(monthCost(id))} de ${usd(lim)}` : ' · sin límite'}`;
      });
      const byModel = sumBy(rows, (r) => `${r.provider}/${r.model}`).map(([k, g]) => {
        const [p, ...m] = k.split('/');
        const pr = priceFor(p, m.join('/'));
        return `- ${k}: ${usd(g.cost)} (${tok(g.input)} entrada / ${tok(g.output)} salida · precio ${pr.input}/${pr.output} $ por millón${pr.unknown ? ', precio desconocido' : ''})`;
      });
      return [
        `Periodo: ${days ? `últimos ${days} días` : 'todo'} · total ${usd(total.cost)} · ${total.calls} llamadas · ${tok(total.input)} enviados / ${tok(total.output)} recibidos`,
        `Por bot:\n${byBot.join('\n')}`,
        `Por modelo:\n${byModel.join('\n')}`,
        'Los costes son estimados con precios aproximados (editables en «Uso y coste»).',
      ].join('\n\n');
    },
  },
  provider_status: {
    description: 'Estado de tus proveedores de IA: qué claves hay, modelos que fallan o se saturan, errores de cuota y, en OpenRouter, saldo y límite de la clave.',
    parameters: { type: 'object', properties: {} },
    async run() {
      const keys = PROVIDERS.filter((p) => !p.noKey).map((p) => `- ${p.label}: ${getKey(p.id) ? 'clave configurada' : 'sin clave'}`);
      const health = healthRows().filter((r) => r.fail > 0 || r.ok > 0).slice(0, 12).map((r) => {
        const errs = Object.entries(r.errors || {}).map(([k, n]) => `${k} ×${n}`).join(', ');
        return `- ${r.key}: ${Math.round(r.rate * 100)} % de éxito (${r.ok} bien, ${r.fail} fallos${errs ? `: ${errs}` : ''})${r.lastError ? ` · último error: ${r.lastError.kind} (${new Date(r.lastError.at).toLocaleString()})` : ''}`;
      });
      const or = await openRouterKeyInfo();
      return [
        `Claves:\n${keys.join('\n')}`,
        `Salud de los modelos usados:\n${health.join('\n') || '- Todavía no hay datos.'}`,
        or,
        'Nota: Google, Anthropic y OpenAI no muestran tu plan ni tu saldo a una API key normal. Los errores «límite o cuota agotada» indican que has llegado al tope de tu plan o nivel; míralo en la consola del proveedor.',
      ].filter(Boolean).join('\n\n');
    },
  },
  set_bot_limit: {
    description: 'Pone, cambia o quita el límite de gasto mensual (USD) de un bot. Usa 0 para quitarlo.',
    parameters: { type: 'object', properties: { bot_name: { type: 'string' }, usd: { type: 'number', description: 'Límite en dólares al mes (0 = sin límite)' } }, required: ['bot_name', 'usd'] },
    async run({ bot_name, usd: amount }) {
      const b = findBotByName(bot_name);
      if (!b) return `No existe ningún bot llamado "${bot_name}".`;
      b.monthlyLimit = Number(amount) > 0 ? Number(amount) : null;
      save();
      broadcast({ type: 'bots' });
      return b.monthlyLimit ? `Límite de ${b.name}: ${b.monthlyLimit} $ al mes (lleva ${monthCost(b.id).toFixed(2)} $ este mes).` : `${b.name} ya no tiene límite de gasto.`;
    },
  },
};

export const TREASURER_TOOL_NAMES = Object.keys(TREASURER_TOOLS);

export { TREASURER_BOT } from './store.js';
