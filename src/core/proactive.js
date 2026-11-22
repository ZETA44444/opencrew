// Proactive main bot: when you open the app, the ★ bot proposes a few things it could do for you.
import { getDb, save, now } from './store.js';
import { callModel } from './providers.js';
import { routeModel } from './router.js';
import { broadcast } from './events.js';

const EVERY_MS = 12 * 60 * 60 * 1000; // at most one proposal round every 12 h (costs one small model call)
let running = false;

export const mainBot = () => getDb().bots.find((b) => b.starred) || getDb().bots[0];

function context(bot) {
  const d = getDb();
  const recent = (d.messages[bot.id] || []).slice(-8).map((m) => `${m.role === 'user' ? 'Usuario' : bot.name}: ${String(m.content).slice(0, 200)}`).join('\n');
  return [
    `Equipo: ${d.bots.map((b) => `${b.name} (${b.title}: ${b.description})`).join('; ')}`,
    bot.memory.length && `Lo que sabes del usuario: ${bot.memory.join('; ')}`,
    d.skills.length && `Skills guardadas: ${d.skills.map((k) => k.name).join(', ')}`,
    d.routines.length && `Rutinas activas: ${d.routines.filter((r) => r.enabled).map((r) => r.name).join(', ')}`,
    recent && `Últimos mensajes contigo:\n${recent}`,
    `Fecha: ${new Date().toLocaleString()}`,
  ].filter(Boolean).join('\n\n');
}

function parse(text) {
  const m = String(text).match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    return JSON.parse(m[0])
      .filter((x) => x && x.title && x.prompt)
      .slice(0, 3)
      .map((x) => ({ title: String(x.title).slice(0, 80), prompt: String(x.prompt).slice(0, 600) }));
  } catch { return []; }
}

export async function refreshSuggestions({ force = false } = {}) {
  const d = getDb();
  if (d.settings.proactive === false || running) return;
  const bot = mainBot();
  if (!bot) return;
  const last = d.suggestions;
  if (!force && last?.botId === bot.id && Date.now() - new Date(last.at).getTime() < EVERY_MS) return;
  running = true;
  broadcast({ type: 'suggestions', loading: true });
  try {
    const auto = bot.provider === 'auto' ? routeModel([{ role: 'user', content: 'propón tareas' }]) : null;
    const res = await callModel({
      providerId: auto?.provider || bot.provider, model: auto?.model || bot.model, tools: [],
      system: `Eres ${bot.name}, ${bot.title}, el bot principal de un equipo de bots de IA. PROPUESTAS_JSON: propón tareas útiles y concretas que el equipo podría hacer ahora por el usuario.`,
      messages: [{
        role: 'user',
        content: `${context(bot)}\n\nPropón 3 tareas que podríais hacer ahora por mí, adaptadas a lo que sabes. ` +
          'Responde SOLO con un array JSON: [{"title":"texto corto para un botón","prompt":"el encargo completo, como si te lo pidiera yo"}]',
      }],
    });
    const items = parse(res.text);
    if (items.length) d.suggestions = { botId: bot.id, at: now(), items };
  } catch (e) {
    console.warn('No se pudieron generar propuestas:', e.message); // e.g. no API key yet: stay quiet
  } finally {
    running = false;
    save();
    broadcast({ type: 'suggestions' });
  }
}

export function dismissSuggestion(index) {
  const s = getDb().suggestions;
  if (!s) return;
  s.items = index == null ? [] : s.items.filter((_, i) => i !== index);
  save();
  broadcast({ type: 'suggestions' });
}

export const suggestionsLoading = () => running;
