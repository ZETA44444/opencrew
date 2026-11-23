import { useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import { ask } from '../dialog.jsx';

export default function GroupModal({ group, bots, onClose, onSaved, onDeleted }) {
  const isNew = !group;
  const [name, setName] = useState(group?.name || '');
  const [memberIds, setMemberIds] = useState(group?.memberIds || bots.slice(0, 3).map((b) => b.id));
  const [err, setErr] = useState('');

  const toggle = (id) => setMemberIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 6 ? ids : [...ids, id]));
  const move = (id) => setMemberIds((ids) => [id, ...ids.filter((x) => x !== id)]);

  const submit = async () => {
    setErr('');
    try {
      const saved = isNew ? await api.createGroup({ name, memberIds }) : await api.updateGroup(group.id, { name, memberIds });
      onSaved(saved);
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>{isNew ? 'Nuevo chat de grupo' : `Editar ${group.name}`}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="modal-body">
          <label>Nombre del grupo<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lanzamiento del blog" autoFocus /></label>
          <div className="section-title">Miembros (2 a 6)</div>
          <p className="muted small" style={{ margin: 0 }}>
            Si no mencionas a nadie, responde el <b>primero</b> de la lista (el líder). Con @Nombre hablas con quien quieras,
            y los bots pueden mencionarse entre ellos para repartirse el trabajo. Cada uno usa su propio modelo.
          </p>
          <div className="member-list">
            {bots.map((b) => {
              const on = memberIds.includes(b.id);
              const lead = memberIds[0] === b.id;
              return (
                <div key={b.id} className={`member-row ${on ? 'on' : ''}`}>
                  <label className="check">
                    <input type="checkbox" checked={on} onChange={() => toggle(b.id)} disabled={!on && memberIds.length >= 6} />
                    <Avatar bot={b} size={24} />
                    <span className="member-name">{b.name} <span className="muted small">· {b.title} · {b.provider}/{b.model}</span></span>
                  </label>
                  {on && (lead ? <span className="pill ok">líder</span> : <button className="link small" onClick={() => move(b.id)}>hacer líder</button>)}
                </div>
              );
            })}
          </div>
          {err && <div className="banner error">{err}</div>}
        </div>
        <div className="modal-foot">
          {!isNew && <button className="btn ghost danger" onClick={async () => await ask(`¿Borrar el grupo ${group.name} y su conversación? Los bots no se borran.`) && api.deleteGroup(group.id).then(onDeleted)}>Borrar grupo</button>}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={submit} disabled={!name.trim() || memberIds.length < 2}>{isNew ? 'Crear grupo' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}
