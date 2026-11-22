import { useState } from 'react';
import { api } from '../api.js';

export default function ConnectorsModal({ connectors, services = {}, onClose }) {
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
