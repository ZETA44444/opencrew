import { useState } from 'react';
import { api } from '../api.js';
import Avatar, { COLORS, SHAPES } from './Avatar.jsx';

const TEMPLATES = [
  { name: 'Iris', title: 'Asistente de correo', description: 'Ordena el correo, resume lo importante y redacta respuestas.', instructions: 'Prioriza lo urgente. Propón borradores, nunca envíes nada sin permiso.', color: '#fcd34d', shape: 'circle' },
  { name: 'Scout', title: 'Analista SEO', description: 'Analiza webs, palabras clave y competencia.', instructions: 'Lee las páginas con fetch_url y da recomendaciones concretas.', color: '#c4b5fd', shape: 'triangle' },
  { name: 'Echo', title: 'Social media', description: 'Escribe posts para X, LinkedIn e Instagram.', instructions: 'Escribe en tono cercano. Da 3 variantes por post.', color: '#f9a8d4', shape: 'square' },
  { name: 'Ledger', title: 'Finanzas personales', description: 'Ayuda a organizar gastos y presupuestos (no da asesoría de inversión).', instructions: 'Usa tablas en markdown. Guarda los presupuestos con write_artifact.', color: '#fdba74', shape: 'hexagon' },
];

const TOOL_LABELS = {
  delegate_to_bot: 'Delegar a otros bots',
  save_memory: 'Guardar en memoria',
  fetch_url: 'Leer páginas web',
  write_artifact: 'Crear archivos',
  get_current_time: 'Ver la hora',
};

export default function BotModal({ bot, providers, tools, onClose, onSaved, onDeleted }) {
  const isNew = !bot;
  const firstWithKey = providers.find((p) => !p.noKey && p.hasKey);
  const [f, setF] = useState(() => bot ? { ...bot, tools: bot.tools || tools } : {
    name: '', title: '', description: '', instructions: '', color: COLORS[1], shape: 'circle',
    provider: firstWithKey?.id || 'demo', model: firstWithKey?.models[0] || 'demo', tools, starred: false,
  });
  const [err, setErr] = useState('');
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const provider = providers.find((p) => p.id === f.provider);

  const submit = async () => {
    setErr('');
    try {
      const payload = { name: f.name, title: f.title, description: f.description, instructions: f.instructions, color: f.color, shape: f.shape, provider: f.provider, model: f.model, tools: f.tools, starred: f.starred };
      const saved = isNew ? await api.createBot(payload) : await api.updateBot(bot.id, payload);
      onSaved(saved);
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{isNew ? 'Nuevo bot' : `Editar ${bot.name}`}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="modal-body">
          {isNew && (
            <div className="templates">
              {TEMPLATES.map((t) => (
                <button key={t.name} onClick={() => set(t)}>
                  <Avatar bot={t} size={22} /> <span>{t.title}</span>
                </button>
              ))}
            </div>
          )}
          <div className="avatar-editor">
            <Avatar bot={f} size={56} />
            <div>
              <div className="swatches">
                {COLORS.map((c) => <button key={c} className={f.color === c ? 'on' : ''} style={{ background: c }} onClick={() => set({ color: c })} aria-label={c} />)}
              </div>
              <div className="shapes">
                {SHAPES.map((s) => <button key={s} className={f.shape === s ? 'on' : ''} onClick={() => set({ shape: s })}><Avatar bot={{ ...f, shape: s, name: ' ' }} size={18} /></button>)}
              </div>
            </div>
          </div>
          <div className="grid2">
            <label>Nombre<input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Nova" /></label>
            <label>Cargo<input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="Investigadora" /></label>
          </div>
          <label>¿Cuál es su trabajo? <span className="hint">Los demás bots leen esto para decidir si delegarle tareas.</span>
            <textarea rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} />
          </label>
          <label>Instrucciones
            <textarea rows={3} value={f.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="Cómo debe trabajar, tono, reglas…" />
          </label>

          <div className="section-title">Modelo de IA de este bot</div>
          <div className="grid2">
            <label>Proveedor
              <select value={f.provider} onChange={(e) => { const p = providers.find((x) => x.id === e.target.value); set({ provider: p.id, model: p.models[0] }); }}>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.label}{p.hasKey ? '' : ' (sin clave)'}</option>)}
              </select>
            </label>
            <label>Modelo
              <input list="models" value={f.model} onChange={(e) => set({ model: e.target.value })} disabled={f.provider === 'demo'} />
              <datalist id="models">{provider?.models.map((m) => <option key={m} value={m} />)}</datalist>
            </label>
          </div>
          {provider && !provider.hasKey && <div className="banner small">Este proveedor aún no tiene API key. Añádela en Ajustes.</div>}

          <div className="section-title">Herramientas</div>
          <div className="tool-checks">
            {tools.map((t) => (
              <label key={t} className="check">
                <input type="checkbox" checked={f.tools.includes(t)} onChange={(e) => set({ tools: e.target.checked ? [...f.tools, t] : f.tools.filter((x) => x !== t) })} />
                {TOOL_LABELS[t] || t}
              </label>
            ))}
            <label className="check"><input type="checkbox" checked={!!f.starred} onChange={(e) => set({ starred: e.target.checked })} /> ★ Bot principal</label>
          </div>
          {err && <div className="banner error">{err}</div>}
        </div>
        <div className="modal-foot">
          {!isNew && <button className="btn ghost danger" onClick={() => confirm(`¿Borrar ${bot.name} y su conversación?`) && api.deleteBot(bot.id).then(onDeleted)}>Borrar bot</button>}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={submit} disabled={!f.name.trim()}>{isNew ? 'Crear bot' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}
