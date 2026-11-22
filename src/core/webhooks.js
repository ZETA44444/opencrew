// Webhooks (server only): GitHub, Slack or any service POSTs to your server and the bot hears
// about it at once, without checking every few minutes. Events arriving close together are
// grouped (20 s) into one message, so a burst of pushes costs a single model call.
import { getBot, now, save } from './store.js';
import { broadcast } from './events.js';
import { watchers, fireWatcher, applyFilters } from './watchers.js';

const BATCH_MS = 20_000;
const MAX_PER_HOUR = 30;
const timers = new Map();

const short = (s, n = 500) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const json = (o) => { try { return JSON.stringify(o).slice(0, 1500); } catch { return ''; } };

// Turn a webhook into the same «news item» shape the watchers use.
export function summarizeWebhook(headers = {}, body = {}) {
  const gh = headers['x-github-event'];
  if (gh) {
    const repo = body.repository?.full_name || '';
    const who = body.sender?.login || '';
    const a = body.action ? ` (${body.action})` : '';
    const item = (title, url, text = '', extra = {}) => [{ id: String(headers['x-github-delivery'] || Date.now()), title: `${repo ? `[${repo}] ` : ''}${title}`, url, text: short(text), author: who, ...extra }];
    switch (gh) {
      case 'ping': return [];
      case 'issues': return item(`Issue #${body.issue?.number} ${body.issue?.title}${a}`, body.issue?.html_url, `${who}: ${body.issue?.body || ''}`, { labels: (body.issue?.labels || []).map((l) => l.name) });
      case 'issue_comment': return item(`Comentario en #${body.issue?.number} ${body.issue?.title}`, body.comment?.html_url, `${who}: ${body.comment?.body || ''}`);
      case 'pull_request': return item(`PR #${body.pull_request?.number} ${body.pull_request?.title}${a}`, body.pull_request?.html_url, `${who}: ${body.pull_request?.body || ''}`, { labels: (body.pull_request?.labels || []).map((l) => l.name) });
      case 'pull_request_review': return item(`Revisión en PR #${body.pull_request?.number}: ${body.review?.state}`, body.review?.html_url, `${who}: ${body.review?.body || ''}`);
      case 'push': {
        const commits = body.commits || [];
        return item(`${commits.length} commit${commits.length === 1 ? '' : 's'} en ${String(body.ref || '').replace('refs/heads/', '')}`, body.compare, commits.map((c) => `${c.author?.username || c.author?.name}: ${c.message.split('\n')[0]}`).join(' · '));
      }
      case 'release': return item(`Versión ${body.release?.tag_name} ${body.release?.name || ''}${a}`, body.release?.html_url, body.release?.body);
      case 'workflow_run': return item(`Workflow «${body.workflow_run?.name}»: ${body.workflow_run?.conclusion || body.workflow_run?.status}`, body.workflow_run?.html_url, `${body.workflow_run?.head_branch} · ${body.workflow_run?.display_title || ''}`);
      case 'star': case 'watch': return item(`⭐ ${who} ${body.action === 'deleted' ? 'quitó la estrella' : 'dio una estrella'}`, body.repository?.html_url);
      default: return item(`Evento ${gh}${a}`, body.repository?.html_url, json(body));
    }
  }
  if (body.type === 'event_callback' && body.event) { // Slack Events API
    const e = body.event;
    return [{ id: String(body.event_id || Date.now()), title: `Slack: ${e.type}${e.channel ? ` en ${e.channel}` : ''}`, author: e.user || '', text: short(e.text || json(e)) }];
  }
  const title = body.title || body.subject || body.name || body.message || body.text || 'Nuevo aviso';
  return [{ id: String(body.id || Date.now()), title: short(title, 160), url: body.url || body.html_url || '', text: short(typeof body === 'string' ? body : json(body), 1500) }];
}

// Called by the server once the request is authenticated.
export function receiveWebhook(w, headers, body) {
  if (!w.enabled) return { status: 200, body: { ok: true, ignored: 'vigilante pausado' } };
  if (body?.type === 'url_verification' && body.challenge) return { status: 200, body: { challenge: body.challenge } }; // Slack setup
  const items = applyFilters(w, summarizeWebhook(headers, body));
  w.lastCheckAt = now();
  if (!items.length) { save(); broadcast({ type: 'watchers' }); return { status: 200, body: { ok: true, ignored: 'sin novedades (o filtradas)' } }; }
  w.state ??= {};
  const hour = Date.now() - 3_600_000;
  w.state.fired = (w.state.fired || []).filter((t) => t > hour);
  w.state.pending = [...(w.state.pending || []), ...items].slice(-50);
  save();
  if (!timers.has(w.id)) timers.set(w.id, setTimeout(() => flush(w.id), BATCH_MS));
  return { status: 202, body: { ok: true, queued: items.length } };
}

async function flush(id) {
  timers.delete(id);
  const w = watchers().find((x) => x.id === id);
  if (!w || !w.state?.pending?.length || !getBot(w.botId)) return;
  if ((w.state.fired || []).length >= MAX_PER_HOUR) {
    w.lastError = `Demasiados avisos: más de ${MAX_PER_HOUR} en una hora. Se agrupan y se envían más tarde.`;
    save(); broadcast({ type: 'watchers' });
    timers.set(id, setTimeout(() => flush(id), 10 * 60_000));
    return;
  }
  const news = w.state.pending;
  w.state.pending = [];
  w.state.fired = [...(w.state.fired || []), Date.now()];
  w.lastError = null;
  await fireWatcher(w, news, { wait: true });
}
