import { useEffect, useState } from 'react';
import { hostedInfo } from '../remote.js';
import { askText } from '../dialog.jsx';

// Ajustes → Cuenta (server with accounts): who you are, password, sign out; the owner also
// manages invitations and users.
const call = async (path, data) => {
  const r = await fetch(`./api/${path}`, { method: data ? 'POST' : 'GET', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-opencrew': '1' }, body: data ? JSON.stringify(data) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
};

const money = (n) => (n == null ? '∞' : `${Number(n).toFixed(2).replace('.', ',')} €`);
const PLAN_OPTIONS = [['trial', 'Prueba'], ['pro', 'Pro'], ['founder', 'Fundador'], ['free', 'Gratis (sus claves)']];

// Your plan: what's included and how much AI credit is left (OpenCrew's own AI, charged at cost).
function PlanBox({ plan }) {
  const total = plan.creditsEur || 0;
  const pct = total ? Math.min(100, (plan.usedEur / total) * 100) : 0;
  const days = plan.trialEnds ? Math.max(0, Math.ceil((plan.trialEnds - Date.now()) / 864e5)) : null;
  const l = plan.limits || {};
  return (
    <>
      <div className="section-title">Tu plan</div>
      <div className="key-row">
        <div className="key-head"><strong>{plan.label}</strong>{days != null && <span className="pill">{days} {days === 1 ? 'día' : 'días'} de prueba</span>}</div>
        {total > 0 ? (
          <div className="quota">
            <div className="quota-head"><span>Créditos de IA {plan.plan === 'trial' ? 'de la prueba' : 'de este mes'}</span><b>{money(plan.remainingEur)} de {money(total)}</b></div>
            <div className="quota-bar"><div className={pct >= 100 ? 'hot' : pct >= 80 ? 'warm' : ''} style={{ width: `${pct}%` }} /></div>
          </div>
        ) : <div className="muted small">Tu plan no incluye IA de OpenCrew: usa tus propias claves de API (Ajustes → Modelos).</div>}
        <div className="muted small">
          Incluye: {l.bots == null ? 'bots ilimitados' : `hasta ${l.bots} bots`} · {l.routines == null ? 'rutinas ilimitadas' : `${l.routines} rutinas`} · {l.watchers == null ? 'vigilantes ilimitados' : `${l.watchers} vigilantes`} · {l.computerHours ? `ordenador de bot (${l.computerHours} h/mes)` : 'sin ordenador de bot'}.
          Tus propias claves funcionan siempre y no gastan créditos.
        </div>
      </div>
    </>
  );
}

// Administrator: how the service is going (beta metrics).
function AdminStats({ s }) {
  const max = Math.max(1, ...s.days.map((d) => d.signups));
  const PLAN = { trial: 'Prueba', pro: 'Pro', founder: 'Fundador', free: 'Gratis' };
  return (
    <>
      <div className="section-title">Cómo va OpenCrew</div>
      {s.health ? (
        <div className={`banner small ${s.health.ok && Date.now() - s.health.at < 15 * 60_000 ? '' : 'error'}`}>
          {Date.now() - s.health.at > 15 * 60_000 ? '⚠️ La comprobación del servidor no se ejecuta desde ' + new Date(s.health.at).toLocaleString('es-ES')
            : s.health.ok ? `✅ Servidor bien · disco ${s.health.disk} % · memoria libre ${s.health.memFreeMb} MB · ${s.health.engines} espacios y ${s.health.computers} ordenadores encendidos`
              : `⚠️ ${s.health.problems}`}
        </div>
      ) : <div className="muted small">La comprobación del servidor aún no ha dado datos.</div>}
      <div className="usage-totals">
        <div><span className="muted small">Usuarios</span><b>{s.users}</b></div>
        <div><span className="muted small">Activos 7 días</span><b>{s.active7}</b></div>
        <div><span className="muted small">Ingresos/mes (netos aprox.)</span><b>{money(s.revenueNetEur)}</b></div>
        <div><span className="muted small">Coste de IA este mes</span><b>{money(s.aiCostEur)}</b></div>
      </div>
      <div className="muted small">
        {Object.entries(s.byPlan).map(([p, n]) => `${PLAN[p] || p}: ${n}`).join(' · ') || 'Aún no hay usuarios'} · activos hoy: {s.active1} · espacios dormidos: {s.sleeping} · llamadas de IA este mes: {s.aiCalls}
      </div>
      <div className="signup-bars" title="Altas por día (últimos 30 días)">
        {s.days.map((d) => <span key={d.day} title={`${d.day}: ${d.signups}`} style={{ height: `${Math.max(4, (d.signups / max) * 100)}%`, opacity: d.signups ? 1 : 0.25 }} />)}
      </div>
      <div className="muted small">Altas por día, últimos 30 días.</div>
    </>
  );
}

export default function AccountSection() {
  const me = hostedInfo()?.user;
  const [pw, setPw] = useState(null); // { current, password }
  const [msg, setMsg] = useState('');
  const [admin, setAdmin] = useState(null);
  const [invite, setInvite] = useState(null);
  const [note, setNote] = useState('');
  const [del, setDel] = useState(null); // { password, confirm }
  const [plan, setPlan] = useState(null);
  const [stats, setStats] = useState(null);
  const loadAdmin = () => { call('admin/users').then(setAdmin).catch(() => {}); call('admin/stats').then(setStats).catch(() => {}); };
  useEffect(() => { if (me?.role === 'owner') loadAdmin(); call('account/plan').then(setPlan).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
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

      {plan && plan.plan !== 'owner' && <PlanBox plan={plan} />}

      <div className="section-title">Tus datos</div>
      <div className="muted small">Descarga una copia de todo lo tuyo (bots, chats, memoria, archivos, rutinas…) en un archivo. Tus claves de API no se incluyen.</div>
      <div className="settings-actions">
        <a className="btn small" href="./api/account/export" download>Descargar todos mis datos</a>
        {me.role !== 'owner' && !del && <button className="btn small ghost danger" onClick={() => setDel({ password: '', confirm: '' })}>Borrar mi cuenta…</button>}
      </div>
      {del && (
        <div className="key-row">
          <div className="small"><b>Esto borra para siempre</b> tu cuenta, tus bots, chats, memoria, archivos, claves y los ordenadores de tus bots. No se puede deshacer: descarga antes tus datos si los quieres.</div>
          <div className="grid2">
            <label>Tu contraseña<input type="password" autoComplete="current-password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} /></label>
            <label>Escribe BORRAR<input value={del.confirm} onChange={(e) => setDel({ ...del, confirm: e.target.value })} /></label>
          </div>
          <div className="card-actions">
            <button className="btn small danger" disabled={del.confirm !== 'BORRAR' || !del.password} onClick={async () => { try { await call('account/delete', del); location.reload(); } catch (e) { setMsg(e.message); } }}>Borrar mi cuenta para siempre</button>
            <button className="btn small ghost" onClick={() => setDel(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {me.role === 'owner' && admin && (
        <>
          {stats && <AdminStats s={stats} />}
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
                <span><b>{u.email}</b> · {u.role === 'owner' ? 'administrador' : u.planView?.label || u.plan} · desde {new Date(u.createdAt).toLocaleDateString('es-ES')}{u.disabled ? ' · desactivado' : ''}
                  {u.role !== 'owner' && <span className="muted small"> · IA este mes: {money(u.aiCostEur)}{u.planView?.remainingEur != null ? ` · le quedan ${money(u.planView.remainingEur)}` : ''}</span>}</span>
                {u.role !== 'owner' && <span className="row-actions">
                  <select className="small-select" value={u.plan} onChange={async (e) => { await call('admin/plan', { id: u.id, plan: e.target.value }); loadAdmin(); }}>
                    {PLAN_OPTIONS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
                  </select>
                  <button className="btn small ghost" onClick={async () => { const v = await askText(`¿Cuántos euros de créditos de IA añades a ${u.email}?`, { placeholder: '5' }); if (v && Number(v) > 0) { await call('admin/plan', { id: u.id, topupEur: Number(v) }); loadAdmin(); } }}>+ Créditos</button>
                  <button className="btn small ghost" onClick={async () => { await call('admin/disable', { id: u.id, disabled: !u.disabled }); loadAdmin(); }}>{u.disabled ? 'Reactivar' : 'Desactivar'}</button>
                  <button className="btn small ghost danger" onClick={async () => { if (await askText(`Para borrar ${u.email} y todos sus datos, escribe BORRAR`, { expect: 'BORRAR', okLabel: 'Borrar' }) !== 'BORRAR') return; await call('admin/delete', { id: u.id }); loadAdmin(); }}>Borrar</button>
                </span>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
