// The app's engine: runs inside the browser, or on your own server (server/index.mjs),
// which exposes these same functions to the app over HTTPS (see src/remote.js).
import { getDb, getBot, newId, now, save, messagesOf, exportData, importData, storageKind, storageUsage } from './core/store.js';
import { publicProviders, providerById, callModel, refreshModels, refreshAllModels, defaultModel } from './core/providers.js';
import { runAgent, runGroup, getGroup, busy, stopBot } from './core/agent.js';
import { broadcast, subscribe } from './core/events.js';
import { computeNext, runRoutine, startScheduler, missed, resolveMissed } from './core/routines.js';
import { artifactsOf, TOOL_NAMES } from './core/tools.js';
import { searchBackend } from './core/search.js';
import { githubWhoAmI } from './core/github.js';
import { connectGoogle, storeGoogleToken, disconnectGoogle, updateGoogle, googleStatus } from './core/google.js';
import { transcribeBase64 } from './core/transcribe.js';
import { openArtifactFile } from './artifactFile.js';
import { usageRows, priceFor, setPrice, clearUsage, monthCost } from './core/usage.js';
import { healthRows, clearHealth } from './core/health.js';
import { proposalsFor, resolveProposal } from './core/automemory.js';
import { startWatchers, saveWatcher, deleteWatcher, checkWatcher, watchers } from './core/watchers.js';
import { pendingApprovals, resolveApproval, revokeAlways, setApprovalsEnabled, SENSITIVE } from './core/approvals.js';
import { addConnector, refreshConnector, updateConnector, removeConnector } from './core/mcp.js';
import { refreshSuggestions, dismissSuggestion, suggestionsLoading } from './core/proactive.js';
import { askPermission, notifyPermission, notify } from './core/notify.js';

const BOT_FIELDS = ['name', 'title', 'description', 'instructions', 'color', 'shape', 'provider', 'model', 'memory', 'starred', 'tools', 'toolsKnown', 'connectors', 'monthlyLimit', 'delegation', 'autoFallback', 'sharedMemory'];
const ROUTINE_FIELDS = ['botId', 'name', 'prompt', 'schedule', 'enabled', 'catchUp'];
const GROUP_FIELDS = ['name', 'memberIds'];
const PROJECT_FIELDS = ['name', 'description', 'color', 'botIds', 'groupIds', 'memory'];
const SERVICE_KEYS = ['tavily', 'github']; // keys for tools, not for chat models
// A "thread" is a bot's own chat or a group chat; both live in db.messages[id].
const start = (threadId, text, attachments = []) => (getGroup(threadId)
  ? runGroup({ groupId: threadId, input: text, attachments })
  : runAgent({ botId: threadId, input: text, attachments })).catch((e) => console.error(e));
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
  start(botId, next.text, next.attachments);
}

let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  // When a bot finishes, it picks up the next queued message.
  subscribe((ev) => { if (ev.type === 'status' && !ev.busy) setTimeout(() => drain(ev.botId), 300); });
  for (const botId of Object.keys(db().queues || {})) setTimeout(() => drain(botId), 1000);
  startScheduler();
  startWatchers();
  refreshAllModels().then(() => broadcast({ type: 'bots' }));
  setTimeout(() => refreshSuggestions(), 1500); // proactive main bot
}

