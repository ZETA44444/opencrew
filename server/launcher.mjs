// OpenCrew launcher: the ONLY part with access to Docker. It does a fixed set of things — bot
// computers and code sandboxes, always with the same safe settings — for the main server, which
// runs without privileges. Not reachable from outside (internal network + secret key).
import http from 'node:http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { computer } from './computer.mjs';
import { runInSandbox } from './sandbox.mjs';

const PORT = Number(process.env.LAUNCHER_PORT) || 8788;
const KEY = process.env.LAUNCHER_KEY || '';
if (KEY.length < 24) { console.error('Falta LAUNCHER_KEY'); process.exit(1); }
const same = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
// Who is asking: the gateway / owner's engine (master key) or one user's engine (its own key, which
// only reaches that user's bot computers: their names get the user's id in front).
const tenantKey = (t) => createHmac('sha256', KEY).update(`tenant:${t}`).digest('hex');
function caller(req) {
  const t = String(req.headers['x-tenant'] || '');
  const k = String(req.headers['x-launcher-key'] || '');
  if (!t) return same(k, KEY) ? { master: true, prefix: '' } : null;
  if (!/^[a-f0-9]{12}$/.test(t)) return null;
  return same(k, tenantKey(t)) ? { master: false, tenant: t, prefix: `${t}-` } : null;
}
const ok = (req) => !!caller(req);
const botIdFor = (req) => (v) => { const s = String(v || ''); if (!/^[\w-]{1,40}$/.test(s)) throw Object.assign(new Error('botId no válido'), { status: 400 }); return `${caller(req).prefix}${s}`; };

// ---------- one isolated engine per user (only the gateway, with the master key) ----------
const ENGINE_IMAGE = process.env.ENGINE_IMAGE || 'server-opencrew';
const NETWORK = process.env.ENGINE_NETWORK || 'server_default';
const dockerRun = (args, input) => new Promise((resolve) => {
  const p = spawn('docker', args); let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() })); p.on('error', (e) => resolve({ code: -1, out: '', err: e.message }));
  if (input) p.stdin.end(input); else p.stdin.end();
});
async function engineStart(b) {
  const t = String(b.tenant || '');
  if (!/^[a-f0-9]{12}$/.test(t)) throw Object.assign(new Error('Usuario no válido'), { status: 400 });
  const name = `opencrew-engine-${t}`;
  const img = await dockerRun(['image', 'inspect', '-f', '{{.Id}}', ENGINE_IMAGE]);
  const st = await dockerRun(['inspect', '-f', '{{.State.Running}} {{.Image}}', name]);
  if (st.code === 0) {
    const [running, image] = st.out.split(' ');
    if (image === img.out) { if (running !== 'true') await dockerRun(['start', name]); return { started: true }; }
    await dockerRun(['rm', '-f', name]); // new version of OpenCrew: recreate (data stays in its volume)
  }
  const env = {
    OPENCREW_TOKEN: String(b.token), OPENCREW_SECRET_KEY: String(b.secretKey), OPENCREW_DATA: '/data/', OPENCREW_TENANT: t,
    OPENCREW_HOST: String(b.host || ''), LAUNCHER_URL: `http://launcher:${PORT}`, LAUNCHER_KEY: tenantKey(t), LAUNCHER_TENANT: t,
    // OpenCrew's AI through the gateway (paid plans): its internal address and this user's key.
    ...(/^oc_[a-f0-9]{12}_[a-f0-9]{64}$/.test(String(b.aiKey || '')) && /^http:\/\/[\w.-]+:\d+\/ai$/.test(String(b.aiUrl || '')) && { OPENCREW_AI_URL: String(b.aiUrl), OPENCREW_AI_KEY: String(b.aiKey) }),
  };
  if (!/^[0-9a-f]{32,}$/i.test(env.OPENCREW_TOKEN) || !/^[0-9a-f]{64}$/i.test(env.OPENCREW_SECRET_KEY)) throw Object.assign(new Error('Claves no válidas'), { status: 400 });
  // Secrets go through a file read by docker (--env-file from stdin isn't supported): pass them as -e on the command line of this container only.
  const r = await dockerRun(['run', '-d', '--name', name, '--network', NETWORK, '--restart', 'unless-stopped',
    '-v', `opencrew-data-${t}:/data`, '--user', '1000:1000', '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--memory', '512m', '--pids-limit', '256', '--label', 'opencrew=engine',
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), ENGINE_IMAGE]);
  if (r.code !== 0) throw new Error(r.err || 'No se pudo crear el espacio del usuario');
  return { started: true };
}
async function engineRemove(b) {
  const t = String(b.tenant || '');
  if (!/^[a-f0-9]{12}$/.test(t)) throw Object.assign(new Error('Usuario no válido'), { status: 400 });
  await dockerRun(['rm', '-f', `opencrew-engine-${t}`]);
  if (b.deleteData) {
    await dockerRun(['volume', 'rm', '-f', `opencrew-data-${t}`]);
    const pcs = await dockerRun(['ps', '-aq', '--filter', `name=opencrew-pc-${t}-`]);
    for (const id of pcs.out.split('\n').filter(Boolean)) await dockerRun(['rm', '-f', id]);
    const vols = await dockerRun(['volume', 'ls', '-q', '--filter', `name=opencrew-pc-${t}-`]);
    for (const v of vols.out.split('\n').filter(Boolean)) await dockerRun(['volume', 'rm', '-f', v]);
  }
  return { removed: true };
}
const send = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const body = (req) => new Promise((resolve, reject) => { let s = ''; req.on('data', (d) => { s += d; if (s.length > 5_000_000) { reject(new Error('Demasiado grande')); req.destroy(); } }); req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { reject(new Error('JSON no válido')); } }); });

