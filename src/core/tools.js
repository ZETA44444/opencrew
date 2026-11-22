// Tools every bot can use. Each tool: { name, description, parameters (JSON schema), run(args, ctx) }
import { getDb, findBotByName, save, now, newId } from './store.js';
import { providerById, defaultModel, modelsOf, PROVIDERS } from './providers.js';
import { broadcast } from './events.js';

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
    description: 'Guarda un archivo (markdown, código, csv, html…) como artefacto que el usuario puede abrir o descargar.',
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
  const enabled = bot.tools || defaultToolsFor(bot);
  return TOOL_NAMES
    .filter((n) => enabled.includes(n))
    .filter((n) => !(n === 'delegate_to_bot' && depth >= 2)) // avoid infinite delegation chains
    .map((name) => ({ name, description: ALL_TOOLS[name].description, parameters: ALL_TOOLS[name].parameters }));
}

export async function runTool(call, ctx) {
  const tool = ALL_TOOLS[call.name];
  if (!tool) return `Herramienta desconocida: ${call.name}`;
  return String(await tool.run(call.args || {}, ctx));
}

export function describeCall(call) {
  const a = call.args || {};
  switch (call.name) {
    case 'delegate_to_bot': return `Delegando a ${a.bot_name}`;
    case 'save_memory': return 'Guardando en memoria';
    case 'fetch_url': return `Leyendo ${a.url}`;
    case 'write_artifact': return `Creando ${a.filename}`;
    case 'get_current_time': return 'Mirando la hora';
    case 'create_bot': return `Creando el bot ${a.name}`;
    case 'update_bot': return `Configurando a ${a.bot_name}`;
    default: return call.name;
  }
}
