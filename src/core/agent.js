// The agent loop: model → tools → model … until the bot gives a final answer.
import { getBot, getDb, messagesOf, newId, now, save } from './store.js';
import { callModel, providerById, fallbackModels, shouldFallBack } from './providers.js';
import { toolsFor, runTool, describeCall } from './tools.js';
import { broadcast } from './events.js';
import { notify } from './notify.js';
import { needsApproval, requestApproval } from './approvals.js';
import { recordUsage, checkBudget, monthCost } from './usage.js';
import { recordModelResult, recordFallback, recentlyDown } from './health.js';
import { routeModel } from './router.js';

const MAX_STEPS = 8;
export const busy = new Set();
// One AbortController per run; nested (delegated) runs share their parent's.
const controllers = new Map(); // botId -> AbortController of the run it is working on

// Resolves when the bot/thread is free (or rejects if the run asking for it is stopped).
export function waitUntilFree(id, signal, timeoutMs = 3 * 60_000) {
  if (!busy.has(id)) return Promise.resolve();
  const until = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      if (signal?.aborted) { clearInterval(t); reject(stopped()); }
      else if (!busy.has(id)) { clearInterval(t); resolve(); }
      else if (Date.now() > until) { clearInterval(t); reject(Object.assign(new Error('timeout'), { busyTimeout: true })); }
    }, 400);
  });
}

export function stopBot(botId) {
  const c = controllers.get(botId);
  if (c) c.abort();
  return !!c;
}

function systemPrompt(bot, group) {
  const team = getDb().bots.filter((b) => b.id !== bot.id)
    .map((b) => `- ${b.name} (${b.title}) — ${b.description} [modelo: ${b.provider}/${b.model}]`).join('\n');
  return [
    `Eres ${bot.name}, ${bot.title}, un bot de IA dentro de OpenCrew, un equipo de bots que trabajan para el usuario.`,
    `Tu trabajo: ${bot.description}`,
    bot.instructions && `Instrucciones:\n${bot.instructions}`,
    `Fecha y hora actual: ${new Date().toString()}`,
    bot.memory.length ? `Tu memoria (datos que el usuario te pidió recordar):\n${bot.memory.map((m) => `- ${m}`).join('\n')}` : '',
    team && !group && delegationPrompt(bot, team),
    group && groupPrompt(bot, group),
    getDb().skills.length ? `Skills del equipo (procesos guardados; si una tarea encaja, lee sus pasos con use_skill y síguelos; si descubres un proceso que se repetirá, guárdalo con save_skill):\n${getDb().skills.map((k) => `- ${k.name}${k.description ? `: ${k.description}` : ''}`).join('\n')}` : '',
    'Responde siempre en el idioma del usuario y usa markdown. Sé conciso.',
  ].filter(Boolean).join('\n\n');
}

// How hard a bot should push work to its teammates. The main bot (★) is a coordinator by
// default: it must hand specialised work to the right bot instead of doing it itself.
// Warn once a month when a bot passes 80 % of its spending limit.
function warnBudget(bot, threadId) {
  const limit = Number(bot.monthlyLimit) || 0;
  if (!limit) return;
  const month = new Date().toISOString().slice(0, 7);
  const spent = monthCost(bot.id);
  if (spent < limit * 0.8 || bot.budgetWarned === month) return;
  bot.budgetWarned = month;
  save();
  const pct = Math.round((spent / limit) * 100);
  notify({ kind: 'routine', threadId, title: `💸 ${bot.name} lleva el ${pct} % de su límite`, body: `${spent.toFixed(2)} $ de ${limit.toFixed(2)} $ este mes.` });
  broadcast({ type: 'budget', botId: bot.id, pct, spent, limit });
}

const ANSWER_MYSELF = {
  name: 'responder_yo_mismo',
  description: 'Úsalo SOLO si ningún bot del equipo es especialista en lo que se pide (saludos, preguntas sobre el equipo, resumir lo ya hecho). Si algún bot encaja, usa delegate_to_bot en su lugar.',
  parameters: { type: 'object', properties: { motivo: { type: 'string', description: 'Por qué no encaja con ningún bot del equipo' } }, required: ['motivo'] },
};

export const delegationMode = (bot) => bot.delegation || (bot.starred ? 'coordinator' : 'auto');