export const localApi = {
  subscribe,

  async state() {
    boot();
    return clone({
      bots: db().bots,
      providers: publicProviders(),
      routines: db().routines,
      groups: db().groups,
      watchers: watchers().map(({ state, ...w }) => ({ ...w, ready: !!(state?.seen || state?.hash) })),
      projects: db().projects,
      globalMemory: db().globalMemory,
      skills: db().skills,
      approvals: pendingApprovals(),
      sensitiveTools: SENSITIVE,
      connectors: db().connectors.map(({ token, ...c }) => ({ ...c, hasToken: !!token })),
      suggestions: db().suggestions || null,
      suggestionsLoading: suggestionsLoading(),
      runs: db().runs.slice(0, 300),
      missed: missed.map((m) => ({ ...m, name: db().routines.find((r) => r.id === m.routineId)?.name, botId: db().routines.find((r) => r.id === m.routineId)?.botId })),
      busy: [...busy],
      tools: TOOL_NAMES,
      settings: db().settings,
      services: { tavily: !!db().keys.tavily, github: !!db().keys.github, githubWrite: !!db().settings.githubWrite, google: googleStatus(), searchBackend: searchBackend() },
    });
  },

  async messages(botId) { return clone(messagesOf(botId)); },

  async clear(botId) { stopBot(botId); db().messages[botId] = []; save(); return { ok: true }; },

  async chat(botId, text, attachments = []) {
    const bot = getBot(botId) || getGroup(botId);
    if (!bot) throw new Error('Chat no encontrado');
    if (!text.trim() && !attachments.length) throw new Error('Mensaje vacío');
    if (!text.trim()) text = 'Mira lo que te adjunto.';
    if (busy.has(bot.id)) {
      queueOf(bot.id).push({ id: newId(), text: text.trim(), attachments, at: now() });
      save();
      broadcast({ type: 'queue', botId: bot.id });
      return { ok: true, queued: true };
    }
    start(bot.id, text.trim(), attachments);
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
    if (getGroup(botId)) start(botId, text, old.attachments || []);
    else runAgent({ botId, input: text, attachments: old.attachments || [], from: old.from, source: old.source === 'routine' ? 'routine' : 'user' }).catch((e) => console.error(e));
    return clone(thread);
  },

  // «Parar ahora»: stops the bot and every bot it delegated to in this run.
  stop(botId) { return stopBot(botId); },

  async createBot(input) {
    const b = pick(input || {}, BOT_FIELDS);
    if (!b.name?.trim()) throw new Error('El bot necesita un nombre');
    if (db().bots.some((x) => x.name.toLowerCase() === b.name.trim().toLowerCase())) throw new Error(`Ya existe un bot llamado ${b.name.trim()}. Elige otro nombre.`);
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
    stopBot(id);
    const d = db();
    d.bots = d.bots.filter((b) => b.id !== id);
    delete d.messages[id];
    delete d.artifacts[id];
    if (d.queues) delete d.queues[id];
    for (const g of d.groups) g.memberIds = g.memberIds.filter((m) => m !== id);
    for (const p of d.projects) p.botIds = p.botIds.filter((m) => m !== id);
    d.routines = d.routines.filter((r) => r.botId !== id);
    d.watchers = (d.watchers || []).filter((w) => w.botId !== id);
    save();
    broadcast({ type: 'bots' });
    return { ok: true };
  },

  async memoryProposals(botId) { return clone(proposalsFor(botId)); },
  async resolveMemoryProposal(botId, id, action, scope) { resolveProposal(botId, id, action, scope); },

  async setGlobalMemory(memory) {
    db().globalMemory = memory;
    save();
    broadcast({ type: 'bots' });
  },

  // ---------- projects ----------
  async saveProject(input) {
    const p = pick(input || {}, PROJECT_FIELDS);
    if (input.id) {
      const existing = db().projects.find((x) => x.id === input.id);
      if (!existing) throw new Error('Proyecto no encontrado');
      if (p.name !== undefined && !p.name.trim()) throw new Error('El proyecto necesita un nombre');
      Object.assign(existing, p);
      save();
      broadcast({ type: 'bots' });
      return clone(existing);
    }
    if (!p.name?.trim()) throw new Error('El proyecto necesita un nombre');
    const project = { id: newId(), description: '', color: '#7dd3fc', botIds: [], groupIds: [], memory: [], ...p, name: p.name.trim(), createdAt: now() };
    db().projects.push(project);
    save();
    broadcast({ type: 'bots' });
    return clone(project);
  },

  async deleteProject(id) {
    db().projects = db().projects.filter((p) => p.id !== id); // bots and chats are kept
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
    stopBot(id);
    const d = db();
    d.groups = d.groups.filter((g) => g.id !== id);
    for (const p of d.projects) p.groupIds = p.groupIds.filter((m) => m !== id);
    delete d.messages[id];
    if (d.queues) delete d.queues[id];
    save();
    broadcast({ type: 'bots' });
    return { ok: true };
  },

  // ---------- notifications ----------
  notifyPermission,
  askNotifyPermission: askPermission,
  testNotification: () => notify({ kind: 'routine', threadId: 'test', title: 'OpenCrew', body: 'Las notificaciones funcionan ✓' }),

  // ---------- proactive main bot ----------
  refreshSuggestions: () => refreshSuggestions({ force: true }),
  dismissSuggestion,

  // ---------- usage & cost ----------
  async usage(days = 30) {
    const rows = usageRows(days);
    const prices = {};
    for (const r of rows) prices[`${r.provider}/${r.model}`] ??= priceFor(r.provider, r.model);
    return { rows, prices };
  },
  monthCost,
  async setPrice(provider, model, input, output) { setPrice(provider, model, input, output); },
  async clearUsage() { clearUsage(); },
  async health() { return clone(healthRows()); },
  async clearHealth() { clearHealth(); },

  // ---------- approvals ----------
  resolveApproval,
  revokeAlways,
  setApprovalsEnabled,

  // ---------- GitHub ----------
  githubWhoAmI,
  connectGoogle,
  storeGoogleToken,
  async transcribeAudio(data, mime, lang) { return transcribeBase64(data, mime, lang); },
  disconnectGoogle,
  updateGoogle,

  // ---------- connected apps (MCP) ----------
  addConnector,
  refreshConnector,
  updateConnector,
  removeConnector,

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

  async getArtifact(botId, name) {
    const a = artifactsOf(botId).find((x) => x.name === name);
    return a ? clone(a) : { name, content: '(Este archivo ya no existe)' };
  },

  openArtifact(botId, name, download = false) {
    const a = artifactsOf(botId).find((x) => x.name === name);
    if (a) openArtifactFile(a, download);
  },

  async deleteArtifact(botId, name) {
    db().artifacts[botId] = artifactsOf(botId).filter((a) => a.name !== name);
    save();
    return { ok: true };
  },

  // ---------- keys & settings ----------
  async saveKeys(keys) {
    for (const [provider, key] of Object.entries(keys || {})) {
      if (!providerById(provider) && !SERVICE_KEYS.includes(provider)) continue;
      if (key) db().keys[provider] = String(key).trim();
      else delete db().keys[provider];
    }
    save();
    await Promise.all(Object.keys(keys || {}).filter((p) => providerById(p)).map((p) => refreshModels(p)));
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

  async exportData(opts) { return exportData(opts); },
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

  resolveMissed,
  async saveWatcher(w) { saveWatcher(w); },
  async deleteWatcher(id) { deleteWatcher(id); },
  async checkWatcher(id) { const w = watchers().find((x) => x.id === id); if (w) await checkWatcher(w, { force: true }); },

  async runRoutine(id) {
    const r = db().routines.find((x) => x.id === id);
    if (!r) throw new Error('Rutina no encontrada');
    runRoutine(r);
    return { ok: true };
  },
};
