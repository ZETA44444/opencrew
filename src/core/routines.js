// Routines: prompts that a bot runs on its own on a schedule.
// schedule = { type: 'interval', minutes } | { type: 'daily', time: 'HH:MM', days: [0..6] }  (0 = domingo)
import { getDb, getBot, newId, now, save } from './store.js';
import { runAgent, busy } from './agent.js';
import { broadcast } from './events.js';
import { notify } from './notify.js';

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
  // The bot is busy (you're chatting with it, or another job): try again in a minute.
  if (busy.has(bot.id)) {
    routine.nextRunAt = new Date(Date.now() + 60_000).toISOString();
    save();
    broadcast({ type: 'routines' });
    return;
  }
  running.add(routine.id);
  const run = { id: newId(), routineId: routine.id, botId: routine.botId, startedAt: now(), status: 'running' };
  const db = getDb();
  db.runs.unshift(run);
  db.runs = db.runs.slice(0, 500);
  routine.lastRunAt = run.startedAt;
  routine.nextRunAt = computeNext(routine);
  save();
  broadcast({ type: 'routines' });
  try {
    const reply = await runAgent({ botId: routine.botId, input: `⏱ Rutina «${routine.name}»\n\n${routine.prompt}`, source: 'routine' });
    run.status = reply.error ? 'error' : reply.stopped ? 'stopped' : 'ok';
    run.summary = reply.content.slice(0, 1500);
    run.replyId = reply.id;
    run.model = reply.model;
    notify({ kind: 'routine', threadId: routine.botId, title: `${run.status === 'ok' ? '✓' : '⚠️'} ${bot.name} · ${routine.name}`, body: reply.content });
  } catch (e) {
    run.status = 'error';
    run.summary = e.message;
  } finally {
    run.finishedAt = now();
    run.ms = new Date(run.finishedAt) - new Date(run.startedAt);
    running.delete(routine.id);
    save();
    broadcast({ type: 'routines' });
  }
}

// ---------- missed runs (the app was closed or the computer asleep) ----------
// A run counts as missed if it is more than 2 minutes late. What happens then depends on
// routine.catchUp: 'ask' (default: show a notice), 'run' (run once now) or 'skip'.
const GRACE_MS = 2 * 60_000;
export const missed = []; // [{ routineId, count, since }]

function countMissed(r, nowDate) {
  let n = 0;
  let t = new Date(r.nextRunAt);
  while (t <= nowDate && n < 999) {
    n++;
    const next = computeNext(r, t);
    if (!next) break;
    t = new Date(next);
  }
  return n;
}

function handleMissed(r, nowDate) {
  const count = countMissed(r, nowDate);
  const since = r.nextRunAt;
  const db = getDb();
  db.runs.unshift({ id: newId(), routineId: r.id, botId: r.botId, startedAt: since, finishedAt: now(), status: 'missed', count, summary: `No se ejecutó ${count === 1 ? 'una vez' : `${count} veces`} porque OpenCrew estaba cerrada.` });
  db.runs = db.runs.slice(0, 500);
  r.nextRunAt = computeNext(r, nowDate);
  save();
  const policy = r.catchUp || 'ask';
  if (policy === 'run') runRoutine(r);
  else if (policy === 'ask') {
    const existing = missed.find((m) => m.routineId === r.id);
    if (existing) existing.count += count;
    else missed.push({ routineId: r.id, count, since });
  }
  broadcast({ type: 'routines' });
}

export function resolveMissed(routineId, action) {
  const i = missed.findIndex((m) => m.routineId === routineId);
  const items = routineId === 'all' ? missed.splice(0) : i >= 0 ? missed.splice(i, 1) : [];
  if (action === 'run') {
    for (const m of items) {
      const r = getDb().routines.find((x) => x.id === m.routineId);
      if (r) runRoutine(r);
    }
  }
  broadcast({ type: 'routines' });
}

let started = false;
export function startScheduler() {
  if (started) return;
  started = true;
  const tick = () => {
    const t = Date.now();
    for (const r of getDb().routines) {
      if (!r.enabled) continue;
      if (!r.nextRunAt) { r.nextRunAt = computeNext(r); save(); continue; }
      const due = new Date(r.nextRunAt).getTime();
      if (due > t) continue;
      if (t - due > GRACE_MS) handleMissed(r, new Date(t));
      else runRoutine(r);
    }
  };
  setInterval(tick, 15_000);
  tick();
}
