import { useState } from 'react';
import { api, serverMode } from '../api.js';

// Gateways: one address that gives your bots hundreds of apps (you connect the apps on the gateway's website).
const GATEWAYS = {
  zapier: {
    label: 'Zapier', blurb: '+8.000 apps. Tú eliges qué acciones pueden usar tus bots (p. ej. «Slack: enviar mensaje»).',
    link: 'https://mcp.zapier.com', linkLabel: 'Abrir Zapier MCP',
    steps: [
      'Entra en mcp.zapier.com con tu cuenta de Zapier y crea un servidor MCP nuevo (cliente: «Other» u otro genérico).',
      'Añade las herramientas que quieras darles, por ejemplo «Slack: Send Channel Message» o «Google Sheets: Find Row», y conecta allí tus cuentas.',
      'En la pestaña «Connect», copia la dirección del servidor (empieza por https://mcp.zapier.com/) y, si te da un token aparte, cópialo también.',
    ],
    urlHint: 'https://mcp.zapier.com/api/…', header: 'authorization', tokenLabel: 'Token (si Zapier te da uno aparte)',
  },
  composio: {
    label: 'Composio', blurb: '+800 apps con inicio de sesión gestionado (Gmail, Slack, HubSpot, Notion, Linear…).',
    link: 'https://platform.composio.dev', linkLabel: 'Abrir Composio',
    steps: [
      'Crea una cuenta en platform.composio.dev.',
      'Conecta las apps que quieras (inicias sesión en cada una desde Composio) y crea un servidor MCP con ellas.',
      'Copia la dirección MCP que te da y tu clave de API (Settings → API Keys).',
    ],
    urlHint: 'https://…composio.dev/…', header: 'x-api-key', tokenLabel: 'Clave de API de Composio',
  },
  other: {
    label: 'Otra pasarela o servidor MCP', blurb: 'Rube, Pipedream, Klavis o el servidor MCP oficial de una app.',
    steps: ['Copia la dirección MCP (transporte HTTP) y, si la pide, su clave y el nombre de la cabecera donde va.'],
    urlHint: 'https://ejemplo.com/mcp', header: 'authorization', tokenLabel: 'Clave o token (opcional)', custom: true,
  },
};
const headerFor = (gw, url) => (gw === 'composio' && /connect\.composio\.dev/.test(url) ? 'x-consumer-api-key' : GATEWAYS[gw]?.header || 'authorization');
const MANY = 40;

