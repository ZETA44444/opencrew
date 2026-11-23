import { useState } from 'react';
import { localApi } from '../localApi.js';
import { remoteConfig, setRemoteConfig, testServer, rpc, normalizeUrl, hostedInfo } from '../remote.js';
import AccountSection from './AccountSection.jsx';
import { ask } from '../dialog.jsx';

// Ajustes → Servidor: connect this app to your own OpenCrew server (bots keep working 24/7).
export default function ServerSection() {
  if (hostedInfo()) return <AccountSection />; // server with accounts: show the account instead
  const current = remoteConfig();
  const [url, setUrl] = useState(current?.url || '');
  const [token, setToken] = useState('');
  const [info, setInfo] = useState(null);
  const [upload, setUpload] = useState(true);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const test = async () => {
    setErr(''); setInfo(null); setBusy('test');
    try {
      const i = await testServer({ url, token });
      setInfo(i);
      setUpload(!!i.fresh);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };

  const connect = async () => {
    setErr(''); setBusy('connect');
    const conf = { url: normalizeUrl(url), token: token.trim() };
    try {
      if (upload) {
        if (!info?.fresh && !await ask('El servidor ya tiene datos. Si subes los de este navegador, se reemplazarán. ¿Seguir?')) { setBusy(''); return; }
        await rpc('importData', [await localApi.exportData({ includeKeys: true })], conf);
      }
      setRemoteConfig(conf);
      location.reload();
    } catch (e) { setErr(e.message); setBusy(''); }
  };

  const disconnect = async () => {
    if (!await ask('La app volverá a usar los datos guardados en este navegador. Tu servidor sigue funcionando con los suyos. ¿Desconectar?')) return;
    setRemoteConfig(null);
    location.reload();
  };

  if (current) {
    return (
      <>
        <div className="section-title">Servidor</div>
        <div className="muted small">
          ☁️ Conectado a <b>{current.url}</b>. Tus bots, claves, chats, rutinas y vigilantes viven en tu servidor y siguen funcionando aunque cierres esta pestaña.
          Este navegador solo muestra y envía.
        </div>
        <div className="settings-actions">
          <button className="btn small ghost" onClick={disconnect}>Desconectar</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="section-title">Servidor</div>
      <div className="muted small">
        Conecta tu propio servidor de OpenCrew y tus bots trabajarán 24/7 (rutinas y vigilantes aunque cierres el navegador),
        con tus datos en un solo sitio para todos tus dispositivos.
      </div>
      <div className="grid2">
        <label>Dirección<input placeholder="https://tu-servidor" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        <label>Token de acceso<input type="password" autoComplete="off" placeholder="El token de tu servidor" value={token} onChange={(e) => setToken(e.target.value)} /></label>
      </div>
      <div className="settings-actions">
        <button className="btn small" disabled={!url || !token || !!busy} onClick={test}>{busy === 'test' ? 'Probando…' : 'Probar'}</button>
      </div>
      {info && (
        <div className="key-row">
          <div className="small">✓ Servidor OpenCrew {info.version} · {info.bots} bots · {info.fresh ? 'recién instalado' : `${info.messages} mensajes guardados`}</div>
          <label className="check small">
            <input type="checkbox" checked={upload} onChange={(e) => setUpload(e.target.checked)} />
            Subir al servidor los bots, chats, rutinas y API keys de este navegador {info.fresh ? '' : '(reemplaza lo que tiene)'}
          </label>
          <div className="card-actions">
            <button className="btn small primary" disabled={!!busy} onClick={connect}>{busy === 'connect' ? 'Conectando…' : 'Conectar'}</button>
          </div>
        </div>
      )}
      {err && <div className="small run-error">{err}</div>}
    </>
  );
}
