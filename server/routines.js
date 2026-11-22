// Routines: prompts that a bot runs on its own on a schedule.
// schedule = { type: 'interval', minutes } | { type: 'daily', time: 'HH:MM', days: [0..6] }  (0 = domingo)
import { getDb, getBot, newId, now, save } from './store.js';
import { runAgent } from './agent.js';
import { broadcast } from './events.js';

const running = new Set();

export function computeNext(routine, from = new Date()) {
  const s = routine.schedule || {};
  if (s.type === 'interval') {
    const mins = Math.max(1, Number(s.minutes) || 60);
    return new Date(from.getTime() + mins * 60_000).toISOString();
  }
  if (s.type === 'daily') {
    const [h, m] = String(s.time || '08:00').split(':').map(Number);
    const days = s.days?.length ? s.days : [0, 1, 2, 3, 4, 5, 6];
    for (let i = 0; i < 8; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      d.setHours(h, m, 0, 0);
      if (d > from && days.includes(d.getDay())) return d.toISOString();
    }
  }
  return null;
}

export async function runRoutine(routine) {
  if (running.has(routine.id)) return;
  const bot = getBot(routine.botId);
  if (!bot) return;
  running.add(routine.id);
  const run = { id: newId(), routineId: routine.id, botId: routine.botId, startedAt: now(), status: 'running' };
  const db = getDb();
  db.runs.unshift(run);
  db.runs = db.runs.slice(0, 200);
  routine.lastRunAt = run.startedAt;
  routine.nextRunAt = computeNext(routine);
  save();
  broadcast({ type: 'routines' });
  try {
    const reply = await runAgent({ botId: routine.botId, input: `⏱ Rutina «${routine.name}»\n\n${routine.prompt}`, source: 'routine' });
    run.status = reply.error ? 'error' : 'ok';
    run.summary = reply.content.slice(0, 300);
  } catch (e) {
    run.status = 'error';
    run.summary = e.message;
  } finally {
    run.finishedAt = now();
    running.delete(routine.id);
    save();
    broadcast({ type: 'routines' });
  }
}

export function startScheduler() {
  const tick = () => {
    const t = Date.now();
    for (const r of getDb().routines) {
      if (!r.enabled) continue;
      if (!r.nextRunAt) { r.nextRunAt = computeNext(r); save(); continue; }
      if (new Date(r.nextRunAt).getTime() <= t) runRoutine(r);
    }
  };
  setInterval(tick, 15_000);
  tick();
}
