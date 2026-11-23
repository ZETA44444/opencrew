// OpenCrew Escritorio: lets your OpenCrew bots use files (and, if you want, the terminal) on THIS
// computer. Only the folders you add, each read-only or read+write and for the bots you choose.
// Every action is also approved by you in OpenCrew and logged. No dependencies: Node 22+.
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import { join, resolve, relative, sep, basename, dirname, isAbsolute } from 'node:path';
import { homedir, hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { PAGE } from './page.mjs';

const VERSION = '1.0.0';
const HOME = process.env.OC_DESKTOP_HOME || join(homedir(), 'Library', 'Application Support', 'OpenCrew Escritorio');
const CONFIG = join(HOME, 'config.json');
const PORT = Number(process.env.OC_DESKTOP_PORT) || 4311;
const BLOCK = ['.ssh', '.gnupg', '.aws', '.kube', '.docker', 'Keychains', '.env', '.netrc', '.npmrc', 'id_rsa', 'id_ed25519', '.git-credentials', 'Cookies', 'Login Data'];

await fs.mkdir(HOME, { recursive: true });
let cfg = { server: '', key: '', secret: randomBytes(16).toString('hex'), folders: [], terminal: false, terminalBots: [], paused: false };
try { cfg = { ...cfg, ...JSON.parse(await fs.readFile(CONFIG, 'utf8')) }; } catch { /* first run */ }
const saveCfg = () => fs.writeFile(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
await saveCfg();

// ---------- link with your OpenCrew server ----------
let ws = null;
let status = { state: 'off', error: '' };
let bots = [];
let retry = 1000;
let timer = null;
const log = [];
const note = (line) => { log.unshift(`${new Date().toLocaleTimeString('es-ES')} ${line}`); log.length = Math.min(log.length, 50); };

function hello() {
  ws?.send(JSON.stringify({ type: 'hello', device: `Mac · ${hostname().replace(/\.local$/, '')}`, version: VERSION, terminal: !!cfg.terminal, folders: cfg.folders.map((f) => ({ name: basename(f.path), write: !!f.write })) }));
}
function connect() {
  clearTimeout(timer);
  if (!cfg.server || !cfg.key) { status = { state: 'off', error: 'Falta emparejar' }; return; }
  if (cfg.paused) { status = { state: 'paused', error: '' }; return; }
  if (ws && ws.readyState <= 1) return;
  const url = `${cfg.server.replace(/^http/, 'ws').replace(/\/+$/, '')}/api/desktop?k=${encodeURIComponent(cfg.key)}`;
  status = { state: 'connecting', error: '' };
  try { ws = new WebSocket(url); } catch (e) { status = { state: 'error', error: e.message }; return schedule(); }
  ws.onopen = () => { retry = 1000; status = { state: 'on', error: '' }; hello(); note('Conectado a tu servidor'); };
  ws.onmessage = async (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'bots') { bots = m.bots || []; return; }
    if (!m.id || !m.cmd) return;
    try { const result = await run(m.cmd, m.args || {}); ws.send(JSON.stringify({ id: m.id, ok: true, result })); note(`✓ ${m.args?.bot?.name || 'Bot'}: ${m.cmd} ${m.args?.path || m.args?.cwd || ''}`); }
    catch (err) { ws.send(JSON.stringify({ id: m.id, ok: false, error: String(err.message || err) })); note(`✗ ${m.args?.bot?.name || 'Bot'}: ${m.cmd} — ${err.message}`); }
  };
  ws.onclose = () => { ws = null; if (!cfg.paused) { status = { state: 'error', error: 'Sin conexión con tu servidor; reintentando…' }; schedule(); } };
  ws.onerror = () => {};
}
function schedule() { timer = setTimeout(connect, retry); retry = Math.min(retry * 2, 60_000); }
setInterval(() => { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'ping' })); }, 25_000);
connect();

// ---------- what a bot may touch ----------
const botOk = (list, bot) => !list || !list.length ? true : list.includes(bot?.id);
const foldersFor = (bot) => cfg.folders.filter((f) => botOk(f.bots, bot));
const blockedPath = (p) => p.split(sep).some((seg) => BLOCK.some((b) => seg === b || (b === '.env' && seg.startsWith('.env'))));

