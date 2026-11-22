import { useState } from 'react';
import { api } from '../api.js';

export default function SettingsModal({ providers, onClose, onSaved }) {
  const [keys, setKeys] = useState({});
  const [list, setList] = useState(providers);
  const [tests, setTests] = useState({});
  const [saving, setSaving] = useState(false);

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
    const r = await api.testProvider(p.id, p.models[0]).catch((e) => ({ ok: false, error: e.message }));
    setTests((t) => ({ ...t, [p.id]: r }));
  };

  const remove = async (p) => {
    const updated = await api.saveKeys({ [p.id]: '' });
    setList(updated);
    onSaved();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <h3>Ajustes · Claves de IA</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="modal-body">
          <p className="muted small">
            Pega aquí tus propias API keys. Se guardan solo en tu ordenador (<code>data/db.json</code>) y nunca se devuelven al navegador.
            También puedes ponerlas en el archivo <code>.env</code>. Luego, en cada bot, elige qué proveedor y modelo usa.
          </p>
          {list.filter((p) => !p.noKey).map((p) => {
            const t = tests[p.id];
            return (
              <div key={p.id} className="key-row">
                <div className="key-head">
                  <strong>{p.label}</strong>
                  {p.hasKey
                    ? <span className="pill ok">configurada{p.keySource === 'env' ? ' (.env)' : ''}</span>
                    : <span className="pill">sin clave</span>}
                  <a href={p.keyUrl} target="_blank" rel="noreferrer" className="link small">Conseguir clave ↗</a>
                </div>
                <div className="key-input">
                  <input type="password" autoComplete="off" placeholder={p.hasKey ? '•••••••• (escribe para reemplazar)' : 'Pega tu API key'}
                    value={keys[p.id] || ''} onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })} />
                  <button className="btn small" onClick={() => test(p)} disabled={!p.hasKey && !keys[p.id]}>Probar</button>
                  {p.keySource === 'app' && <button className="btn small ghost" onClick={() => remove(p)}>Quitar</button>}
                </div>
                {t && (t.loading ? <div className="muted small">Probando {p.models[0]}…</div>
                  : t.ok ? <div className="small run-ok">✓ Funciona · respondió «{t.reply}» en {(t.ms / 1000).toFixed(1)}s</div>
                  : <div className="small run-error">✗ {t.error}</div>)}
              </div>
            );
          })}
          <div className="key-row">
            <div className="key-head"><strong>Ollama (modelos locales gratis)</strong><span className="pill ok">sin clave</span></div>
            <div className="muted small">Instala Ollama, ejecuta <code>ollama pull llama3.2</code> y elige «Ollama» en el bot.</div>
          </div>
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