// Fixed operations only: nothing here accepts Docker options, images, mounts or flags.
const OPS = {
  sandbox: (b) => runInSandbox(String(b.code ?? ''), { timeoutMs: Math.min(30_000, Number(b.timeoutMs) || 10_000) }),
  shell: (b, id) => computer.shell(id(b.botId), String(b.command ?? ''), { timeoutMs: Math.min(300_000, Number(b.timeoutMs) || 60_000) }),
  browse: (b, id) => computer.browse(id(b.botId), b.input || {}),
  writeFile: (b, id) => computer.writeFile(id(b.botId), String(b.path || ''), String(b.content ?? '')),
  readFile: (b, id) => computer.readFile(id(b.botId), String(b.path || '')),
  status: (b, id) => computer.status(id(b.botId)),
  remove: (b, id) => computer.remove(id(b.botId)),
};
const MASTER_OPS = { engineStart, engineRemove };

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/health') return send(res, 200, { ok: true });
    const who = caller(req);
    if (!who) return send(res, 401, { error: 'No autorizado' });
    const name = (req.url || '').replace(/^\//, '');
    if (req.method === 'POST' && MASTER_OPS[name]) {
      if (!who.master) return send(res, 403, { error: 'Prohibido' });
      return send(res, 200, { result: await MASTER_OPS[name](await body(req)) });
    }
    const op = req.method === 'POST' && OPS[name];
    if (!op) return send(res, 404, { error: 'No encontrado' });
    return send(res, 200, { result: await op(await body(req), botIdFor(req)) });
  } catch (e) { return send(res, e.status || 500, { error: e.message }); }
});

// The live screen of a bot computer: a raw stream, piped through `docker exec` (no port opened).
server.on('upgrade', async (req, socket) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/vnc' || !ok(req)) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
    const child = await computer.vnc(botIdFor(req)(url.searchParams.get('botId')));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: opencrew-vnc\r\nConnection: Upgrade\r\n\r\n');
    child.stdout.pipe(socket);
    socket.pipe(child.stdin);
    child.stdin.on('error', () => {});
    const close = () => { try { child.kill(); } catch { /* gone */ } socket.destroy(); };
    child.on('close', close);
    socket.on('close', close);
    socket.on('error', close);
  } catch (e) { socket.end(`HTTP/1.1 503 Service Unavailable\r\n\r\n${e.message}`); }
});

server.listen(PORT, () => console.log(`OpenCrew launcher en :${PORT}`));
