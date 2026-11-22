// The app's "backend", running inside the browser. Same function names the UI
// used when there was a Node server, so the components barely changed.
import { getDb, getBot, newId, now, save, messagesOf, exportData, importData, storageKind, storageUsage } from './core/store.js';
import { publicProviders, providerById, callModel, refreshModels, refreshAllModels, defaultModel } from './core/providers.js';
import { runAgent, runGroup, getGroup, busy, stopBot } from './core/agent.js';
import { broadcast, subscribe } from './core/events.js';
import { computeNext, runRoutine, startScheduler } from './core/routines.js';
import { artifactsOf, TOOL_NAMES } from './core/tools.js';
import { refreshSuggestions, dismissSuggestion, suggestionsLoading } from './core/proactive.js';

const BOT_FIELDS = ['name', 'title', 'description', 'instructions', 'color', 'shape', 'provider', 'model', 'memory', 'starred', 'tools', 'toolsKnown'];
const ROUTINE_FIELDS = ['botId', 'name', 'prompt', 'schedule', 'enabled'];
const GROUP_FIELDS = ['name', 'memberIds'];
// A "thread" is a bot's own chat or a group chat; both live in db.messages[id].
const start = (threadId, text) => (getGroup(threadId)
  ? runGroup({ groupId: threadId, input: text })
  : runAgent({ botId: threadId, input: text })).catch((e) => console.error(e));
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const db = getDb;
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------- message queue («Queue») ----------
const queueOf = (botId) => ((db().queues ??= {})[botId] ??= []);

function drain(botId) {
  const q = queueOf(botId);
  if (busy.has(botId) || !q.length || !(getBot(botId) || getGroup(botId))) return;
  const next = q.shift();
  save();
  broadcast({ type: 'queue', botId });
  start(botId, next.text);
}

let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  // When a bot finishes, it picks up the next queued message.
  subscribe((ev) => { if (ev.type === 'status' && !ev.busy) setTimeout(() => drain(ev.botId), 300); });
  for (const botId of Object.keys(db().queues || {})) setTimeout(() => drain(botId), 1000);
  startScheduler();
  refreshAllModels().then(() => broadcast({ type: 'bots' }));
  setTimeout(() => refreshSuggestions(), 1500); // proactive main bot
}