export default function GatewayConnectors({ connectors, bots }) {
  const [pick, setPick] = useState(null); // gateway being connected
  const [form, setForm] = useState({ name: '', url: '', token: '', headerName: '' });
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState('');

  const start = (gw) => { setPick(gw); setErr(''); setForm({ name: gw === 'other' ? '' : GATEWAYS[gw].label, url: '', token: '', headerName: '' }); };
  const add = async () => {
    setErr(''); setBusy('add');
    try {
      const headerName = form.headerName.trim() || headerFor(pick, form.url);
      const c = await api.addConnector({ name: form.name || GATEWAYS[pick].label, url: form.url.trim(), token: form.token.trim(), headerName, gateway: pick });
      if (c.status === 'error') setErr(c.lastError); else { setPick(null); setOpen(c.id); }
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const refresh = async (id) => { setBusy(id); await api.refreshConnector(id); setBusy(''); };
  const toggleBot = (c, id, on) => {
    const all = bots.map((b) => b.id);
    const cur = c.botIds || all;
    const next = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
    api.updateConnector(c.id, { botIds: next.length === all.length ? null : next });
  };
  const toggleTool = (c, name, on) => {
    const off = new Set(c.disabledTools || []);
    if (on) off.delete(name); else off.add(name);
    api.updateConnector(c.id, { disabledTools: [...off] });
  };
  const setAllTools = (c, on) => api.updateConnector(c.id, { disabledTools: on ? [] : c.tools.map((t) => t.name) });

  return (
    <>
      <div className="section-title">Pasarelas y servidores MCP</div>
      <p className="muted small" style={{ margin: 0 }}>
        Una pasarela te da <b>una sola dirección</b> con cientos de apps (Slack, Trello, Shopify, HubSpot, WhatsApp…): conectas tus cuentas en su web y pegas aquí la dirección.
        {!serverMode && ' Consejo: con tu servidor de OpenCrew conectado funcionan todas; desde el navegador algunas no dejan conectarse.'}
      </p>

      {connectors.map((c) => {
        const on = c.tools.filter((t) => !(c.disabledTools || []).includes(t.name));
        const shown = c.tools.filter((t) => !filter || `${t.name} ${t.description}`.toLowerCase().includes(filter.toLowerCase()));
        return (
          <div key={c.id} className="key-row">
            <div className="key-head">
              <strong>{c.name}</strong>
              {c.gateway && c.gateway !== 'other' && <span className="pill">{GATEWAYS[c.gateway]?.label}</span>}
              {c.status === 'ok' ? <span className="pill ok">{on.length} de {c.tools.length} herramientas</span> : <span className="pill err">error</span>}
              <label className="switch" style={{ marginLeft: 'auto' }} title={c.enabled ? 'Activa' : 'Desactivada'}>
                <input type="checkbox" checked={c.enabled} onChange={(e) => api.updateConnector(c.id, { enabled: e.target.checked })} />
                <span />
              </label>
            </div>
            <div className="muted small conn-url">{c.url.replace(/(\/s\/|\/a\/)[^/]+/, '$1•••')}{c.server ? ` · ${c.server}` : ''}{c.hasToken ? ` · con clave (${c.headerName || 'authorization'})` : ''}</div>
            {c.lastError && <div className="small run-error">{c.lastError}</div>}
            {on.length > MANY && <div className="small muted">⚠️ Muchas herramientas activas: cada mensaje gasta más y el bot elige peor. Desactiva las que no uses.</div>}
            {open === c.id && (
              <div className="conn-detail">
                <div className="small muted">Bots que pueden usarla:</div>
                <div className="chip-checks">
                  {bots.map((b) => (
                    <label key={b.id} className="check small">
                      <input type="checkbox" checked={!c.botIds || c.botIds.includes(b.id)} onChange={(e) => toggleBot(c, b.id, e.target.checked)} /> {b.name}
                    </label>
                  ))}
                </div>
                {c.tools.length > 0 && (
                  <>
                    <div className="card-row">
                      <span className="small muted">Herramientas (las que escriben o envían piden tu permiso):</span>
                      <span className="spacer" />
                      <button className="link small" onClick={() => setAllTools(c, true)}>todas</button>
                      <button className="link small" onClick={() => setAllTools(c, false)}>ninguna</button>
                    </div>
                    {c.tools.length > 12 && <input placeholder="Buscar herramienta…" value={filter} onChange={(e) => setFilter(e.target.value)} />}
                    <div className="conn-tools">
                      {shown.slice(0, 300).map((t) => (
                        <label key={t.name} className="check small tool-check">
                          <input type="checkbox" checked={!(c.disabledTools || []).includes(t.name)} onChange={(e) => toggleTool(c, t.name, e.target.checked)} />
                          <span><code>{t.name}</code> <span className="muted">{t.description.slice(0, 140)}</span></span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="card-actions">
              <button className="btn small ghost" onClick={() => { setOpen(open === c.id ? null : c.id); setFilter(''); }}>{open === c.id ? 'Cerrar opciones' : 'Bots y herramientas'}</button>
              <button className="btn small" disabled={busy === c.id} onClick={() => refresh(c.id)}>{busy === c.id ? 'Conectando…' : 'Actualizar'}</button>
              <button className="btn small ghost danger" onClick={() => confirm(`¿Quitar ${c.name}?`) && api.removeConnector(c.id)}>Quitar</button>
            </div>
          </div>
        );
      })}

      {!pick && (
        <div className="gateway-grid">
          {Object.entries(GATEWAYS).map(([id, g]) => (
            <button key={id} className="gateway-card" onClick={() => start(id)}>
              <strong>{g.label}</strong>
              <span className="muted small">{g.blurb}</span>
            </button>
          ))}
        </div>
      )}

      {pick && (
        <div className="key-row">
          <div className="key-head">
            <strong>Conectar {GATEWAYS[pick].label}</strong>
            {GATEWAYS[pick].link && <a href={GATEWAYS[pick].link} target="_blank" rel="noreferrer" className="link small">{GATEWAYS[pick].linkLabel} ↗</a>}
          </div>
          <ol className="small muted gateway-steps">{GATEWAYS[pick].steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <div className="grid2">
            <label>Nombre<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Slack y Trello" /></label>
            <label>{GATEWAYS[pick].tokenLabel}<input type="password" autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} /></label>
          </div>
          <label>Dirección MCP<input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={GATEWAYS[pick].urlHint} autoFocus /></label>
          {GATEWAYS[pick].custom && (
            <label>Cabecera de la clave<input value={form.headerName} onChange={(e) => setForm({ ...form, headerName: e.target.value })} placeholder="Authorization (o x-api-key…)" /></label>
          )}
          <div className="muted small">La dirección y la clave dan acceso a tus apps: se guardan {serverMode ? 'solo en tu servidor' : 'solo en este navegador'}.</div>
          {err && <div className="banner error small">{err}</div>}
          <div className="card-actions">
            <button className="btn small primary" disabled={!form.url.trim() || busy === 'add'} onClick={add}>{busy === 'add' ? 'Conectando…' : 'Conectar'}</button>
            <button className="btn small ghost" onClick={() => { setPick(null); setErr(''); }}>Cancelar</button>
          </div>
        </div>
      )}
    </>
  );
}
