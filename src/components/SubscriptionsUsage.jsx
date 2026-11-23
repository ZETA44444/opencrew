import { useEffect, useState } from 'react';
import { api, serverMode } from '../api.js';
import { fmtCost } from './UsageModal.jsx';

// Real usage of your subscriptions, as ChatGPT and Claude report it (your whole account,
// including what you use outside OpenCrew). Plans are flat-rate: they give % of limits, not euros.
const when = (t) => {
  if (!t) return '';
  const ms = t - Date.now();
  if (ms <= 0) return 'ya se ha renovado';
  const h = Math.floor(ms / 36e5), m = Math.round((ms % 36e5) / 6e4);
  return h >= 24 ? `se renueva ${new Date(t).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : `se renueva en ${h ? `${h} h ` : ''}${m} min`;
};
const ago = (t) => { if (!t) return 'nunca'; const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'ahora mismo' : m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`; };

function Bar({ label, w }) {
  if (!w) return null;
  const used = Math.min(100, Math.max(0, w.used || 0));
  const reset = w.resetsAt && w.resetsAt < Date.now();
  const pct = reset ? 0 : used;
  return (
    <div className="quota">
      <div className="quota-head"><span>{label}</span><b>{pct.toFixed(pct % 1 ? 1 : 0)} % usado</b></div>
      <div className="quota-bar"><div className={pct >= 90 ? 'hot' : pct >= 70 ? 'warm' : ''} style={{ width: `${pct}%` }} /></div>
      <div className="muted small">{when(w.resetsAt)}{w.status === 'rejected' ? ' · ⛔ límite alcanzado' : ''}</div>
    </div>
  );
}

export default function SubscriptionsUsage({ monthRows = [] }) {
  const [u, setU] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const load = (refresh) => {
    setBusy(refresh || 'load'); setErr('');
    return api.subscriptionUsage(refresh).then(setU).catch((e) => setErr(e.message)).finally(() => setBusy(''));
  };
  useEffect(() => { if (serverMode) load(); }, []);
  if (!serverMode) return <div className="muted small">Conecta tu servidor y el Puente para ver aquí el uso real de tus suscripciones.</div>;
  if (u === null && !err) return <div className="muted small">Cargando…</div>;
  if (!u) return <div className="banner error small">{err || 'El Puente no está instalado en tu servidor.'}</div>;
  const month = u.thisMonth || {};
  const gemini = monthRows.filter((r) => r.provider === 'gemini').reduce((t, r) => ({ cost: t.cost + r.cost, calls: t.calls + r.calls }), { cost: 0, calls: 0 });

  const card = (id, name, s, extra) => (
    <div className="key-row" key={id}>
      <div className="key-head">
        <strong>{name}</strong>
        {!s.connected ? <span className="pill">sin conectar</span> : s.enabled ? <span className="pill ok">en uso</span> : <span className="pill">desactivada</span>}
        {s.connected && <button className="btn small" style={{ marginLeft: 'auto' }} disabled={!!busy} onClick={() => load(id)}>{busy === id ? 'Actualizando…' : 'Actualizar'}</button>}
      </div>
      {s.connected && !s.limits && <div className="muted small">Aún no hay datos: aparecen con la primera respuesta (o pulsa «Actualizar»).</div>}
      {s.limits && (
        <>
          <Bar label="Ventana de 5 horas" w={s.limits.fiveHour} />
          <Bar label="Límite semanal" w={s.limits.sevenDay} />
          {Object.entries(s.limits).filter(([k, v]) => v && typeof v === 'object' && 'used' in v && !['fiveHour', 'sevenDay'].includes(k)).map(([k, v]) => <Bar key={k} label={k.replace(/_/g, ' ')} w={v} />)}
          {extra?.(s.limits)}
          <div className="muted small">Dato oficial de {name} sobre toda tu cuenta (también lo que usas fuera de OpenCrew) · {ago(s.limits.updatedAt)}.</div>
        </>
      )}
      {month[id] && <div className="muted small">Este mes desde OpenCrew: {month[id].requests} respuestas ({Object.entries(month[id].models).map(([m, n]) => `${m} ${n}`).join(', ')}).</div>}
    </div>
  );

  return (
    <div className="subs-usage">
      <p className="muted small" style={{ margin: 0 }}>
        Las suscripciones tienen precio fijo: lo que miden es <b>qué parte de tus límites has gastado</b>. Estos porcentajes los da cada empresa y cuentan todo lo que usas, no solo OpenCrew.
      </p>
      {err && <div className="banner error small">{err}</div>}
      {card('claude', 'Claude', u.claude, (l) => l.overage?.status && (
        <div className="muted small">Uso extra de pago: {l.overage.using ? 'lo estás usando ahora' : l.overage.status === 'rejected' ? 'desactivado (no te cobrarán de más)' : l.overage.status}.</div>
      ))}
      {card('chatgpt', 'ChatGPT', u.chatgpt, (l) => (l.plan || l.credits) && (
        <div className="muted small">{l.plan ? `Plan: ${l.plan}. ` : ''}{l.credits ? `Créditos: ${JSON.stringify(l.credits)}` : ''}</div>
      ))}
      <div className="key-row">
        <div className="key-head"><strong>Gemini (créditos de Google AI Pro)</strong></div>
        <div className="muted small">
          Google no da tu consumo real por API: el saldo de los créditos que incluye tu Google AI Pro (10 $/mes) y lo gastado se ve en Google AI Studio.
        </div>
        <div className="settings-actions">
          <a className="btn small" href="https://aistudio.google.com/usage" target="_blank" rel="noreferrer">Ver mi consumo en AI Studio ↗</a>
          <a className="btn small ghost" href="https://console.cloud.google.com/billing" target="_blank" rel="noreferrer">Facturación de Google Cloud ↗</a>
        </div>
        <div className="muted small">Desde OpenCrew este mes: {gemini.calls} llamadas · {fmtCost(gemini.cost)} estimado (solo lo de OpenCrew).</div>
      </div>
    </div>
  );
}
