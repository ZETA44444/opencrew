import { useEffect, useRef, useState } from 'react';
import { api, serverMode } from '../api.js';
import ServerSection from './ServerSection.jsx';
import { isAdvanced } from '../uimode.js';
import { ask } from '../dialog.jsx';
import { getLang, setLang, LANGS, legalUrl } from '../i18n/index.js';
import { hostedInfo } from '../remote.js';
import { remoteConfig } from '../remote.js';
import { voices as listVoices, speechSupported, dictationSupported, speak } from '../voice.js';

const TABS = [
  ['modelos', 'Modelos'], ['cuenta', 'Cuenta y datos'], ['apps', 'Apps'], ['preferencias', 'Preferencias'], ['privacidad', 'Privacidad'], ['avanzado', 'Avanzado'],
];

export default function SettingsModal({ providers, settings, services, sensitiveTools = {}, onClose, onSaved, onConnectors, initialTab = 'modelos' }) {
  const [tab, setTab] = useState(initialTab);
  const [keys, setKeys] = useState({});
  const [list, setList] = useState(providers);
  const [tests, setTests] = useState({});
  const [saving, setSaving] = useState(false);
  const [tavily, setTavily] = useState('');
  const [hasTavily, setHasTavily] = useState(!!services?.tavily);
  const saveTavily = async (value) => { await api.saveKeys({ tavily: value }); setHasTavily(!!value); setTavily(''); onSaved(); };
  const [webReader, setWebReader] = useState(settings?.webReader !== false);
  const [proactive, setProactive] = useState(settings?.proactive !== false);
  const [advanced, setAdvanced] = useState(isAdvanced(settings));
  const [voice, setVoice] = useState(settings?.voice || { voiceName: '', rate: 1, autoSpeak: false });
  const [voiceList, setVoiceList] = useState(() => listVoices());
  useEffect(() => {
    if (!speechSupported) return undefined;
    const update = () => setVoiceList(listVoices());
    speechSynthesis.addEventListener?.('voiceschanged', update);
    return () => speechSynthesis.removeEventListener?.('voiceschanged', update);
  }, []);
  const setVoiceOpt = (patch) => { const v = { ...voice, ...patch }; setVoice(v); api.updateSettings({ voice: v }); };
  const lang2 = (navigator.language || 'es').slice(0, 2);
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

  const download = async () => {
    const data = await api.exportData();
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
      if (!await ask('Esto reemplaza tus bots, chats y rutinas actuales por los de la copia. ¿Seguir?', { okLabel: 'Reemplazar', danger: true })) return;
      await api.importData(json);
      setBackupMsg('Copia restaurada.');
      onSaved();
    } catch (e) {
      setBackupMsg(`No se pudo restaurar: ${e.message}`);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide settings-modal">
        <div className="modal-head">
          <h3>Ajustes</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="tabs settings-tabs" role="tablist">
          {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
        </div>
        <div className="modal-body">
          {tab === 'avanzado' && <>
          <label className="check mode-toggle">
            <input type="checkbox" checked={advanced} onChange={(e) => { setAdvanced(e.target.checked); api.updateSettings({ uiMode: e.target.checked ? 'advanced' : 'basic' }).then(onSaved); }} />
            Modo avanzado <span className="muted small">— muestra las opciones técnicas (servidor, búsqueda, conexiones MCP, delegación…)</span>
          </label>
          {!advanced && <div className="muted small">Con el modo avanzado apagado, la app muestra solo lo esencial. Enciéndelo para ver aquí la búsqueda en internet y, en otras pestañas, el servidor y Ollama.</div>}
          </>}
          {tab === 'modelos' && <>
          <p className="muted small">
            Pega aquí tus propias API keys. Se guardan <b>{serverMode ? 'solo en tu servidor' : 'solo en este navegador'}</b> y solo se envían al proveedor de IA
            correspondiente cuando un bot lo usa. Después, en cada bot, elige qué modelo usa.
          </p>
          {list.filter((p) => !p.noKey && (advanced || ['gemini', 'anthropic', 'openai'].includes(p.id) || p.hasKey)).map((p) => {
            const t = tests[p.id];
            return (
              <div key={p.id} className="key-row">
                <div className="key-head">
                  <strong>{p.label}</strong>
                  {p.included ? <span className="pill ok">incluido en tu plan</span> : p.hasKey ? <span className="pill ok">configurada</span> : <span className="pill">sin clave</span>}
                  <a href={p.keyUrl} target="_blank" rel="noreferrer" className="link small">Conseguir clave ↗</a>
                </div>
                <div className="key-input">
                  <input type="password" autoComplete="off" placeholder={p.hasKey ? '•••••••• (escribe para reemplazar)' : 'Pega tu API key'}
                    value={keys[p.id] || ''} onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })} />
                  <button className="btn small" onClick={() => test(p)} disabled={!p.hasKey && !keys[p.id]}>Probar</button>
                  {p.hasKey && !p.included && <button className="btn small ghost" onClick={() => remove(p)}>Quitar</button>}
                </div>
                {p.id === 'gemini' && (
                  <details className="small muted">
                    <summary>¿Tienes Google AI Pro o Ultra? Usa sus créditos incluidos (10 $/mes en Pro) — legal y oficial</summary>
                    <ol className="gateway-steps">
                      <li>Únete gratis al <a className="link" href="https://developers.google.com/program" target="_blank" rel="noreferrer">Google Developer Program</a> con la misma cuenta de Google y, en «Mis beneficios», activa los créditos de Google Cloud de tu plan.</li>
                      <li>Esos créditos van a una cuenta de facturación de Google Cloud. En <a className="link" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">AI Studio</a>, crea una clave en un proyecto vinculado a esa facturación (Google pide una recarga mínima de 5 $ antes de usar los créditos).</li>
                      <li>Pega aquí esa clave. Lo que gasten tus bots con Gemini se descuenta de esos créditos; el saldo real lo ves en <a className="link" href="https://aistudio.google.com/usage" target="_blank" rel="noreferrer">AI Studio → Uso</a>.</li>
                    </ol>
                  </details>
                )}
                {t && (t.loading ? <div className="muted small">Probando {p.defaultModel}…</div>
                  : t.ok ? <div className="small run-ok">✓ Funciona con {t.model} · respondió «{t.reply}» en {(t.ms / 1000).toFixed(1)}s</div>
                  : <div className="small run-error">✗ {t.error}</div>)}
              </div>
            );
          })}
          {advanced && (
          <div className="key-row">
            <div className="key-head"><strong>Ollama (modelos locales gratis)</strong><span className="pill ok">sin clave</span></div>
            <div className="muted small">
              Instala Ollama, ejecuta <code>ollama pull llama3.2</code> y arráncalo permitiendo esta web:
              <code>OLLAMA_ORIGINS="*" ollama serve</code>. Luego elige «Ollama» en el bot.
            </div>
          </div>
          )}
          </>}

          {tab === 'avanzado' && advanced && <>
          <div className="section-title">Búsqueda en internet</div>
          <div className="muted small">
            Los bots buscan con la mejor opción que tengas: <b>Tavily</b> → <b>Gemini + Google</b> → <b>Claude</b> → DuckDuckGo sin clave.
            Ahora mismo: <b>{services?.searchBackend}</b>.
          </div>
          <div className="key-row">
            <div className="key-head">
              <strong>Tavily (opcional, búsquedas más precisas)</strong>
              {hasTavily ? <span className="pill ok">configurada</span> : <span className="pill">sin clave</span>}
              <a href="https://app.tavily.com" target="_blank" rel="noreferrer" className="link small">Conseguir clave ↗</a>
            </div>
            <div className="key-input">
              <input type="password" autoComplete="off" placeholder={hasTavily ? '•••••••• (escribe para reemplazar)' : 'Pega tu API key de Tavily'} value={tavily} onChange={(e) => setTavily(e.target.value)} />
              <button className="btn small" disabled={!tavily} onClick={() => saveTavily(tavily)}>Guardar</button>
              {hasTavily && <button className="btn small ghost" onClick={() => saveTavily('')}>Quitar</button>}
            </div>
          </div>
          </>}

          {tab === 'privacidad' && <>
          <div className="section-title">Lectura de páginas web</div>
          <label className="check">
            <input type="checkbox" checked={webReader} onChange={(e) => { setWebReader(e.target.checked); api.updateSettings({ webReader: e.target.checked }); }} />
            Usar el lector público r.jina.ai cuando una web no deja leerse desde el navegador
          </label>
          <div className="muted small">La mayoría de webs bloquean que otra página las lea. Si lo desactivas, los bots solo podrán leer webs que lo permitan.</div>
          </>}

          {tab === 'preferencias' && advanced && <>
          <div className="section-title">Bot principal proactivo</div>
          <label className="check">
            <input type="checkbox" checked={proactive} onChange={(e) => { setProactive(e.target.checked); api.updateSettings({ proactive: e.target.checked }); }} />
            Al abrir la app, el bot principal (★) propone tareas que puede hacer por ti
          </label>
          <div className="muted small">Usa una llamada corta a su modelo como mucho cada 12 horas.</div>

          </>}
          {tab === 'preferencias' && <>
          <label>Idioma · Language
            <select className="notranslate" value={getLang()} onChange={(e) => { const v = e.target.value; api.updateSettings({ lang: v }).catch(() => {}).finally(() => setLang(v)); }}>
              {LANGS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <div className="section-title">Memoria automática</div>
          <label className="check">
            <input type="checkbox" checked={settings?.autoMemory !== false} onChange={(e) => { api.updateSettings({ autoMemory: e.target.checked }); onSaved(); }} />
            Al chatear, los bots me proponen qué recordar (no guardan nada sin mi aprobación)
          </label>
          <div className="muted small">Usa el modelo más barato que tengas y solo cada varios mensajes o cuando dices algo como «me llamo…» o «prefiero…».</div>
          </>}

          {tab === 'privacidad' && <>
          <div className="section-title">Mensajes a otras personas</div>
          <div className="muted small">Todo lo que un bot envía o publica en tu nombre (correos, comentarios, mensajes en apps conectadas, invitaciones) te pide permiso cada vez, aunque tengas los permisos desactivados.</div>
          <label className="check">
            <input type="checkbox" checked={!!settings?.aiSignature} onChange={(e) => { api.updateSettings({ aiSignature: e.target.checked }); onSaved(); }} />
            Añadir al final de los correos «Redactado con ayuda de IA (OpenCrew) y revisado por mí»
          </label>

          <div className="section-title">Permisos</div>
          <label className="check">
            <input type="checkbox" checked={settings?.approvals?.enabled !== false} onChange={(e) => { api.setApprovalsEnabled(e.target.checked); onSaved(); }} />
            Pedirme permiso antes de acciones sensibles (crear bots o rutinas, generar imágenes, escribir en GitHub o en apps conectadas)
          </label>
          {Object.keys(settings?.approvals?.always || {}).some((k) => k.includes(':')) && (
            <div className="always-list">
              <div className="muted small">Permitido siempre (cada permiso vale solo para ese bot):</div>
              {Object.entries(settings.approvals.always).filter(([k]) => k.includes(':')).map(([k, v]) => (
                <div key={k} className="mem-item">
                  <span><b>{v.botName || 'Bot'}</b> · {sensitiveTools[v.tool || k.split(':')[1]] || v.label || k}</span>
                  <button className="btn small ghost" onClick={() => { api.revokeAlways(k); onSaved(); }}>Volver a preguntar</button>
                </div>
              ))}
            </div>
          )}
          </>}

          {tab === 'preferencias' && <>
          <div className="section-title">Voz</div>
          <div className="muted small">
            {dictationSupported ? 'Pulsa el micrófono junto a la caja de texto para dictar. ' : 'Tu navegador no permite dictar (prueba con Chrome o Edge). '}
            {speechSupported ? 'Cada respuesta tiene «🔊 Escuchar».' : 'Tu navegador no puede leer en voz alta.'}
          </div>
          <label>Dictado
            <select value={voice.dictation || 'browser'} onChange={(e) => setVoiceOpt({ dictation: e.target.value })}>
              <option value="browser">Del navegador (en directo, gratis; no funciona en Brave/Arc/Opera)</option>
              <option value="cloud">Grabar y transcribir con mi clave de Gemini u OpenAI (más fiable)</option>
            </select>
          </label>
          <label>Llamadas
            <select value={voice.native || ''} onChange={(e) => setVoiceOpt({ native: e.target.value })}>
              <option value="">Normal (cualquier modelo, con herramientas; voz del navegador)</option>
              <option value="gemini">Voz nativa con Gemini Live (más rápida y natural; necesita tu clave de Gemini, sin herramientas)</option>
              <option value="openai">Voz nativa con OpenAI Realtime (muy natural; necesita tu clave de OpenAI, sin herramientas)</option>
            </select>
          </label>
          {voice.native && !providers?.find((p) => p.id === voice.native)?.hasKey && <div className="muted small">⚠️ Añade tu clave de {voice.native === 'openai' ? 'OpenAI' : 'Gemini'} arriba para usar la voz nativa; mientras tanto se usa la llamada normal.</div>}
          {speechSupported && (
            <>
              <label className="check"><input type="checkbox" checked={!!voice.autoSpeak} onChange={(e) => setVoiceOpt({ autoSpeak: e.target.checked })} /> Leer en voz alta las respuestas nuevas automáticamente</label>
              <div className="grid2">
                <label>Voz
                  <select value={voice.voiceName || ''} onChange={(e) => setVoiceOpt({ voiceName: e.target.value })}>
                    <option value="">Automática</option>
                    {voiceList.filter((v) => v.lang.startsWith(lang2)).concat(voiceList.filter((v) => !v.lang.startsWith(lang2))).map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                  </select>
                </label>
                <label>Velocidad: {Number(voice.rate || 1).toFixed(1)}×
                  <input type="range" min="0.6" max="1.8" step="0.1" value={voice.rate || 1} onChange={(e) => setVoiceOpt({ rate: Number(e.target.value) })} />
                </label>
              </div>
              <div><button className="btn small" onClick={() => speak('Hola, así sonarán las respuestas de tus bots.', voice)}>Probar voz</button></div>
            </>
          )}

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

          </>}

          {tab === 'cuenta' && (advanced || hostedInfo()) && <ServerSection />}
          {tab === 'apps' && <>
            <div className="muted small">Conecta tus apps (Gmail, Calendar, Notion, GitHub…), tu navegador y tu ordenador para que los bots trabajen con ellos. Cada acción sensible te pedirá permiso.</div>
            <div className="settings-actions"><button className="btn small primary" onClick={() => { onClose(); onConnectors?.(); }}>Abrir conexiones</button></div>
          </>}

          {tab === 'cuenta' && <>
          <div className="muted small"><a className="link" href={legalUrl('condiciones')} target="_blank" rel="noreferrer">Condiciones</a> · <a className="link" href={legalUrl('privacidad')} target="_blank" rel="noreferrer">Privacidad</a> · <a className="link" href={legalUrl('uso-aceptable')} target="_blank" rel="noreferrer">Uso aceptable</a></div>
          <div className="section-title">Copia de seguridad</div>
          <div className="muted small">Tus bots, chats y rutinas viven en {serverMode ? 'tu servidor' : 'este navegador'}. Descarga una copia para no perderlos o para pasarlos a otro ordenador.</div>
          <div className="settings-actions">
            <button className="btn small" onClick={download}>Descargar copia</button>
            <button className="btn small" onClick={() => fileRef.current?.click()}>Restaurar copia…</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { restore(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          {backupMsg && <div className="small muted">{backupMsg}</div>}
          {storage && (
            <div className="small muted">
              Almacenamiento: {storage.kind === 'indexeddb' ? 'IndexedDB' : storage.kind === 'file' ? 'archivo en tu servidor' : 'localStorage (modo limitado)'}
              {storage.used != null && ` · usando ${mb(storage.used)} de ${mb(storage.quota)} disponibles`}
            </div>
          )}
          </>}
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cerrar</button>
          {tab === 'modelos' && <button className="btn primary" onClick={save} disabled={saving || !Object.values(keys).some(Boolean)}>Guardar claves</button>}
        </div>
      </div>
    </div>
  );
}
