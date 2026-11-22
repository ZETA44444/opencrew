// Tools every bot can use. Each tool: { name, description, parameters (JSON schema), run(args, ctx) }
import { getDb, findBotByName, save, now } from './store.js';

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
      const reply = await ctx.runAgent({ botId: target.id, input: task, from: ctx.bot.name, depth: ctx.depth + 1, runId: ctx.runId, emit: ctx.emit });
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
  get_current_time: {
    description: 'Devuelve la fecha y hora actual.',
    parameters: { type: 'object', properties: {} },
    async run() { return new Date().toString(); },
  },
};

export const TOOL_NAMES = Object.keys(ALL_TOOLS);

export function toolsFor(bot, depth) {
  const enabled = bot.tools || TOOL_NAMES;
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
    default: return call.name;
  }
}
