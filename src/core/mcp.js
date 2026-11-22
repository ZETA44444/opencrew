// Minimal MCP client for remote servers (Streamable HTTP transport), running in the browser.
// The server must allow requests from this page (CORS). Connectors are shared by all bots.
import { getDb, newId, now, save } from './store.js';
import { broadcast } from './events.js';

const PROTOCOL = '2025-06-18';
const sessions = new Map(); // connectorId -> { sessionId, ready }

export const connectors = () => (getDb().connectors ??= []);
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'app';
export const toolKey = (c, t) => `mcp_${slug(c.name)}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

async function rpc(c, method, params, { notify = false } = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL };
  if (c.token) headers.authorization = /^bearer /i.test(c.token) ? c.token : `Bearer ${c.token}`;
  const s = sessions.get(c.id);
  if (s?.sessionId) headers['mcp-session-id'] = s.sessionId;
  const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: newId(), method, params };
  let res;
  try {
    res = await fetch(c.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    throw new Error(`No se pudo conectar con ${c.url} (${e.message}). Comprueba la URL y que el servidor permita conexiones desde navegadores (CORS).`);
  }
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessions.set(c.id, { ...(sessions.get(c.id) || {}), sessionId: sid });
  if (notify) return null;
  if (res.status === 401 || res.status === 403) throw new Error('El servidor pide autorización: añade un token válido al conector.');
  if (!res.ok) throw new Error(`El servidor respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const type = res.headers.get('content-type') || '';
  let msg;
  if (type.includes('text/event-stream')) {
    // Take the first JSON-RPC response from the stream.
    const text = await res.text();
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (!data) continue;
      try { const j = JSON.parse(data); if (j.id === body.id || j.result || j.error) { msg = j; break; } } catch { /* skip */ }
    }
  } else msg = await res.json();
  if (!msg) throw new Error('Respuesta vacía del servidor MCP');
  if (msg.error) throw new Error(`MCP: ${msg.error.message || JSON.stringify(msg.error)}`);
  return msg.result;
}

async function ensureSession(c) {
  if (sessions.get(c.id)?.ready) return;
  sessions.delete(c.id);
  const init = await rpc(c, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'OpenCrew', version: '0.1.0' } });
  await rpc(c, 'notifications/initialized', {}, { notify: true }).catch(() => {});
  sessions.set(c.id, { ...(sessions.get(c.id) || {}), ready: true, server: init?.serverInfo });
  return init;
}

// Connects, lists the server's tools and stores them.
export async function refreshConnector(id) {
  const c = connectors().find((x) => x.id === id);
  if (!c) throw new Error('Conector no encontrado');
  try {
    sessions.delete(c.id);
    const init = await ensureSession(c);
    const tools = [];
    let cursor;
    do {
      const r = await rpc(c, 'tools/list', cursor ? { cursor } : {});
      tools.push(...(r?.tools || []));
      cursor = r?.nextCursor;
    } while (cursor && tools.length < 200);
    Object.assign(c, {
      tools: tools.map((t) => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema || { type: 'object', properties: {} } })),
      server: init?.serverInfo?.name || c.server, status: 'ok', lastError: null, updatedAt: now(),
    });
  } catch (e) {
    Object.assign(c, { status: 'error', lastError: e.message, updatedAt: now() });
  }
  save();
  broadcast({ type: 'connectors' });
  return c;
}

export async function addConnector({ name, url, token }) {
  let u;
  try { u = new URL(url); } catch { throw new Error('La URL no es válida'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('La URL debe empezar por https://');
  const c = { id: newId(), name: String(name || u.hostname).trim().slice(0, 40), url: u.href, token: token || '', enabled: true, tools: [], status: 'new', createdAt: now() };
  connectors().push(c);
  save();
  return refreshConnector(c.id);
}

export function updateConnector(id, patch) {
  const c = connectors().find((x) => x.id === id);
  if (!c) return;
  for (const k of ['name', 'enabled', 'token', 'url']) if (patch[k] !== undefined) c[k] = patch[k];
  if (patch.url || patch.token !== undefined) sessions.delete(id);
  save();
  broadcast({ type: 'connectors' });
}

export function removeConnector(id) {
  getDb().connectors = connectors().filter((x) => x.id !== id);
  sessions.delete(id);
  save();
  broadcast({ type: 'connectors' });
}

// ---------- tools for bots ----------
export function connectorTools() {
  const out = [];
  for (const c of connectors()) {
    if (!c.enabled || c.status !== 'ok') continue;
    for (const t of c.tools || []) {
      out.push({
        name: toolKey(c, t),
        description: `[${c.name}] ${t.description}`.slice(0, 1000),
        parameters: t.inputSchema?.type === 'object' ? t.inputSchema : { type: 'object', properties: {} },
      });
    }
  }
  return out;
}

export function findConnectorTool(key) {
  for (const c of connectors()) for (const t of c.tools || []) if (toolKey(c, t) === key) return { c, t };
  return null;
}

export async function callConnectorTool(key, args) {
  const hit = findConnectorTool(key);
  if (!hit) return `Herramienta desconocida: ${key}`;
  const { c, t } = hit;
  if (!c.enabled) return `El conector ${c.name} está desactivado.`;
  try {
    await ensureSession(c);
    const r = await rpc(c, 'tools/call', { name: t.name, arguments: args || {} });
    return formatResult(r);
  } catch (e) {
    // Session may have expired: retry once with a fresh one.
    sessions.delete(c.id);
    try { await ensureSession(c); return formatResult(await rpc(c, 'tools/call', { name: t.name, arguments: args || {} })); } catch (e2) { return `Error de ${c.name}: ${e2.message}`; }
  }
}

function formatResult(r) {
  const parts = (r?.content || []).map((p) => {
    if (p.type === 'text') return p.text;
    if (p.type === 'resource') return p.resource?.text || `[recurso ${p.resource?.uri}]`;
    if (p.type === 'image') return `[imagen ${p.mimeType}]`;
    return `[${p.type}]`;
  });
  if (r?.structuredContent && !parts.length) parts.push(JSON.stringify(r.structuredContent, null, 2));
  const text = parts.join('\n\n') || '(sin contenido)';
  return `${r?.isError ? 'Error: ' : ''}${text}`.slice(0, 12_000);
}
