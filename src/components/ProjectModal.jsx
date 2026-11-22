import { useState } from 'react';
import { api } from '../api.js';
import Avatar, { COLORS, GroupAvatar } from './Avatar.jsx';

export default function ProjectModal({ project, bots, groups, onClose, onSaved, onDeleted }) {
  const isNew = !project;
  const [f, setF] = useState(() => project ? { ...project } : { name: '', description: '', color: COLORS[1], botIds: [], groupIds: [] });
  const [err, setErr] = useState('');
  const toggle = (key, id) => setF((x) => ({ ...x, [key]: x[key].includes(id) ? x[key].filter((i) => i !== id) : [...x[key], id] }));

  const submit = async () => {
    setErr('');
    try { onSaved(await api.saveProject({ ...f, id: project?.id })); } catch (e) { setErr(e.message); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{isNew ? 'Nuevo proyecto' : `Editar ${project.name}`}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="modal-body">
          <div className="grid2">
            <label>Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Lanzamiento de la tienda" autoFocus /></label>
            <label>Color
              <div className="swatches">
                {COLORS.map((c) => <button key={c} className={f.color === c ? 'on' : ''} style={{ background: c }} onClick={() => setF({ ...f, color: c })} aria-label={c} />)}
              </div>
            </label>
          </div>
          <label>¿De qué trata? <span className="hint">Los bots del proyecto lo leen para entender el contexto.</span>
            <textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Tienda online de café; objetivo: abrir en enero" />
          </label>
          <div className="section-title">Bots del proyecto</div>
          <div className="member-list">
            {bots.map((b) => (
              <label key={b.id} className={`member-row check ${f.botIds.includes(b.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={f.botIds.includes(b.id)} onChange={() => toggle('botIds', b.id)} />
                <Avatar bot={b} size={22} /><span className="member-name">{b.name} <span className="muted small">· {b.title}</span></span>
              </label>
            ))}
          </div>
          {groups.length > 0 && (
            <>
              <div className="section-title">Chats de grupo del proyecto</div>
              <div className="member-list">
                {groups.map((g) => (
                  <label key={g.id} className={`member-row check ${f.groupIds.includes(g.id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={f.groupIds.includes(g.id)} onChange={() => toggle('groupIds', g.id)} />
                    <GroupAvatar members={g.memberIds.map((id) => bots.find((b) => b.id === id)).filter(Boolean)} size={22} />
                    <span className="member-name">{g.name}</span>
                  </label>
                ))}
              </div>
            </>
          )}
          <p className="muted small" style={{ margin: 0 }}>Los chats, archivos y rutinas de cada bot siguen siendo suyos; el proyecto los agrupa y da contexto. Un bot puede estar en varios proyectos.</p>
          {err && <div className="banner error">{err}</div>}
        </div>
        <div className="modal-foot">
          {!isNew && <button className="btn ghost danger" onClick={() => confirm(`¿Borrar el proyecto ${project.name}? Los bots y sus chats no se borran.`) && api.deleteProject(project.id).then(onDeleted)}>Borrar proyecto</button>}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={submit} disabled={!f.name.trim()}>{isNew ? 'Crear proyecto' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}
