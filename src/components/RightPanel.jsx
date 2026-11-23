import { useEffect, useState } from 'react';
import { api, serverMode } from '../api.js';
import { remoteConfig } from '../remote.js';
import Markdown from './Markdown.jsx';
import { ask } from '../dialog.jsx';

const TABS = [['progress', 'Progreso'], ['routines', 'Rutinas'], ['memory', 'Memoria'], ['artifacts', 'Archivos'], ['activity', 'Actividad']];

export default function RightPanel({ bot, state, steps, pinned, onUnpin, artifactsTick, refresh, onClose, onOpenArtifact }) {
  const [tab, setTab] = useState('progress');
  const tabs = bot.isGroup ? TABS.slice(0, 1) : TABS;
  const current = bot.isGroup ? 'progress' : tab;
  return (
    <aside className="panel">
      <div className="tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={current === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
        <button className="icon-btn close" onClick={onClose} aria-label="Cerrar panel">×</button>
      </div>
      <div className="panel-body">
        {current === 'progress' && <Progress steps={steps} pinned={pinned} onUnpin={onUnpin} />}
        {current === 'routines' && (
          <>
            <Watchers bot={bot} watchers={(state.watchers || []).filter((w) => w.botId === bot.id)} refresh={refresh} tenant={state.services?.tenant} />
            <div className="section-title">⏱ Rutinas por horario</div>
            <Routines bot={bot} routines={state.routines.filter((r) => r.botId === bot.id)} runs={state.runs} refresh={refresh} />
          </>
        )}
        {current === 'memory' && <Memory bot={bot} bots={state.bots} globalMemory={state.globalMemory || []} projects={(state.projects || []).filter((p) => p.botIds.includes(bot.id))} refresh={refresh} />}
        {current === 'artifacts' && <Artifacts bot={bot} tick={artifactsTick} onOpen={onOpenArtifact} />}
        {current === 'activity' && <Activity bot={bot} />}
      </div>
    </aside>
  );
}

function Progress({ steps, pinned, onUnpin }) {
  const [open, setOpen] = useState({});
  if (!steps.length) return <p className="muted">Aquí verás cada paso que da el bot: qué modelo piensa, qué herramientas usa y a quién delega.</p>;
  return (
    <div className="steps">
      {pinned && <button className="link" onClick={onUnpin}>← Volver a la última ejecución</button>}
      {steps.map((s) => (
        <div key={s.id} className={`step ${s.status}`} style={{ marginLeft: s.depth * 14 }}>
          <button className="step-head" onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}>
            <span className="step-icon">{s.status === 'running' ? <span className="spinner" /> : s.status === 'error' ? '!' : '✓'}</span>
            <span className="step-label">
              {(s.depth > 0 || (s.threadId && s.threadId !== s.botId)) && <b>{s.botName} · </b>}{s.label}
            </span>
            {s.ms != null && <span className="step-ms">{(s.ms / 1000).toFixed(1)}s</span>}
          </button>
          {open[s.id] && (s.detail || s.args) && (
            <pre className="step-detail">{s.args ? JSON.stringify(s.args, null, 2) + '\n\n' : ''}{s.detail || ''}</pre>
          )}
        </div>
      ))}
    </div>
  );
}

const DAYS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
function describeSchedule(s) {
  if (s.type === 'interval') return `Cada ${s.minutes} min`;
  const days = s.days?.length && s.days.length < 7 ? ` (${s.days.map((d) => DAYS[d]).join(' ')})` : '';
  return `Cada día a las ${s.time}${days}`;
}

