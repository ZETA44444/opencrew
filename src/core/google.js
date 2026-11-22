// Gmail and Google Calendar for bots, signing in with Google in this browser (no server).
// The access token lasts ~1 hour and is kept only in this browser. Reading is available once
// connected; sending emails and creating events must be switched on and asks for approval.
import { getDb, save } from './store.js';
import { broadcast } from './events.js';

// Public OAuth client of the OpenCrew site (not a secret). Forks can set their own in Apps conectadas.
export const DEFAULT_CLIENT_ID = '929080871229-3g4eo40uk8r27meqdoph252gp5v60guc.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

const cfg = () => (getDb().settings.google ??= { botIds: null, write: false });
const tok = () => getDb().keys.googleToken;
export const clientId = () => cfg().clientId || DEFAULT_CLIENT_ID;
export const googleConnected = () => !!tok()?.token;
export const googleExpired = () => !!tok() && Date.now() > (tok().exp || 0) - 60_000;
export const googleCanWrite = () => !!cfg().write;
export const googleStatus = () => ({ connected: googleConnected(), expired: googleExpired(), email: cfg().email || '', write: googleCanWrite(), botIds: cfg().botIds, clientId: cfg().clientId || '' });

// ---------- sign-in (Google Identity Services token flow) ----------
let gisLoading;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisLoading = null; reject(new Error('No se pudo cargar el inicio de sesión de Google (¿bloqueador de anuncios?)')); };
    document.head.appendChild(s);
  });
  return gisLoading;
}

// Must be called from a click (it opens Google's popup).
export async function connectGoogle() {
  await loadGis();
  const token = await new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPES,
      include_granted_scopes: true,
      callback: (r) => (r.error ? reject(new Error(r.error_description || r.error)) : resolve(r)),
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Has cerrado la ventana de Google' : e?.message || 'No se pudo iniciar sesión con Google')),
    });
    client.requestAccessToken({ prompt: googleConnected() ? '' : 'consent' });
  });
  const granted = String(token.scope || '');
  getDb().keys.googleToken = { token: token.access_token, exp: Date.now() + (Number(token.expires_in) || 3600) * 1000, scope: granted };
  try { cfg().email = (await gapi('https://gmail.googleapis.com/gmail/v1/users/me/profile')).emailAddress; } catch { /* scope may be missing */ }
  save();
  broadcast({ type: 'connectors' });
  const missing = ['gmail.readonly', 'calendar.events'].filter((s) => !granted.includes(s));
  return { email: cfg().email, missing };
}

export function disconnectGoogle() {
  const t = tok()?.token;
  if (t) window.google?.accounts?.oauth2?.revoke?.(t, () => {});
  delete getDb().keys.googleToken;
  delete cfg().email;
  save();
  broadcast({ type: 'connectors' });
}

export function updateGoogle(patch) {
  Object.assign(cfg(), patch);
  save();
  broadcast({ type: 'connectors' });
}

async function gapi(url, { method = 'GET', body } = {}) {
  if (!googleConnected()) throw new Error('Google no está conectado: conéctalo en Apps conectadas.');
  if (googleExpired()) throw new Error('La sesión de Google ha caducado (dura 1 hora). Pulsa «Reconectar» en Apps conectadas y vuelve a pedírmelo.');
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${tok().token}`, ...(body && { 'content-type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) { getDb().keys.googleToken.exp = 0; save(); broadcast({ type: 'connectors' }); }
    const hint = res.status === 401 ? ' (sesión caducada: reconecta Google en Apps conectadas)' : res.status === 403 ? ' (falta permiso: reconecta y acepta todos los permisos)' : '';
    throw new Error(`Google ${res.status}: ${data?.error?.message || 'error'}${hint}`);
  }
  return data;
}

// ---------- Gmail helpers ----------
const GM = 'https://gmail.googleapis.com/gmail/v1/users/me';
const header = (m, name) => (m.payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
const b64urlDecode = (s) => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
const b64url = (str) => { const b = new TextEncoder().encode(str); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const b64 = (str) => { const b = new TextEncoder().encode(str); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const strip = (html) => String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

function bodyText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return b64urlDecode(part.body.data);
  for (const p of part.parts || []) { const t = bodyText(p); if (t) return t; }
  if (part.mimeType === 'text/html' && part.body?.data) return strip(b64urlDecode(part.body.data));
  for (const p of part.parts || []) if (p.mimeType === 'text/html' && p.body?.data) return strip(b64urlDecode(p.body.data));
  return '';
}

const attachments = (part, out = []) => {
  if (part?.filename && part.body?.attachmentId) out.push(`${part.filename} (${Math.round((part.body.size || 0) / 1024)} KB)`);
  (part?.parts || []).forEach((p) => attachments(p, out));
  return out;
};

export async function gmailList(query = 'in:inbox', limit = 10) {
  const list = await gapi(`${GM}/messages?maxResults=${Math.min(25, Math.max(1, limit))}&q=${encodeURIComponent(query)}`);
  const ids = (list.messages || []).map((m) => m.id);
  return Promise.all(ids.map(async (id) => {
    const m = await gapi(`${GM}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    return { id, threadId: m.threadId, from: header(m, 'From'), subject: header(m, 'Subject') || '(sin asunto)', date: header(m, 'Date'), snippet: strip(m.snippet || ''), unread: (m.labelIds || []).includes('UNREAD') };
  }));
}

