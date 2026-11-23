import { useState } from 'react';
import { api } from '../api.js';
import Markdown from './Markdown.jsx';
import { ask } from '../dialog.jsx';

export default function SkillsModal({ skills, onClose }) {
  const [editing, setEditing] = useState(null); // skill being edited, or {} for a new one
  const [viewing, setViewing] = useState(null);
  const [err, setErr] = useState('');

  const save = async () => {
    setErr('');
    try { await api.saveSkill(editing); setEditing(null); } catch (e) { setErr(e.message); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <h3>{editing ? (editing.id ? `Editar «${editing.name}»` : 'Nueva skill') : viewing ? viewing.name : 'Skills del equipo'}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="modal-body">
          {editing ? (
            <>
              <label>Nombre<input value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Informe SEO semanal" autoFocus /></label>
              <label>¿Cuándo usarla?<input value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Cada lunes, para resumir el tráfico de la web" /></label>
              <label>Pasos <span className="hint">En markdown. Los bots los leerán y los seguirán.</span>
                <textarea rows={10} value={editing.steps || ''} onChange={(e) => setEditing({ ...editing, steps: e.target.value })}
                  placeholder={'1. Lee https://…\n2. Compara con la semana anterior\n3. Escribe un resumen de 5 viñetas\n4. Guárdalo con write_artifact'} />
              </label>
              {err && <div className="banner error">{err}</div>}
            </>
          ) : viewing ? (
            <>
              {viewing.description && <p className="muted" style={{ margin: 0 }}>{viewing.description}</p>}
              <div className="skill-steps"><Markdown text={viewing.steps} /></div>
              <div className="muted small">Creada por {viewing.createdBy || '—'}{viewing.updatedBy ? ` · editada por ${viewing.updatedBy}` : ''} · usada {viewing.uses || 0} veces</div>
            </>
          ) : (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                Una skill es un proceso guardado: «cómo hacer X» paso a paso. La comparten todos los bots: cualquiera puede usarla, y
                los bots pueden guardar skills nuevas cuando aprenden algo que se repite (dile a un bot «guarda esto como skill»).
              </p>
              {skills.length === 0 && <div className="empty-skills muted">Todavía no hay skills.</div>}
              {skills.map((k) => (
                <button key={k.id} className="skill-card" onClick={() => setViewing(k)}>
                  <div className="skill-name">{k.name}</div>
                  {k.description && <div className="muted small">{k.description}</div>}
                  <div className="muted small">por {k.createdBy || '—'} · usada {k.uses || 0} veces</div>
                </button>
              ))}
            </>
          )}
        </div>
        <div className="modal-foot">
          {editing ? (
            <>
              <span className="spacer" />
              <button className="btn ghost" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="btn primary" onClick={save} disabled={!editing.name?.trim() || !editing.steps?.trim()}>Guardar</button>
            </>
          ) : viewing ? (
            <>
              <button className="btn ghost danger" onClick={async () => await ask(`¿Borrar la skill «${viewing.name}»?`) && api.deleteSkill(viewing.id).then(() => setViewing(null))}>Borrar</button>
              <span className="spacer" />
              <button className="btn ghost" onClick={() => setViewing(null)}>← Volver</button>
              <button className="btn primary" onClick={() => { setEditing(viewing); setViewing(null); }}>Editar</button>
            </>
          ) : (
            <>
              <span className="spacer" />
              <button className="btn ghost" onClick={onClose}>Cerrar</button>
              <button className="btn primary" onClick={() => setEditing({})}>+ Nueva skill</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
