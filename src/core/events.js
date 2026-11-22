// In-browser event bus: the agent loop emits steps/messages, the UI listens.
const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function broadcast(event) {
  for (const fn of listeners) {
    try { fn(event); } catch (e) { console.error(e); }
  }
}
