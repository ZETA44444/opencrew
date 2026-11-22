// Tools every bot can use. Each tool: { name, description, parameters (JSON schema), run(args, ctx) }
import { getDb, findBotByName, save, now, newId } from './store.js';
import { providerById, defaultModel, modelsOf, PROVIDERS } from './providers.js';
import { broadcast } from './events.js';
import { computeNext } from './routines.js';
import { webSearch } from './search.js';
import { runJavaScript, formatRun } from './sandbox.js';
import { generateImage } from './images.js';
import { connectorTools, callConnectorTool, findConnectorTool } from './mcp.js';
import { githubTools, runGithubTool, describeGithub } from './github.js';

const PALETTE = ['#7dd3fc', '#fca5a5', '#86efac', '#fcd34d', '#c4b5fd', '#f9a8d4', '#fdba74', '#e5e5e5'];
const SHAPES = ['circle', 'square', 'diamond', 'hexagon', 'triangle'];
const pickOne = (arr, seed) => arr[[...String(seed)].reduce((a, c) => a + c.charCodeAt(0), 0) % arr.length];

// Checks a provider/model pair and fills in a sensible model if missing.
function resolveModel(provider, model, fallbackBot) {
  if (!provider) return { provider: fallbackBot.provider, model: model || fallbackBot.model };
  const p = providerById(provider) || PROVIDERS.find((x) => x.label.toLowerCase().includes(String(provider).toLowerCase()));
  if (!p) throw new Error(`Proveedor desconocido: ${provider}. Usa uno de: ${PROVIDERS.map((x) => x.id).join(', ')}`);
  return { provider: p.id, model: model || defaultModel(p.id) };
}

// ---------- routines helpers ----------
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function parseDays(days) {
  if (days == null || days === '') return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set();
  const whole = String(days).toLowerCase();
  if (/fin(es)? de semana|finde|weekend/.test(whole)) [0, 6].forEach((x) => out.add(x));
  if (/laborable|entre semana|weekday/.test(whole)) [1, 2, 3, 4, 5].forEach((x) => out.add(x));
  const list = Array.isArray(days) ? days : whole.replace(/fin(es)? de semana|entre semana/g, '').split(/\s*,\s*|\s+y\s+|\s+/);
  for (const d of list) {
    const t = String(d).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (!t) continue;
    if (/^\d$/.test(t)) out.add(Number(t) % 7);
    else if (/laborable|entre semana|weekday/.test(t)) [1, 2, 3, 4, 5].forEach((x) => out.add(x));
    else if (/fin de semana|finde|weekend/.test(t)) [0, 6].forEach((x) => out.add(x));
    else if (/todos|diario|cada dia|daily/.test(t)) [0, 1, 2, 3, 4, 5, 6].forEach((x) => out.add(x));
    else {
      const i = DAY_NAMES.findIndex((n) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').startsWith(t.slice(0, 3)));
      if (i >= 0) out.add(i);
    }
  }
  return out.size ? [...out].sort() : [0, 1, 2, 3, 4, 5, 6];
}
const describeSchedule = (s) => (s.type === 'interval' ? `cada ${s.minutes} min` : `a las ${s.time} (${s.days.length === 7 ? 'todos los días' : s.days.map((d) => DAY_NAMES[d]).join(', ')})`);

const providerHelp = () => PROVIDERS.map((p) => `${p.id} (modelos: ${modelsOf(p.id).slice(0, 4).join(', ')})`).join('; ');

export const artifactsOf = (botId) => (getDb().artifacts[botId] ??= []);
const safeName = (n) => String(n || 'archivo.txt').split(/[\\/]/).pop().replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]/g, '_').slice(0, 80) || 'archivo.txt';

async function readUrl(u) {
  // 1) Direct fetch (works for sites that allow CORS).
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(15_000) });
    const type = res.headers.get('content-type') || '';
    const body = await res.text();
    return { status: res.status, text: type.includes('html') ? htmlToText(body) : body };
  } catch (e) {
    // 2) Most sites block browsers from reading them directly (CORS). Fall back to a public reader.
    if (!getDb().settings.webReader) throw new Error('La web no permite leerla desde el navegador y el lector web está desactivado en Ajustes.');
    const res = await fetch(`https://r.jina.ai/${u.href}`, { signal: AbortSignal.timeout(30_000) });
    return { status: res.status, text: await res.text(), via: 'r.jina.ai' };
  }
}

