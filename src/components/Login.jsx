import { useState } from 'react';

// Sign-in screen of an OpenCrew server with accounts: create the administrator (first time, with
// the setup code from the server), sign in, or sign up with an invitation.
const post = async (path, data) => {
  const r = await fetch(`./api/auth/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-opencrew': '1' }, body: JSON.stringify(data) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
};

export default function Login({ state }) {
  const invite = new URLSearchParams(location.search).get('invitacion') || '';
  const [mode, setMode] = useState(state.needsTerms ? 'terms' : state.setupNeeded ? 'setup' : invite ? 'signup' : 'login');
  const [f, setF] = useState({ email: '', password: '', password2: '', code: '', invite, accept: false });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (mode !== 'login' && mode !== 'terms' && f.password !== f.password2) { setErr('Las contraseñas no coinciden'); return; }
    setBusy(true);
    try {
      if (mode === 'terms') await post('accept', { accept: f.accept });
      else if (mode === 'setup') await post('setup', { code: f.code, email: f.email, password: f.password, accept: f.accept });
      else if (mode === 'signup') await post('signup', { invite: f.invite, email: f.email, password: f.password, accept: f.accept });
      else await post('login', { email: f.email, password: f.password });
      location.href = location.pathname; // fresh start, without the invitation in the address
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };

  const title = { setup: 'Crea la cuenta de administrador', signup: 'Crea tu cuenta', login: 'Entra en OpenCrew', terms: 'Han cambiado las condiciones' }[mode];
  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">◆ OpenCrew</div>
        <h1>{title}</h1>
        {mode === 'setup' && <p className="muted small">Es la primera vez que se abre este servidor. Para que nadie más pueda quedarse con él, hace falta el código de configuración que está en el servidor.</p>}
        {mode === 'signup' && <p className="muted small">Tu equipo de bots con IA, trabajando para ti. Tus datos se guardan cifrados y separados de los de los demás.</p>}
        {mode === 'setup' && <label>Código de configuración<input value={f.code} onChange={set('code')} autoComplete="off" required /></label>}
        {mode === 'signup' && !invite && <label>Código de invitación<input value={f.invite} onChange={set('invite')} required /></label>}
        {mode === 'terms' && <p className="muted small">Hemos actualizado las condiciones, la privacidad o el uso aceptable. Léelas y acéptalas para seguir usando OpenCrew; tus bots y datos siguen igual.</p>}
        {mode !== 'terms' && <label>Correo<input type="email" value={f.email} onChange={set('email')} autoComplete="email" required autoFocus={mode !== 'setup'} /></label>}
        {mode !== 'terms' && <label>Contraseña<input type="password" value={f.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 10} required /></label>}
        {mode !== 'login' && mode !== 'terms' && <label>Repite la contraseña<input type="password" value={f.password2} onChange={set('password2')} autoComplete="new-password" minLength={10} required /></label>}
        {mode !== 'login' && mode !== 'terms' && <p className="muted small">Al menos 10 caracteres. Mejor una frase que una palabra.</p>}
        {mode !== 'login' && (
          <label className="check small">
            <input type="checkbox" checked={f.accept} onChange={(e) => setF({ ...f, accept: e.target.checked })} required />
            <span>Tengo 18 años o más y acepto las <a className="link" href="./legal/condiciones.html" target="_blank" rel="noreferrer">Condiciones</a>, la <a className="link" href="./legal/privacidad.html" target="_blank" rel="noreferrer">Privacidad</a> y el <a className="link" href="./legal/uso-aceptable.html" target="_blank" rel="noreferrer">Uso aceptable</a>.</span>
          </label>
        )}
        <p className="muted small login-ai">OpenCrew es un equipo de bots de <b>inteligencia artificial</b>: no son personas y pueden equivocarse.</p>
        {err && <div className="banner error small">{err}</div>}
        <button className="btn primary full" disabled={busy}>{busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : mode === 'terms' ? 'Aceptar y seguir' : 'Crear cuenta'}</button>
        {!state.setupNeeded && mode !== 'terms' && (
          <div className="login-switch small">
            {mode === 'login' ? <button type="button" className="link" onClick={() => setMode('signup')}>Tengo una invitación</button>
              : <button type="button" className="link" onClick={() => setMode('login')}>Ya tengo cuenta</button>}
          </div>
        )}
      </form>
    </div>
  );
}
