// «Mi navegador»: bots act in YOUR Chrome/Brave through the OpenCrew extension (server only).
// Every action asks your permission (once / always / deny) and is written to the activity log.
// The extension itself refuses password and card fields and the sites you block.
import { now, save } from './store.js';

const ext = () => globalThis.OPENCREW_EXT;
export const userBrowserOnline = () => !!ext()?.connected();

const tabArg = { type: 'number', description: 'Id de la pestaña (de mi_navegador_pestanas). Si no lo pones, la pestaña activa.' };
export const USER_BROWSER_TOOLS = {
  mi_navegador_pestanas: {
    description: 'Lista las pestañas abiertas en el navegador del usuario (id, título, web, cuál está activa).',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const tabs = await ext().send('tabs');
      return tabs.map((t) => `- [${t.id}] ${t.active ? '👉 ' : ''}${t.title} — ${t.url}`).join('\n') || 'No hay pestañas.';
    },
  },
  mi_navegador_leer: {
    description: 'Lee el contenido visible de una pestaña del navegador del usuario (texto, enlaces y campos de formulario).',
    parameters: { type: 'object', properties: { tab_id: tabArg } },
    run: async ({ tab_id }) => {
      const r = await ext().send('read', { tabId: tab_id });
      return [`${r.title} — ${r.url}`, r.fields?.length ? `Campos: ${r.fields.map((f) => `«${f.label}» (${f.selector})`).join(' · ')}` : '', `Texto:\n${r.text}`,
        r.links?.length ? `Enlaces:\n${r.links.map(([t, h]) => `- ${t}: ${h}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
    },
  },
  mi_navegador_abrir: {
    description: 'Abre una web en una pestaña nueva del navegador del usuario.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    run: async ({ url }) => { const r = await ext().send('open', { url }); return `Abierta en la pestaña ${r.id}: ${r.url}`; },
  },
  mi_navegador_clic: {
    description: 'Hace clic en un botón o enlace de una pestaña del usuario (por su texto visible o un selector CSS).',
    parameters: { type: 'object', properties: { tab_id: tabArg, target: { type: 'string', description: 'Texto del botón/enlace o selector CSS' } }, required: ['target'] },
    run: async ({ tab_id, target }) => { const r = await ext().send('click', { tabId: tab_id, target }); return `Clic en «${r.clicked}». Ahora: ${r.title} — ${r.url}`; },
  },
  mi_navegador_escribir: {
    description: 'Escribe texto en un campo de una pestaña del usuario (por su etiqueta, placeholder o selector). Nunca contraseñas ni datos de tarjeta: la extensión lo bloquea.',
    parameters: { type: 'object', properties: { tab_id: tabArg, target: { type: 'string' }, text: { type: 'string' }, enviar: { type: 'boolean', description: 'Pulsar Enter después' } }, required: ['target', 'text'] },
    run: async ({ tab_id, target, text, enviar }) => { const r = await ext().send('type', { tabId: tab_id, target, text, submit: !!enviar }); return `Escrito en «${r.field}»${enviar ? ' y enviado' : ''}.`; },
  },
  mi_navegador_captura: {
    description: 'Hace una captura de pantalla de una pestaña del usuario y la guarda en Archivos.',
    parameters: { type: 'object', properties: { tab_id: tabArg } },
    run: async ({ tab_id }, ctx) => {
      const r = await ext().send('screenshot', { tabId: tab_id }, 30_000);
      const name = `mi-navegador-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
      const list = ctx.artifacts(ctx.bot.id);
      list.unshift({ name, content: r.dataUrl, updatedAt: now() });
      save();
      ctx.emit({ type: 'artifacts', botId: ctx.bot.id });
      return `Captura de «${r.title}» guardada en Archivos: ${name}`;
    },
  },
};

export function userBrowserTools(bot) {
  if (!bot?.userBrowser || !userBrowserOnline()) return [];
  return Object.entries(USER_BROWSER_TOOLS).map(([name, t]) => ({ name, description: `[Tu navegador] ${t.description}`, parameters: t.parameters }));
}

export async function runUserBrowserTool(name, args, ctx) {
  const t = USER_BROWSER_TOOLS[name];
  if (!t) return `Herramienta desconocida: ${name}`;
  if (!ctx?.bot?.userBrowser) return 'Este bot no tiene permiso para usar el navegador del usuario (se activa en su configuración).';
  if (!userBrowserOnline()) return 'El navegador del usuario no está conectado: la extensión de OpenCrew está cerrada o sin emparejar.';
  try { return String(await t.run(args || {}, ctx)); } catch (e) { return `Error: ${e.message}`; }
}

export function describeUserBrowser(name, a = {}) {
  return {
    mi_navegador_pestanas: 'Mirando tus pestañas',
    mi_navegador_leer: `Leyendo ${a.tab_id ? `la pestaña ${a.tab_id}` : 'tu pestaña activa'}`,
    mi_navegador_abrir: `Abriendo ${a.url} en tu navegador`,
    mi_navegador_clic: `Clic en «${a.target}» en tu navegador`,
    mi_navegador_escribir: `Escribiendo en «${a.target}» en tu navegador`,
    mi_navegador_captura: 'Captura de tu navegador',
  }[name] || name;
}
