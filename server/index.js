import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

try { process.loadEnvFile(); } catch { /* no .env file, that's fine */ }

const { getDb, getBot, newId, now, save, messagesOf } = await import('./store.js');
const { publicProviders, providerById, callModel } = await import('./providers.js');
const { runAgent, busy } = await import('./agent.js');
const { sseHandler, broadcast } = await import('./events.js');
const { computeNext, runRoutine, startScheduler } = await import('./routines.js');
const { artifactsDir, TOOL_NAMES } = await import('./tools.js');

const app = express();
app.use(express.json({ limit: '2mb' }));

const BOT_FIELDS = ['name', 'title', 'description', 'instructions', 'color', 'shape', 'provider', 'model', 'memory', 'starred', 'tools'];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const db = getDb;
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

app.get('/api/events', sseHandler);

app.get('/api/state', (req, res) => {
  res.json({
    bots: db().bots,
    providers: publicProviders(),
    routines: db().routines,
    runs: db().runs.slice(0, 50),
    busy: [...busy],
    tools: TOOL_NAMES,
  });
});

// ---------- bots ----------
app.post('/api/bots', (req, res) => {
  const b = pick(req.body || {}, BOT_FIELDS);
  if (!b.name?.trim()) return bad(res, 'El bot necesita un nombre');
  const bot = {
    id: newId(), title: 'Asistente', description: '', instructions: '', color: '#e5e5e5', shape: 'circle',
    provider: 'demo', model: 'demo', memory: [], starred: false, ...b, name: b.name.trim(), createdAt: now(),
  };
  db().bots.push(bot);
  save();
  broadcast({ type: 'bots' });
  res.json(bot);
});

app.patch('/api/bots/:id', (req, res) => {
  const bot = getBot(req.params.id);
  if (!bot) return bad(res, 'Bot no encontrado', 404);
  Object.assign(bot, pick(req.body || {}, BOT_FIELDS));
  if (req.body?.provider && !providerById(bot.provider)) return bad(res, 'Proveedor desconocido');
  save();
  broadcast({ type: 'bots' });
  res.json(bot);
});

app.delete('/api/bots/:id', (req, res) => {
  const d = db();
  d.bots = d.bots.filter((b) => b.id !== req.params.id);
  delete d.messages[req.params.id];
  d.routines = d.routines.filter((r) => r.botId !== req.params.id);
  save();
  broadcast({ type: 'bots' });
  res.json({ ok: true });
});

app.get('/api/bots/:id/messages', (req, res) => res.json(messagesOf(req.params.id)));

app.delete('/api/bots/:id/messages', (req, res) => {
  db().messages[req.params.id] = [];
  save();
  res.json({ ok: true });
});

app.post('/api/bots/:id/chat', (req, res) => {
  const bot = getBot(req.params.id);
  const text = String(req.body?.text || '').trim();
  if (!bot) return bad(res, 'Bot no encontrado', 404);
  if (!text) return bad(res, 'Mensaje vacío');
  if (busy.has(bot.id)) return bad(res, `${bot.name} está ocupado, espera a que termine`, 409);
  runAgent({ botId: bot.id, input: text }).catch((e) => console.error(e));
  res.status(202).json({ ok: true });
});

// ---------- artifacts ----------
app.get('/api/bots/:id/artifacts', (req, res) => {
  const dir = artifactsDir(req.params.id);
  if (!fs.existsSync(dir)) return res.json([]);
  const files = fs.readdirSync(dir).map((name) => {
    const st = fs.statSync(path.join(dir, name));
    return { name, size: st.size, updatedAt: st.mtime };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(files);
});

app.get('/api/bots/:id/artifacts/:name', (req, res) => {
  const file = path.join(artifactsDir(req.params.id), path.basename(req.params.name));
  if (!fs.existsSync(file)) return bad(res, 'No existe', 404);
  // Sandbox so an HTML artifact made by a bot can't run scripts against this app.
  res.set('Content-Security-Policy', 'sandbox');
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.query.download) res.attachment(path.basename(file));
  res.sendFile(file);
});

app.delete('/api/bots/:id/artifacts/:name', (req, res) => {
  const file = path.join(artifactsDir(req.params.id), path.basename(req.params.name));
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

// ---------- API keys (stored only on this machine, never sent back in full) ----------
app.put('/api/settings/keys', (req, res) => {
  for (const [provider, key] of Object.entries(req.body || {})) {
    if (!providerById(provider)) continue;
    if (key) db().keys[provider] = String(key).trim();
    else delete db().keys[provider];
  }
  save();
  res.json(publicProviders());
});

app.post('/api/settings/test', async (req, res) => {
  const { provider, model } = req.body || {};
  const t0 = Date.now();
  try {
    const r = await callModel({
      providerId: provider, model, tools: [],
      system: 'Eres una prueba de conexión.', messages: [{ role: 'user', content: 'Responde solo con: OK' }],
    });
    res.json({ ok: true, reply: r.text.slice(0, 200), ms: Date.now() - t0 });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ---------- routines ----------
const ROUTINE_FIELDS = ['botId', 'name', 'prompt', 'schedule', 'enabled'];
app.post('/api/routines', (req, res) => {
  const r = pick(req.body || {}, ROUTINE_FIELDS);
  if (!getBot(r.botId)) return bad(res, 'Bot no encontrado');
  if (!r.name || !r.prompt) return bad(res, 'Falta nombre o instrucciones');
  const routine = { id: newId(), enabled: true, schedule: { type: 'daily', time: '08:00' }, ...r, createdAt: now() };
  routine.nextRunAt = computeNext(routine);
  db().routines.push(routine);
  save();
  broadcast({ type: 'routines' });
  res.json(routine);
});

app.patch('/api/routines/:id', (req, res) => {
  const r = db().routines.find((x) => x.id === req.params.id);
  if (!r) return bad(res, 'Rutina no encontrada', 404);
  Object.assign(r, pick(req.body || {}, ROUTINE_FIELDS));
  r.nextRunAt = computeNext(r);
  save();
  broadcast({ type: 'routines' });
  res.json(r);
});

app.delete('/api/routines/:id', (req, res) => {
  db().routines = db().routines.filter((x) => x.id !== req.params.id);
  save();
  broadcast({ type: 'routines' });
  res.json({ ok: true });
});

app.post('/api/routines/:id/run', (req, res) => {
  const r = db().routines.find((x) => x.id === req.params.id);
  if (!r) return bad(res, 'Rutina no encontrada', 404);
  runRoutine(r);
  res.status(202).json({ ok: true });
});

// ---------- static frontend (after `npm run build`) ----------
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => (req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(path.join(dist, 'index.html')) : next()));
}

const PORT = Number(process.env.API_PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1'; // local only by default: your API keys live here
app.listen(PORT, HOST, () => {
  console.log(`OpenCrew API → http://${HOST}:${PORT}`);
  startScheduler();
});
