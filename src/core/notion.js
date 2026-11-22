// Notion for bots, with your internal integration token. Notion doesn't allow calls from a
// browser, so this only works on your OpenCrew server. Reading is available once the token
// is set; creating pages and adding content must be switched on and asks for approval.
import { getDb } from './store.js';

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const token = () => getDb().keys.notion || '';
export const onServer = () => typeof window === 'undefined';
export const notionEnabled = () => !!token() && onServer();
export const notionCanWrite = () => !!getDb().settings.notionWrite;

async function nf(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, 'notion-version': VERSION, ...(body && { 'content-type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const hint = res.status === 401 ? ' (token no válido)' : res.status === 404 ? ' (no existe o no está compartido con tu integración: en Notion, abre la página → ··· → Conexiones → añade tu integración)' : '';
    throw new Error(`Notion ${res.status}: ${data?.message || 'error'}${hint}`);
  }
  return data;
}

const cleanId = (id) => {
  const m = String(id || '').match(/[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (!m) throw new Error(`Id o enlace de Notion no válido: "${id}"`);
  return m[0].replace(/-/g, '');
};
const plain = (rich = []) => rich.map((r) => r.plain_text || '').join('');
function titleOf(obj) {
  if (obj.object === 'database') return plain(obj.title) || '(base de datos sin título)';
  const prop = Object.values(obj.properties || {}).find((p) => p.type === 'title');
  return plain(prop?.title) || '(sin título)';
}
function propText(p) {
  switch (p.type) {
    case 'title': return plain(p.title);
    case 'rich_text': return plain(p.rich_text);
    case 'number': return p.number ?? '';
    case 'select': return p.select?.name || '';
    case 'status': return p.status?.name || '';
    case 'multi_select': return p.multi_select.map((x) => x.name).join(', ');
    case 'date': return p.date ? `${p.date.start}${p.date.end ? ` → ${p.date.end}` : ''}` : '';
    case 'checkbox': return p.checkbox ? '✓' : '✗';
    case 'url': return p.url || '';
    case 'email': return p.email || '';
    case 'people': return p.people.map((x) => x.name || x.id).join(', ');
    default: return '';
  }
}
function blockText(b) {
  const t = b[b.type];
  const text = plain(t?.rich_text);
  switch (b.type) {
    case 'heading_1': return `# ${text}`;
    case 'heading_2': return `## ${text}`;
    case 'heading_3': return `### ${text}`;
    case 'bulleted_list_item': return `- ${text}`;
    case 'numbered_list_item': return `1. ${text}`;
    case 'to_do': return `- [${t.checked ? 'x' : ' '}] ${text}`;
    case 'quote': return `> ${text}`;
    case 'code': return `\`\`\`\n${text}\n\`\`\``;
    case 'child_page': return `📄 ${t.title} (id ${b.id})`;
    case 'child_database': return `🗃 ${t.title} (id ${b.id})`;
    default: return text;
  }
}

// Simple text → Notion blocks: "# ", "## ", "- ", "1. ", "- [ ] " and paragraphs.
function toBlocks(content) {
  const rich = (s) => (s.match(/[\s\S]{1,1900}/g) || ['']).map((c) => ({ type: 'text', text: { content: c } }));
  const make = (type, s, extra = {}) => ({ object: 'block', type, [type]: { rich_text: rich(s), ...extra } });
  return String(content || '').split('\n').filter((l) => l.trim()).slice(0, 100).map((l) => {
    let m;
    if ((m = /^###\s+(.*)/.exec(l))) return make('heading_3', m[1]);
    if ((m = /^##\s+(.*)/.exec(l))) return make('heading_2', m[1]);
    if ((m = /^#\s+(.*)/.exec(l))) return make('heading_1', m[1]);
    if ((m = /^\s*[-*]\s+\[( |x)\]\s+(.*)/i.exec(l))) return make('to_do', m[2], { checked: m[1].toLowerCase() === 'x' });
    if ((m = /^\s*[-*]\s+(.*)/.exec(l))) return make('bulleted_list_item', m[1]);
    if ((m = /^\s*\d+[.)]\s+(.*)/.exec(l))) return make('numbered_list_item', m[1]);
    return make('paragraph', l);
  });
}

const TOOLS = {
  notion_search: {
    description: 'Busca páginas y bases de datos en el Notion del usuario (solo las compartidas con su integración).',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', description: 'Máx. 20' } } },
    async run({ query = '', limit = 10 }) {
      const r = await nf('/search', { method: 'POST', body: { query, page_size: Math.min(20, Math.max(1, limit)), sort: { direction: 'descending', timestamp: 'last_edited_time' } } });
      return r.results.map((o) => `- ${o.object === 'database' ? '🗃' : '📄'} ${titleOf(o)} · id ${o.id} · editado ${String(o.last_edited_time).slice(0, 10)}`).join('\n')
        || 'No hay resultados. Si esperabas algo, comparte esa página con tu integración en Notion (··· → Conexiones).';
    },
  },
  notion_read: {
    description: 'Lee una página de Notion (título, propiedades y contenido). Acepta el id o el enlace.',
    parameters: { type: 'object', properties: { page: { type: 'string', description: 'Id o enlace de la página' } }, required: ['page'] },
    async run({ page }) {
      const id = cleanId(page);
      const p = await nf(`/pages/${id}`);
      const props = Object.entries(p.properties || {}).filter(([, v]) => v.type !== 'title').map(([k, v]) => `${k}: ${propText(v)}`).filter((x) => !x.endsWith(': '));
      const lines = [];
      let cursor;
      for (let i = 0; i < 3; i++) {
        const r = await nf(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
        lines.push(...r.results.map(blockText).filter(Boolean));
        if (!r.has_more) break;
        cursor = r.next_cursor;
      }
      return [`# ${titleOf(p)}`, p.url, ...(props.length ? ['', ...props] : []), '', lines.join('\n').slice(0, 15_000) || '(página vacía)'].join('\n');
    },
  },
  notion_query_database: {
    description: 'Lista las filas de una base de datos de Notion (con sus propiedades).',
    parameters: { type: 'object', properties: { database: { type: 'string', description: 'Id o enlace de la base de datos' }, limit: { type: 'number', description: 'Máx. 50' } }, required: ['database'] },
    async run({ database, limit = 25 }) {
      const r = await nf(`/databases/${cleanId(database)}/query`, { method: 'POST', body: { page_size: Math.min(50, Math.max(1, limit)) } });
      return r.results.map((row) => `- ${titleOf(row)} · ${Object.entries(row.properties).filter(([, v]) => v.type !== 'title').map(([k, v]) => `${k}: ${propText(v)}`).filter((x) => !x.endsWith(': ')).join(' · ')} · id ${row.id}`).join('\n') || 'La base de datos está vacía.';
    },
  },
  notion_create_page: {
    write: true,
    description: 'Crea una página en Notion dentro de otra página o de una base de datos. El contenido admite "# título", "- lista", "- [ ] tarea" y párrafos. Solo si el usuario lo ha pedido.',
    parameters: {
      type: 'object',
      properties: { parent: { type: 'string', description: 'Id o enlace de la página o base de datos donde crearla' }, title: { type: 'string' }, content: { type: 'string' } },
      required: ['parent', 'title'],
    },
    async run({ parent, title, content = '' }) {
      const id = cleanId(parent);
      let parentRef = { page_id: id };
      let properties = { title: { title: [{ type: 'text', text: { content: title } }] } };
      const db = await nf(`/databases/${id}`).catch(() => null);
      if (db) {
        const titleProp = Object.entries(db.properties).find(([, v]) => v.type === 'title')?.[0] || 'Name';
        parentRef = { database_id: id };
        properties = { [titleProp]: { title: [{ type: 'text', text: { content: title } }] } };
      }
      const p = await nf('/pages', { method: 'POST', body: { parent: parentRef, properties, children: toBlocks(content) } });
      return `Página creada: ${p.url}`;
    },
  },
  notion_append: {
    write: true,
    description: 'Añade contenido al final de una página de Notion. Solo si el usuario lo ha pedido.',
    parameters: { type: 'object', properties: { page: { type: 'string' }, content: { type: 'string' } }, required: ['page', 'content'] },
    async run({ page, content }) {
      const blocks = toBlocks(content);
      await nf(`/blocks/${cleanId(page)}/children`, { method: 'PATCH', body: { children: blocks } });
      return `Añadidos ${blocks.length} bloques a la página.`;
    },
  },
};

export function notionTools() {
  if (!notionEnabled()) return [];
  return Object.entries(TOOLS)
    .filter(([, t]) => !t.write || notionCanWrite())
    .map(([name, t]) => ({ name, description: `[Notion] ${t.description}`, parameters: t.parameters }));
}

export async function runNotionTool(name, args) {
  const t = TOOLS[name];
  if (!t) return `Herramienta desconocida: ${name}`;
  if (!onServer()) return 'Notion solo funciona a través de tu servidor de OpenCrew.';
  if (!token()) return 'Notion no está conectado: el usuario puede añadir su token en Apps conectadas.';
  if (t.write && !notionCanWrite()) return 'Escribir en Notion está desactivado. El usuario puede activarlo en Apps conectadas.';
  try { return String(await t.run(args || {})); } catch (e) { return `Error: ${e.message}`; }
}

export async function notionWhoAmI() {
  if (!onServer()) throw new Error('Notion solo funciona a través de tu servidor');
  const me = await nf('/users/me');
  return me.bot?.workspace_name || me.name || 'Notion';
}

export function describeNotion(name, a = {}) {
  return {
    notion_search: `Notion: buscando «${a.query || ''}»`,
    notion_read: 'Notion: leyendo una página',
    notion_query_database: 'Notion: leyendo una base de datos',
    notion_create_page: `Notion: creando «${a.title}»`,
    notion_append: 'Notion: añadiendo contenido',
  }[name] || name;
}
