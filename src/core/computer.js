// Tools for a bot's own «computer» on your server (terminal + browser). Only when the app runs on
// your OpenCrew server and the bot has «Ordenador» switched on in its settings.
import { now, save } from './store.js';
import { checkComputerAllowed, addComputerTime } from './limits.js';

// Every use of the computer goes through pc(): it refuses when the plan doesn't include one.
const pc = () => { checkComputerAllowed(); return globalThis.OPENCREW_COMPUTER; };
export const computerAvailable = () => !!globalThis.OPENCREW_COMPUTER;
const IMG = /\.(png|jpe?g|gif|webp|svg)$/i;
const TEXT = /\.(txt|md|csv|json|html?|xml|js|mjs|ts|py|sh|css|ya?ml|log|sql|svg)$/i;

function saveArtifact(ctx, name, content) {
  const list = (ctx.artifacts)(ctx.bot.id);
  const existing = list.find((a) => a.name === name);
  if (existing) Object.assign(existing, { content, updatedAt: now() });
  else list.unshift({ name, content, updatedAt: now() });
  save();
  ctx.emit({ type: 'artifacts', botId: ctx.bot.id });
}

export const COMPUTER_TOOLS = {
  computer_terminal: {
    description: 'Ejecuta un comando en TU ordenador (Linux con bash, git, curl, python3, node, jq). Tu carpeta de trabajo es /work y se conserva entre conversaciones. Puedes instalar paquetes de Python/Node con pip/npm en /work. Devuelve la salida y el código de salida.',
    parameters: { type: 'object', properties: { command: { type: 'string' }, timeout_s: { type: 'number', description: 'Máximo de segundos (por defecto 60, máx. 300)' } }, required: ['command'] },
    async run({ command, timeout_s = 60 }, ctx) {
      const r = await pc().shell(ctx.bot.id, command, { timeoutMs: Math.min(300, Math.max(5, Number(timeout_s) || 60)) * 1000 });
      return `${r.code === 124 ? '⏱ Tiempo agotado\n' : ''}Código de salida: ${r.code}\n\n${r.output}`;
    },
  },
  computer_browser: {
    description: 'Usa TU navegador (Chromium real, guarda sesiones y cookies). Abre una web y opcionalmente sigue pasos: {"action":"click","target":"Texto del botón o selector CSS"}, {"action":"type","target":"#email","text":"…"}, {"action":"press","key":"Enter"}, {"action":"scroll"}, {"action":"wait","ms":1000}, {"action":"goto","url":"…"}, {"action":"back"}. Se mueve como una persona (ratón con trayectoria, tecleo letra a letra). Devuelve el texto visible, los enlaces y una captura que se guarda en Archivos. Si una web te bloquea, usa las herramientas mi_navegador_* (el navegador del usuario) si las tienes, o pídele al usuario que la abra él. Nunca escribas contraseñas ni datos de pago.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Web a abrir (opcional si continúas con pasos)' },
        steps: { type: 'array', items: { type: 'object', properties: { action: { type: 'string' }, target: { type: 'string' }, text: { type: 'string' }, key: { type: 'string' }, url: { type: 'string' }, ms: { type: 'number' } } } },
        screenshot: { type: 'boolean', description: 'Guardar captura (por defecto sí)' },
      },
    },
    async run({ url, steps = [], screenshot = true }, ctx) {
      if (!url && !steps.length) return 'Indica una url o algún paso.';
      const r = await pc().browse(ctx.bot.id, { url, steps, screenshot });
      if (r.error && !r.text) return `Error del navegador: ${r.error}`;
      let shot = '';
      if (r.screenshot) {
        const name = `captura-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
        saveArtifact(ctx, name, `data:image/jpeg;base64,${r.screenshot}`);
        shot = `\nCaptura guardada en Archivos: ${name}`;
      }
      return [
        `${r.ok ? '' : '⚠️ Algún paso falló. '}Página: ${r.title || '(sin título)'} — ${r.url}`,
        r.log?.length ? `Pasos:\n${r.log.join('\n')}` : '',
        r.error ? `Error: ${r.error}` : '',
        r.blocked ? `🚫 Esta web ha bloqueado la visita (código ${r.status || '?'}). Bloquea las conexiones que vienen de servidores en la nube, no la forma de navegar: reintentar aquí no servirá. Usa mi_navegador_abrir / mi_navegador_leer (el navegador del usuario, con su conexión de casa) si están disponibles; si no, explícaselo al usuario y pídele que conecte la extensión de OpenCrew.` : '',
        `Texto visible:\n${r.text || '(vacío)'}`,
        r.links?.length ? `Enlaces:\n${r.links.map(([t, h]) => `- ${t}: ${h}`).join('\n')}` : '',
      ].filter(Boolean).join('\n\n') + shot;
    },
  },
  computer_write_file: {
    description: 'Escribe un archivo en tu ordenador (ruta relativa a /work). Útil para scripts o datos que luego ejecutas con computer_terminal.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    async run({ path, content }, ctx) {
      const p = await pc().writeFile(ctx.bot.id, path, content);
      return `Guardado ${p} (${new Blob([String(content ?? '')]).size} bytes)`;
    },
  },
  computer_get_file: {
    description: 'Copia un archivo de tu ordenador a «Archivos» para que el usuario pueda abrirlo o descargarlo (máx. 2 MB). Texto, imágenes, CSV, HTML…',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    async run({ path }, ctx) {
      const f = await pc().readFile(ctx.bot.id, path);
      const base = f.path.split('/').pop() || 'archivo';
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      let content;
      if (IMG.test(base)) content = `data:image/${base.split('.').pop().toLowerCase().replace('jpg', 'jpeg').replace('svg', 'svg+xml')};base64,${f.base64}`;
      else if (TEXT.test(base) || !bytes.some((b) => b === 0)) content = new TextDecoder().decode(bytes);
      else return `${base} es un archivo binario: de momento solo puedo pasar texto e imágenes a Archivos.`;
      saveArtifact(ctx, base, content);
      return `Copiado a Archivos: ${base} (${bytes.length} bytes)`;
    },
  },
};

export function computerTools(bot) {
  if (!computerAvailable() || !bot?.computer) return [];
  return Object.entries(COMPUTER_TOOLS).map(([name, t]) => ({ name, description: `[Tu ordenador] ${t.description}`, parameters: t.parameters }));
}

export async function runComputerTool(name, args, ctx) {
  const t = COMPUTER_TOOLS[name];
  if (!t) return `Herramienta desconocida: ${name}`;
  if (!computerAvailable()) return 'El ordenador de los bots solo funciona en tu servidor de OpenCrew.';
  if (!ctx?.bot?.computer) return 'Este bot no tiene ordenador. El usuario puede activarlo en la configuración del bot.';
  const t0 = Date.now();
  try { return String(await t.run(args || {}, ctx)); } catch (e) { return `Error: ${e.message}`; } finally { addComputerTime(Date.now() - t0); save(); } // time of real use
}

export function describeComputer(name, a = {}) {
  return {
    computer_terminal: `Terminal: ${String(a.command || '').slice(0, 60)}`,
    computer_browser: `Navegador: ${a.url || `${(a.steps || []).length} pasos`}`,
    computer_write_file: `Escribiendo ${a.path}`,
    computer_get_file: `Pasando ${a.path} a Archivos`,
  }[name] || name;
}
