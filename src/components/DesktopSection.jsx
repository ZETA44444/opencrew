import { useEffect, useState } from 'react';
import { api, serverMode } from '../api.js';
import { remoteConfig } from '../remote.js';
import { ask } from '../dialog.jsx';

// Apps conectadas → Tu ordenador: pair the OpenCrew Escritorio app (files and terminal of your Mac).
export default function DesktopSection() {
  const [st, setSt] = useState(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState('');
  const load = () => api.desktopStatus().then(setSt).catch(() => setSt(null));
  useEffect(() => { if (!serverMode) return undefined; load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);
  const copy = (what, text) => navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1500); });
  const server = remoteConfig()?.url || '';
  const folders = st?.info?.folders || [];

  return (
    <div className="key-row">
      <div className="key-head">
        <strong>Tu ordenador (app OpenCrew Escritorio)</strong><span className="pill" title="Se instala a mano; versión de prueba">beta</span>
        {!serverMode ? <span className="pill">necesita tu servidor</span>
          : st?.connected ? <span className="pill ok">conectado · {st.info?.browser}</span>
          : st?.paired ? <span className="pill">emparejado · desconectado</span> : <span className="pill">sin emparejar</span>}
      </div>
      {!serverMode ? <div className="muted small">Conecta tu servidor (Ajustes → Servidor) para usarla.</div> : (
        <>
          <div className="muted small">
            Tus bots podrán leer, buscar y (si quieres) guardar archivos en las <b>carpetas que elijas</b> de tu Mac, y usar la terminal solo si la activas.
            Tú decides qué bots usan cada carpeta, y cada acción te la piden aquí. Actívalo en cada bot: «Puede usar mi ordenador».
          </div>
          {st?.connected && (
            <div className="muted small">Carpetas compartidas: {folders.length ? folders.map((f) => `${f.name} (${f.write ? 'lectura y escritura' : 'solo lectura'})`).join(', ') : 'ninguna todavía (añádelas en la app)'} · Terminal: {st.info?.terminal ? 'activada' : 'desactivada'}.</div>
          )}
          <ol className="small muted gateway-steps">
            <li><a className="link" href="./opencrew-escritorio.zip" download>Descarga OpenCrew Escritorio</a> (Mac, necesita Node.js 22+) y descomprímelo.</li>
            <li>Doble clic en <code>instalar.command</code> (si macOS no te deja: clic derecho → Abrir). Se abrirá su página de ajustes.</li>
            <li>Pega la dirección del servidor y el código de emparejamiento, y añade las carpetas que quieras compartir.</li>
          </ol>
          <div className="hook-url"><code>{server}</code><button className="btn small" onClick={() => copy('url', server)}>{copied === 'url' ? '✓' : 'Copiar dirección'}</button></div>
          {code && <div className="hook-url"><code>{code}</code><button className="btn small" onClick={() => copy('code', code)}>{copied === 'code' ? '✓ Copiado' : 'Copiar código'}</button></div>}
          {code && <div className="muted small">Guárdalo ya: por seguridad no se vuelve a mostrar.</div>}
          <div className="card-actions">
            <button className="btn small primary" onClick={async () => { if (st?.paired && !await ask('Se creará un código nuevo y la app emparejada dejará de funcionar hasta que lo pegues. ¿Seguir?')) return; const r = await api.desktopPair(); setCode(r.key); load(); }}>{st?.paired ? 'Nuevo código' : 'Emparejar mi ordenador'}</button>
            {st?.paired && <button className="btn small ghost" onClick={async () => { if (!await ask('¿Desconectar tu ordenador? Los bots dejarán de poder usar tus archivos.')) return; await api.desktopRevoke(); setCode(''); load(); }}>Revocar</button>}
          </div>
        </>
      )}
    </div>
  );
}