export const api = {
  subscribe,

  async state() {
    boot();
    return clone({
      bots: db().bots,
      providers: publicProviders(),
      routines: db().routines,
      groups: db().groups,
      skills: db().skills,
      suggestions: db().suggestions || null,
      suggestionsLoading: suggestionsLoading(),
      runs: db().runs.slice(0, 50),
      busy: [...busy],
      tools: TOOL_NAMES,
      settings: db().settings,
    });
  },

  async messages(botId) { return clone(messagesOf(botId)); },

  async clear(botId) { db().messages[botId] = []; save(); return { ok: true }; },

  async chat(botId, text) {
    const bot = getBot(botId) || getGroup(botId);
    if (!bot) throw new Error('Chat no encontrado');
    if (!text.trim()) throw new Error('Mensaje vacío');
    if (busy.has(bot.id)) {
      queueOf(bot.id).push({ id: newId(), text: text.trim(), at: now() });
      save();
      broadcast({ type: 'queue', botId: bot.id });
      return { ok: true, queued: true };
    }
    start(bot.id, text.trim());
    return { ok: true };
  },

  async queue(botId) { return clone(queueOf(botId)); },

  async removeQueued(botId, id) {
    db().queues[botId] = queueOf(botId).filter((x) => x.id !== id);
    save();
    broadcast({ type: 'queue', botId });
    return { ok: true };
  },

  // Re-run the last user message (optionally with new text). Removes it and everything after it first.
  async rerunLast(botId, newText) {
    const bot = getBot(botId) || getGroup(botId);
    if (!bot) throw new Error('Chat no encontrado');
    if (busy.has(botId)) throw new Error(`${bot.name} está ocupado, espera a que termine`);
    const thread = messagesOf(botId);
    let i = thread.length - 1;
    while (i >= 0 && thread[i].role !== 'user') i--;
    if (i < 0) throw new Error('No hay ningún mensaje que reintentar');
    const old = thread[i];
    const text = (newText ?? old.content).trim();
    if (!text) throw new Error('Mensaje vacío');
    thread.splice(i);
    save();
    if (getGroup(botId)) start(botId, text);
    else runAgent({ botId, input: text, from: old.from, source: old.source === 'routine' ? 'routine' : 'user' }).catch((e) => console.error(e));
    return clone(thread);
  },

  // «Parar ahora»: stops the bot and every bot it delegated to in this run.
  stop(botId) { return stopBot(botId); },

  async createBot(input) {
    const b = pick(input || {}, BOT_FIELDS);
    if (!b.name?.trim()) throw new Error('El bot necesita un nombre');
    const bot = {
      id: newId(), title: 'Asistente', description: '', instructions: '', color: '#e5e5e5', shape: 'circle',
      provider: 'demo', model: 'demo', memory: [], starred: false, ...b, name: b.name.trim(), createdAt: now(),
    };
    db().bots.push(bot);
    save();
    broadcast({ type: 'bots' });
    return clone(bot);
  },

  async updateBot(id, patch) {
    const bot = getBot(id);
    if (!bot) throw new Error('Bot no encontrado');
    if (patch?.provider && !providerById(patch.provider)) throw new Error('Proveedor desconocido');
    Object.assign(bot, pick(patch || {}, BOT_FIELDS));
    save();
    broadcast({ type: 'bots' });
    return clone(bot);
  },

  async deleteBot(id) {
    const d = db();
    d.bots = d.bots.filter((b) => b.id !== id);
    delete d.messages[id];
    delete d.artifacts[id];
    if (d.queues) delete d.queues[id];
    for (const g of d.groups) g.memberIds = g.memberIds.filter((m) => m !== id);
    d.routines = d.routines.filter((r) => r.botId !== id);
    save();
    broadcast({ type: 'bots' });
    return { ok: true };
  },

  // ---------- group chats ----------
  async createGroup(input) {
    const g = pick(input || {}, GROUP_FIELDS);
    if (!g.name?.trim()) throw new Error('El grupo necesita un nombre');
    const memberIds = (g.memberIds || []).filter((id) => getBot(id)).slice(0, 6);
    if (memberIds.length < 2) throw new Error('Elige al menos 2 bots');
    const group = { id: newId(), name: g.name.trim(), memberIds, createdAt: now() };
    db().groups.push(group);
    save();
    broadcast({ type: 'bots' });
    return clone(group);
  },

  async updateGroup(id, patch) {
    const g = getGroup(id);
    if (!g) throw new Error('Grupo no encontrado');
    const p = pick(patch || {}, GROUP_FIELDS);
    if (p.memberIds) {
      p.memberIds = p.memberIds.filter((m) => getBot(m)).slice(0, 6);
      if (p.memberIds.length < 2) throw new Error('Elige al menos 2 bots');
    }
    if (p.name !== undefined && !p.name.trim()) throw new Error('El grupo necesita un nombre');
    Object.assign(g, p);
    save();
    broadcast({ type: 'bots' });
    return clone(g);
  },

  async deleteGroup(id) {
    const d = db();
    d.groups = d.groups.filter((g) => g.id !== id);
    delete d.messages[id];
    if (d.queues) delete d.queues[id];
    save();
    broadcast({ type: 'bots' });
    return { ok: true };
  },

  // ---------- proactive main bot ----------
  refreshSuggestions: () => refreshSuggestions({ force: true }),
  dismissSuggestion,

  // ---------- skills (shared library of processes) ----------
  async saveSkill(input) {
    const name = String(input?.name || '').trim();
    if (!name) throw new Error('La skill necesita un nombre');
    if (!String(input.steps || '').trim()) throw new Error('Escribe los pasos de la skill');
    const skills = db().skills;
    const dup = skills.find((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== input.id);
    if (dup) throw new Error('Ya hay una skill con ese nombre');
    const existing = input.id && skills.find((x) => x.id === input.id);
    if (existing) Object.assign(existing, { name, description: input.description || '', steps: input.steps, updatedBy: 'Tú', updatedAt: now() });
    else skills.push({ id: newId(), name, description: input.description || '', steps: input.steps, createdBy: 'Tú', updatedAt: now() });
    save();
    broadcast({ type: 'skills' });
    return { ok: true };
  },

  async deleteSkill(id) {
    db().skills = db().skills.filter((x) => x.id !== id);
    save();
    broadcast({ type: 'skills' });
    return { ok: true };
  },

  // ---------- artifacts ----------
  async artifacts(botId) {
    return artifactsOf(botId).map((a) => ({ name: a.name, size: new Blob([a.content]).size, updatedAt: a.updatedAt }));
  },

  openArtifact(botId, name, download = false) {
    const a = artifactsOf(botId).find((x) => x.name === name);
    if (!a) return;
    // Always plain text: an HTML file written by a bot must never run with access to your keys.
    const url = URL.createObjectURL(new Blob([a.content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    if (download) link.download = a.name; else link.target = '_blank';
    link.rel = 'noopener';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },

  async deleteArtifact(botId, name) {
    db().artifacts[botId] = artifactsOf(botId).filter((a) => a.name !== name);
    save();
    return { ok: true };
  },

  // ---------- keys & settings ----------
  async saveKeys(keys) {
    for (const [provider, key] of Object.entries(keys || {})) {
      if (!providerById(provider)) continue;
      if (key) db().keys[provider] = String(key).trim();
      else delete db().keys[provider];
    }
    save();
    await Promise.all(Object.keys(keys || {}).map((p) => refreshModels(p)));
    broadcast({ type: 'bots' });
    return publicProviders();
  },

  async testProvider(provider, model = defaultModel(provider)) {
    const t0 = Date.now();
    try {
      const r = await callModel({
        providerId: provider, model, tools: [],
        system: 'Eres una prueba de conexión.', messages: [{ role: 'user', content: 'Responde solo con: OK' }],
      });
      return { ok: true, model, reply: r.text.slice(0, 200), ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async updateSettings(patch) {
    Object.assign(db().settings, patch);
    save();
    broadcast({ type: 'bots' });
    return clone(db().settings);
  },

  exportData,
  storageInfo: async () => ({ kind: storageKind(), ...(await storageUsage()) }),
  async importData(json) {
    await importData(json);
    broadcast({ type: 'bots' });
  },

  // ---------- routines ----------
  async createRoutine(input) {
    const r = pick(input || {}, ROUTINE_FIELDS);
    if (!getBot(r.botId)) throw new Error('Bot no encontrado');
    if (!r.name || !r.prompt) throw new Error('Falta nombre o instrucciones');
    const routine = { id: newId(), enabled: true, schedule: { type: 'daily', time: '08:00' }, ...r, createdAt: now() };
    routine.nextRunAt = computeNext(routine);
    db().routines.push(routine);
    save();
    broadcast({ type: 'routines' });
    return clone(routine);
  },

  async updateRoutine(id, patch) {
    const r = db().routines.find((x) => x.id === id);
    if (!r) throw new Error('Rutina no encontrada');
    Object.assign(r, pick(patch || {}, ROUTINE_FIELDS));
    r.nextRunAt = computeNext(r);
    save();
    broadcast({ type: 'routines' });
    return clone(r);
  },

  async deleteRoutine(id) {
    db().routines = db().routines.filter((x) => x.id !== id);
    save();
    broadcast({ type: 'routines' });
    return { ok: true };
  },

  async runRoutine(id) {
    const r = db().routines.find((x) => x.id === id);
    if (!r) throw new Error('Rutina no encontrada');
    runRoutine(r);
    return { ok: true };
  },
};