function delegationPrompt(bot, team) {
  const mode = delegationMode(bot);
  if (mode === 'never') return `Tu equipo (no delegas tareas, las haces tú):\n${team}`;
  if (mode === 'coordinator') {
    return [
      `Tu equipo:\n${team}`,
      'ERES EL COORDINADOR. Regla más importante: si una tarea encaja con el trabajo de otro bot del equipo, NO la hagas tú.',
      'Usa delegate_to_bot con ese bot y pásale el encargo completo y todo el contexto (lo que pidió el usuario, para qué es, formato, extensión).',
      'Ejemplos: escribir un texto, redacción, trabajo o ensayo → al redactor; buscar o investigar información → al investigador; código → al programador.',
      'Si la tarea tiene varias partes, delega cada parte al bot adecuado (puedes llamar a delegate_to_bot varias veces, por ejemplo primero investigar y luego redactar con lo investigado) y al final une y resume los resultados.',
      'Solo respondes tú directamente cuando es un saludo, una pregunta sobre el equipo o la app, organizar o resumir lo que ya han hecho otros, o una tarea que no encaja con nadie.',
      'Antes de responder piensa: ¿qué bot del equipo es el especialista en esto? Si existe, delega.',
    ].join('\n');
  }
  return `Tu equipo (si una tarea encaja claramente mejor con otro bot, delégala con delegate_to_bot en vez de hacerla tú):\n${team}`;
}

