// Server mode: the same functions as localApi, executed on your server over HTTPS.
// Your bots, keys and chats live there and keep working 24/7; this browser shows them.
import { getDb } from './core/store.js';
import { notify, notifyPermission, askPermission } from './core/notify.js';
import { requestGoogleToken, DEFAULT_CLIENT_ID } from './core/google.js';
import { openArtifactFile } from './artifactFile.js';

const CONF_KEY = 'oc.server';

export function remoteConfig() {
  try {
    const c = JSON.parse(globalThis.localStorage?.getItem(CONF_KEY) || 'null');
    return c?.url && c?.token ? c : null;
  } catch { return null; }
}
export const isRemote = () => !!remoteConfig();
export const normalizeUrl = (u) => {
  let url = String(u || '').trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//.test(url)) url = `https://${url}`;
  return url;
};
export function setRemoteConfig(c) {
  if (c) localStorage.setItem(CONF_KEY, JSON.stringify({ url: normalizeUrl(c.url), token: String(c.token).trim() }));
  else localStorage.removeItem(CONF_KEY);
}

// One call to the server. `conf` lets the settings screen test a server before connecting.
export async function rpc(method, args = [], conf = remoteConfig()) {
  let res;
  try {
    res = await fetch(`${conf.url}/api/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${conf.token}` },
      body: JSON.stringify({ method, args }),
    });
  } catch {
    throw new Error('No hay conexión con tu servidor. Revisa tu conexión a internet o que el servidor esté encendido.');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401) throw new Error('El servidor ha rechazado el token de acceso.');
  if (!res.ok || data?.error) throw new Error(data?.error || `Servidor ${res.status}`);
  return data.result;
}

export async function testServer(conf) {
  const c = { url: normalizeUrl(conf.url), token: String(conf.token || '').trim() };
  const health = await fetch(`${c.url}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) throw new Error('No encuentro un servidor de OpenCrew en esa dirección.');
  const info = await rpc('serverInfo', [], c);
  return { ...health, ...info };
}

// ---------- live events (streamed from the server) ----------
const listeners = new Set();
let streaming = false;
let lastState = null;
const emit = (ev) => { for (const fn of listeners) { try { fn(ev); } catch (e) { console.error(e); } } };

function onServerEvent(ev) {
  if (ev.type === 'notify') { notify(ev.notification, { local: true }); return; }
  // A bot answered while this tab is in the background.
  if (ev.type === 'message' && ev.message?.role === 'assistant' && !ev.message.from && ev.message.source !== 'routine'
    && typeof document !== 'undefined' && document.hidden && lastState?.settings?.notifications?.replies) {
    const bot = lastState.bots.find((b) => b.id === ev.message.botId);
    notify({ kind: 'reply', threadId: ev.botId, title: bot?.name || 'OpenCrew', body: ev.message.content }, { local: true });
  }
  emit(ev);
}

async function streamEvents() {
  if (streaming) return;
  streaming = true;
  let delay = 1000;
  let first = true;
  for (;;) {
    const conf = remoteConfig();
    if (!conf) return;
    try {
      const res = await fetch(`${conf.url}/api/events`, { headers: { authorization: `Bearer ${conf.token}` } });
      if (!res.ok || !res.body) throw new Error(`eventos ${res.status}`);
      emit({ type: 'server', connected: true });
      if (!first) emit({ type: 'bots' }); // reconnected: refresh everything
      first = false;
      delay = 1000;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (line) { try { onServerEvent(JSON.parse(line.slice(6))); } catch { /* bad event */ } }
        }
      }
    } catch { /* retry below */ }
    emit({ type: 'server', connected: false });
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 30_000);
  }
}

const has = (id) => !!lastState?.providers?.find((p) => p.id === id)?.hasKey;
export const remoteHasKey = has;

const local = {
  subscribe(fn) { listeners.add(fn); streamEvents(); return () => listeners.delete(fn); },
  async state() {
    const s = await rpc('state');
    lastState = s;
    getDb().settings = structuredClone(s.settings); // voice and display preferences read locally
    return s;
  },
  notifyPermission,
  askNotifyPermission: askPermission,
  testNotification: () => notify({ kind: 'routine', threadId: 'test', title: 'OpenCrew', body: 'Las notificaciones funcionan ✓' }, { local: true }),
  async openArtifact(botId, name, download = false) { openArtifactFile(await rpc('getArtifact', [botId, name]), download); },
  async connectGoogle() {
    const g = lastState?.services?.google || {};
    const token = await requestGoogleToken(g.clientId || DEFAULT_CLIENT_ID, { again: !!g.connected });
    return rpc('storeGoogleToken', [token]);
  },
  serverMode: true,
};

export const remoteApi = new Proxy(local, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (typeof prop !== 'string' || prop === 'then') return undefined;
    return (...args) => rpc(prop, args);
  },
});
