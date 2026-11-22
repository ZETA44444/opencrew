import { useEffect, useRef, useState } from 'react';
import Avatar, { GroupAvatar } from './Avatar.jsx';
import { CallSession } from '../call.js';
import { LiveSession, liveAvailable } from '../live.js';

const LABEL = {
  idle: 'Conectando…', listening: 'Te escucho…', transcribing: 'Entendiendo…', thinking: 'Pensando…',
  speaking: 'Hablando…', error: 'No puedo escucharte', ended: 'Llamada terminada',
};

export default function CallOverlay({ bot, rate = 1, native = false, onClose }) {
  const [state, setState] = useState('idle');
  const [lines, setLines] = useState([]);
  const [err, setErr] = useState('');
  const [secs, setSecs] = useState(0);
  const [mode, setMode] = useState('');
  const [notice, setNotice] = useState('');
  const session = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    const handlers = {
      threadId: bot.id, rate,
      onState: setState,
      onError: setErr,
      onLine: (l) => setLines((ls) => {
        // Live (interim) dictation replaces the previous interim line.
        const last = ls[ls.length - 1];
        if (last?.interim && l.who === 'Tú') return [...ls.slice(0, -1), l];
        return [...ls, l].slice(-30);
      }),
    };
    const begin = (s, m) => { session.current = s; window.__ocCall = s; setMode(m); s.start(); };
    if (native && !bot.isGroup && liveAvailable()) {
      begin(new LiveSession({
        ...handlers,
        onFallback: (msg) => {
          if (session.current?.closed) return;
          session.current?.hangup();
          setNotice(msg);
          begin(new CallSession(handlers), 'normal'); // fall back to the normal call
        },
      }), 'live');
    } else begin(new CallSession(handlers), 'normal');
    const t = setInterval(() => setSecs((x) => x + 1), 1000);
    return () => { clearInterval(t); const s = session.current; s?.hangup(); if (window.__ocCall === s) delete window.__ocCall; };
  }, [bot.id, rate, native]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [lines.length]);

  const hangup = () => { session.current?.hangup(); onClose(); };
  const mm = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  return (
    <div className="call-overlay" role="dialog" aria-label={`Llamada con ${bot.name}`}>
      <div className="call-top">
        <span className="muted small">Llamada · {mm}{mode === 'live' && ' · ⚡ voz nativa (Gemini Live)'}</span>
      </div>
      <div className={`call-avatar state-${state}`}>
        {bot.isGroup ? <GroupAvatar members={bot.members} size={120} /> : <Avatar bot={bot} size={120} />}
      </div>
      <h2 className="call-name">{bot.name}</h2>
      <div className="call-state">{LABEL[state] || state}</div>
      {notice && <div className="banner small call-err">{notice}</div>}
      {err && <div className="banner error small call-err">{err}</div>}
      <div className="call-lines">
        {lines.map((l, i) => (
          <div key={i} className={`call-line ${l.who === 'Tú' ? 'me' : ''} ${l.interim ? 'interim' : ''}`}>
            <b>{l.who}</b> {l.text.length > 400 ? `${l.text.slice(0, 400)}…` : l.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="call-actions">
        {(state === 'speaking' || state === 'thinking') && (
          <button className="call-btn" onClick={() => session.current?.interrupt()} title="Interrumpir y hablar tú">✋</button>
        )}
        <button className="call-btn hang" onClick={hangup} title="Colgar" aria-label="Colgar">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" /></svg>
        </button>
      </div>
      <div className="muted small call-hint">Habla con normalidad; cuando te calles un segundo, {bot.isGroup ? 'el grupo' : bot.name} te contesta.</div>
    </div>
  );
}
