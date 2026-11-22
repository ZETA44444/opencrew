import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function SettingsModal({ providers, settings, onClose, onSaved }) {
  const [keys, setKeys] = useState({});
  const [list, setList] = useState(providers);
  const [tests, setTests] = useState({});
  const [saving, setSaving] = useState(false);
  const [webReader, setWebReader] = useState(settings?.webReader !== false);
  const [proactive, setProactive] = useState(settings?.proactive !== false);
  const [notif, setNotif] = useState(settings?.notifications || { routines: true, replies: true });
  const [perm, setPerm] = useState(api.notifyPermission());
  const setNotifOpt = (k, v) => { const n = { ...notif, [k]: v }; setNotif(n); api.updateSettings({ notifications: n }); };
  const [backupMsg, setBackupMsg] = useState('');
  const fileRef = useRef(null);
  const [storage, setStorage] = useState(null);
  useEffect(() => { api.storageInfo().then(setStorage).catch(() => {}); }, []);
  const mb = (n) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.saveKeys(keys);
      setList(updated);
      setKeys({});
      onSaved();
    } finally { setSaving(false); }
  };

  const test = async (p) => {
    setTests((t) => ({ ...t, [p.id]: { loading: true } }));
    if (keys[p.id]) await save();
    const r = await api.testProvider(p.id).catch((e) => ({ ok: false, error: e.message }));
    setTests((t) => ({ ...t, [p.id]: r }));
  };

  const remove = async (p) => {
    const updated = await api.saveKeys({ [p.id]: '' });
    setList(updated);
    onSaved();
  };

  const download = () => {
    const data = api.exportData();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `opencrew-copia-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setBackupMsg('Copia descargada (sin tus API keys).');
  };

  const restore = async (file) => {
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (!confirm('Esto reemplaza tus bots, chats y rutinas actuales por los de la copia. ¿Seguir?')) return;
      await api.importData(json);
      setBackupMsg('Copia restaurada.');
      onSaved();
    } catch (e) {
      setBackupMsg(`No se pudo restaurar: ${e.message}`);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <h3>Ajustes y claves</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="modal-body">
          <p className="muted small">
            Pega aquí tus propias API keys. Se guardan <b>solo en este navegador</b> y solo se envían al proveedor de IA
            correspondiente cuando un bot lo usa. Después, en cada bot, elige qué modelo usa.
          </p>
          {list.filter((p) => !p.noKey).map((p) => {
            const t = tests[p.id];
            return (
              <div key={p.id} className="key-row">
                <div className="key-head">
                  <strong>{p.label}</strong>
                  {p.hasKey ? <span className="pill ok">configurada</span> : <span className="pill">sin clave</span>}
                  <a href={p.keyUrl} target="_blank" rel="noreferrer" className="link small">Conseguir clave ↗</a>
                </div>
                <div className="key-input">
                  <input type="password" autoComplete="off" placeholder={p.hasKey ? '•••••••• (escribe para reemplazar)' : 'Pega tu API key'}
                    value={keys[p.id] || ''} onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })} />
                  <button className="btn small" onClick={() => test(p)} disabled={!p.hasKey && !keys[p.id]}>Probar</button>
                  {p.hasKey && <button className="btn small ghost" onClick={() => remove(p)}>Quitar</button>}
                </div>
                {t && (t.loading ? <div className="muted small">Probando {p.defaultModel}…</div>
                  : t.ok ? <div className="small run-ok">✓ Funciona con {t.model} · respondió «{t.reply}» en {(t.ms / 1000).toFixed(1)}s</div>
                  : <div className="small run-error">✗ {t.error}</div>)}
              </div>
            );
          })}
          <div className="key-row">
            <div className="key-head"><strong>Ollama (modelos locales gratis)</strong><span className="pill ok">sin clave</span></div>
            <div className="muted small">
              Instala Ollama, ejecuta <code>ollama pull llama3.2</code> y arráncalo permitiendo esta web:
              <code>OLLAMA_ORIGINS="*" ollama serve</code>. Luego elige «Ollama» en el bot.
            </div>
          </div>

          <div className="section-title">Lectura de páginas web</div>
          <label className="check">
            <input type="checkbox" checked={webReader} onChange={(e) => { setWebReader(e.target.checked); api.updateSettings({ webReader: e.target.checked }); }} />
            Usar el lector público r.jina.ai cuando una web no deja leerse desde el navegador
          </label>
          <div className="muted small">La mayoría de webs bloquean que otra página las lea. Si lo desactivas, los bots solo podrán leer webs que lo permitan.</div>

          <div className="section-title">Bot principal proactivo</div>
          <label className="check">
            <input type="checkbox" checked={proactive} onChange={(e) => { setProactive(e.target.checked); api.updateSettings({ proactive: e.target.checked }); }} />
            Al abrir la app, el bot principal (★) propone tareas que puede hacer por ti
          </label>
          <div className="muted small">Usa una llamada corta a su modelo como mucho cada 12 horas.</div>

          <div className="section-title">Notificaciones</div>
          {perm === 'unsupported' ? <div className="muted small">Este navegador no admite notificaciones.</div> : (
            <>
              <div className="settings-actions">
                {perm === 'granted'
                  ? <><span className="pill ok">activadas</span><button className="btn small" onClick={() => api.testNotification()}>Probar</button></>
                  : perm === 'denied'
                    ? <span className="muted small">Bloqueadas. Actívalas en los permisos del sitio de tu navegador (icono del candado).</span>
                    : <button className="btn small" onClick={async () => setPerm(await api.askNotifyPermission())}>Activar notificaciones</button>}
              </div>
              <label className="check"><input type="checkbox" checked={notif.routines !== false} onChange={(e) => setNotifOpt('routines', e.target.checked)} /> Cuando termina una rutina</label>
              <label className="check"><input type="checkbox" checked={!!notif.replies} onChange={(e) => setNotifOpt('replies', e.target.checked)} /> Cuando un bot responde y estás en otra pestaña</label>
              <div className="muted small">Solo llegan mientras OpenCrew está abierta (aunque sea en segundo plano).</div>
            </>
          )}

          <div className="section-title">Copia de seguridad</div>
          <div className="muted small">Tus bots, chats y rutinas viven en este navegador. Descarga una copia para no perderlos o para pasarlos a otro ordenador.</div>
          <div className="settings-actions">
            <button className="btn small" onClick={download}>Descargar copia</button>
            <button className="btn small" onClick={() => fileRef.current?.click()}>Restaurar copia…</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { restore(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          {backupMsg && <div className="small muted">{backupMsg}</div>}
          {storage && (
            <div className="small muted">
              Almacenamiento: {storage.kind === 'indexeddb' ? 'IndexedDB' : 'localStorage (modo limitado)'}
              {storage.used != null && ` · usando ${mb(storage.used)} de ${mb(storage.quota)} disponibles`}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
          <button className="btn primary" onClick={save} disabled={saving || !Object.values(keys).some(Boolean)}>Guardar claves</button>
        </div>
      </div>
    </div>
  );
}
