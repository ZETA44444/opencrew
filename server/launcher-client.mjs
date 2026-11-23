// How the (unprivileged) main server asks the launcher for bot computers and code sandboxes.
// Same interface the server used before, so nothing else changes.
import http from 'node:http';
import { EventEmitter } from 'node:events';

const BASE = (process.env.LAUNCHER_URL || 'http://launcher:8788').replace(/\/$/, '');
const KEY = process.env.LAUNCHER_KEY || '';
// A user's engine identifies itself; its key only reaches its own bot computers.
const TENANT = process.env.LAUNCHER_TENANT || '';
const auth = () => ({ 'x-launcher-key': KEY, ...(TENANT && { 'x-tenant': TENANT }) });

async function call(op, payload, timeoutMs = 320_000) {
  let res;
  try {
    res = await fetch(`${BASE}/${op}`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth() }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) { throw new Error(`El servicio de ordenadores no responde (${e.cause?.code || e.message})`); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Servicio de ordenadores: ${res.status}`);
  return data.result;
}

export const runInSandbox = (code, { timeoutMs = 10_000 } = {}) => call('sandbox', { code, timeoutMs }, timeoutMs + 30_000)
  .catch((e) => ({ ok: false, logs: [], error: e.message, ms: 0 }));

const userControl = new Map(); // botId -> until: you're using its screen, the bot waits
export const computer = {
  shell: (botId, command, { timeoutMs = 60_000 } = {}) => call('shell', { botId, command, timeoutMs }, timeoutMs + 30_000),
  browse(botId, input) {
    if ((userControl.get(botId) || 0) > Date.now()) return Promise.reject(new Error('El usuario está usando tu ordenador ahora mismo. Espera a que te devuelva el control o díselo en el chat.'));
    return call('browse', { botId, input }, 200_000);
  },
  writeFile: (botId, path, content) => call('writeFile', { botId, path, content }),
  readFile: (botId, path) => call('readFile', { botId, path }),
  status: (botId) => call('status', { botId }, 30_000).catch(() => 'unknown'),
  remove: (botId) => call('remove', { botId }, 60_000),
  setControl(botId, on) { if (on) userControl.set(botId, Date.now() + 20 * 60_000); else userControl.delete(botId); return { control: on }; },
  inControl: (botId) => (userControl.get(botId) || 0) > Date.now(),
  // Raw screen stream, shaped like a child process (stdout/stdin/kill/close) for the WebSocket bridge.
  vnc(botId) {
    return new Promise((resolve, reject) => {
      const req = http.request(`${BASE}/vnc?botId=${encodeURIComponent(botId)}`, { headers: { Connection: 'Upgrade', Upgrade: 'opencrew-vnc', ...auth() } });
      req.on('upgrade', (_res, socket) => {
        const child = new EventEmitter();
        child.stdout = socket; child.stdin = socket;
        child.kill = () => socket.destroy();
        socket.on('close', () => child.emit('close'));
        resolve(child);
      });
      req.on('response', (r) => reject(new Error(`Pantalla no disponible (${r.statusCode})`)));
      req.on('error', reject);
      req.setTimeout(40_000, () => { req.destroy(new Error('La pantalla tarda demasiado')); });
      req.end();
    });
  },
};
