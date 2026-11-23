import { useEffect, useState } from 'react';
import { hostedInfo } from '../remote.js';

// Ajustes → Cuenta (server with accounts): who you are, password, sign out; the owner also
// manages invitations and users.
const call = async (path, data) => {
  const r = await fetch(`./api/${path}`, { method: data ? 'POST' : 'GET', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-opencrew': '1' }, body: data ? JSON.stringify(data) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
};

export default function AccountSection() {
  const me = hostedInfo()?.user;
  const [pw, setPw] = useState(null); // { current, password }
  const [msg, setMsg] = useState('');
  const [admin, setAdmin] = useState(null);
  const [invite, setInvite] = useState(null);
  const [note, setNote] = useState('');
  const loadAdmin = () => call('admin/users').then(setAdmin).catch(() => {});
  useEffect(() => { if (me?.role === 'owner') loadAdmin(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!me) return null;

  const changePw = async () => {
    setMsg('');
    try { await call('auth/password', pw); setPw(null); setMsg('✓ Contraseña cambiada. Se ha cerrado la sesión en los demás dispositivos.'); } catch (e) { setMsg(e.message); }
  };
  const logout = async () => { await call('auth/logout', {}).catch(() => {}); location.reload(); };

  return (
    <>
      <div className="section-title">Cuenta</div>
      <div className="muted small">Has entrado como <b>{me.email}</b>{me.role === 'owner' ? ' · administrador del servidor' : ''}. Tus bots, claves y chats están en tu propio espacio, cifrado y separado del resto.</div>
      {pw ? (
        <div className="grid2">
          <label>Contraseña actual<input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
          <label>Nueva (mín. 10)<input type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></label>
        </div>
      ) : null}
      {msg && <div className="small muted">{msg}</div>}
      <div className="settings-actions">
        {pw ? <><button className="btn small primary" onClick={changePw}>Guardar contraseña</button><button className="btn small ghost" onClick={() => setPw(null)}>Cancelar</button></>
          : <button className="btn small" onClick={() => setPw({ current: '', password: '' })}>Cambiar contraseña</button>}
        <button className="btn small ghost" onClick={logout}>Cerrar sesión</button>
      </div>

      {me.role === 'owner' && admin && (
        <>
          <div className="section-title">Usuarios e invitaciones</div>
          <div className="muted small">OpenCrew aún no está abierto a todo el mundo: solo entra quien tenga una invitación (vale 14 días y una sola vez).</div>
          <div className="key-input">
            <input placeholder="Para quién es (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn small primary" onClick={async () => { const r = await call('admin/invite', { note }); setInvite(r); setNote(''); loadAdmin(); }}>Crear invitación</button>
          </div>
          {invite && <div className="hook-url"><code>{invite.url}</code><button className="btn small" onClick={() => navigator.clipboard?.writeText(invite.url)}>Copiar enlace</button></div>}
          <div className="always-list">
            {admin.users.map((u) => (
              <div key={u.id} className="mem-item">
                <span><b>{u.email}</b> · {u.role === 'owner' ? 'administrador' : `plan ${u.plan}`} · desde {new Date(u.createdAt).toLocaleDateString('es-ES')}{u.disabled ? ' · desactivado' : ''}</span>
                {u.role !== 'owner' && <button className="btn small ghost" onClick={async () => { await call('admin/disable', { id: u.id, disabled: !u.disabled }); loadAdmin(); }}>{u.disabled ? 'Reactivar' : 'Desactivar'}</button>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
