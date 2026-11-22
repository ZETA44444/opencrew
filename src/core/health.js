// Model health: how often each provider/model answers or fails (overloaded, quota, retired…).
// Used by the Tesorero bot and the health panel.
import { getDb, now, save } from './store.js';

const h = () => (getDb().health ??= {});

const kindOf = (status) => ({
  0: 'sin conexión', 401: 'clave no válida', 403: 'sin permiso', 404: 'modelo retirado', 408: 'tiempo agotado',
  429: 'límite o cuota agotada', 500: 'error del proveedor', 502: 'error del proveedor', 503: 'saturado', 504: 'tiempo agotado', 529: 'saturado',
}[status] || (status ? `error ${status}` : 'error'));

export function recordModelResult(provider, model, error) {
  const key = `${provider}/${model}`;
  const r = (h()[key] ??= { ok: 0, fail: 0, errors: {} });
  if (!error) {
    r.ok += 1;
    r.lastOkAt = now();
  } else {
    r.fail += 1;
    const k = kindOf(error.status);
    r.errors[k] = (r.errors[k] || 0) + 1;
    r.lastError = { kind: k, message: String(error.message).slice(0, 200), at: now() };
  }
  save();
}

export function healthRows() {
  return Object.entries(h()).map(([key, r]) => {
    const [provider, ...m] = key.split('/');
    const total = r.ok + r.fail;
    return { key, provider, model: m.join('/'), ...r, rate: total ? r.ok / total : 1 };
  }).sort((a, b) => a.rate - b.rate);
}

export function clearHealth() {
  getDb().health = {};
  save();
}
