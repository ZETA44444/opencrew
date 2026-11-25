// Plan limits on an OpenCrew server with accounts (the gateway sends them with every request; see
// server/index.mjs). In the browser-only app or a self-hosted server there are no limits.
import { getDb } from './store.js';

const NAMES = { bots: 'bots', routines: 'rutinas', watchers: 'vigilantes' };
export const planLimits = () => globalThis.OPENCREW_LIMITS || getDb().settings?.planLimits || null;

const count = {
  bots: () => getDb().bots.filter((b) => b.role !== 'treasurer').length,
  routines: () => getDb().routines.length,
  watchers: () => (getDb().watchers || []).length,
};

// Throws a clear message when creating one more would go over the plan.
export function checkLimit(kind) {
  const l = planLimits();
  const max = l?.[kind];
  if (max == null || count[kind]() < max) return;
  throw new Error(`Tu plan ${l.label || ''} permite hasta ${max} ${NAMES[kind]}. Borra alguno o pásate a Pro para tener más.`.replace('  ', ' '));
}

// Bot computers: hours of real use per month (a bot working on it, or you watching its screen).
const month = () => new Date().toISOString().slice(0, 7);
export function computerSeconds() {
  const u = (getDb().computerUsage ??= {});
  return u[month()] || 0;
}
export function addComputerTime(ms) {
  if (!(ms > 0)) return;
  const u = (getDb().computerUsage ??= {});
  u[month()] = (u[month()] || 0) + Math.round(ms / 1000);
}
export function computerUsageInfo() {
  const l = planLimits();
  return { usedHours: Math.round((computerSeconds() / 3600) * 10) / 10, limitHours: l ? l.computerHours : null };
}
export function checkComputerAllowed() {
  const l = planLimits();
  if (!l || l.computerHours == null) return;
  if (l.computerHours === 0) throw new Error(`Tu plan ${l.label || ''} no incluye ordenador para los bots. Pásate a Pro para usarlo.`.replace('  ', ' '));
  if (computerSeconds() >= l.computerHours * 3600) throw new Error(`Has usado las ${l.computerHours} horas de ordenador de este mes de tu plan. Vuelven el mes que viene.`);
}
