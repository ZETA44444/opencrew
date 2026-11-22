import { useState } from 'react';
import { api, serverMode } from '../api.js';

export default function ConnectorsModal({ connectors, services = {}, bots = [], onClose }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);

  const add = async () => {
    setErr('');
    setBusy('add');
    try {
      const c = await api.addConnector(form);
      if (c.status === 'error') setErr(c.lastError);
      else setForm(null);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };

  const [ghToken, setGhToken] = useState('');
  const [ghUser, setGhUser] = useState(null);
  const [ghErr, setGhErr] = useState('');
  const saveGithub = async (value) => {
    setGhErr(''); setGhUser(null);
    await api.saveKeys({ github: value });
    setGhToken('');
    if (value) {
      try { setGhUser(await api.githubWhoAmI()); } catch (e) { setGhErr(e.message); }
    }
  };
  const testGithub = async () => { setGhErr(''); try { setGhUser(await api.githubWhoAmI()); } catch (e) { setGhErr(e.message); } };

  const g = services.google || {};
  const [gErr, setGErr] = useState('');
  const [gBusy, setGBusy] = useState(false);
  const [gAdv, setGAdv] = useState(false);
  const [gClient, setGClient] = useState(g.clientId || '');
  const connectG = async () => {
    setGErr(''); setGBusy(true);
    try {
      const r = await api.connectGoogle();
      if (r.missing.length) setGErr(`Falta aceptar algún permiso (${r.missing.join(', ')}). Pulsa «Reconectar» y marca todas las casillas.`);
    } catch (e) {
      setGErr(/origin|redirect_uri|invalid_client|idpiframe/i.test(e.message) ? `${e.message}. Revisa que este sitio (${location.origin}) esté en «Orígenes de JavaScript autorizados» de tu Client ID.` : e.message);
    } finally { setGBusy(false); }
  };
  // Server with Google's secret: sign in once and it never expires (the server renews it).
  const connectPermanent = async () => {
    setGErr('');
    const w = window.open('', 'opencrew-google', 'width=520,height=700'); // open now, inside the click
    try {
      const url = await api.googleServerAuthUrl();
      if (w) w.location.href = url; else location.href = url;
    } catch (e) { w?.close(); setGErr(e.message); }
  };
  const toggleBot = (id, on) => {
    const all = bots.map((b) => b.id);
    const cur = g.botIds || all;
    const next = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
    api.updateGoogle({ botIds: next.length === all.length ? null : next });
  };

  const [nToken, setNToken] = useState('');
  const [nInfo, setNInfo] = useState('');
  const [nErr, setNErr] = useState('');
  const saveNotion = async (value) => {
    setNErr(''); setNInfo('');
    await api.saveKeys({ notion: value });
    setNToken('');
    if (value) { try { setNInfo(await api.notionWhoAmI()); } catch (e) { setNErr(e.message); } }
  };

  const refresh = async (id) => { setBusy(id); await api.refreshConnector(id); setBusy(''); };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <h3>Apps conectadas</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="modal-body">
          <p className="muted small" style={{ margin: 0 }}>
            Conecta servidores <b>MCP</b> (el estándar abierto de herramientas para IA) y <b>todos tus bots</b> podrán usar sus herramientas:
            buscar en Notion, crear issues, leer tu calendario… Pega la URL del servidor (transporte HTTP). Debe permitir conexiones desde el navegador (CORS).
          </p>

          <div className="section-title">Integradas</div>
          <div className="key-row">
            <div className="key-head">
              <strong>GitHub</strong>
              {services.github ? <span className="pill ok">conectado{ghUser ? ` como ${ghUser}` : ''}</span> : <span className="pill">sin token</span>}
              <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer" className="link small">Crear token ↗</a>
            </div>
            <div className="muted small">Tus bots podrán ver tus repos, issues, pull requests y archivos. Usa un token «fine-grained» solo con los repos y permisos que quieras darles.</div>
            <div className="key-input">
              <input type="password" autoComplete="off" placeholder={services.github ? '•••••••• (escribe para reemplazar)' : 'Pega tu token personal de GitHub'} value={ghToken} onChange={(e) => setGhToken(e.target.value)} />
              <button className="btn small" disabled={!ghToken} onClick={() => saveGithub(ghToken)}>Guardar</button>
              {services.github && <button className="btn small" onClick={testGithub}>Probar</button>}
              {services.github && <button className="btn small ghost" onClick={() => saveGithub('')}>Quitar</button>}
            </div>
            {services.github && (
              <label className="check small">
                <input type="checkbox" checked={!!services.githubWrite} onChange={(e) => api.updateSettings({ githubWrite: e.target.checked })} />
                Permitir que los bots escriban (crear issues y comentarios) cuando se lo pidas
              </label>
            )}
            {ghErr && <div className="small run-error">{ghErr}</div>}
          </div>

          <div className="key-row">
            <div className="key-head">
              <strong>Gmail y Google Calendar</strong>
              {g.connected ? (g.expired ? <span className="pill err">sesión caducada</span> : <span className="pill ok">conectado{g.email ? ` · ${g.email}` : ''}{g.permanent ? ' · sin caducar' : ''}</span>) : <span className="pill">sin conectar</span>}
            </div>
            <div className="muted small">
              Inicia sesión con Google y tus bots podrán buscar y leer tus correos y ver tu agenda.
              {g.serverOAuth ? ' Con tu servidor la sesión no caduca: tus vigilantes de Gmail funcionan 24/7.' : ' La sesión dura 1 hora; después pulsa «Reconectar».'}
            </div>
            <div className="card-actions">
              {g.serverOAuth
                ? <button className="btn small primary" onClick={connectPermanent}>{g.permanent ? 'Volver a conectar' : 'Conectar con Google (sin caducar)'}</button>
                : <button className="btn small primary" disabled={gBusy} onClick={connectG}>{gBusy ? 'Abriendo Google…' : g.connected ? 'Reconectar' : 'Conectar con Google'}</button>}
              {g.connected && <button className="btn small ghost" onClick={() => api.disconnectGoogle()}>Desconectar</button>}
              <button className="btn small ghost" onClick={() => setGAdv(!gAdv)}>{gAdv ? 'Ocultar opciones' : 'Opciones'}</button>
            </div>
            {g.connected && (
              <>
                <label className="check small">
                  <input type="checkbox" checked={!!g.write} onChange={(e) => api.updateGoogle({ write: e.target.checked })} />
                  Permitir enviar correos, guardar borradores y crear eventos (siempre te pedirán permiso antes)
                </label>
                <div className="small muted">Bots que pueden usar tu correo y tu agenda:</div>
                <div className="chip-checks">
                  {bots.map((b) => (
                    <label key={b.id} className="check small">
                      <input type="checkbox" checked={!g.botIds || g.botIds.includes(b.id)} onChange={(e) => toggleBot(b.id, e.target.checked)} /> {b.name}
                    </label>
                  ))}
                </div>
              </>
            )}
            {gAdv && (
              <label className="small">Client ID de Google propio (solo si usas OpenCrew en otra web)
                <div className="key-input">
                  <input placeholder="…apps.googleusercontent.com (vacío = el de OpenCrew)" value={gClient} onChange={(e) => setGClient(e.target.value)} />
                  <button className="btn small" onClick={() => api.updateGoogle({ clientId: gClient.trim() || undefined })}>Guardar</button>
                </div>
              </label>
            )}
            {serverMode && !g.serverOAuth && (
              <details className="small muted">
                <summary>¿Quieres que no caduque cada hora?</summary>
                Tu servidor puede renovar la sesión solo. Hace falta añadir el secreto de tu cliente de Google al servidor (te lo explica el asistente de OpenCrew paso a paso).
              </details>
            )}
            {gErr && <div className="small run-error">{gErr}</div>}
          </div>

          <div className="key-row">
            <div className="key-head">
              <strong>Notion</strong>
              {!serverMode ? <span className="pill">necesita tu servidor</span> : services.notion ? <span className="pill ok">conectado{nInfo ? ` · ${nInfo}` : ''}</span> : <span className="pill">sin token</span>}
              {serverMode && <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer" className="link small">Crear integración ↗</a>}
            </div>
            {!serverMode ? (
              <div className="muted small">Notion no deja conectarse desde el navegador. Conecta tu servidor en Ajustes → Servidor y podrás usarlo aquí.</div>
            ) : (
              <>
                <div className="muted small">
                  Crea una integración interna en Notion, copia su token y pégalo aquí. Después, en cada página que quieras que vean tus bots: <b>··· → Conexiones → tu integración</b>.
                </div>
                <div className="key-input">
                  <input type="password" autoComplete="off" placeholder={services.notion ? '•••••••• (escribe para reemplazar)' : 'Token de la integración (ntn_…)'} value={nToken} onChange={(e) => setNToken(e.target.value)} />
                  <button className="btn small" disabled={!nToken} onClick={() => saveNotion(nToken)}>Guardar</button>
                  {services.notion && <button className="btn small" onClick={async () => { setNErr(''); try { setNInfo(await api.notionWhoAmI()); } catch (e) { setNErr(e.message); } }}>Probar</button>}
                  {services.notion && <button className="btn small ghost" onClick={() => saveNotion('')}>Quitar</button>}
                </div>
                {services.notion && (
                  <label className="check small">
                    <input type="checkbox" checked={!!services.notionWrite} onChange={(e) => api.updateSettings({ notionWrite: e.target.checked })} />
                    Permitir crear páginas y añadir contenido (siempre te pedirán permiso antes)
                  </label>
                )}
              </>
            )}
            {nErr && <div className="small run-error">{nErr}</div>}
          </div>

          <div className="section-title">Servidores MCP</div>
          {connectors.length === 0 && !form && <div className="empty-skills muted">Aún no hay servidores MCP conectados.</div>}

          {connectors.map((c) => (
            <div key={c.id} className="key-row">
              <div className="key-head">
                <strong>{c.name}</strong>
                {c.status === 'ok' ? <span className="pill ok">{c.tools.length} herramientas</span> : <span className="pill err">error</span>}
                <label className="switch" style={{ marginLeft: 'auto' }} title={c.enabled ? 'Activa' : 'Desactivada'}>
                  <input type="checkbox" checked={c.enabled} onChange={(e) => api.updateConnector(c.id, { enabled: e.target.checked })} />
                  <span />
                </label>
              </div>
              <div className="muted small conn-url">{c.url}{c.server ? ` · ${c.server}` : ''}{c.hasToken ? ' · con token' : ''}</div>
              {c.lastError && <div className="small run-error">{c.lastError}</div>}
              {open === c.id && c.tools.length > 0 && (
                <div className="conn-tools">
                  {c.tools.map((t) => <div key={t.name}><code>{t.name}</code> <span className="muted small">{t.description}</span></div>)}
                </div>
              )}
              <div className="card-actions">
                {c.tools.length > 0 && <button className="btn small ghost" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Ocultar herramientas' : 'Ver herramientas'}</button>}
                <button className="btn small" disabled={busy === c.id} onClick={() => refresh(c.id)}>{busy === c.id ? 'Conectando…' : 'Reconectar'}</button>
                <button className="btn small ghost danger" onClick={() => confirm(`¿Quitar ${c.name}?`) && api.removeConnector(c.id)}>Quitar</button>
              </div>
            </div>
          ))}

          {form && (
            <div className="key-row">
              <div className="grid2">
                <label>Nombre<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Notion" autoFocus /></label>
                <label>Token (opcional)<input type="password" autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="Si el servidor lo pide" /></label>
              </div>
              <label>URL del servidor MCP<input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://mi-servidor.com/mcp" /></label>
              {err && <div className="banner error small">{err}</div>}
              <div className="card-actions">
                <button className="btn small primary" disabled={!form.url || busy === 'add'} onClick={add}>{busy === 'add' ? 'Conectando…' : 'Conectar'}</button>
                <button className="btn small ghost" onClick={() => { setForm(null); setErr(''); }}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
          {!form && <button className="btn primary" onClick={() => setForm({ name: '', url: '', token: '' })}>+ Conectar app</button>}
        </div>
      </div>
    </div>
  );
}