async function realOrParent(p) {
  try { return await fs.realpath(p); } catch { return join(await fs.realpath(dirname(p)), basename(p)); }
}
// «Proyectos/notas.md» (folder name first) or an absolute path inside an allowed folder.
async function resolvePath(input, bot, { write = false } = {}) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Falta la ruta');
  const mine = foldersFor(bot);
  if (!mine.length) throw new Error('No tienes acceso a ninguna carpeta de este ordenador');
  let folder = null;
  let target;
  if (isAbsolute(raw) || raw.startsWith('~')) {
    target = resolve(raw.replace(/^~/, homedir()));
  } else {
    const [first, ...rest] = raw.split(/[\\/]/);
    folder = mine.find((f) => basename(f.path) === first) || (mine.length === 1 ? mine[0] : null);
    if (!folder) throw new Error(`Empieza la ruta por el nombre de una carpeta permitida: ${mine.map((f) => basename(f.path)).join(', ')}`);
    target = basename(folder.path) === first ? join(folder.path, ...rest) : join(folder.path, raw);
  }
  const real = await realOrParent(target);
  const hit = folder ? [folder] : mine;
  for (const f of hit) {
    const root = await fs.realpath(f.path).catch(() => f.path);
    const rel = relative(root, real);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      if (blockedPath(rel)) throw new Error('Ese archivo está protegido (claves, contraseñas o configuración privada)');
      if (write && !f.write) throw new Error(`La carpeta ${basename(f.path)} es solo de lectura`);
      return { real, root, folder: f, rel };
    }
  }
  throw new Error('Esa ruta está fuera de las carpetas que te ha permitido el usuario');
}

const isText = (buf) => !buf.subarray(0, 8000).includes(0);

async function run(cmd, a) {
  const bot = a.bot;
  if (cmd === 'folders') {
    return { folders: foldersFor(bot).map((f) => ({ path: f.path, name: basename(f.path), write: !!f.write })), terminal: !!cfg.terminal && botOk(cfg.terminalBots, bot) };
  }
  if (cmd === 'list') {
    const { real } = await resolvePath(a.path, bot);
    const items = await fs.readdir(real, { withFileTypes: true });
    const entries = [];
    for (const d of items.slice(0, 500)) {
      if (blockedPath(d.name)) continue;
      const st = await fs.stat(join(real, d.name)).catch(() => null);
      entries.push({ name: d.name, dir: d.isDirectory(), size: st?.size || 0 });
    }
    entries.sort((x, y) => (y.dir - x.dir) || x.name.localeCompare(y.name));
    return { path: real, entries };
  }
  if (cmd === 'read') {
    const { real } = await resolvePath(a.path, bot);
    const st = await fs.stat(real);
    if (st.isDirectory()) throw new Error('Es una carpeta: usa listar');
    if (st.size > 200_000) throw new Error(`Es demasiado grande (${Math.round(st.size / 1024)} KB; máximo 200 KB)`);
    const buf = await fs.readFile(real);
    if (!isText(buf)) throw new Error('No es un archivo de texto');
    return { path: real, size: st.size, content: buf.toString('utf8') };
  }
  if (cmd === 'search') {
    const { real } = await resolvePath(a.path, bot);
    const name = String(a.name || '').toLowerCase(), text = String(a.text || '');
    const matches = [];
    let seen = 0;
    const walk = async (d, depth) => {
      if (depth > 6 || matches.length >= 100 || seen > 5000) return;
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (blockedPath(e.name) || e.name === 'node_modules' || e.name === '.git') continue;
        const f = join(d, e.name);
        seen++;
        if (e.isDirectory()) await walk(f, depth + 1);
        else if (!name || e.name.toLowerCase().includes(name)) {
          if (text) { const st = await fs.stat(f).catch(() => null); if (!st || st.size > 1_000_000) continue; const b = await fs.readFile(f).catch(() => null); if (!b || !isText(b) || !b.toString('utf8').includes(text)) continue; }
          matches.push(f);
          if (matches.length >= 100) return;
        }
      }
    };
    await walk(real, 0);
    return { matches };
  }
  if (cmd === 'write') {
    const { real, root } = await resolvePath(a.path, bot, { write: true });
    const content = String(a.content ?? '');
    if (content.length > 2_000_000) throw new Error('Demasiado grande (máx. 2 MB)');
    let backup = null;
    if (existsSync(real)) { // keep the previous version, just in case
      const dir = join(root, '.opencrew-copias');
      await fs.mkdir(dir, { recursive: true });
      backup = join(dir, `${basename(real)}.${new Date().toISOString().replace(/[:.]/g, '-')}`);
      await fs.copyFile(real, backup);
    }
    await fs.mkdir(dirname(real), { recursive: true });
    await fs.writeFile(real, content);
    return { path: real, size: Buffer.byteLength(content), backup };
  }
  if (cmd === 'run') {
    if (!cfg.terminal) throw new Error('El usuario no ha activado la terminal en OpenCrew Escritorio');
    if (!botOk(cfg.terminalBots, bot)) throw new Error('Este bot no tiene permiso para usar la terminal');
    const { real } = await resolvePath(a.cwd, bot);
    const st = await fs.stat(real);
    if (!st.isDirectory()) throw new Error('La carpeta de trabajo no existe');
    return new Promise((done) => {
      const p = spawn(process.env.SHELL || '/bin/zsh', ['-lc', String(a.command)], { cwd: real, env: process.env });
      let out = '';
      const t = setTimeout(() => p.kill('SIGKILL'), 120_000);
      const add = (d) => { if (out.length < 20_000) out += d; };
      p.stdout.on('data', add); p.stderr.on('data', add);
      p.on('close', (code) => { clearTimeout(t); done({ code, output: (out.length >= 20_000 ? `${out}\n… (salida recortada)` : out) || '(sin salida)' }); });
      p.on('error', (e) => { clearTimeout(t); done({ code: -1, output: e.message }); });
    });
  }
  throw new Error(`Orden desconocida: ${cmd}`);
}

