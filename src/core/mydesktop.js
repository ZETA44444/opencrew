// «Mi equipo»: bots use files (and optionally the terminal) on YOUR computer through the
// OpenCrew Escritorio app (server only). The app only allows the folders you add, each one
// read-only or read+write and for the bots you choose; every action also asks your permission
// here and is written to the activity log.
const pc = () => globalThis.OPENCREW_DESKTOP;
export const desktopOnline = () => !!pc()?.connected();

const pathArg = { type: 'string', description: 'Ruta dentro de una de las carpetas permitidas (empieza por el nombre o la ruta que da mi_equipo_carpetas)' };
const call = (cmd, args, ctx, timeout) => pc().send(cmd, { ...args, bot: { id: ctx.bot.id, name: ctx.bot.name } }, timeout);

export const MY_DESKTOP_TOOLS = {
  mi_equipo_carpetas: {
    description: 'Lista las carpetas del ordenador del usuario que puedes usar y qué permiso tienes en cada una (lectura o lectura y escritura), y si puedes usar su terminal.',
    parameters: { type: 'object', properties: {} },
    run: async (a, ctx) => {
      const r = await call('folders', {}, ctx);
      if (!r.folders.length) return 'El usuario no te ha dado acceso a ninguna carpeta de su ordenador.';
      return `${r.folders.map((f) => `- ${f.path} (${f.write ? 'lectura y escritura' : 'solo lectura'})`).join('\n')}\nTerminal: ${r.terminal ? 'permitida' : 'no permitida'}`;
    },
  },
  mi_equipo_listar: {
    description: 'Lista el contenido de una carpeta del ordenador del usuario.',
    parameters: { type: 'object', properties: { path: pathArg }, required: ['path'] },
    run: async ({ path }, ctx) => {
      const r = await call('list', { path }, ctx);
      return `${r.path}\n${r.entries.map((e) => `${e.dir ? '📁' : '📄'} ${e.name}${e.dir ? '/' : ` (${e.size < 1024 ? `${e.size} B` : `${Math.round(e.size / 1024)} KB`})`}`).join('\n') || '(vacía)'}`;
    },
  },
  mi_equipo_leer: {
    description: 'Lee un archivo de texto del ordenador del usuario (hasta ~200 KB).',
    parameters: { type: 'object', properties: { path: pathArg }, required: ['path'] },
    run: async ({ path }, ctx) => { const r = await call('read', { path }, ctx); return `${r.path} (${r.size} bytes)\n\n${r.content}`; },
  },
  mi_equipo_buscar: {
    description: 'Busca archivos por nombre (y opcionalmente por contenido) dentro de una carpeta permitida.',
    parameters: { type: 'object', properties: { path: pathArg, nombre: { type: 'string', description: 'Parte del nombre del archivo' }, contenido: { type: 'string', description: 'Texto que debe contener (opcional)' } }, required: ['path'] },
    run: async ({ path, nombre, contenido }, ctx) => { const r = await call('search', { path, name: nombre, text: contenido }, ctx, 60_000); return r.matches.length ? r.matches.map((m) => `- ${m}`).join('\n') : 'No hay coincidencias.'; },
  },
  mi_equipo_escribir: {
    description: 'Crea o sobrescribe un archivo de texto en una carpeta del usuario con permiso de escritura. Solo si el usuario lo ha pedido.',
    parameters: { type: 'object', properties: { path: pathArg, contenido: { type: 'string' } }, required: ['path', 'contenido'] },
    run: async ({ path, contenido }, ctx) => { const r = await call('write', { path, content: String(contenido ?? '') }, ctx); return `Guardado ${r.path} (${r.size} bytes)${r.backup ? ` · copia del anterior: ${r.backup}` : ''}`; },
  },
  mi_equipo_terminal: {
    description: 'Ejecuta un comando en la terminal del ordenador del usuario, dentro de una carpeta permitida (solo si el usuario activó la terminal para ti). Máx. 2 minutos.',
    parameters: { type: 'object', properties: { command: { type: 'string' }, path: { type: 'string', description: 'Carpeta donde ejecutarlo' } }, required: ['command', 'path'] },
    run: async ({ command, path }, ctx) => { const r = await call('run', { command, cwd: path }, ctx, 150_000); return `Código de salida: ${r.code}\n\n${r.output}`; },
  },
};

export function myDesktopTools(bot) {
  if (!bot?.userComputer || !desktopOnline()) return [];
  const info = pc().info() || {};
  return Object.entries(MY_DESKTOP_TOOLS)
    .filter(([name]) => name !== 'mi_equipo_terminal' || info.terminal)
    .map(([name, t]) => ({ name, description: `[Tu ordenador] ${t.description}`, parameters: t.parameters }));
}

export async function runMyDesktopTool(name, args, ctx) {
  const t = MY_DESKTOP_TOOLS[name];
  if (!t) return `Herramienta desconocida: ${name}`;
  if (!ctx?.bot?.userComputer) return 'Este bot no tiene permiso para usar el ordenador del usuario (se activa en su configuración).';
  if (!desktopOnline()) return 'El ordenador del usuario no está conectado: la app OpenCrew Escritorio está cerrada o sin emparejar.';
  try { return String(await t.run(args || {}, ctx)); } catch (e) { return `Error: ${e.message}`; }
}

export function describeMyDesktop(name, a = {}) {
  return {
    mi_equipo_carpetas: 'Mirando qué carpetas puede usar',
    mi_equipo_listar: `Abriendo la carpeta ${a.path}`,
    mi_equipo_leer: `Leyendo ${a.path}`,
    mi_equipo_buscar: `Buscando ${a.nombre || a.contenido || ''} en ${a.path}`,
    mi_equipo_escribir: `Guardando ${a.path} en tu ordenador`,
    mi_equipo_terminal: `Terminal de tu ordenador: ${String(a.command || '').slice(0, 60)}`,
  }[name] || name;
}
