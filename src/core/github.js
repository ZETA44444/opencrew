// GitHub for bots, with your personal access token (stored only in this browser).
// Read tools are always available once the token is set; writing (new issues, comments)
// must be switched on in Apps conectadas.
import { getDb } from './store.js';

const API = 'https://api.github.com';
const token = () => getDb().keys.github || '';
export const githubEnabled = () => !!token();
export const githubCanWrite = () => !!getDb().settings.githubWrite;

async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token()}`,
      'x-github-api-version': '2022-11-28',
      ...(body && { 'content-type': 'application/json' }),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const hint = res.status === 401 ? ' (token no válido o caducado)' : res.status === 404 ? ' (no existe o el token no tiene acceso)' : res.status === 403 ? ' (sin permiso o límite de uso alcanzado)' : '';
    throw new Error(`GitHub ${res.status}: ${data?.message || 'error'}${hint}`);
  }
  return data;
}

const repoPath = (repo) => {
  const r = String(repo || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(r)) throw new Error(`Repositorio no válido: "${repo}" (usa el formato usuario/repo)`);
  return r;
};
const short = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

export async function githubWhoAmI() {
  const u = await gh('/user');
  return u.login;
}

const TOOLS = {
  github_list_repos: {
    description: 'Lista los repositorios de GitHub del usuario (los más recientes primero).',
    parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Cuántos (máx. 50)' } } },
    async run({ limit = 20 }) {
      const repos = await gh(`/user/repos?sort=updated&per_page=${Math.min(50, limit)}`);
      return repos.map((r) => `- ${r.full_name}${r.private ? ' (privado)' : ''} · ★${r.stargazers_count} · ${r.open_issues_count} abiertos · ${short(r.description, 120)}`).join('\n') || 'No hay repositorios.';
    },
  },
  github_list_issues: {
    description: 'Lista issues o pull requests de un repositorio.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'usuario/repo' },
        kind: { type: 'string', description: '"issues" o "prs"' },
        state: { type: 'string', description: '"open", "closed" o "all"' },
      },
      required: ['repo'],
    },
    async run({ repo, kind = 'issues', state = 'open' }) {
      const r = repoPath(repo);
      if (kind === 'prs') {
        const prs = await gh(`/repos/${r}/pulls?state=${state}&per_page=30`);
        return prs.map((p) => `- #${p.number} ${p.title} · ${p.user.login} · ${p.draft ? 'borrador · ' : ''}${p.head.ref} → ${p.base.ref}`).join('\n') || 'No hay pull requests.';
      }
      const items = (await gh(`/repos/${r}/issues?state=${state}&per_page=30`)).filter((i) => !i.pull_request);
      return items.map((i) => `- #${i.number} ${i.title} · ${i.user.login} · ${i.labels.map((l) => l.name).join(', ') || 'sin etiquetas'} · ${i.comments} comentarios`).join('\n') || 'No hay issues.';
    },
  },
  github_get_issue: {
    description: 'Lee un issue o pull request concreto con sus comentarios.',
    parameters: { type: 'object', properties: { repo: { type: 'string', description: 'usuario/repo' }, number: { type: 'number' } }, required: ['repo', 'number'] },
    async run({ repo, number }) {
      const r = repoPath(repo);
      const i = await gh(`/repos/${r}/issues/${Number(number)}`);
      const comments = i.comments ? await gh(`/repos/${r}/issues/${Number(number)}/comments?per_page=30`) : [];
      return [
        `#${i.number} ${i.title} (${i.state}${i.pull_request ? ', pull request' : ''}) · ${i.user.login} · ${i.html_url}`,
        short(i.body, 4000) || '(sin descripción)',
        ...comments.map((c) => `— ${c.user.login}: ${short(c.body, 800)}`),
      ].join('\n\n');
    },
  },
  github_read_file: {
    description: 'Lee un archivo de un repositorio (o lista una carpeta si la ruta es una carpeta).',
    parameters: {
      type: 'object',
      properties: { repo: { type: 'string', description: 'usuario/repo' }, path: { type: 'string', description: 'Ruta, p. ej. README.md o src/' }, ref: { type: 'string', description: 'Rama o commit (opcional)' } },
      required: ['repo'],
    },
    async run({ repo, path = '', ref }) {
      const r = repoPath(repo);
      const data = await gh(`/repos/${r}/contents/${String(path).replace(/^\//, '')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
      if (Array.isArray(data)) return data.map((f) => `${f.type === 'dir' ? '📁' : '📄'} ${f.path}`).join('\n');
      if (data.encoding === 'base64') {
        const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
        return `${data.path} (${data.size} bytes)\n\n${new TextDecoder().decode(bytes).slice(0, 15_000)}`;
      }
      return `${data.path}: no se puede mostrar (${data.type})`;
    },
  },
  github_create_issue: {
    write: true,
    description: 'Crea un issue en un repositorio. Úsalo SOLO si el usuario lo ha pedido expresamente.',
    parameters: {
      type: 'object',
      properties: { repo: { type: 'string', description: 'usuario/repo' }, title: { type: 'string' }, body: { type: 'string' }, labels: { type: 'string', description: 'Etiquetas separadas por comas (opcional)' } },
      required: ['repo', 'title'],
    },
    async run({ repo, title, body = '', labels }) {
      const i = await gh(`/repos/${repoPath(repo)}/issues`, { method: 'POST', body: { title, body, ...(labels && { labels: String(labels).split(',').map((l) => l.trim()).filter(Boolean) }) } });
      return `Issue creado: #${i.number} ${i.html_url}`;
    },
  },
  github_comment: {
    write: true,
    description: 'Añade un comentario a un issue o pull request. Úsalo SOLO si el usuario lo ha pedido expresamente.',
    parameters: { type: 'object', properties: { repo: { type: 'string', description: 'usuario/repo' }, number: { type: 'number' }, body: { type: 'string' } }, required: ['repo', 'number', 'body'] },
    async run({ repo, number, body }) {
      const c = await gh(`/repos/${repoPath(repo)}/issues/${Number(number)}/comments`, { method: 'POST', body: { body } });
      return `Comentario publicado: ${c.html_url}`;
    },
  },
};

export function githubTools() {
  if (!githubEnabled()) return [];
  return Object.entries(TOOLS)
    .filter(([, t]) => !t.write || githubCanWrite())
    .map(([name, t]) => ({ name, description: `[GitHub] ${t.description}`, parameters: t.parameters }));
}

export async function runGithubTool(name, args) {
  const t = TOOLS[name];
  if (!t) return `Herramienta desconocida: ${name}`;
  if (!githubEnabled()) return 'GitHub no está conectado: añade tu token en Apps conectadas.';
  if (t.write && !githubCanWrite()) return 'Escribir en GitHub está desactivado. El usuario puede activarlo en Apps conectadas.';
  try { return String(await t.run(args || {})); } catch (e) { return `Error: ${e.message}`; }
}

export function describeGithub(name, a = {}) {
  return {
    github_list_repos: 'GitHub: listando repositorios',
    github_list_issues: `GitHub: ${a.kind === 'prs' ? 'pull requests' : 'issues'} de ${a.repo}`,
    github_get_issue: `GitHub: leyendo #${a.number} de ${a.repo}`,
    github_read_file: `GitHub: leyendo ${a.path || '/'} de ${a.repo}`,
    github_create_issue: `GitHub: creando issue en ${a.repo}`,
    github_comment: `GitHub: comentando en #${a.number}`,
  }[name] || name;
}