function isPrivateHost(host) {
  return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/i.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

const ALL_TOOLS = {
  delegate_to_bot: {
    description: 'Delega una tarea a otro bot del equipo y espera su respuesta. Úsalo cuando otro bot sea más adecuado para la tarea.',
    parameters: {
      type: 'object',
      properties: {
        bot_name: { type: 'string', description: 'Nombre exacto del bot del equipo' },
        task: { type: 'string', description: 'La tarea, con todo el contexto que necesite' },
      },
      required: ['bot_name', 'task'],
    },
    async run({ bot_name, task }, ctx) {
      const target = findBotByName(bot_name);
      if (!target) return `No existe ningún bot llamado "${bot_name}". Bots disponibles: ${getDb().bots.map((b) => b.name).join(', ')}`;
      if (target.id === ctx.bot.id) return 'No puedes delegarte una tarea a ti mismo.';
      const reply = await ctx.runAgent({ botId: target.id, input: task, from: ctx.bot.name, depth: ctx.depth + 1, runId: ctx.runId, emit: ctx.emit, controller: ctx.controller });
      if (reply.stopped) throw new Error('Detenido');
      return `Respuesta de ${target.name} (${target.provider}/${target.model}):\n${reply.content}`;
    },
  },
  save_memory: {
    description: 'Guarda en tu memoria permanente un dato importante sobre el usuario o sus preferencias.',
    parameters: { type: 'object', properties: { fact: { type: 'string', description: 'El dato a recordar, en una frase' } }, required: ['fact'] },
    async run({ fact }, ctx) {
      ctx.bot.memory.push(String(fact).slice(0, 500));
      save();
      return `Guardado en memoria: "${fact}"`;
    },
  },
  web_search: {
    description: 'Busca en internet información actual (noticias, precios, datos, documentación). Devuelve un resumen y las fuentes con sus URLs; luego puedes leer una fuente con fetch_url.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Qué buscar, como lo escribirías en Google' } }, required: ['query'] },
    async run({ query }) { return webSearch(query); },
  },
  generate_image: {
    description: 'Genera una imagen a partir de una descripción (ilustraciones, portadas, logos, fotos de producto…). La imagen se guarda en Archivos y se muestra en el chat.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Descripción detallada de la imagen: tema, estilo, colores, composición' },
        filename: { type: 'string', description: 'Nombre corto para el archivo, sin extensión (opcional)' },
      },
      required: ['prompt'],
    },
    async run({ prompt, filename }, ctx) {
      const img = await generateImage(String(prompt), { demoMode: ctx.bot.provider === 'demo' });
      const ext = (img.dataUrl.match(/^data:image\/([\w+]+)/)?.[1] || 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg');
      const base = safeName(filename || String(prompt).slice(0, 40)).replace(/\.[^.]*$/, '').replace(/\s+/g, '-').toLowerCase() || 'imagen';
      const name = `${base}.${ext}`;
      const list = artifactsOf(ctx.bot.id);
      const existing = list.find((a) => a.name === name);
      if (existing) Object.assign(existing, { content: img.dataUrl, updatedAt: now() });
      else list.unshift({ name, content: img.dataUrl, updatedAt: now() });
      save();
      ctx.emit({ type: 'artifacts', botId: ctx.bot.id });
      return `Archivo guardado: ${name} (imagen generada con ${img.via}). Ya se ve en el chat; no hace falta describirla entera.`;
    },
  },
  run_javascript: {
    description: 'Ejecuta código JavaScript en un sandbox aislado (sin internet ni acceso a la app, máx. 10 s). Úsalo para cálculos exactos, procesar datos, fechas o comprobar código. Muestra resultados con console.log o con return.',
    parameters: { type: 'object', properties: { code: { type: 'string', description: 'Código JavaScript (se ejecuta como cuerpo de una función async; puedes usar await y return)' } }, required: ['code'] },
    async run({ code }) { return formatRun(await runJavaScript(code)); },
  },
  fetch_url: {
    description: 'Descarga una página web pública y devuelve su texto (máx. 12.000 caracteres).',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL http(s) completa' } }, required: ['url'] },
    async run({ url }) {
      let u;
      try { u = new URL(url); } catch { return 'URL no válida.'; }
      if (!/^https?:$/.test(u.protocol) || isPrivateHost(u.hostname)) return 'Solo se permiten URLs públicas http(s).';
      const r = await readUrl(u);
      return `HTTP ${r.status} · ${u.href}${r.via ? ` (leído vía ${r.via})` : ''}\n\n${r.text.slice(0, 12_000)}`;
    },
  },
  write_artifact: {
    description: 'Guarda un archivo (markdown, código, csv, json, svg o html) que el usuario puede abrir dentro de la app. Los .html se muestran como página interactiva: úsalos para dashboards, informes visuales o mini-apps (HTML autocontenido; puedes usar scripts de CDNs).',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Nombre del archivo con extensión, p. ej. informe.md' },
        content: { type: 'string', description: 'Contenido completo del archivo' },
      },
      required: ['filename', 'content'],
    },
    async run({ filename, content }, ctx) {
      const name = safeName(filename);
      const text = String(content ?? '');
      const list = artifactsOf(ctx.bot.id);
      const existing = list.find((a) => a.name === name);
      if (existing) Object.assign(existing, { content: text, updatedAt: now() });
      else list.unshift({ name, content: text, updatedAt: now() });
      save();
      ctx.emit({ type: 'artifacts', botId: ctx.bot.id });
      return `Archivo guardado: ${name} (${new Blob([text]).size} bytes)`;
    },
  },
  save_skill: {
    description: 'Guarda (o actualiza) una skill en la biblioteca compartida del equipo: un proceso paso a paso para hacer una tarea que se repite. Todos los bots podrán usarla.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nombre corto de la skill (p. ej. «Informe SEO semanal»)' },
        description: { type: 'string', description: 'Cuándo usarla, en una frase' },
        steps: { type: 'string', description: 'Los pasos detallados, en markdown' },
      },
      required: ['name', 'steps'],
    },
    async run(a, ctx) {
      const name = String(a.name || '').trim();
      if (!name) return 'Falta el nombre de la skill.';
      const skills = getDb().skills;
      const existing = skills.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (existing) Object.assign(existing, { description: a.description || existing.description, steps: String(a.steps), updatedBy: ctx.bot.name, updatedAt: now() });
      else skills.push({ id: newId(), name, description: a.description || '', steps: String(a.steps), createdBy: ctx.bot.name, updatedAt: now() });
      save();
      broadcast({ type: 'skills' });
      return `${existing ? 'Skill actualizada' : 'Skill guardada'}: «${name}». Ya la pueden usar todos los bots.`;
    },
  },
  use_skill: {
    description: 'Lee los pasos de una skill de la biblioteca compartida antes de hacer una tarea que encaje con ella.',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'Nombre de la skill' } }, required: ['name'] },
    async run({ name }) {
      const n = String(name || '').trim().toLowerCase();
      const skills = getDb().skills;
      const sk = skills.find((x) => x.name.toLowerCase() === n) || skills.find((x) => x.name.toLowerCase().includes(n) || n.includes(x.name.toLowerCase()));
      if (!sk) return `No hay ninguna skill llamada "${name}". Disponibles: ${skills.map((x) => x.name).join(', ') || 'ninguna'}`;
      sk.uses = (sk.uses || 0) + 1;
      save();
      return `Skill «${sk.name}»${sk.description ? ` — ${sk.description}` : ''}\n\n${sk.steps}`;
    },
  },
  create_routine: {
    description: 'Programa una rutina: una tarea que un bot hará solo cada cierto tiempo o cada día a una hora. Úsalo cuando el usuario pida algo recurrente («todos los lunes a las 9…», «cada hora revisa…»).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nombre corto (p. ej. «Resumen del lunes»)' },
        prompt: { type: 'string', description: 'Lo que el bot debe hacer en cada ejecución, explicado completo' },
        schedule_type: { type: 'string', description: '"daily" (a una hora, ciertos días) o "interval" (cada X minutos)' },
        time: { type: 'string', description: 'Hora en formato HH:MM (24 h) si es daily' },
        days: { type: 'string', description: 'Días si es daily: p. ej. "lunes", "lunes,miércoles", "laborables", "fin de semana" o "todos"' },
        minutes: { type: 'number', description: 'Cada cuántos minutos si es interval' },
        bot_name: { type: 'string', description: 'Qué bot la hará (por defecto, tú)' },
      },
      required: ['name', 'prompt', 'schedule_type'],
    },
    async run(a, ctx) {
      const bot = a.bot_name ? findBotByName(a.bot_name) : ctx.bot;
      if (!bot) return `No existe ningún bot llamado "${a.bot_name}".`;
      let schedule;
      if (String(a.schedule_type).startsWith('interval') || (a.minutes && !a.time)) {
        schedule = { type: 'interval', minutes: Math.max(5, Math.round(Number(a.minutes) || 60)) };
      } else {
        const m = String(a.time || '08:00').match(/(\d{1,2})(?::(\d{2}))?/);
        const hh = Math.min(23, Number(m?.[1] ?? 8)), mm = Math.min(59, Number(m?.[2] ?? 0));
        schedule = { type: 'daily', time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, days: parseDays(a.days) };
      }
      const routine = { id: newId(), botId: bot.id, name: String(a.name).slice(0, 80), prompt: String(a.prompt), schedule, enabled: true, createdBy: ctx.bot.name, createdAt: now() };
      routine.nextRunAt = computeNext(routine);
      getDb().routines.push(routine);
      save();
      broadcast({ type: 'routines' });
      return `Rutina creada: «${routine.name}» para ${bot.name}, ${describeSchedule(schedule)}. Próxima ejecución: ${new Date(routine.nextRunAt).toLocaleString()}. ` +
        'Recuerda al usuario que las rutinas solo se ejecutan mientras OpenCrew está abierta.';
    },
  },
  list_routines: {
    description: 'Lista las rutinas programadas del equipo.',
    parameters: { type: 'object', properties: {} },
    async run() {
      const d = getDb();
      if (!d.routines.length) return 'No hay rutinas programadas.';
      return d.routines.map((r) => `- «${r.name}» (${d.bots.find((b) => b.id === r.botId)?.name || '?'}, ${describeSchedule(r.schedule)}, ${r.enabled ? 'activa' : 'pausada'})`).join('\n');
    },
  },
  update_routine: {
    description: 'Pausa, reactiva o borra una rutina por su nombre.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nombre de la rutina' },
        action: { type: 'string', description: '"pause", "resume" o "delete"' },
      },
      required: ['name', 'action'],
    },
    async run({ name, action }) {
      const d = getDb();
      const n = String(name || '').toLowerCase();
      const r = d.routines.find((x) => x.name.toLowerCase() === n) || d.routines.find((x) => x.name.toLowerCase().includes(n));
      if (!r) return `No hay ninguna rutina llamada "${name}".`;
      if (action === 'delete') d.routines = d.routines.filter((x) => x !== r);
      else { r.enabled = action !== 'pause'; r.nextRunAt = computeNext(r); }
      save();
      broadcast({ type: 'routines' });
      return `Rutina «${r.name}» ${action === 'delete' ? 'borrada' : action === 'pause' ? 'pausada' : 'reactivada'}.`;
    },
  },
  create_bot: {
    description: 'Crea un bot nuevo en el equipo con su propio trabajo y modelo de IA. Úsalo cuando el usuario pida un bot nuevo o haga falta un especialista que no existe.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nombre corto, una palabra (p. ej. Iris)' },
        title: { type: 'string', description: 'Cargo (p. ej. Asistente de correo)' },
        description: { type: 'string', description: 'Su trabajo en una o dos frases; los demás bots lo leen para delegarle tareas' },
        instructions: { type: 'string', description: 'Cómo debe trabajar: tono, reglas, pasos' },
        provider: { type: 'string', description: 'Proveedor de IA (opcional): anthropic, gemini, openai, xai, openrouter, ollama o demo. Por defecto, el tuyo.' },
        model: { type: 'string', description: 'Modelo concreto (opcional). Por defecto, el recomendado del proveedor.' },
      },
      required: ['name', 'title', 'description'],
    },
    async run(a, ctx) {
      const name = String(a.name || '').trim().replace(/^@/, '').split(/\s+/)[0];
      if (!name) return 'Falta el nombre del bot.';
      if (getDb().bots.some((b) => b.name.toLowerCase() === name.toLowerCase())) return `Ya existe un bot llamado ${name}. Usa update_bot para cambiarlo.`;
      const { provider, model } = resolveModel(a.provider, a.model, ctx.bot);
      const bot = {
        id: newId(), name, title: a.title || 'Asistente', description: a.description || '', instructions: a.instructions || '',
        color: pickOne(PALETTE, name), shape: pickOne(SHAPES, name + 'x'), provider, model, memory: [], starred: false,
        createdBy: ctx.bot.name, createdAt: now(),
      };
      getDb().bots.push(bot);
      save();
      broadcast({ type: 'bots' });
      const keyNote = providerById(provider)?.noKey || getDb().keys[provider] ? '' : ` Ojo: aún no hay API key de ${providerById(provider).label}; el usuario debe añadirla en Ajustes.`;
      return `Bot creado: ${bot.name} (${bot.title}) con ${provider}/${model}. Ya aparece en la barra lateral y puedes delegarle tareas.${keyNote}`;
    },
  },
  update_bot: {
    description: 'Cambia la configuración de un bot del equipo: cargo, trabajo, instrucciones o modelo de IA.',
    parameters: {
      type: 'object',
      properties: {
        bot_name: { type: 'string', description: 'Nombre del bot a cambiar' },
        title: { type: 'string' },
        description: { type: 'string' },
        instructions: { type: 'string' },
        provider: { type: 'string', description: 'Nuevo proveedor de IA' },
        model: { type: 'string', description: 'Nuevo modelo' },
      },
      required: ['bot_name'],
    },
    async run(a, ctx) {
      const bot = findBotByName(a.bot_name);
      if (!bot) return `No existe ningún bot llamado "${a.bot_name}".`;
      const changes = [];
      for (const k of ['title', 'description', 'instructions']) if (a[k]) { bot[k] = String(a[k]); changes.push(k); }
      if (a.provider || a.model) {
        const r = resolveModel(a.provider || bot.provider, a.model || (a.provider ? null : bot.model), ctx.bot);
        bot.provider = r.provider; bot.model = r.model;
        changes.push(`modelo → ${r.provider}/${r.model}`);
      }
      if (!changes.length) return `No había nada que cambiar. Proveedores disponibles: ${providerHelp()}`;
      save();
      broadcast({ type: 'bots' });
      return `${bot.name} actualizado: ${changes.join(', ')}.`;
    },
  },
  get_current_time: {
    description: 'Devuelve la fecha y hora actual.',
    parameters: { type: 'object', properties: {} },
    async run() { return new Date().toString(); },
  },
};

