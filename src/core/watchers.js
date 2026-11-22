// Watchers: check for something new WITHOUT using the AI (GitHub, a web page, an RSS feed)
// and only wake the bot when there is news. Saves tokens compared with "check every 15 min".
import { getDb, getBot, newId, now, save } from './store.js';
import { broadcast } from './events.js';
import { runAgent, busy, waitUntilFree } from './agent.js';
import { notify } from './notify.js';
import { gmailList, googleConnected } from './google.js';

export const watchers = () => (getDb().watchers ??= []);
const MIN_EVERY = { github: 5, web: 15, rss: 10, gmail: 5 };

// ---------- sources: each returns a list of { id, title, url, text } (newest first) ----------
async function githubItems(cfg) {
  const repo = String(cfg.repo || '').replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repositorio no válido (usa usuario/repo)');
  const token = getDb().keys.github;
  const path = { issues: `issues?state=all&sort=created&per_page=20`, pulls: `pulls?state=all&sort=created&direction=desc&per_page=20`, releases: 'releases?per_page=10', commits: 'commits?per_page=20' }[cfg.event || 'issues'];
  const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { accept: 'application/vnd.github+json', ...(token && { authorization: `Bearer ${token}` }) },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}${res.status === 403 ? ' (límite de consultas sin token: añade tu token en Apps conectadas)' : ''}`);
  const data = await res.json();
  if (cfg.event === 'commits') return data.map((c) => ({ id: c.sha, author: c.author?.login || c.commit.author?.name, title: c.commit.message.split('\n')[0], url: c.html_url, text: `${c.commit.author?.name}: ${c.commit.message}`.slice(0, 500) }));
  if (cfg.event === 'releases') return data.map((r) => ({ id: String(r.id), title: r.name || r.tag_name, url: r.html_url, text: String(r.body || '').slice(0, 800) }));
  const list = cfg.event === 'pulls' ? data : data.filter((i) => !i.pull_request);
  return list.map((i) => ({ id: String(i.id), author: i.user?.login, title: `#${i.number} ${i.title}`, url: i.html_url, text: `${i.user?.login} · ${(i.labels || []).map((l) => l.name).join(', ')}\n${String(i.body || '').slice(0, 600)}`, labels: (i.labels || []).map((l) => l.name) }));
}

async function readText(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return await res.text();
  } catch {
    if (!getDb().settings.webReader) throw new Error('La web no deja leerse desde el navegador y el lector web está desactivado en Ajustes.');
    const res = await fetch(`https://r.jina.ai/${url}`, { signal: AbortSignal.timeout(30_000) });
    return await res.text();
  }
}

async function rssItems(cfg) {
  const xml = await readText(cfg.url);
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) || [];
  if (!blocks.length) throw new Error('No parece un feed RSS/Atom (no hay elementos <item> ni <entry>)');
  const tag = (b, t) => (b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`)) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim() || '';
  return blocks.slice(0, 20).map((b) => {
    const link = tag(b, 'link') || (b.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    return { id: tag(b, 'guid') || tag(b, 'id') || link || tag(b, 'title'), title: tag(b, 'title'), url: link, text: (tag(b, 'description') || tag(b, 'summary')).slice(0, 500) };
  });
}

const clean = (html) => String(html).replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); }

async function webCheck(cfg, state) {
  const text = clean(await readText(cfg.url)).slice(0, 50_000);
  const h = hash(text);
  if (state.hash && state.hash !== h) {
    const before = state.text || '';
    let i = 0;
    while (i < before.length && before[i] === text[i]) i++; // first difference
    return { changed: true, state: { hash: h, text: text.slice(0, 20_000) }, items: [{ id: h, title: 'La página ha cambiado', url: cfg.url, text: `…${text.slice(Math.max(0, i - 200), i + 1200)}…` }] };
  }
  return { changed: false, state: { hash: h, text: text.slice(0, 20_000) }, items: [] };
}

// Gmail: new emails matching a search (no AI used to check).
async function gmailItems(cfg) {
  if (!googleConnected()) throw new Error('Google no está conectado (Apps conectadas)');
  const list = await gmailList(cfg.query || 'in:inbox', 20);
  return list.map((m) => ({ id: m.id, author: m.from, isMail: true, title: `${m.subject} — ${m.from}`, url: `https://mail.google.com/mail/u/0/#all/${m.threadId}`, text: `[id ${m.id}] ${m.snippet}` }));
}