function mime({ to, cc, subject, body, inReplyTo }) {
  const lines = [
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: =?UTF-8?B?${b64(subject || '')}?=`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(body || '').replace(/.{76}/g, '$&\r\n'),
  ];
  return b64url(lines.join('\r\n'));
}

async function buildMessage({ to, cc, subject, body, reply_to_id }) {
  if (!reply_to_id && !to) throw new Error('Falta el destinatario (to)');
  let threadId, inReplyTo;
  if (reply_to_id) {
    const orig = await gapi(`${GM}/messages/${reply_to_id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Reply-To`);
    threadId = orig.threadId;
    inReplyTo = header(orig, 'Message-ID');
    to ||= header(orig, 'Reply-To') || header(orig, 'From');
    subject ||= /^re:/i.test(header(orig, 'Subject')) ? header(orig, 'Subject') : `Re: ${header(orig, 'Subject')}`;
  }
  return { raw: mime({ to, cc, subject, body, inReplyTo }), ...(threadId && { threadId }), to, subject };
}

// ---------- Calendar helpers ----------
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const when = (e) => (e.start?.dateTime ? new Date(e.start.dateTime).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : `${e.start?.date} (todo el día)`);
const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
function toTime(s) {
  if (isDateOnly(s)) return { date: s };
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha no válida: "${s}" (usa formato ISO, p. ej. 2026-11-25T10:00)`);
  return { dateTime: d.toISOString(), timeZone: tz() };
}

// ---------- tools ----------
const TOOLS = {
  gmail_search: {
    description: 'Busca correos en el Gmail del usuario. Usa la sintaxis de búsqueda de Gmail (from:, subject:, is:unread, newer_than:2d…). Devuelve id, remitente, asunto, fecha y un extracto.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Búsqueda de Gmail; por defecto los de la bandeja de entrada' }, limit: { type: 'number', description: 'Cuántos (máx. 25)' } } },
    async run({ query = 'in:inbox', limit = 10 }) {
      const items = await gmailList(query, limit);
      return items.map((m) => `- [${m.id}] ${m.unread ? '🔵 ' : ''}${m.subject} · ${m.from} · ${m.date}\n  ${m.snippet.slice(0, 200)}`).join('\n') || 'No hay correos que coincidan.';
    },
  },
  gmail_read: {
    description: 'Lee un correo completo (por su id de gmail_search).',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async run({ id }) {
      const m = await gapi(`${GM}/messages/${encodeURIComponent(id)}?format=full`);
      const files = attachments(m.payload);
      return [
        `De: ${header(m, 'From')}`, `Para: ${header(m, 'To')}`, `Fecha: ${header(m, 'Date')}`, `Asunto: ${header(m, 'Subject')}`,
        ...(files.length ? [`Adjuntos: ${files.join(', ')}`] : []),
        '', (bodyText(m.payload) || strip(m.snippet || '')).slice(0, 12_000),
      ].join('\n');
    },
  },
  gmail_create_draft: {
    write: true,
    description: 'Crea un BORRADOR de correo (no lo envía). Para responder, pasa reply_to_id con el id del correo original.',
    parameters: { type: 'object', properties: { to: { type: 'string' }, cc: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, reply_to_id: { type: 'string' } }, required: ['body'] },
    async run(a) {
      const msg = await buildMessage(a);
      await gapi(`${GM}/drafts`, { method: 'POST', body: { message: { raw: msg.raw, ...(msg.threadId && { threadId: msg.threadId }) } } });
      return `Borrador guardado en Gmail para ${msg.to} · «${msg.subject}».`;
    },
  },
  gmail_send: {
    write: true,
    description: 'ENVÍA un correo. Úsalo SOLO si el usuario lo ha pedido expresamente; si no, crea un borrador. Para responder, pasa reply_to_id.',
    parameters: { type: 'object', properties: { to: { type: 'string' }, cc: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, reply_to_id: { type: 'string' } }, required: ['body'] },
    async run(a) {
      const msg = await buildMessage(a);
      await gapi(`${GM}/messages/send`, { method: 'POST', body: { raw: msg.raw, ...(msg.threadId && { threadId: msg.threadId }) } });
      return `Correo enviado a ${msg.to} · «${msg.subject}».`;
    },
  },
  calendar_list_events: {
    description: 'Lista los próximos eventos del calendario principal del usuario.',
    parameters: { type: 'object', properties: { days: { type: 'number', description: 'Días hacia delante (por defecto 7)' }, from: { type: 'string', description: 'Fecha de inicio ISO (por defecto ahora)' }, query: { type: 'string', description: 'Texto a buscar (opcional)' } } },
    async run({ days = 7, from, query }) {
      const start = from ? new Date(from) : new Date();
      const end = new Date(start.getTime() + Math.min(90, Math.max(1, Number(days) || 7)) * 86_400_000);
      const data = await gapi(`${CAL}?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${start.toISOString()}&timeMax=${end.toISOString()}${query ? `&q=${encodeURIComponent(query)}` : ''}`);
      return (data.items || []).map((e) => `- [${e.id}] ${when(e)} · ${e.summary || '(sin título)'}${e.location ? ` · 📍 ${e.location}` : ''}${e.attendees?.length ? ` · ${e.attendees.length} invitados` : ''}`).join('\n') || 'No hay eventos en esas fechas.';
    },
  },
  calendar_create_event: {
    write: true,
    description: 'Crea un evento en el calendario principal. Fechas en ISO (2026-11-25T10:00) o solo fecha (2026-11-25) para todo el día. Solo si el usuario lo ha pedido.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string', description: 'Por defecto, 1 hora después del inicio' },
        description: { type: 'string' }, location: { type: 'string' }, attendees: { type: 'string', description: 'Correos separados por comas (se les enviará invitación)' },
      },
      required: ['title', 'start'],
    },
    async run({ title, start, end, description, location, attendees }) {
      const s = toTime(start);
      const e = end ? toTime(end) : s.date ? { date: new Date(new Date(`${s.date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10) } : { dateTime: new Date(new Date(s.dateTime).getTime() + 3_600_000).toISOString(), timeZone: tz() };
      const guests = String(attendees || '').split(',').map((x) => x.trim()).filter(Boolean).map((email) => ({ email }));
      const ev = await gapi(`${CAL}${guests.length ? '?sendUpdates=all' : ''}`, { method: 'POST', body: { summary: title, description, location, start: s, end: e, ...(guests.length && { attendees: guests }) } });
      return `Evento creado: ${when(ev)} · ${ev.summary} · ${ev.htmlLink}`;
    },
  },
};

const allowedFor = (bot) => { const ids = cfg().botIds; return !ids || ids.includes(bot?.id); };

export function googleTools(bot) {
  if (!googleConnected() || !allowedFor(bot)) return [];
  return Object.entries(TOOLS)
    .filter(([, t]) => !t.write || googleCanWrite())
    .map(([name, t]) => ({ name, description: `[${name.startsWith('gmail') ? 'Gmail' : 'Calendar'}] ${t.description}`, parameters: t.parameters }));
}

export const isGoogleTool = (name) => name.startsWith('gmail_') || name.startsWith('calendar_');

export async function runGoogleTool(name, args, bot) {
  const t = TOOLS[name];
  if (!t) return `Herramienta desconocida: ${name}`;
  if (!googleConnected()) return 'Google no está conectado: el usuario puede conectarlo en Apps conectadas.';
  if (!allowedFor(bot)) return 'Este bot no tiene permiso para usar Gmail ni Calendar.';
  if (t.write && !googleCanWrite()) return 'Enviar correos y crear eventos está desactivado. El usuario puede activarlo en Apps conectadas.';
  try { return String(await t.run(args || {})); } catch (e) { return `Error: ${e.message}`; }
}

export function describeGoogle(name, a = {}) {
  return {
    gmail_search: `Gmail: buscando ${a.query || 'en la bandeja de entrada'}`,
    gmail_read: 'Gmail: leyendo un correo',
    gmail_create_draft: `Gmail: borrador${a.to ? ` para ${a.to}` : ''}`,
    gmail_send: `Gmail: enviando correo${a.to ? ` a ${a.to}` : ''}`,
    calendar_list_events: 'Calendar: mirando tu agenda',
    calendar_create_event: `Calendar: creando «${a.title}»`,
  }[name] || name;
}
