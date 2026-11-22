import { useEffect, useState } from 'react';
import { api } from '../api.js';

const TABS = [['progress', 'Progreso'], ['routines', 'Rutinas'], ['memory', 'Memoria'], ['artifacts', 'Archivos']];

export default function RightPanel({ bot, state, steps, pinned, onUnpin, artifactsTick, refresh, onClose }) {
  const [tab, setTab] = useState('progress');
  return (
    <aside className="panel">
      <div className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
        <button className="icon-btn close" onClick={onClose} aria-label="Cerrar panel">×</button>
      </div>
      <div className="panel-body">
        {tab === 'progress' && <Progress steps={steps} pinned={pinned} onUnpin={onUnpin} />}
        {tab === 'routines' && <Routines bot={bot} routines={state.routines.filter((r) => r.botId === bot.id)} runs={state.runs} refresh={refresh} />}
        {tab === 'memory' && <Memory bot={bot} refresh={refresh} />}
        {tab === 'artifacts' && <Artifacts bot={bot} tick={artifactsTick} />}
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
              {s.depth > 0 && <b>{s.botName} · </b>}{s.label}
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

function Routines({ bot, routines, runs, refresh }) {
  const [form, setForm] = useState(null);
  const save = async () => {
    const schedule = form.type === 'interval' ? { type: 'interval', minutes: Number(form.minutes) } : { type: 'daily', time: form.time, days: form.days };
    await api.createRoutine({ botId: bot.id, name: form.name, prompt: form.prompt, schedule });
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
            {r.enabled && r.nextRunAt && <div className="muted small">Próxima: {new Date(r.nextRunAt).toLocaleString()}</div>}
            {last && <div className={`small run-${last.status}`}>Última: {last.status === 'running' ? 'ejecutando…' : last.status} · {new Date(last.startedAt).toLocaleString()}</div>}
            <div className="card-actions">
              <button className="btn small" onClick={() => api.runRoutine(r.id)}>Ejecutar ahora</button>
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
        <button className="btn full" onClick={() => setForm({ name: '', prompt: '', type: 'daily', time: '08:00', minutes: 60, days: [1, 2, 3, 4, 5] })}>+ Nueva rutina</button>
      )}
    </div>
  );
}

function Memory({ bot, refresh }) {
  const [fact, setFact] = useState('');
  const update = (memory) => api.updateBot(bot.id, { memory }).then(refresh);
  return (
    <div className="memory">
      <p className="muted small">Lo que {bot.name} sabe de ti. Solo este bot ve su memoria. También puede guardar cosas solo cuando le dices «recuerda que…».</p>
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

function Artifacts({ bot, tick }) {
  const [files, setFiles] = useState([]);
  const load = () => api.artifacts(bot.id).then(setFiles).catch(() => setFiles([]));
  useEffect(() => { load(); }, [bot.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!files.length) return <p className="muted">Los archivos que cree {bot.name} (informes, código, documentos) aparecerán aquí.</p>;
  return (
    <div className="artifacts">
      {files.map((f) => (
        <div key={f.name} className="file">
          <span className="file-icon">▤</span>
          <button className="file-name" onClick={() => api.openArtifact(bot.id, f.name)}>{f.name}</button>
          <span className="muted small">{(f.size / 1024).toFixed(1)} KB</span>
          <button className="icon-btn" onClick={() => api.openArtifact(bot.id, f.name, true)} title="Descargar">↓</button>
          <button className="icon-btn" onClick={() => confirm(`¿Borrar ${f.name}?`) && api.deleteArtifact(bot.id, f.name).then(load)} title="Borrar">×</button>
        </div>
      ))}
    </div>
  );
}