// Runs one bot. Normally in its own chat (threadId = botId). In a group chat, the group runner
// passes `group` + `convo` (the shared transcript) and manages busy/stop for the whole group.
export async function runAgent({ botId, input, attachments = [], chain = [], from = null, source = 'user', depth = 0, runId = newId(), emit = broadcast, controller = new AbortController(), group = null, convo: groupConvo = null }) {
  const bot = getBot(botId);
  if (!bot) throw new Error('Bot no encontrado');
  const threadId = group ? group.id : botId;
  const thread = messagesOf(threadId);
  const ownsThread = !group;

  let convo;
  if (ownsThread) {
    // History = past visible turns (text only); tool traffic is only kept within the current run.
    // Past attachments are mentioned by name only (re-sending files every turn would be slow and costly).
    const history = thread.slice(-30).filter((m) => !m.error).map((m) => ({ role: m.role, content: withAttachmentNote(m) }));
    const userMsg = { id: newId(), role: 'user', content: input, attachments, from, source, createdAt: now() };
    thread.push(userMsg);
    save();
    emit({ type: 'message', botId: threadId, message: userMsg });
    busy.add(threadId);
    controllers.set(threadId, controller);
    emit({ type: 'status', botId: threadId, busy: true });
    convo = [...history, { role: 'user', content: from ? `[Tarea delegada por ${from}]\n${input}` : input, attachments }];
  } else {
    convo = groupConvo;
  }
  const signal = controller.signal;

  const steps = [];
  const step = (s) => {
    const full = { id: newId(), botId, threadId, botName: bot.name, depth, runId, at: now(), ...s };
    steps.push(full);
    emit({ type: 'step', step: full });
    return full;
  };
  const update = (s, patch) => { Object.assign(s, patch); emit({ type: 'step', step: s }); };

  // chain = bots already waiting in this task (to never delegate back up the chain and deadlock)
  const ctx = { bot, depth, runId, emit, runAgent, controller, signal, waitUntilFree, isBusy: (id) => busy.has(id), chain: [...chain, bot.id] };
  const tools = toolsFor(bot, depth);
  const label = `${providerById(bot.provider)?.label || bot.provider} · ${bot.model}`;
  let final = null;
  let error = null;
  let partial = '';
  const spent = { input: 0, output: 0, cost: 0 }; // this answer's own model calls
  let lastModel = null; // the model that actually answered (may differ after a fallback)
  let sticky = null; // once a model failed in this answer, keep using the one that worked

  try {
    for (let i = 0; i < MAX_STEPS && final === null; i++) {
      if (signal.aborted) throw stopped();
      partial = '';
      checkBudget(bot); // stop before spending more than the bot's monthly limit
      let stepLabel = label;
      const thinking = step({ kind: 'model', label: `Pensando (${label})`, status: 'running' });
      const t0 = Date.now();
      emit({ type: 'draft', botId: threadId, speaker: botId, runId, text: '' }); // new model call → fresh live bubble
      let firstToken = true;
      const onText = (delta) => {
        if (firstToken) { firstToken = false; update(thinking, { label: `Escribiendo (${stepLabel})` }); }
        partial += delta;
        emit({ type: 'delta', botId: threadId, speaker: botId, runId, text: delta });
      };
      // Coordinator, first step: it must decide explicitly — delegate, or say why it answers itself.
      const decide = i === 0 && depth === 0 && !group && delegationMode(bot) === 'coordinator' && tools.some((t) => t.name === 'delegate_to_bot');
      const callArgs = { system: systemPrompt(bot, group), messages: convo, signal, tools: decide ? [...tools, ANSWER_MYSELF] : tools, forceTool: decide };
      let used = sticky || { provider: bot.provider, model: bot.model };
      // The bot's model was overloaded a moment ago: start directly with the replacement.
      if (!sticky && bot.provider !== 'auto' && bot.autoFallback !== false && recentlyDown(`${used.provider}/${used.model}`)) {
        const alt = fallbackModels(used.provider, used.model).find((a) => !recentlyDown(`${a.provider}/${a.model}`));
        if (alt) {
          step({ kind: 'note', label: `${used.model} estaba saturado hace poco → uso ${alt.provider}/${alt.model}`, status: 'done' });
          used = alt;
          sticky = alt;
        }
      }
      // «Automático»: pick the cheapest model good enough for this step.
      if (!sticky && bot.provider === 'auto') {
        const route = routeModel(convo, i);
        if (route) {
          used = { provider: route.provider, model: route.model };
          stepLabel = `automático → ${route.provider}/${route.model} · ${route.reason}`;
          update(thinking, { label: `Pensando (${stepLabel})` });
        } else used = { provider: 'demo', model: 'demo' };
      }
      let res;
      try {
        try {
          res = await callModel({ providerId: used.provider, model: used.model, onText, ...callArgs });
        } catch (e) {
          if (e.name !== 'AbortError' && ![400, 422].includes(e.status)) recordModelResult(used.provider, used.model, e);
          // Some models (many Ollama/OpenRouter ones) don't support forced tool use: ask normally.
          if (!callArgs.forceTool || ![400, 422].includes(e.status)) throw e;
          Object.assign(callArgs, { forceTool: false, tools });
          res = await callModel({ providerId: used.provider, model: used.model, onText, ...callArgs });
        }
      } catch (e) {
        // Overloaded / rate-limited / retired model: try other models automatically.
        if (bot.autoFallback === false || !shouldFallBack(e)) throw e;
        let lastErr = e;
        for (const alt of fallbackModels(used.provider, used.model, { otherProvidersOnly: [401, 403].includes(e.status) })) {
          if (signal.aborted) throw stopped();
          step({ kind: 'note', label: `${used.model} no responde (${lastErr.status || 'sin conexión'}) → probando ${alt.provider}/${alt.model}`, status: 'done' });
          const failed = `${used.provider}/${used.model}`;
          used = alt;
          partial = '';
          emit({ type: 'draft', botId: threadId, speaker: botId, runId, text: '' }); // drop the half-written text
          try { res = await callModel({ providerId: alt.provider, model: alt.model, onText, ...callArgs }); sticky = alt; recordFallback(failed, `${alt.provider}/${alt.model}`); break; } catch (e2) {
            lastErr = e2;
            if (e2.name !== 'AbortError') recordModelResult(alt.provider, alt.model, e2);
            if (!shouldFallBack(e2)) throw e2;
          }
        }
        if (!res) throw lastErr;
      }
      lastModel = `${used.provider}/${used.model}`;
      if (used.provider !== 'demo') recordModelResult(used.provider, used.model, null);
      update(thinking, { status: 'done', label: `Pensando (${bot.provider === 'auto' && lastModel === `${used.provider}/${used.model}` && !sticky ? stepLabel : lastModel === `${bot.provider}/${bot.model}` ? label : lastModel})`, ms: Date.now() - t0 });
      if (res.usage) {
        spent.input += res.usage.input || 0;
        spent.output += res.usage.output || 0;
        spent.cost += recordUsage({ botId: bot.id, provider: used.provider, model: used.model, input: res.usage.input, output: res.usage.output });
        warnBudget(bot, threadId);
      }

      if (!res.toolCalls.length) { final = res.text || '(sin respuesta)'; break; }
      convo.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls, raw: res.raw });
      // "I'll answer myself": acknowledge and let it answer on the next step.
      const own = res.toolCalls.filter((c) => c.name === ANSWER_MYSELF.name);
      for (const c of own) {
        step({ kind: 'note', label: `Responde él mismo: ${c.args?.motivo || 'no encaja con nadie del equipo'}`, status: 'done' });
        convo.push({ role: 'tool', toolCallId: c.id, name: c.name, content: 'De acuerdo. Responde ahora directamente al usuario.' });
      }
      res.toolCalls = res.toolCalls.filter((c) => c.name !== ANSWER_MYSELF.name);
      if (res.text) step({ kind: 'note', label: res.text.slice(0, 200), status: 'done' });

      for (const call of res.toolCalls) {
        if (signal.aborted) throw stopped();
        const s = step({ kind: 'tool', tool: call.name, label: describeCall(call), args: call.args, status: 'running' });
        let out;
        try {
          // Sensitive action: stop and ask you first.
          if (needsApproval(call)) {
            update(s, { label: `Esperando tu permiso: ${describeCall(call)}`, waiting: true });
            if (typeof document !== 'undefined' && document.hidden) {
              notify({ kind: 'routine', threadId, title: `🔐 ${bot.name} necesita tu permiso`, body: describeCall(call) });
            }
            // Unattended routines don't wait forever: no answer in 30 min = denied.
            const decision = await requestApproval({ call, bot, threadId, label: describeCall(call), signal, timeoutMs: source === 'routine' ? 30 * 60_000 : 0 });
            if (decision === 'deny') {
              out = 'El usuario NO ha dado permiso para esta acción. No la hagas ni la intentes de otra forma; díselo y sigue con lo demás.';
              update(s, { status: 'error', label: `${describeCall(call)} — denegado`, waiting: false, detail: 'Denegado por ti' });
              convo.push({ role: 'tool', toolCallId: call.id, name: call.name, content: out });
              continue;
            }
            update(s, { label: describeCall(call), waiting: false });
          }
          out = await runTool(call, ctx);
          update(s, { status: 'done', detail: out.slice(0, 600) });
        } catch (e) {
          if (signal.aborted) { update(s, { status: 'error', detail: 'Detenido' }); throw stopped(); }
          out = `Error: ${e.message}`;
          update(s, { status: 'error', detail: out });
        }
        convo.push({ role: 'tool', toolCallId: call.id, name: call.name, content: out });
      }
    }
    if (final === null) final = 'He llegado al límite de pasos para esta tarea. Dime si quieres que continúe.';
  } catch (e) {
    if (signal.aborted) {
      // Keep whatever the bot had already written; finish any step left spinning.
      for (const s of steps) if (s.status === 'running') update(s, { status: 'error', label: `${s.label} — detenido` });
      final = `${partial ? `${partial}\n\n` : ''}⏹ *Detenido por ti.*`;
      step({ kind: 'stopped', label: 'Detenido por el usuario', status: 'error' });
    } else {
      error = e.message;
      final = `⚠️ ${e.message}`;
      step({ kind: 'error', label: e.message, status: 'error' });
      if (e.budget) notify({ kind: 'routine', threadId, title: `💸 ${bot.name}: límite de gasto alcanzado`, body: e.message });
    }
  } finally {
    if (ownsThread) {
      if (controllers.get(threadId) === controller) controllers.delete(threadId);
      busy.delete(threadId);
      emit({ type: 'status', botId: threadId, busy: false });
    }
  }

  if (!getBot(botId) || (group && !getGroup(group.id))) {
    // The bot (or group) was deleted while working: don't bring its conversation back.
    return { id: newId(), role: 'assistant', botId, content: final, steps, stopped: true, error: !!error };
  }
  const reply = { id: newId(), role: 'assistant', botId, content: final, steps, usage: spent.input || spent.output ? spent : undefined, stopped: signal.aborted, model: lastModel || `${bot.provider}/${bot.model}`, error: !!error, source, createdAt: now() };
  const live = messagesOf(threadId); // not `thread`: the chat may have been cleared meanwhile
  live.push(reply);
  if (live.length > 500) live.splice(0, live.length - 500);
  save();
  emit({ type: 'message', botId: threadId, message: reply });
  // Let you know when a bot answers while you're in another tab (routines notify on their own).
  if (depth === 0 && source !== 'routine' && typeof document !== 'undefined' && document.hidden) {
    notify({ kind: 'reply', threadId, title: group ? `${bot.name} en ${group.name}` : bot.name, body: final });
  }
  return reply;
}

