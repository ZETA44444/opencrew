import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Markdown from './Markdown.jsx';

const TABS = [['progress', 'Progreso'], ['routines', 'Rutinas'], ['memory', 'Memoria'], ['artifacts', 'Archivos']];

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
        {current === 'routines' && <Routines bot={bot} routines={state.routines.filter((r) => r.botId === bot.id)} runs={state.runs} refresh={refresh} />}
        {current === 'memory' && <Memory bot={bot} projects={(state.projects || []).filter((p) => p.botIds.includes(bot.id))} refresh={refresh} />}
        {current === 'artifacts' && <Artifacts bot={bot} tick={artifactsTick} onOpen={onOpenArtifact} />}
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
              <button className="btn small ghost" onClick={() => confirm('¿Borrar rutina?') && api.deleteRoutine(r.id).then(refresh)}>Borrar</button>
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

function Memory({ bot, projects = [], refresh }) {
  const [fact, setFact] = useState('');
  const [projFact, setProjFact] = useState({});
  const update = (memory) => api.updateBot(bot.id, { memory }).then(refresh);
  const updateProject = (p, memory) => api.saveProject({ id: p.id, memory }).then(refresh);
  return (
    <div className="memory">
      {projects.map((p) => (
        <div key={p.id} className="proj-mem">
          <div className="section-title"><span className="project-dot" style={{ background: p.color }} /> Memoria del proyecto «{p.name}»</div>
          <p className="muted small">La comparten todos los bots del proyecto. Cuando le dices a cualquiera «recuerda que…», se guarda aquí.</p>
          {(p.memory || []).map((m, i) => (
            <div key={i} className="mem-item">
              <span>{memText(m)}{m.by && <span className="muted small"> · {m.by}</span>}</span>
              <button className="icon-btn" onClick={() => updateProject(p, p.memory.filter((_, j) => j !== i))} aria-label="Borrar">×</button>
            </div>
          ))}
          <form onSubmit={(e) => { e.preventDefault(); const v = (projFact[p.id] || '').trim(); if (v) { updateProject(p, [...(p.memory || []), { text: v, by: 'Tú', at: new Date().toISOString() }]); setProjFact({ ...projFact, [p.id]: '' }); } }}>
            <input placeholder="Añadir al proyecto…" value={projFact[p.id] || ''} onChange={(e) => setProjFact({ ...projFact, [p.id]: e.target.value })} />
          </form>
        </div>
      ))}
      {projects.length > 0 && <div className="section-title">Memoria privada de {bot.name}</div>}
      <p className="muted small">{projects.length ? `Solo la ve ${bot.name}.` : `Lo que ${bot.name} sabe de ti. Solo este bot ve su memoria. También guarda cosas cuando le dices «recuerda que…».`}</p>
      {bot.memory.map((m, i) => (
        <div key={i} className="mem-item">
          <span>{m}</span>
          <button className="icon-btn" onClick={() => update(bot.memory.filter((_, j) => j !== i))} aria-label="Borrar">×</button>
        </div>
      ))}
      <form onSubmit={(e) => { e.preventDefault(); if (fact.trim()) { update([...bot.memory, fact.trim()]); setFact(''); } }}>
        <input placeholder="Añadir un recuerdo…" value={fact} onChange={(e) => setFact(e.target.value)} />
      </form>
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
          <button className="icon-btn" onClick={() => confirm(`¿Borrar ${f.name}?`) && api.deleteArtifact(bot.id, f.name).then(load)} title="Borrar">×</button>
        </div>
      ))}
    </div>
  );
}
