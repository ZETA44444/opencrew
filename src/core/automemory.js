// Automatic memory: after you chat with a bot, it proposes things worth remembering
// (your name, preferences, decisions…). Nothing is saved until you approve it.
import { getDb, getBot, messagesOf, newId, now, save } from './store.js';
import { callModel } from './providers.js';
import { routeModel } from './router.js';
import { broadcast } from './events.js';

const CUES = /\b(me llamo|mi nombre|soy de|vivo en|trabajo (en|como)|prefiero|me gusta|no me gusta|odio|siempre|nunca|mi (empresa|negocio|web|correo|horario|presupuesto|idioma|equipo)|recuerda)\b/i;
const running = new Set();

const all = () => (getDb().memoryProposals ??= {});
export const proposalsFor = (threadId) => all()[threadId] || [];

function knownFacts(bot) {
  const d = getDb();
  const text = (m) => (typeof m === 'string' ? m : m.text);
  return [
    ...bot.memory.map(text),
    ...(d.globalMemory || []).map(text),
    ...(d.projects || []).filter((p) => p.botIds.includes(bot.id)).flatMap((p) => (p.memory || []).map(text)),
  ];
}

function parse(text) {
  const m = String(text).match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    return JSON.parse(m[0]).filter((x) => x && x.text).slice(0, 4)
      .map((x) => ({ text: String(x.text).slice(0, 300), scope: ['global', 'project', 'bot'].includes(x.scope) ? x.scope : 'global' }));
  } catch { return []; }
}

// Demo (no key): pick sentences with clear memory cues.
function demoExtract(messages) {
  return messages.filter((m) => m.role === 'user')
    .flatMap((m) => String(m.content).split(/(?<=[.!?])\s+/))
    .filter((s) => CUES.test(s) && !/^recuerda/i.test(s.trim()))
    .slice(0, 3)
    .map((s) => ({ text: s.trim().replace(/^./, (c) => c.toUpperCase()), scope: /presupuesto|tarjeta|pago|compra/i.test(s) ? 'bot' : 'global' }));
}

// Called after each answer in a bot's own chat. Cheap: only runs every few messages or on clear cues.
export async function maybeProposeMemories(botId) {
  const d = getDb();
  if (d.settings.autoMemory === false || running.has(botId)) return;
  const bot = getBot(botId);
  if (!bot) return;
  const thread = messagesOf(botId);
  const seen = (d.memoryCursor ??= {})[botId] || 0;
  const fresh = thread.slice(seen).filter((m) => !m.error);
  const userMsgs = fresh.filter((m) => m.role === 'user' && m.source !== 'routine' && !m.from);
  if (!userMsgs.length) return;
  if (userMsgs.length < 4 && !userMsgs.some((m) => CUES.test(m.content))) return;
  running.add(botId);
  d.memoryCursor[botId] = thread.length;
  try {
    const known = knownFacts(bot);
    let items;
    const route = routeModel([{ role: 'user', content: 'hola' }]); // cheapest small model you have
    if (!route || bot.provider === 'demo') items = demoExtract(fresh);
    else {
      const convo = fresh.slice(-12).map((m) => `${m.role === 'user' ? 'Usuario' : bot.name}: ${String(m.content).slice(0, 500)}`).join('\n');
      const res = await callModel({
        providerId: route.provider, model: route.model, tools: [],
        system: 'Extraes recuerdos útiles y duraderos sobre el usuario. Responde solo con JSON.',
        messages: [{ role: 'user', content: `Conversación reciente:\n${convo}\n\nYa se sabe:\n${known.map((k) => `- ${k}`).join('\n') || '- nada'}\n\n` +
          'Lista como mucho 4 datos NUEVOS que valga la pena recordar siempre (nombre, preferencias, datos del negocio, decisiones). ' +
          'Nada temporal ni de esta tarea concreta. scope: "global" si sirve a todo el equipo, "project" si es del proyecto, "bot" si es sensible (pagos, compras, datos privados). ' +
          'Responde SOLO con un array JSON: [{"text":"…","scope":"global|project|bot"}] (o [] si no hay nada).' }],
      });
      items = parse(res.text);
    }
    const lower = known.map((k) => k.toLowerCase());
    items = items.filter((it) => !lower.includes(it.text.toLowerCase()));
    if (items.length) {
      const list = (all()[botId] ??= []);
      for (const it of items) if (!list.some((x) => x.text === it.text)) list.push({ id: newId(), ...it, at: now() });
      broadcast({ type: 'memoryProposals', botId });
    }
  } catch (e) {
    console.warn('Memoria automática:', e.message);
  } finally {
    running.delete(botId);
    save();
  }
}

export function resolveProposal(botId, id, action, scope) {
  const list = all()[botId] || [];
  const p = list.find((x) => x.id === id);
  if (!p) return;
  all()[botId] = list.filter((x) => x.id !== id);
  if (action === 'save') {
    const d = getDb();
    const bot = getBot(botId);
    const s = scope || p.scope;
    const item = { text: p.text, by: bot?.name || 'bot', at: now() };
    const projects = (d.projects || []).filter((x) => x.botIds.includes(botId));
    if (s === 'project' && projects.length) projects.forEach((x) => (x.memory ??= []).push(item));
    else if (s === 'bot' && bot) bot.memory.push(p.text);
    else d.globalMemory.push(item);
  }
  save();
  broadcast({ type: 'bots' });
  broadcast({ type: 'memoryProposals', botId });
}
