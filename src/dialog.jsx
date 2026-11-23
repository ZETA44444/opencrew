import { useEffect, useRef, useState } from 'react';

// The app's own dialogs instead of the browser's confirm/alert/prompt (which look foreign, can't be styled
// and are blocked inside some embedded views). Usage: `if (!await ask('¿Borrar…?')) return;`.
let push = null;
const queue = [];
const open = (d) => new Promise((resolve) => {
  const item = { ...d, resolve };
  if (push) push(item); else queue.push(item);
});

// Yes/no. Messages that start with «¿Borrar», «¿Quitar» or «¿Desconectar» get a red button automatically.
export const ask = (message, { okLabel, cancelLabel = 'Cancelar', danger } = {}) => {
  const destructive = danger ?? /^¿(Borrar|Quitar|Desconectar|Reiniciar|Revocar)/i.test(message);
  return open({ kind: 'confirm', message, okLabel: okLabel || (destructive ? (message.match(/^¿(\p{L}+)/u)?.[1] || 'Aceptar') : 'Aceptar'), cancelLabel, danger: destructive });
};
// Just tell something.
export const notify = (message) => open({ kind: 'alert', message, okLabel: 'Entendido' });
// Type something; with `expect`, the OK button only works when the text matches (e.g. «BORRAR»).
export const askText = (message, { expect, placeholder = '', okLabel = 'Aceptar', danger = !!expect } = {}) =>
  open({ kind: 'prompt', message, expect, placeholder, okLabel, cancelLabel: 'Cancelar', danger });

export function DialogHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    push = (d) => setItems((x) => [...x, d]);
    if (queue.length) setItems((x) => [...x, ...queue.splice(0)]);
    return () => { push = null; };
  }, []);
  const d = items[0];
  const [text, setText] = useState('');
  const okRef = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => { setText(''); setTimeout(() => (inputRef.current || okRef.current)?.focus(), 0); }, [d]);
  if (!d) return null;
  const close = (value) => { d.resolve(value); setItems((x) => x.slice(1)); };
  const cancelValue = d.kind === 'prompt' ? null : false;
  const blocked = d.kind === 'prompt' && d.expect && text.trim() !== d.expect;
  const ok = () => { if (!blocked) close(d.kind === 'prompt' ? text : true); };
  return (
    <div className="modal-backdrop dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(d.kind === 'alert' ? true : cancelValue)}
      onKeyDown={(e) => { if (e.key === 'Escape') close(d.kind === 'alert' ? true : cancelValue); }}>
      <div className="modal dialog" role="alertdialog" aria-modal="true" aria-label={d.message}>
        <div className="modal-body">
          <p className="dialog-msg">{d.message}</p>
          {d.kind === 'prompt' && (
            <input ref={inputRef} value={text} placeholder={d.placeholder || d.expect || ''} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') ok(); }} />
          )}
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          {d.kind !== 'alert' && <button className="btn ghost" onClick={() => close(cancelValue)}>{d.cancelLabel}</button>}
          <button ref={okRef} className={`btn ${d.danger ? 'danger-solid' : 'primary'}`} disabled={blocked} onClick={ok}>{d.okLabel}</button>
        </div>
      </div>
    </div>
  );
}
