import { useEffect, useState } from 'react';
import { api, serverMode } from '../api.js';
import { remoteConfig } from '../remote.js';
import { ask } from '../dialog.jsx';

// Apps conectadas → Tu navegador: pair the OpenCrew extension with your server.
export default function ExtensionSection() {
  const [st, setSt] = useState(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState('');
  const load = () => api.extensionStatus().then(setSt).catch(() => setSt(null));
  useEffect(() => { if (!serverMode) return undefined; load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);
  const copy = (what, text) => navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1500); });
  const server = remoteConfig()?.url || '';

  return (
    <div className="key-row">
      <div className="key-head">
        <strong>Tu navegador (extensión de OpenCrew)</strong>
        {!serverMode ? <span className="pill">necesita tu servidor</span>
          : st?.connected ? <span className="pill ok">conectado · {st.info?.browser}</span>
          : st?.paired ? <span className="pill">emparejado · desconectado</span> : <span className="pill">sin emparejar</span>}
      </div>
      {!serverMode ? <div className="muted small">Conecta tu servidor (Ajustes → Servidor) para usarla.</div> : (
        <>
          <div className="muted small">
            Tus bots podrán leer tus pestañas, abrir webs, hacer clic y escribir <b>pidiéndote permiso en cada acción</b>. Nunca escriben contraseñas ni datos de tarjeta, y puedes prohibir webs (bancos y pagos vienen bloqueados).
            Actívalo en cada bot: «Puede usar mi navegador».
          </div>
          <ol className="small muted gateway-steps">
            <li><a className="link" href="./opencrew-extension.zip" download>Descarga la extensión</a> y descomprímela.</li>
            <li>En Chrome o Brave abre <code>chrome://extensions</code> (o <code>brave://extensions</code>), activa el «Modo de desarrollador» y pulsa «Cargar descomprimida» → elige la carpeta.</li>
            <li>Pulsa el icono de OpenCrew en la barra y pega la dirección del servidor y el código de emparejamiento.</li>
          </ol>
          <div className="hook-url"><code>{server}</code><button className="btn small" onClick={() => copy('url', server)}>{copied === 'url' ? '✓' : 'Copiar dirección'}</button></div>
          {code && (
            <div className="hook-url"><code>{code}</code><button className="btn small" onClick={() => copy('code', code)}>{copied === 'code' ? '✓ Copiado' : 'Copiar código'}</button></div>
          )}
          {code && <div className="muted small">Guárdalo ya: por seguridad no se vuelve a mostrar.</div>}
          <div className="card-actions">
            <button className="btn small primary" onClick={async () => { if (st?.paired && !await ask('Se creará un código nuevo y la extensión que esté emparejada dejará de funcionar hasta que lo pegues. ¿Seguir?')) return; const r = await api.extensionPair(); setCode(r.key); load(); }}>{st?.paired ? 'Nuevo código' : 'Emparejar mi navegador'}</button>
            {st?.paired && <button className="btn small ghost" onClick={async () => { if (!await ask('¿Desconectar la extensión? Los bots dejarán de poder usar tu navegador.')) return; await api.extensionRevoke(); setCode(''); load(); }}>Revocar</button>}
          </div>
        </>
      )}
    </div>
  );
}