function withAttachmentNote(m) {
  if (!m.attachments?.length) return m.content;
  return `${m.content}\n[Adjuntó: ${m.attachments.map((a) => a.name).join(', ')}]`;
}

// ---------- group chats ----------
export const getGroup = (id) => (getDb().groups || []).find((g) => g.id === id);
const membersOf = (group) => group.memberIds.map(getBot).filter(Boolean);

function groupPrompt(bot, group) {
  const others = membersOf(group).filter((b) => b.id !== bot.id).map((b) => `- @${b.name} (${b.title}) — ${b.description}`).join('\n');
  return `Estás en el chat de grupo «${group.name}» con el usuario y estos bots:\n${others}\n` +
    'Los mensajes de otros bots aparecen como «[Nombre]: …». Responde solo con tu propia parte. ' +
    'Si necesitas que otro miembro haga algo, menciónalo con @Nombre en tu respuesta y dile qué necesitas; él responderá después. ' +
    'No menciones a nadie si no hace falta.';
}

function mentionsIn(text, group, exceptId) {
  const members = membersOf(group);
  const found = [];
  for (const m of String(text).matchAll(/@([\p{L}\d_-]+)/gu)) {
    const n = m[1].toLowerCase();
    const bot = members.find((b) => b.name.toLowerCase() === n);
    if (bot && bot.id !== exceptId && !found.includes(bot)) found.push(bot);
  }
  return found;
}

