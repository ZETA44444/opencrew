import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Avatar from './Avatar.jsx';
import { ask } from '../dialog.jsx';

const RANGES = [[1, 'Hoy'], [7, '7 días'], [30, '30 días'], [0, 'Todo']];
const fmtTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(n));
export const fmtCost = (c) => (c === 0 ? '0 $' : c < 0.01 ? '< 0,01 $' : `${c.toFixed(2).replace('.', ',')} $`);

function group(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    const g = m.get(k) || { key: k, input: 0, output: 0, calls: 0, cost: 0, sample: r };
    g.input += r.input; g.output += r.output; g.calls += r.calls; g.cost += r.cost;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost || b.input + b.output - (a.input + a.output));
}

export default function UsageModal({ bots, onClose }) {
  const [range, setRange] = useState(30);
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [health, setHealth] = useState([]);
  const [pricesBusy, setPricesBusy] = useState(false);
  const load = () => {
    api.usage(range).then(setData); api.health().then(setHealth);
  };
  useEffect(() => { load(); }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  const byBot = useMemo(() => (data ? group(data.rows, (r) => r.botId) : []), [data]);
  const byModel = useMemo(() => (data ? group(data.rows, (r) => `${r.provider}/${r.model}`) : []), [data]);
  const total = byBot.reduce((t, g) => ({ input: t.input + g.input, output: t.output + g.output, calls: t.calls + g.calls, cost: t.cost + g.cost }), { input: 0, output: 0, calls: 0, cost: 0 });
  const botOf = (id) => bots.find((b) => b.id === id) || { id, name: 'Bot borrado', color: '#555', shape: 'circle', title: '' };

  const savePrice = async () => {
    await api.setPrice(editing.provider, editing.model, editing.input, editing.output);
    setEditing(null);
    load();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <h3>Uso y coste</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="modal-body">
          <div className="cat-tabs">
            {RANGES.map(([d, l]) => <button key={d} className={range === d ? 'on' : ''} onClick={() => setRange(d)}>{l}</button>)}
          </div>
          {<>
          <div className="usage-totals">
            <div><span className="muted small">Coste estimado</span><b>{fmtCost(total.cost)}</b></div>
            <div><span className="muted small">Tokens enviados</span><b>{fmtTok(total.input)}</b></div>
            <div><span className="muted small">Tokens recibidos</span><b>{fmtTok(total.output)}</b></div>
            <div><span className="muted small">Llamadas</span><b>{total.calls}</b></div>
          </div>

          {data && !data.rows.length && <div className="empty-skills muted">Todavía no hay uso en este periodo.</div>}

          {byBot.length > 0 && (
            <>
              <div className="section-title">Por bot</div>
              <table className="usage-table">
                <thead><tr><th>Bot</th><th>Llamadas</th><th>Tokens</th><th>Coste</th></tr></thead>
                <tbody>
                  {byBot.map((g) => {
                    const b = botOf(g.key);
                    const share = total.cost ? g.cost / total.cost : (g.input + g.output) / Math.max(1, total.input + total.output);
                    return (
                      <tr key={g.key}>
                        <td><span className="usage-bot"><Avatar bot={b} size={18} />{b.name}</span><div className="usage-bar"><span style={{ width: `${Math.max(2, share * 100)}%` }} /></div></td>
                        <td>{g.calls}</td>
                        <td>{fmtTok(g.input + g.output)}</td>
                        <td>{fmtCost(g.cost)}{b.monthlyLimit ? <div className={`limit ${(b.monthCost || 0) >= b.monthlyLimit ? 'over' : ''}`}>este mes {fmtCost(b.monthCost || 0)} de {fmtCost(b.monthlyLimit)}</div> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {byModel.length > 0 && (
            <>
              <div className="section-title">Por modelo · precio por millón de tokens (entrada / salida)</div>
              <table className="usage-table">
                <thead><tr><th>Modelo</th><th>Tokens</th><th>Precio</th><th>Coste</th></tr></thead>
                <tbody>
                  {byModel.map((g) => {
                    const { provider, model } = g.sample;
                    const p = data.prices[`${provider}/${model}`];
                    const isEditing = editing?.provider === provider && editing?.model === model;
                    return (
                      <tr key={g.key}>
                        <td className="mono">{provider}/{model}</td>
                        <td>{fmtTok(g.input)} / {fmtTok(g.output)}</td>
                        <td>
                          {isEditing ? (
                            <span className="price-edit">
                              <input type="number" min="0" step="0.01" value={editing.input} onChange={(e) => setEditing({ ...editing, input: e.target.value })} />
                              <input type="number" min="0" step="0.01" value={editing.output} onChange={(e) => setEditing({ ...editing, output: e.target.value })} />
                              <button className="btn small primary" onClick={savePrice}>OK</button>
                            </span>
                          ) : (
                            <button className="link" title="Cambiar precio" onClick={() => setEditing({ provider, model, input: p.input, output: p.output })}>
                              {+p.input.toFixed(3)} $ / {+p.output.toFixed(3)} ${p.custom ? ' ✎' : p.live ? ' · en vivo' : ''}{p.unknown ? ' (desconocido)' : ''}
                            </button>
                          )}
                        </td>
                        <td>{fmtCost(g.cost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
          <div className="section-title">Salud de los modelos</div>
          {health.length === 0 ? <div className="muted small">Aún no hay datos: aparecerán cuando tus bots usen modelos reales.</div> : (
            <table className="usage-table">
              <thead><tr><th>Modelo</th><th>Éxito</th><th>Errores</th><th>Sustituido por</th></tr></thead>
              <tbody>
                {health.map((r) => (
                  <tr key={r.key}>
                    <td className="mono">{r.key}{r.lastError && <div className="muted small">último fallo: {r.lastError.kind} · {new Date(r.lastError.at).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>}</td>
                    <td><span className={`health-pill ${r.rate >= 0.95 ? 'good' : r.rate >= 0.7 ? 'meh' : 'bad'}`}>{Math.round(r.rate * 100)} %</span><div className="muted small">{r.ok} bien · {r.fail} mal</div></td>
                    <td className="small">{Object.entries(r.errors || {}).map(([k, n]) => `${k} ×${n}`).join(', ') || '—'}</td>
                    <td className="small mono">{Object.entries(r.replacedBy || {}).map(([k, n]) => `${k} ×${n}`).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="section-title">Precios en vivo</div>
          <div className="settings-actions">
            <span className="muted small">
              {data?.live ? <>{data.live.count} modelos de Anthropic, Google, OpenAI y xAI con su precio publicado · actualizado {new Date(data.live.at).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{data.live.errors?.length ? ' · alguna fuente no respondió' : ''}</> : 'Aún no se han descargado los precios en vivo.'}
            </span>
            <button className="btn small" disabled={pricesBusy} onClick={async () => { setPricesBusy(true); await api.refreshPrices().catch(() => {}); setPricesBusy(false); load(); }}>{pricesBusy ? 'Actualizando…' : 'Actualizar precios'}</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Los precios se actualizan solos cada 12 horas con lo que publica cada proveedor (también los modelos nuevos), y «Automático» los usa para elegir el modelo más barato que sirva. Puedes fijar uno a mano pulsando sobre él. La factura real es la de tu proveedor de IA.
            El modo demo y Ollama (local) no cuestan nada.
          </p>
          </>}
        </div>
        <div className="modal-foot">
          <button className="btn ghost danger" onClick={async () => await ask('¿Borrar todo el historial de uso?') && api.clearUsage().then(load)}>Borrar historial</button>
          {health.length > 0 && <button className="btn ghost" onClick={() => api.clearHealth().then(load)}>Reiniciar salud</button>}
          <span className="spacer" />
          <button className="btn primary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
