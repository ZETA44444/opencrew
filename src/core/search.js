// Web search for bots. Uses the best option you have a key for:
//   1) Tavily (search API)  2) Gemini with Google Search  3) Claude with web search
//   4) no key: DuckDuckGo results read through the public r.jina.ai reader (if enabled in Settings)
import { getDb } from './store.js';
import { modelsOf, defaultModel } from './providers.js';

const MAX = 7000;
const key = (id) => getDb().keys[id] || '';

async function json(url, init, label) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${label} ${res.status}: ${data?.error?.message || data?.detail?.error || data?.message || text.slice(0, 200)}`);
  return data;
}

async function tavily(query) {
  const data = await json('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key('tavily')}` },
    body: JSON.stringify({ query, max_results: 6, include_answer: true, search_depth: 'basic' }),
  }, 'Tavily');
  const lines = (data.results || []).map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${String(r.content || '').slice(0, 400)}`);
  return `Búsqueda (Tavily): «${query}»\n${data.answer ? `\nResumen: ${data.answer}\n` : ''}\n${lines.join('\n\n')}`;
}

async function gemini(query) {
  const list = modelsOf('gemini');
  const model = list.find((m) => /flash-lite-latest|flash-latest/.test(m)) || defaultModel('gemini');
  const data = await json(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key('gemini') },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `Busca en Google y resume con datos concretos y actuales: ${query}` }] }],
      tools: [{ google_search: {} }],
    }),
  }, 'Gemini (Google Search)');
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  const sources = (cand?.groundingMetadata?.groundingChunks || []).map((c) => c.web).filter(Boolean)
    .map((w, i) => `${i + 1}. ${w.title || w.domain || 'fuente'} — ${w.uri}`);
  return `Búsqueda (Gemini + Google): «${query}»\n\n${text}\n\nFuentes:\n${sources.join('\n') || '(sin fuentes)'}`;
}

async function claude(query) {
  const list = modelsOf('anthropic');
  const model = list.find((m) => /haiku/.test(m)) || defaultModel('anthropic');
  const data = await json('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-api-key': key('anthropic'),
      'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model, max_tokens: 1500,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: `Busca en internet y resume con datos concretos y actuales, citando las URLs: ${query}` }],
    }),
  }, 'Claude (web search)');
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const urls = new Set();
  for (const b of data.content || []) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach((r) => r.url && urls.add(`${r.title} — ${r.url}`));
  }
  return `Búsqueda (Claude): «${query}»\n\n${text}\n\nFuentes:\n${[...urls].slice(0, 8).map((u, i) => `${i + 1}. ${u}`).join('\n') || '(ver el texto)'}`;
}

async function freeSearch(query) {
  if (!getDb().settings.webReader) throw new Error('No hay ninguna clave para buscar (Tavily, Gemini o Claude) y el lector web público está desactivado en Ajustes.');
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(`https://r.jina.ai/${url}`, { signal: AbortSignal.timeout(40_000) });
  if (!res.ok) throw new Error(`Búsqueda libre ${res.status}`);
  const text = await res.text();
  // Keep the useful part: result titles, links and snippets.
  const body = text.split(/Markdown Content:/)[1] || text;
  const clean = body
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '') // linked images
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[\]\([^)]*\)/g, '') // empty links
    .replace(/https:\/\/duckduckgo\.com\/l\/\?uddg=([^&)\s]+)[^)\s]*/g, (_, u) => { try { return decodeURIComponent(u); } catch { return u; } }) // real URLs
    .replace(/\n{3,}/g, '\n\n').trim();
  return `Búsqueda (DuckDuckGo vía r.jina.ai, sin clave): «${query}»\n\n${clean}`;
}

export async function webSearch(query) {
  const q = String(query || '').trim();
  if (!q) return 'Falta lo que hay que buscar.';
  const tries = [
    key('tavily') && tavily,
    key('gemini') && gemini,
    key('anthropic') && claude,
    freeSearch,
  ].filter(Boolean);
  const errors = [];
  for (const fn of tries) {
    try { return (await fn(q)).slice(0, MAX); } catch (e) { errors.push(e.message); }
  }
  return `No se pudo buscar: ${errors.join(' | ')}`;
}

export function searchBackend() {
  if (key('tavily')) return 'Tavily';
  if (key('gemini')) return 'Gemini + Google Search';
  if (key('anthropic')) return 'Claude web search';
  return getDb().settings.webReader ? 'DuckDuckGo (sin clave)' : 'ninguno';
}
