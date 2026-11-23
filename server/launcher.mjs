// OpenCrew launcher: the ONLY part with access to Docker. It does a fixed set of things — bot
// computers and code sandboxes, always with the same safe settings — for the main server, which
// runs without privileges. Not reachable from outside (internal network + secret key).
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { computer } from './computer.mjs';
import { runInSandbox } from './sandbox.mjs';

const PORT = Number(process.env.LAUNCHER_PORT) || 8788;
const KEY = process.env.LAUNCHER_KEY || '';
if (KEY.length < 24) { console.error('Falta LAUNCHER_KEY'); process.exit(1); }
const same = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
const ok = (req) => same(req.headers['x-launcher-key'] || '', KEY);
const botId = (v) => { const s = String(v || ''); if (!/^[\w-]{1,40}$/.test(s)) throw Object.assign(new Error('botId no válido'), { status: 400 }); return s; };
const send = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const body = (req) => new Promise((resolve, reject) => { let s = ''; req.on('data', (d) => { s += d; if (s.length > 5_000_000) { reject(new Error('Demasiado grande')); req.destroy(); } }); req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { reject(new Error('JSON no válido')); } }); });

// Fixed operations only: nothing here accepts Docker options, images, mounts or flags.
const OPS = {
  sandbox: (b) => runInSandbox(String(b.code ?? ''), { timeoutMs: Math.min(30_000, Number(b.timeoutMs) || 10_000) }),
  shell: (b) => computer.shell(botId(b.botId), String(b.command ?? ''), { timeoutMs: Math.min(300_000, Number(b.timeoutMs) || 60_000) }),
  browse: (b) => computer.browse(botId(b.botId), b.input || {}),
  writeFile: (b) => computer.writeFile(botId(b.botId), String(b.path || ''), String(b.content ?? '')),
  readFile: (b) => computer.readFile(botId(b.botId), String(b.path || '')),
  status: (b) => computer.status(botId(b.botId)),
  remove: (b) => computer.remove(botId(b.botId)),
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/health') return send(res, 200, { ok: true });
    if (!ok(req)) return send(res, 401, { error: 'No autorizado' });
    const op = req.method === 'POST' && OPS[(req.url || '').replace(/^\//, '')];
    if (!op) return send(res, 404, { error: 'No encontrado' });
    return send(res, 200, { result: await op(await body(req)) });
  } catch (e) { return send(res, e.status || 500, { error: e.message }); }
});

// The live screen of a bot computer: a raw stream, piped through `docker exec` (no port opened).
server.on('upgrade', async (req, socket) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/vnc' || !ok(req)) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
    const child = await computer.vnc(botId(url.searchParams.get('botId')));
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
