// The agent loop: model → tools → model … until the bot gives a final answer.
import { getBot, getDb, messagesOf, newId, now, save } from './store.js';
import { callModel, providerById } from './providers.js';
import { toolsFor, runTool, describeCall } from './tools.js';
import { broadcast } from './events.js';

const MAX_STEPS = 8;
export const busy = new Set();

function systemPrompt(bot) {
  const team = getDb().bots.filter((b) => b.id !== bot.id)
    .map((b) => `- ${b.name} (${b.title}) — ${b.description} [modelo: ${b.provider}/${b.model}]`).join('\n');
  return [
    `Eres ${bot.name}, ${bot.title}, un bot de IA dentro de OpenCrew, un equipo de bots que trabajan para el usuario.`,
    `Tu trabajo: ${bot.description}`,
    bot.instructions && `Instrucciones:\n${bot.instructions}`,
    `Fecha y hora actual: ${new Date().toString()}`,
    bot.memory.length ? `Tu memoria (datos que el usuario te pidió recordar):\n${bot.memory.map((m) => `- ${m}`).join('\n')}` : '',
    team && `Tu equipo (puedes delegar con delegate_to_bot):\n${team}`,
    'Responde siempre en el idioma del usuario y usa markdown. Sé conciso.',
  ].filter(Boolean).join('\n\n');
}

export async function runAgent({ botId, input, from = null, source = 'user', depth = 0, runId = newId(), emit = broadcast }) {
  const bot = getBot(botId);
  if (!bot) throw new Error('Bot no encontrado');
  const thread = messagesOf(botId);

  // History = past visible turns (text only); tool traffic is only kept within the current run.
  const history = thread.slice(-30).filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));

  const userMsg = { id: newId(), role: 'user', content: input, from, source, createdAt: now() };
  thread.push(userMsg);
  save();
  emit({ type: 'message', botId, message: userMsg });

  busy.add(botId);
  emit({ type: 'status', botId, busy: true });

  const convo = [...history, { role: 'user', content: from ? `[Tarea delegada por ${from}]\n${input}` : input }];
  const steps = [];
  const step = (s) => {
    const full = { id: newId(), botId, botName: bot.name, depth, runId, at: now(), ...s };
    steps.push(full);
    emit({ type: 'step', step: full });
    return full;
  };
  const update = (s, patch) => { Object.assign(s, patch); emit({ type: 'step', step: s }); };

  const ctx = { bot, depth, runId, emit, runAgent };
  const tools = toolsFor(bot, depth);
  const label = `${providerById(bot.provider)?.label || bot.provider} · ${bot.model}`;
  let final = null;
  let error = null;

  try {
    for (let i = 0; i < MAX_STEPS && final === null; i++) {
      const thinking = step({ kind: 'model', label: `Pensando (${label})`, status: 'running' });
      const t0 = Date.now();
      const res = await callModel({ providerId: bot.provider, model: bot.model, system: systemPrompt(bot), messages: convo, tools });
      update(thinking, { status: 'done', ms: Date.now() - t0 });

      if (!res.toolCalls.length) { final = res.text || '(sin respuesta)'; break; }
      convo.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls, raw: res.raw });
      if (res.text) step({ kind: 'note', label: res.text.slice(0, 200), status: 'done' });

      for (const call of res.toolCalls) {
        const s = step({ kind: 'tool', tool: call.name, label: describeCall(call), args: call.args, status: 'running' });
        let out;
        try {
          out = await runTool(call, ctx);
          update(s, { status: 'done', detail: out.slice(0, 600) });
        } catch (e) {
          out = `Error: ${e.message}`;
          update(s, { status: 'error', detail: out });
        }
        convo.push({ role: 'tool', toolCallId: call.id, name: call.name, content: out });
      }
    }
    if (final === null) final = 'He llegado al límite de pasos para esta tarea. Dime si quieres que continúe.';
  } catch (e) {
    error = e.message;
    final = `⚠️ ${e.message}`;
    step({ kind: 'error', label: e.message, status: 'error' });
  } finally {
    busy.delete(botId);
    emit({ type: 'status', botId, busy: false });
  }

  const reply = { id: newId(), role: 'assistant', content: final, steps, model: `${bot.provider}/${bot.model}`, error: !!error, source, createdAt: now() };
  thread.push(reply);
  if (thread.length > 500) thread.splice(0, thread.length - 500);
  save();
  emit({ type: 'message', botId, message: reply });
  return reply;
}