const RUN_LABEL = { ok: '✓ Completada', error: '✗ Error', running: '◌ Ejecutando…', stopped: '⏹ Detenida', missed: '⏭ Perdida (app cerrada)' };
const CATCHUP = { ask: 'preguntarme', run: 'ejecutar una vez', skip: 'omitir' };
const fmtMs = (ms) => (ms == null ? '' : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`);

function RunHistory({ runs }) {
  const [open, setOpen] = useState(null);
  if (!runs.length) return <div className="muted small">Aún no se ha ejecutado.</div>;
  const ok = runs.filter((r) => r.status === 'ok').length;
  return (
    <div className="run-history">
      <div className="muted small">{runs.length} registros · {Math.round((ok / Math.max(1, runs.filter((r) => r.status !== 'missed').length)) * 100)} % sin errores</div>
      {runs.slice(0, 20).map((r) => (
        <div key={r.id} className={`run run-${r.status}`}>
          <button className="run-head" onClick={() => setOpen(open === r.id ? null : r.id)}>
            <span className="run-status">{RUN_LABEL[r.status] || r.status}</span>
            <span className="run-when">{new Date(r.startedAt).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            <span className="run-ms">{fmtMs(r.ms)}</span>
          </button>
          {open === r.id && (
            <div className="run-body">
              {r.model && <div className="muted small">{r.model}</div>}
              <div className="run-summary"><Markdown text={r.summary || '(sin resultado)'} /></div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const WATCH_TYPES = {
  github: { label: 'GitHub', hint: 'Avisa con issues, pull requests, versiones o commits nuevos' },
  web: { label: 'Una página web', hint: 'Avisa cuando cambia el contenido de una web' },
  rss: { label: 'Un RSS / blog', hint: 'Avisa con cada artículo nuevo de un feed' },
  gmail: { label: 'Gmail', hint: 'Avisa con cada correo nuevo que coincida con la búsqueda (necesita Google conectado en Apps conectadas)' },
  webhook: { label: 'Webhook (al instante)', hint: 'GitHub, Slack o cualquier servicio avisa a tu servidor en el momento; no se comprueba nada cada pocos minutos', server: true },
};
const hookUrl = (w, tenant) => `${remoteConfig()?.url || location.origin}/hooks/${tenant ? `${tenant}/` : ''}${w.id}?k=${w.config?.secret || ''}`;

function HookInfo({ w, tenant }) {
  const [copied, setCopied] = useState('');
  const copy = (what, text) => navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1500); });
  return (
    <details className="hook-info">
      <summary className="small">Dirección del webhook y cómo configurarlo</summary>
      <div className="hook-url"><code>{hookUrl(w, tenant)}</code><button className="btn small" onClick={() => copy('url', hookUrl(w, tenant))}>{copied === 'url' ? '✓ Copiada' : 'Copiar'}</button></div>
      <div className="muted small">
        <b>GitHub:</b> repositorio → Settings → Webhooks → Add webhook. Payload URL: la dirección de arriba, Content type: <code>application/json</code>,
        y en Secret pega esta clave <button className="link small" onClick={() => copy('secret', w.config?.secret || '')}>{copied === 'secret' ? '✓ copiada' : 'copiar clave'}</button>. Elige los eventos que quieras.
      </div>
      <div className="muted small"><b>Slack u otros:</b> pega la dirección donde pidan una «Request URL» o «Webhook URL». No la compartas: quien la tenga puede avisar a tu bot.</div>
    </details>
  );
}
const GH_EVENTS = { issues: 'Issues nuevos', pulls: 'Pull requests nuevos', releases: 'Versiones nuevas', commits: 'Commits nuevos' };

function describeWatch(w) {
  if (w.type === 'github') return `${GH_EVENTS[w.config?.event || 'issues']} en ${w.config?.repo}`;
  if (w.type === 'gmail') return `Correos: ${w.config?.query || 'in:inbox'}`;
  if (w.type === 'webhook') return 'al instante';
  return w.config?.url;
}

function describeFilters(f = {}) {
  return [f.include && `contiene «${f.include}»`, f.exclude && `sin «${f.exclude}»`, f.labels && `etiquetas ${f.labels}`, f.author && `de ${f.author}`].filter(Boolean).join(' · ');
}

function Watchers({ bot, watchers, refresh, tenant }) {
  const [form, setForm] = useState(null);
  const [checking, setChecking] = useState(null);
  const [err, setErr] = useState('');
  const save = async () => {
    setErr('');
    const config = form.type === 'github' ? { repo: form.repo, event: form.event } : form.type === 'gmail' ? { query: form.query || 'in:inbox' } : form.type === 'webhook' ? {} : { url: form.url };
    try {
      const filters = { include: form.include, exclude: form.exclude, ...(form.type === 'github' && { labels: form.labels, author: form.author }), ...(form.type === 'gmail' && { author: form.author }) };
      await api.saveWatcher({ botId: bot.id, name: form.name, type: form.type, config, everyMin: Number(form.everyMin), prompt: form.prompt, filters });
      setForm(null); refresh();
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="routines watchers">
      <div className="section-title" style={{ marginTop: 0 }}>🔔 Vigilantes (sin gastar tokens)</div>
      {watchers.length === 0 && !form && <p className="muted small">Comprueban solos si hay algo nuevo <b>sin usar la IA</b>, y solo despiertan a {bot.name} cuando hay novedades.</p>}
      {watchers.map((w) => (
        <div key={w.id} className="card">
          <div className="card-row">
            <strong>{w.name}</strong>
            <label className="switch">
              <input type="checkbox" checked={w.enabled} onChange={(e) => api.saveWatcher({ id: w.id, enabled: e.target.checked }).then(refresh)} />
              <span />
            </label>
          </div>
          <div className="muted small conn-url">{WATCH_TYPES[w.type]?.label}: {describeWatch(w)}{w.type !== 'webhook' && ` · cada ${w.everyMin} min`}</div>
          {w.type === 'webhook' && <HookInfo w={w} tenant={tenant} />}
          {describeFilters(w.filters) && <div className="muted small">Filtro: {describeFilters(w.filters)}</div>}
          {w.type === 'webhook'
            ? <div className="muted small">{w.lastCheckAt ? `Último aviso recibido: ${new Date(w.lastCheckAt).toLocaleString()}` : 'Esperando el primer aviso'}</div>
            : <div className="muted small">{w.lastCheckAt ? `Última comprobación: ${new Date(w.lastCheckAt).toLocaleTimeString()}` : 'Aún no se ha comprobado'}{w.ready ? '' : ' · aprendiendo lo que ya existe'}</div>}
          {w.lastFiredAt && <div className="small run-ok">Última novedad: {new Date(w.lastFiredAt).toLocaleString()} ({w.history?.[0]?.count || 0})</div>}
          {w.lastError && <div className="small run-error">{w.lastError}</div>}
          <div className="card-actions">
            {w.type !== 'webhook' && <button className="btn small" disabled={checking === w.id} onClick={async () => { setChecking(w.id); await api.checkWatcher(w.id); setChecking(null); refresh(); }}>{checking === w.id ? 'Comprobando…' : 'Comprobar ahora'}</button>}
            <button className="btn small ghost" onClick={async () => await ask('¿Borrar vigilante?') && api.deleteWatcher(w.id).then(refresh)}>Borrar</button>
          </div>
        </div>
      ))}
      {form ? (
        <div className="card form">
          <input placeholder="Nombre (p. ej. Bugs nuevos)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, everyMin: e.target.value === 'web' ? 30 : e.target.value === 'rss' ? 15 : e.target.value === 'gmail' ? 5 : 10 })}>
            {Object.entries(WATCH_TYPES).filter(([, v]) => !v.server || serverMode).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <div className="muted small">{WATCH_TYPES[form.type].hint}</div>
          {form.type === 'github' ? (
            <div className="card-row">
              <input placeholder="usuario/repo" value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} />
              <select value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value })}>
                {Object.entries(GH_EVENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          ) : form.type === 'webhook' ? (
            <div className="muted small">Al guardar te daré la dirección que tienes que pegar en GitHub, Slack, etc.</div>
          ) : form.type === 'gmail' ? (
            <input placeholder="Búsqueda de Gmail (p. ej. is:unread from:cliente.com)" value={form.query} onChange={(e) => setForm({ ...form, query: e.target.value })} />
          ) : (
            <input placeholder={form.type === 'rss' ? 'https://blog.com/feed' : 'https://web.com/precios'} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          )}
          {form.type !== 'webhook' && <div className="card-row">
            <span className="muted small">Comprobar cada</span>
            <input type="number" min="5" value={form.everyMin} onChange={(e) => setForm({ ...form, everyMin: e.target.value })} style={{ width: 70 }} />
            <span className="muted small">min</span>
          </div>}
          <details className="filters" open={!!(form.include || form.exclude || form.labels || form.author)}>
            <summary className="muted small">Filtros (opcional)</summary>
            <input placeholder="Solo si contiene… (palabras separadas por comas)" value={form.include} onChange={(e) => setForm({ ...form, include: e.target.value })} />
            <input placeholder="Ignorar si contiene…" value={form.exclude} onChange={(e) => setForm({ ...form, exclude: e.target.value })} />
            {form.type === 'gmail' && <input placeholder="Solo de (correo o dominio, separados por comas)" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />}
            {form.type === 'github' && (
              <div className="card-row">
                <input placeholder="Solo etiquetas (bug, urgente)" value={form.labels} onChange={(e) => setForm({ ...form, labels: e.target.value })} />
                <input placeholder="Solo de (usuario)" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
              </div>
            )}
          </details>
          <textarea rows={2} placeholder="Qué debe hacer el bot con las novedades (p. ej. «resúmelas y dime si alguna es urgente»)" value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
          {err && <div className="small run-error">{err}</div>}
          <div className="card-actions">
            <button className="btn small primary" disabled={!form.name || !(form.repo || form.url || form.type === 'gmail' || form.type === 'webhook')} onClick={save}>Guardar</button>
            <button className="btn small ghost" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <button className="btn full" onClick={() => setForm({ name: '', type: 'github', repo: '', event: 'issues', url: '', query: 'is:unread in:inbox', everyMin: 10, prompt: '', include: '', exclude: '', labels: '', author: '' })}>+ Nuevo vigilante</button>
      )}
    </div>
  );
}

function Routines({ bot, routines, runs, refresh }) {
  const [form, setForm] = useState(null);
  const [history, setHistory] = useState(null);
  const save = async () => {
    const schedule = form.type === 'interval' ? { type: 'interval', minutes: Number(form.minutes) } : { type: 'daily', time: form.time, days: form.days };
    await api.createRoutine({ botId: bot.id, name: form.name, prompt: form.prompt, schedule, catchUp: form.catchUp });
    setForm(null);
    refresh();
  };
  return (
    <div className="routines">
      {routines.length === 0 && !form && <p className="muted">Las rutinas hacen que {bot.name} trabaje solo: un resumen cada mañana, revisar una web cada hora…</p>}
      {routines.map((r) => {
        const last = runs.find((x) => x.routineId === r.id);
        return (
          <div key={r.id} className="card">
            <div className="card-row">
              <strong>{r.name}</strong>
              <label className="switch">
                <input type="checkbox" checked={r.enabled} onChange={(e) => api.updateRoutine(r.id, { enabled: e.target.checked }).then(refresh)} />
                <span />
              </label>
            </div>
            <div className="muted small">{describeSchedule(r.schedule)}</div>
            <label className="muted small catchup">Si la app estaba cerrada:
              <select value={r.catchUp || 'ask'} onChange={(e) => api.updateRoutine(r.id, { catchUp: e.target.value }).then(refresh)}>
                {Object.entries(CATCHUP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            {r.enabled && r.nextRunAt && <div className="muted small">Próxima: {new Date(r.nextRunAt).toLocaleString()}</div>}
            {last && <div className={`small run-${last.status}`}>Última: {RUN_LABEL[last.status] || last.status} · {new Date(last.startedAt).toLocaleString()}</div>}
            {history === r.id && <RunHistory runs={runs.filter((x) => x.routineId === r.id)} />}
            <div className="card-actions">
              <button className="btn small" onClick={() => api.runRoutine(r.id)}>Ejecutar ahora</button>
              <button className="btn small ghost" onClick={() => setHistory(history === r.id ? null : r.id)}>{history === r.id ? 'Ocultar historial' : 'Historial'}</button>
              <button className="btn small ghost" onClick={async () => await ask('¿Borrar rutina?') && api.deleteRoutine(r.id).then(refresh)}>Borrar</button>
            </div>
          </div>
        );
      })}
      {form ? (
        <div className="card form">
          <input placeholder="Nombre (p. ej. Briefing matinal)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <textarea rows={3} placeholder="¿Qué debe hacer?" value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
          <div className="card-row">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="daily">Cada día a una hora</option>
              <option value="interval">Cada X minutos</option>
            </select>
            {form.type === 'daily'
              ? <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
              : <input type="number" min="1" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} style={{ width: 80 }} />}
          </div>
          {form.type === 'daily' && (
            <div className="days">
              {DAYS.map((d, i) => (
                <button key={i} className={form.days.includes(i) ? 'on' : ''}
                  onClick={() => setForm({ ...form, days: form.days.includes(i) ? form.days.filter((x) => x !== i) : [...form.days, i] })}>{d}</button>
              ))}
            </div>
          )}
          <div className="card-actions">
            <button className="btn small primary" disabled={!form.name || !form.prompt} onClick={save}>Guardar</button>
            <button className="btn small ghost" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <button className="btn full" onClick={() => setForm({ name: '', prompt: '', type: 'daily', time: '08:00', minutes: 60, days: [1, 2, 3, 4, 5], catchUp: 'ask' })}>+ Nueva rutina</button>
      )}
    </div>
  );
}

const memText = (m) => (typeof m === 'string' ? m : m.text);
const asItem = (m) => (typeof m === 'string' ? { text: m } : m);

// One shared memory item, with «visible para» (all bots or only some).
function SharedItem({ m, bots, onDelete, onChange }) {
  const [open, setOpen] = useState(false);
  const item = asItem(m);
  const only = item.onlyBots || [];
  const toggle = (id) => {
    const next = only.includes(id) ? only.filter((x) => x !== id) : [...only, id];
    onChange({ ...item, onlyBots: next });
  };
  return (
    <div className="mem-item col">
      <div className="mem-row">
        <span>{item.text}{item.by && <span className="muted small"> · {item.by}</span>}</span>
        <button className={`vis-btn ${only.length ? 'limited' : ''}`} onClick={() => setOpen(!open)} title="Quién puede verlo">
          {only.length ? `🔒 ${only.length}` : '👁 todos'}
        </button>
        <button className="icon-btn" onClick={onDelete} aria-label="Borrar">×</button>
      </div>
      {open && (
        <div className="vis-list">
          <div className="muted small">Visible para {only.length ? 'solo estos bots' : 'todos'} (marca bots para limitarlo):</div>
          {bots.map((b) => (
            <label key={b.id} className="check small"><input type="checkbox" checked={only.includes(b.id)} onChange={() => toggle(b.id)} /> {b.name}</label>
          ))}
        </div>
      )}
    </div>
  );
}

function AddForm({ placeholder, onAdd }) {
  const [v, setV] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(''); } }}>
      <input placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} />
    </form>
  );
}

function Memory({ bot, projects = [], bots = [], globalMemory = [], refresh }) {
  const update = (memory) => api.updateBot(bot.id, { memory }).then(refresh);
  const updateProject = (p, memory) => api.saveProject({ id: p.id, memory }).then(refresh);
  const updateGlobal = (memory) => api.setGlobalMemory(memory).then(refresh);
  const now = () => new Date().toISOString();
  const reads = bot.sharedMemory !== false;
  return (
    <div className="memory">
      <label className="check small reads-shared">
        <input type="checkbox" checked={reads} onChange={(e) => api.updateBot(bot.id, { sharedMemory: e.target.checked }).then(refresh)} />
        {bot.name} lee la memoria compartida (global y de proyectos)
      </label>

      <div className="proj-mem">
        <div className="section-title">🌐 Memoria global</div>
        <p className="muted small">La sabe todo el equipo (salvo lo que limites con 🔒).</p>
        {globalMemory.map((m, i) => (
          <SharedItem key={i} m={m} bots={bots}
            onDelete={() => updateGlobal(globalMemory.filter((_, j) => j !== i))}
            onChange={(nm) => updateGlobal(globalMemory.map((x, j) => (j === i ? nm : x)))} />
        ))}
        <AddForm placeholder="Añadir para todo el equipo…" onAdd={(t) => updateGlobal([...globalMemory, { text: t, by: 'Tú', at: now() }])} />
      </div>

      {projects.map((p) => (
        <div key={p.id} className="proj-mem">
          <div className="section-title"><span className="project-dot" style={{ background: p.color }} /> Proyecto «{p.name}»</div>
          <p className="muted small">La comparten los bots del proyecto. «Recuerda que…» se guarda aquí.</p>
          {(p.memory || []).map((m, i) => (
            <SharedItem key={i} m={m} bots={bots.filter((b) => p.botIds.includes(b.id))}
              onDelete={() => updateProject(p, p.memory.filter((_, j) => j !== i))}
              onChange={(nm) => updateProject(p, p.memory.map((x, j) => (j === i ? nm : x)))} />
          ))}
          <AddForm placeholder="Añadir al proyecto…" onAdd={(t) => updateProject(p, [...(p.memory || []), { text: t, by: 'Tú', at: now() }])} />
        </div>
      ))}

      <div className="section-title">🔒 Memoria privada de {bot.name}</div>
      <p className="muted small">Solo la ve {bot.name}. Úsala para datos sensibles (p. ej. de compras o pagos).</p>
      {bot.memory.map((m, i) => (
        <div key={i} className="mem-item">
          <span>{memText(m)}</span>
          <button className="icon-btn" onClick={() => update(bot.memory.filter((_, j) => j !== i))} aria-label="Borrar">×</button>
        </div>
      ))}
      <AddForm placeholder="Añadir un recuerdo privado…" onAdd={(t) => update([...bot.memory, t])} />
    </div>
  );
}

function Artifacts({ bot, tick, onOpen }) {
  const [files, setFiles] = useState([]);
  const load = () => api.artifacts(bot.id).then(setFiles).catch(() => setFiles([]));
  useEffect(() => { load(); }, [bot.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!files.length) return <p className="muted">Los archivos que cree {bot.name} (informes, código, documentos) aparecerán aquí.</p>;
  return (
    <div className="artifacts">
      {files.map((f) => (
        <div key={f.name} className="file">
          <span className="file-icon">▤</span>
          <button className="file-name" onClick={() => onOpen(bot.id, f.name)}>{f.name}</button>
          <span className="muted small">{(f.size / 1024).toFixed(1)} KB</span>
          <button className="icon-btn" onClick={() => api.openArtifact(bot.id, f.name, true)} title="Descargar">↓</button>
          <button className="icon-btn" onClick={async () => await ask(`¿Borrar ${f.name}?`) && api.deleteArtifact(bot.id, f.name).then(load)} title="Borrar">×</button>
        </div>
      ))}
    </div>
  );
}

// Everything this bot did on your devices (your browser, its computer), with the permission it had.
const STATUS = { ok: '✓', error: '⚠️', denied: '⛔' };
function Activity({ bot }) {
  const [list, setList] = useState(null);
  const load = () => api.activity(bot.id).then(setList).catch(() => setList([]));
  useEffect(() => {
    load();
    return api.subscribe((ev) => { if (ev.type === 'activity' && (!ev.botId || ev.botId === bot.id)) load(); });
  }, [bot.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list) return <p className="muted small">Cargando…</p>;
  if (!list.length) return <p className="muted">Aquí queda registrado todo lo que {bot.name} hace en tu navegador y en su ordenador: qué, cuándo y con qué permiso.</p>;
  return (
    <div className="activity">
      {list.map((a) => (
        <div key={a.id} className={`card activity-item ${a.status}`}>
          <div className="card-row"><span>{STATUS[a.status] || '•'} {a.label}</span><span className="muted small">{new Date(a.at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
          <div className="muted small">{a.approval === 'deny' ? 'Denegado por ti' : a.approval === 'always' || a.approval === 'siempre' ? 'Permitido siempre' : a.approval === 'once' ? 'Permitido una vez' : ''}</div>
          {a.result && a.status !== 'denied' && <details className="small"><summary className="muted">Resultado</summary><div className="activity-result">{a.result}</div></details>}
        </div>
      ))}
      <button className="btn small ghost" onClick={async () => await ask('¿Borrar el registro de este bot?') && api.clearActivity(bot.id).then(load)}>Borrar registro</button>
    </div>
  );
}
