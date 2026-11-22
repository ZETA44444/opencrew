// Approvals: before a sensitive action the bot stops and asks you
// «permitir una vez / permitir siempre / denegar».
import { getDb, newId, now, save } from './store.js';
import { broadcast } from './events.js';
import { findConnectorTool } from './mcp.js';

// Built-in tools that change things outside the chat or cost money.
export const SENSITIVE = {
  create_bot: 'Crear un bot nuevo',
  update_bot: 'Cambiar la configuración de un bot',
  create_routine: 'Programar una rutina',
  update_routine: 'Pausar, reactivar o borrar una rutina',
  generate_image: 'Generar una imagen (gasta créditos de tu clave)',
  github_create_issue: 'Crear un issue en GitHub',
  github_comment: 'Publicar un comentario en GitHub',
  gmail_send: 'Enviar un correo desde tu Gmail',
  gmail_create_draft: 'Guardar un borrador en tu Gmail',
  calendar_create_event: 'Crear un evento en tu calendario',
  set_bot_limit: 'Cambiar el límite de gasto de un bot',
};

const pending = new Map(); // id -> { meta, resolve, reject }

const settings = () => {
  const s = getDb().settings;
  s.approvals ??= { enabled: true, always: {} };
  s.approvals.always ??= {};
  return s.approvals;
};

// MCP tools that declare themselves read-only don't need approval; the rest do.
function isSensitive(name) {
  if (SENSITIVE[name]) return true;
  if (name.startsWith('mcp_')) {
    const hit = findConnectorTool(name);
    if (!hit) return true;
    if (hit.t.readOnly) return false;
    // Servers rarely annotate tools: treat clearly read-only names as safe.
    return !/^(get|list|search|read|fetch|find|query|describe|show|view)[_-]/i.test(hit.t.name);
  }
  return false;
}

export function needsApproval(call) {
  const a = settings();
  if (a.enabled === false) return false;
  if (a.always[call.name]) return false;
  return isSensitive(call.name);
}

export function requestApproval({ call, bot, threadId, label, signal, timeoutMs = 0 }) {
  return new Promise((resolve, reject) => {
    const id = newId();
    const meta = { id, threadId, botId: bot.id, botName: bot.name, tool: call.name, label, args: call.args || {}, at: now() };
    const done = (fn, v) => { pending.delete(id); signal?.removeEventListener?.('abort', onAbort); broadcast({ type: 'approvals' }); fn(v); };
    const onAbort = () => { const e = new Error('Detenido por el usuario'); e.name = 'AbortError'; done(reject, e); };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    pending.set(id, { meta, resolve: (d) => done(resolve, d) });
    if (timeoutMs) setTimeout(() => { if (pending.has(id)) done(resolve, 'deny'); }, timeoutMs);
    broadcast({ type: 'approvals', request: meta });
  });
}

export function resolveApproval(id, decision) {
  const p = pending.get(id);
  if (!p) return;
  if (decision === 'always') {
    settings().always[p.meta.tool] = { label: p.meta.label, at: now() };
    save();
  }
  p.resolve(decision);
}

export const pendingApprovals = () => [...pending.values()].map((p) => p.meta);

export function revokeAlways(tool) {
  delete settings().always[tool];
  save();
  broadcast({ type: 'bots' });
}

export function setApprovalsEnabled(enabled) {
  settings().enabled = enabled;
  save();
  broadcast({ type: 'bots' });
}