// ---------- settings page (only on this computer, protected by a secret) ----------
const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
const body = (req) => new Promise((r) => { let s = ''; req.on('data', (d) => { s += d; }).on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });
const pickFolder = () => new Promise((r) => {
  if (process.platform !== 'darwin') return r(null);
  execFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "Elige una carpeta para tus bots de OpenCrew")'], (err, out) => r(err ? null : out.trim().replace(/\/$/, '')));
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'" });
    return res.end(PAGE);
  }
  // Only this page may call the API: same origin + the secret from the link that opens it.
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) return json(res, 403, { error: 'Prohibido' });
  if (req.headers['x-oc-secret'] !== cfg.secret) return json(res, 401, { error: 'Abre esta página desde la app OpenCrew Escritorio' });
  const b = req.method === 'POST' ? await body(req) : {};
  try {
    if (url.pathname === '/api/state') {
      return json(res, 200, { version: VERSION, status, server: cfg.server, paired: !!cfg.key, paused: cfg.paused, terminal: cfg.terminal, terminalBots: cfg.terminalBots, folders: cfg.folders, bots, log });
    }
    if (url.pathname === '/api/pair') {
      cfg.server = String(b.server || '').trim().replace(/\/+$/, '');
      if (b.key) cfg.key = String(b.key).trim();
      cfg.paused = false; await saveCfg(); try { ws?.close(); } catch { /* */ } ws = null; connect();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/pause') { cfg.paused = !!b.paused; await saveCfg(); try { ws?.close(); } catch { /* */ } ws = null; connect(); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/pick') return json(res, 200, { path: await pickFolder() });
    if (url.pathname === '/api/folders/add') {
      const p = resolve(String(b.path || '').replace(/^~/, homedir()));
      const st = await fs.stat(p).catch(() => null);
      if (!st?.isDirectory()) return json(res, 400, { error: 'Esa carpeta no existe' });
      if (p === homedir() || p === '/' || blockedPath(p)) return json(res, 400, { error: 'Por seguridad no se puede dar acceso a esa carpeta entera; elige una más concreta' });
      if (!cfg.folders.some((f) => f.path === p)) cfg.folders.push({ path: p, write: !!b.write, bots: [] });
      await saveCfg(); hello();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/folders/update') {
      const f = cfg.folders.find((x) => x.path === b.path);
      if (f) { if ('write' in b) f.write = !!b.write; if ('bots' in b) f.bots = Array.isArray(b.bots) ? b.bots : []; }
      await saveCfg(); hello();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/folders/remove') { cfg.folders = cfg.folders.filter((x) => x.path !== b.path); await saveCfg(); hello(); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/terminal') {
      if ('enabled' in b) cfg.terminal = !!b.enabled;
      if ('bots' in b) cfg.terminalBots = Array.isArray(b.bots) ? b.bots : [];
      await saveCfg(); hello();
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'No encontrado' });
  } catch (e) { return json(res, 500, { error: e.message }); }
}).listen(PORT, '127.0.0.1', () => {
  const link = `http://127.0.0.1:${PORT}/#${cfg.secret}`;
  console.log(`OpenCrew Escritorio ${VERSION} · ajustes: ${link}`);
  fs.writeFile(join(HOME, 'ajustes.url'), link).catch(() => {});
});