export const TOOL_NAMES = Object.keys(ALL_TOOLS);
// Tools that change the team: only the main (★) bot gets them unless you enable them by hand.
export const MANAGER_TOOLS = ['create_bot', 'update_bot'];
export const defaultToolsFor = (bot) => TOOL_NAMES.filter((n) => bot.starred || !MANAGER_TOOLS.includes(n));

export function toolsFor(bot, depth) {
  // Tools added to the app after the bot's tool list was saved get their default setting.
  const defaults = defaultToolsFor(bot);
  const enabled = bot.tools
    ? [...bot.tools, ...defaults.filter((n) => !(bot.toolsKnown || ['delegate_to_bot', 'save_memory', 'fetch_url', 'write_artifact', 'get_current_time', 'create_bot', 'update_bot']).includes(n))]
    : defaults;
  return TOOL_NAMES
    .filter((n) => enabled.includes(n))
    .filter((n) => !(n === 'delegate_to_bot' && depth >= 2)) // avoid infinite delegation chains
    .map((name) => ({ name, description: ALL_TOOLS[name].description, parameters: ALL_TOOLS[name].parameters }))
    // Tools from connected apps (MCP), unless this bot has them switched off.
    .concat(bot.connectors === false ? [] : [...githubTools(), ...connectorTools()]);
}

