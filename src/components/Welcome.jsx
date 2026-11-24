import { useState } from 'react';
import { api } from '../api.js';
import { TEMPLATE_CATEGORIES } from '../templates.js';
import { getLang, setLang, LANGS } from '../i18n/index.js';

// First run: what do you want it for → how it will think → your team → first task.
// Goal: something useful in under 3 minutes, without knowing what an «API key» is.
const PURPOSES = [
  { id: 'negocio', icon: '📈', label: 'Mi negocio y marketing', team: ['Scout', 'Echo', 'Muse'],
    tasks: ['Analiza la web de mi competencia y dime qué hacen mejor que yo: ', 'Escríbeme 5 posts para LinkedIn sobre mi negocio, que es: ', 'Busca 5 ideas de contenido que estén funcionando ahora sobre: '] },
  { id: 'ventas', icon: '🤝', label: 'Ventas y clientes', team: ['Hunter', 'Nora', 'Clerk'],
    tasks: ['Busca 10 empresas que podrían ser clientes de mi producto, que es: ', 'Escribe una respuesta amable a un cliente que se queja de un retraso en su pedido', 'Prepárame una propuesta comercial de una página para: '] },
  { id: 'tecnica', icon: '💻', label: 'Programación y datos', team: ['Byte', 'Ops', 'Clerk'],
    tasks: ['Explícame cómo organizar un proyecto web moderno paso a paso', 'Analiza estos datos y dime las 3 conclusiones más importantes: ', 'Escribe la documentación de esta función: '] },
  { id: 'personal', icon: '🌿', label: 'Organizar mi vida', team: ['Iris', 'Sol', 'Ledger'],
    tasks: ['Hazme un plan semanal realista con estas tareas: ', 'Ayúdame a hacer un presupuesto mensual con estos gastos: ', 'Prepárame un resumen de las noticias más importantes de hoy'] },
  { id: 'todo', icon: '✨', label: 'Un poco de todo', team: ['Muse', 'Clerk', 'Byte'],
    tasks: ['Investiga y resúmeme en 10 viñetas: ', 'Redacta un correo profesional para: ', 'Explícame como si tuviera 12 años: '] },
];
const allTemplates = TEMPLATE_CATEGORIES.flatMap((c) => c.items);
// Pay-as-you-go keys (free tiers can't back an app offered in the EU, and are not for consumer use).
const KEY_OPTIONS = [
  { id: 'anthropic', label: 'Claude (recomendado)', url: 'https://console.anthropic.com/settings/keys', site: 'la consola de Anthropic',
    steps: ['Entra con tu cuenta y, en «Billing», añade saldo (desde 5 $; con el modelo rápido da para meses de uso normal).', 'En «API keys», pulsa «Create key» y cópiala.'] },
  { id: 'openai', label: 'OpenAI', url: 'https://platform.openai.com/api-keys', site: 'la plataforma de OpenAI',
    steps: ['Entra con tu cuenta y añade saldo en «Billing».', 'Pulsa «Create new secret key» y cópiala.'] },
  { id: 'gemini', label: 'Gemini (con facturación)', url: 'https://aistudio.google.com/apikey', site: 'Google AI Studio',
    steps: ['Activa la facturación de Google Cloud en tu proyecto (la capa gratuita no se puede usar en apps en Europa).', 'Pulsa «Create API key» y cópiala.'] },
];

