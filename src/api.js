// The app's "backend", running inside the browser. Same function names the UI
// used when there was a Node server, so the components barely changed.
import { getDb, getBot, newId, now, save, messagesOf, exportData, importData } from './core/store.js';
import { publicProviders, providerById, callModel, refreshModels, refreshAllModels, defaultModel } from './core/providers.js';
import { runAgent, busy, stopBot } from './core/agent.js';
import { broadcast, subscribe } from './core/events.js';
import { computeNext, runRoutine, startScheduler } from './core/routines.js';
import { artifactsOf, TOOL_NAMES } from './core/tools.js';

const BOT_FIELDS = ['name', 'title', 'description', 'instructions', 'color', 'shape', 'provider', 'model', 'memory', 'starred', 'tools'];
const ROUTINE_FIELDS = ['botId', 'name', 'prompt', 'schedule', 'enabled'];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const db = getDb;
const clone = (x) => JSON.parse(JSON.stringify(x));

let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  startScheduler();
  refreshAllModels().then(() => broadcast({ type: 'bots' }));
}

export const api = {
  subscribe,

  async state() {
    boot();
    return clone({
      bots: db().bots,
      providers: publicProviders(),
      routines: db().routines,
      runs: db().runs.slice(0, 50),
      busy: [...busy],
      tools: TOOL_NAMES,
      settings: db().settings,
    });
  },

  async messages(botId) { return clone(messagesOf(botId)); },

  async clear(botId) { db().messages[botId] = []; save(); return { ok: true }; },

  async chat(botId, text) {
    const bot = getBot(botId);
    if (!bot) throw new Error('Bot no encontrado');
    if (!text.trim()) throw new Error('Mensaje vacío');
    if (busy.has(bot.id)) throw new Error(`${bot.name} está ocupado, espera a que termine`);
    runAgent({ botId: bot.id, input: text.trim() }).catch((e) => console.error(e));
    return { ok: true };
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
    d.routines = d.routines.filter((r) => r.botId !== id);
    save();
    broadcast({ type: 'bots' });
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
  async importData(json) {
    importData(json);
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