// The shared transcript as one bot sees it: its own messages are "assistant", everyone else's are "user".
function transcriptFor(bot, thread) {
  const lastUser = [...thread].reverse().find((m) => m.role === 'user');
  return thread.slice(-40).filter((m) => !m.error).map((m) => {
    if (m.role === 'user') return { role: 'user', content: `[Usuario]: ${m.content}`, attachments: m === thread[thread.length - 1] || m === lastUser ? m.attachments : undefined };
    if (m.botId === bot.id) return { role: 'assistant', content: m.content };
    return { role: 'user', content: `[${getBot(m.botId)?.name || 'Bot'}]: ${m.content}` };
  });
}

const MAX_GROUP_TURNS = 6;

export async function runGroup({ groupId, input, attachments = [], emit = broadcast }) {
  const group = getGroup(groupId);
  if (!group) throw new Error('Grupo no encontrado');
  const members = membersOf(group);
  if (!members.length) throw new Error('El grupo no tiene bots');
  const thread = messagesOf(groupId);
  const userMsg = { id: newId(), role: 'user', content: input, attachments, source: 'user', createdAt: now() };
  thread.push(userMsg);
  save();
  emit({ type: 'message', botId: groupId, message: userMsg });

  const controller = new AbortController();
  const runId = newId();
  busy.add(groupId);
  controllers.set(groupId, controller);
  emit({ type: 'status', botId: groupId, busy: true });

  // Who speaks: the bots you @mention (in order), otherwise the group's lead (first member).
  const queue = mentionsIn(input, group, null);
  if (!queue.length) queue.push(members[0]);
  try {
    for (let turn = 0; queue.length && turn < MAX_GROUP_TURNS && !controller.signal.aborted; turn++) {
      const bot = queue.shift();
      const reply = await runAgent({ botId: bot.id, group, convo: transcriptFor(bot, thread), runId, emit, controller });
      if (reply.stopped || reply.error) break;
      for (const next of mentionsIn(reply.content, group, bot.id)) if (!queue.includes(next)) queue.push(next);
    }
  } finally {
    if (controllers.get(groupId) === controller) controllers.delete(groupId);
    busy.delete(groupId);
    emit({ type: 'status', botId: groupId, busy: false });
  }
}

function stopped() {
  const e = new Error('Detenido por el usuario');
  e.name = 'AbortError';
  return e;
}