export default function Welcome({ state, onDone }) {
  const [step, setStep] = useState(1);
  const [purpose, setPurpose] = useState(null);
  const [key, setKey] = useState('');
  const [prov, setProv] = useState(KEY_OPTIONS[0]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [task, setTask] = useState('');
  const hasKey = state.providers.some((p) => !p.noKey && p.hasKey);

  const finish = async (botId) => { await api.updateSettings({ onboarded: true }).catch(() => {}); onDone(botId); };

  // Step 2: how the bots will think.
  const useKey = async () => {
    setErr(''); setBusy('key');
    try {
      await api.saveKeys({ [prov.id]: key.trim() });
      const r = await api.testProvider(prov.id);
      if (!r.ok) { await api.saveKeys({ [prov.id]: '' }); throw new Error(`Esa clave no funciona (${r.error || 'sin detalle'}). Cópiala entera y comprueba que tienes saldo.`); }
      setStep(3);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };

  // Step 3: build the team (Atlas leads; every bot on «Automático», which picks the cheapest model that works).
  const buildTeam = async () => {
    setErr(''); setBusy('team');
    try {
      const provider = hasKey || key ? 'auto' : 'demo';
      for (const name of purpose.team) {
        const t = allTemplates.find((x) => x.name === name);
        if (!t || state.bots.some((b) => b.name === name)) continue;
        const { tier, ...rest } = t;
        await api.createBot({ ...rest, provider, model: provider === 'auto' ? 'auto' : 'demo' });
      }
      const s = await api.state();
      for (const b of s.bots) if (b.provider === 'demo' && provider !== 'demo') await api.updateBot(b.id, { provider, model: 'auto' });
      setStep(4);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };

  const send = async (text) => {
    const s = await api.state();
    const lead = s.bots.find((b) => b.starred) || s.bots[0];
    await api.chat(lead.id, text);
    finish(lead.id);
  };

  return (
    <div className="modal-backdrop welcome-modal">
      <div className="modal welcome-card">
        <div className="welcome-steps">{[1, 2, 3, 4].map((n) => <span key={n} className={n <= step ? 'on' : ''} />)}</div>

        {step === 1 && (
          <>
            <h2>Bienvenido a OpenCrew 👋</h2>
            <p className="muted">Un equipo de bots con IA que trabaja para ti: investigan, escriben, programan y hacen tareas solos. ¿Para qué lo quieres sobre todo?</p>
            <p className="muted small">Los bots son programas de inteligencia artificial, no personas, y pueden equivocarse. OpenCrew es para mayores de 18 años.</p>
            <div className="welcome-grid">
              {PURPOSES.map((p) => (
                <button key={p.id} className={`welcome-option ${purpose?.id === p.id ? 'on' : ''}`} onClick={() => setPurpose(p)}>
                  <span className="welcome-icon">{p.icon}</span>{p.label}
                </button>
              ))}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => finish()}>Saltar</button>
              <select className="notranslate welcome-lang" aria-label="Idioma · Language" value={getLang()} onChange={(e) => { const v = e.target.value; api.updateSettings({ lang: v }).catch(() => {}).finally(() => setLang(v)); }}>
                {LANGS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              <span className="spacer" />
              <button className="btn primary" disabled={!purpose} onClick={() => setStep(hasKey ? 3 : 2)}>Siguiente</button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>¿Con qué «piensan» tus bots?</h2>
            <p className="muted">Los bots usan un modelo de IA de pago por uso: pagas al proveedor solo lo que gastan, normalmente céntimos al día. Elige uno:</p>
            <div className="welcome-providers">
              {KEY_OPTIONS.map((o) => <button key={o.id} className={`welcome-option small ${prov.id === o.id ? 'on' : ''}`} onClick={() => { setProv(o); setErr(''); }}>{o.label}</button>)}
            </div>
            <ol className="welcome-howto">
              <li>Abre <a className="link" href={prov.url} target="_blank" rel="noreferrer">{prov.site}</a>.</li>
              {prov.steps.map((t) => <li key={t}>{t}</li>)}
              <li>Pégala aquí:</li>
            </ol>
            <input type="password" autoComplete="off" placeholder="Pega tu clave de API" value={key} onChange={(e) => setKey(e.target.value)} />
            <p className="muted small">Se guarda cifrada y solo se usa para hablar con ese proveedor. Puedes añadir otras cuando quieras en Ajustes.</p>
            {err && <div className="banner error small">{err}</div>}
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setStep(3)}>Ahora no (modo demostración)</button>
              <span className="spacer" />
              <button className="btn primary" disabled={!key.trim() || !!busy} onClick={useKey}>{busy ? 'Comprobando…' : 'Usar esta clave'}</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Tu equipo</h2>
            <p className="muted">Atlas coordina y reparte el trabajo. Estos son los especialistas que vamos a añadir para «{purpose.label}»:</p>
            <div className="welcome-team">
              {purpose.team.map((name) => { const t = allTemplates.find((x) => x.name === name); return t && (
                <div key={name} className="welcome-bot"><span className="welcome-dot" style={{ background: t.color }} /><div><b>{t.name}</b> · {t.title}<div className="muted small">{t.description}</div></div></div>
              ); })}
            </div>
            <p className="muted small">{hasKey || key ? 'Usarán «Automático»: el modelo más barato que sirva para cada tarea.' : 'Estarán en modo demostración hasta que añadas una clave en Ajustes.'}</p>
            {err && <div className="banner error small">{err}</div>}
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setStep(1)}>Atrás</button>
              <span className="spacer" />
              <button className="btn primary" disabled={!!busy} onClick={buildTeam}>{busy ? 'Creando tu equipo…' : 'Crear mi equipo'}</button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2>Tu primera tarea</h2>
            <p className="muted">Pídele algo a tu equipo. Atlas lo repartirá. Elige una idea y complétala, o escribe la tuya:</p>
            <div className="welcome-tasks">
              {purpose.tasks.map((t) => <button key={t} className="welcome-option small" onClick={() => setTask(t)}>{t.replace(/: $/, '…')}</button>)}
            </div>
            <textarea rows={3} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Por ejemplo: investiga los mejores portátiles por menos de 800 € y hazme una tabla" />
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => finish()}>Lo haré luego</button>
              <span className="spacer" />
              <button className="btn primary" disabled={task.trim().length < 5} onClick={() => send(task.trim())}>Enviar a mi equipo</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
