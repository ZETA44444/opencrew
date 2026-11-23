import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { remoteConfig } from '../remote.js';

// Watch a bot's computer live, and take control if it gets stuck (the bot waits while you have it).
export default function ComputerViewer({ bot, busy, onClose }) {
  const box = useRef(null);
  const rfbRef = useRef(null);
  const [status, setStatus] = useState('connecting'); // connecting | on | off | error
  const [err, setErr] = useState('');
  const [control, setControl] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let rfb;
    let cancelled = false;
    setStatus('connecting'); setErr('');
    (async () => {
      try {
        const [{ default: RFB }, ticket] = await Promise.all([import('@novnc/novnc'), api.computerViewTicket(bot.id)]);
        if (cancelled) return;
        const url = `${remoteConfig().url.replace(/^http/, 'ws')}/api/computer/vnc?ticket=${ticket}`;
        rfb = new RFB(box.current, url);
        rfb.scaleViewport = true;
        rfb.viewOnly = true;
        rfb.background = '#0b0b0c';
        rfb.addEventListener('connect', () => setStatus('on'));
        rfb.addEventListener('disconnect', (e) => { if (!cancelled) setStatus(e.detail?.clean ? 'off' : 'error'); });
        rfbRef.current = rfb;
      } catch (e) { if (!cancelled) { setStatus('error'); setErr(e.message); } }
    })();
    return () => { cancelled = true; try { rfb?.disconnect(); } catch { /* already closed */ } rfbRef.current = null; };
  }, [bot.id, attempt]);

  // Give control back when the window closes.
  useEffect(() => () => { api.computerControl(bot.id, false).catch(() => {}); }, [bot.id]);

  const toggleControl = async () => {
    const on = !control;
    await api.computerControl(bot.id, on).catch(() => {});
    setControl(on);
    if (rfbRef.current) { rfbRef.current.viewOnly = !on; if (on) rfbRef.current.focus(); }
  };

  return (
    <div className="computer-view" role="dialog" aria-label={`Ordenador de ${bot.name}`}>
      <div className="computer-bar">
        <strong>🖥 Ordenador de {bot.name}</strong>
        <span className={`pill ${status === 'on' ? 'ok' : status === 'error' ? 'err' : ''}`}>
          {status === 'on' ? (control ? 'tienes el control' : busy ? `${bot.name} está trabajando` : 'en directo') : status === 'connecting' ? 'conectando…' : 'desconectado'}
        </span>
        <span className="spacer" />
        {status === 'on' && (
          <button className={`btn small ${control ? 'primary' : ''}`} onClick={toggleControl}>
            {control ? 'Devolver el control' : '🖐 Tomar el control'}
          </button>
        )}
        {(status === 'off' || status === 'error') && <button className="btn small" onClick={() => setAttempt((x) => x + 1)}>Reconectar</button>}
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">×</button>
      </div>
      {control && <div className="computer-hint small">Tienes el control: {bot.name} no usará el navegador hasta que se lo devuelvas (o pasen 20 minutos). Clic derecho en el escritorio → terminal.</div>}
      {err && <div className="banner error small" style={{ margin: 8 }}>{err}</div>}
      <div className={`computer-screen ${control ? 'controlling' : ''}`} ref={box} />
    </div>
  );
}