export async function runTool(call, ctx) {
  if (call.name.startsWith('mcp_')) return callConnectorTool(call.name, call.args || {});
  if (call.name.startsWith('github_')) return runGithubTool(call.name, call.args || {});
  const tool = ALL_TOOLS[call.name];
  if (!tool) return `Herramienta desconocida: ${call.name}`;
  return String(await tool.run(call.args || {}, ctx));
}

export function describeCall(call) {
  const a = call.args || {};
  if (call.name.startsWith('github_')) return describeGithub(call.name, a);
  if (call.name.startsWith('mcp_')) {
    const hit = findConnectorTool(call.name);
    return hit ? `${hit.c.name}: ${hit.t.name}` : call.name;
  }
  switch (call.name) {
    case 'delegate_to_bot': return `Delegando a ${a.bot_name}`;
    case 'save_memory': return 'Guardando en memoria';
    case 'fetch_url': return `Leyendo ${a.url}`;
    case 'run_javascript': return 'Ejecutando código';
    case 'generate_image': return 'Generando una imagen';
    case 'web_search': return `Buscando «${a.query}»`;
    case 'write_artifact': return `Creando ${a.filename}`;
    case 'get_current_time': return 'Mirando la hora';
    case 'save_skill': return `Guardando la skill «${a.name}»`;
    case 'use_skill': return `Usando la skill «${a.name}»`;
    case 'create_routine': return `Programando la rutina «${a.name}»`;
    case 'list_routines': return 'Mirando las rutinas';
    case 'update_routine': return `Cambiando la rutina «${a.name}»`;
    case 'create_bot': return `Creando el bot ${a.name}`;
    case 'update_bot': return `Configurando a ${a.bot_name}`;
    default: return call.name;
  }
}