// ---------- run one check ----------
export async function checkWatcher(w, { force = false } = {}) {
  const bot = getBot(w.botId);
  if (!bot || w.type === 'webhook') return; // webhooks arrive on their own
  w.lastCheckAt = now();
  w.state ??= {};
  try {
    let news = [];
    let webState = null;
    if (w.type === 'web') {
      const r = await webCheck(w.config, w.state);
      webState = r.state;
      news = r.items;
      if (!news.length) w.state = webState;
    } else {
      const items = w.type === 'github' ? await githubItems(w.config) : w.type === 'gmail' ? await gmailItems(w.config) : await rssItems(w.config);
      const seen = new Set(w.state.seen || []);
      const first = !w.state.seen; // first check only learns what already exists
      news = first ? [] : items.filter((it) => !seen.has(it.id));
      w.state.seen = [...new Set([...items.map((it) => it.id), ...(w.state.seen || [])])].slice(0, 300);
    }
    news = applyFilters(w, news);
    w.lastError = null;
    if (news.length && (!busy.has(bot.id) || force)) {
      if (webState) w.state = webState;
      await fireWatcher(w, news);
    } else if (news.length && !webState) {
      // The bot was busy: leave the news "unseen" so the next check picks them up.
      w.state.seen = (w.state.seen || []).filter((id) => !news.some((n) => n.id === id));
    }
  } catch (e) {
    w.lastError = e.message;
  }
  save();
  broadcast({ type: 'watchers' });
}

// Wake the bot with the news (shared by polling watchers and webhooks).
export async function fireWatcher(w, news, { wait = false } = {}) {
  const bot = getBot(w.botId);
  if (!bot) return;
  if (wait) await waitUntilFree(bot.id, null, 15 * 60_000).catch(() => {});
  w.lastFiredAt = now();
  (w.history ??= []).unshift({ at: now(), count: news.length, titles: news.slice(0, 5).map((n) => n.title) });
  w.history = w.history.slice(0, 20);
  save();
  broadcast({ type: 'watchers' });
  const list = news.slice(0, 10).map((n) => `- ${n.title}${n.url ? ` (${n.url})` : ''}${n.text ? `\n  ${n.text.replace(/\n/g, ' ').slice(0, 400)}` : ''}`).join('\n');
  notify({ kind: 'routine', threadId: bot.id, title: `🔔 ${w.name}: ${news.length} novedad${news.length > 1 ? 'es' : ''}`, body: news.map((n) => n.title).join(' · ') });
  await runAgent({ botId: bot.id, input: `🔔 Vigilante «${w.name}»: ${news.length} novedad${news.length > 1 ? 'es' : ''}\n\n${list}\n\n${w.prompt || 'Revisa estas novedades y dime lo importante.'}`, source: 'routine' });
}

// Filters: «solo si contiene», «ignorar si contiene», etiquetas y autor (GitHub). Comma-separated, any term matches.
const terms = (s) => String(s || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
export function applyFilters(w, news) {
  const f = w.filters || {};
  const inc = terms(f.include), exc = terms(f.exclude), labels = terms(f.labels), authors = terms(f.author);
  return news.filter((n) => {
    const hay = `${n.title} ${n.text}`.toLowerCase();
    if (inc.length && !inc.some((t) => hay.includes(t))) return false;
    if (exc.length && exc.some((t) => hay.includes(t))) return false;
    if (labels.length && !(n.labels || []).some((l) => labels.includes(l.toLowerCase()))) return false;
    if (authors.length && !authors.some((a) => (n.isMail ? String(n.author || '').toLowerCase().includes(a) : String(n.author || '').toLowerCase() === a))) return false;
    return true;
  });
}

let started = false;
export function startWatchers() {
  if (started) return;
  started = true;
  const running = new Set();
  const tick = () => {
    for (const w of watchers()) {
      if (!w.enabled || running.has(w.id) || w.type === 'webhook') continue;
      const every = Math.max(MIN_EVERY[w.type] || 10, Number(w.everyMin) || 15) * 60_000;
      if (w.lastCheckAt && Date.now() - new Date(w.lastCheckAt).getTime() < every) continue;
      running.add(w.id);
      checkWatcher(w).finally(() => running.delete(w.id));
    }
  };
  setInterval(tick, 30_000);
  setTimeout(tick, 3000);
}

export function saveWatcher(input) {
  const list = watchers();
  const existing = input.id && list.find((x) => x.id === input.id);
  const fields = ['botId', 'name', 'type', 'config', 'everyMin', 'prompt', 'enabled', 'filters'];
  const data = Object.fromEntries(fields.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));
  if (existing) {
    if (existing.type === 'webhook') delete data.config; // keep its secret address
    if (data.config && JSON.stringify(data.config) !== JSON.stringify(existing.config)) existing.state = {}; // new source: learn again
    Object.assign(existing, data);
  } else {
    if (!getBot(data.botId)) throw new Error('Bot no encontrado');
    if (!data.name?.trim()) throw new Error('Ponle un nombre al vigilante');
    if (data.type === 'webhook') data.config = { ...(data.config || {}), secret: [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('') };
    list.push({ id: newId(), enabled: true, everyMin: MIN_EVERY[data.type] || 15, state: {}, history: [], createdAt: now(), ...data });
  }
  save();
  broadcast({ type: 'watchers' });
}

export function deleteWatcher(id) {
  getDb().watchers = watchers().filter((w) => w.id !== id);
  save();
  broadcast({ type: 'watchers' });
}
