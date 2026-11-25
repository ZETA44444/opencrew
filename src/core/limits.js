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

// Bot computers: not included in plans with 0 hours.
export function checkComputerAllowed() {
  const l = planLimits();
  if (l && l.computerHours === 0) throw new Error(`Tu plan ${l.label || ''} no incluye ordenador para los bots. Pásate a Pro para usarlo.`.replace('  ', ' '));
}
