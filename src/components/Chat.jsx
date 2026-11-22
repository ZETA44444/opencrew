import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import Markdown from './Markdown.jsx';

export default function Chat({ bot, bots, providers, messages, busy, onSend, onChangeModel, onEdit, onClear, onShowSteps, onTogglePanel, onToggleNav, onOpenSettings }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const endRef = useRef(null);
  const taRef = useRef(null);
  const provider = providers.find((p) => p.id === bot.provider);
  const missingKey = provider && !provider.hasKey;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, busy]);
  useEffect(() => { setErr(''); taRef.current?.focus(); }, [bot.id]);

  const send = async (value = text) => {
    const v = value.trim();
    if (!v || busy) return;
    setText('');
    setErr('');
    try { await onSend(v); } catch (e) { setErr(e.message); setText(v); }
  };

  const others = bots.filter((b) => b.id !== bot.id);
  const suggestions = [
    `¿Qué sabes hacer, ${bot.name}?`,
    others[0] && `@${others[0].name} ${others[0].title === 'Investigadora' ? 'resume https://es.wikipedia.org/wiki/Inteligencia_artificial' : 'preséntate'}`,
    'recuerda que prefiero respuestas cortas',
  ].filter(Boolean);

  return (
    <main className="chat">
      <header className="chat-header">
        <button className="icon-btn mobile-only" onClick={onToggleNav} aria-label="Bots">☰</button>
        <Avatar bot={bot} size={34} />
        <div className="chat-title">
          <div className="name">{bot.name}</div>
          <div className="sub">{bot.title}</div>
        </div>
        <div className="header-actions">
          <button className="icon-btn" onClick={onEdit} title="Editar bot">✎</button>
          <button className="icon-btn" onClick={() => confirm(`¿Borrar la conversación con ${bot.name}?`) && onClear()} title="Borrar conversación">⌫</button>
          <button className="icon-btn" onClick={onTogglePanel} title="Panel lateral">▥</button>
        </div>
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <div className="welcome">
            <Avatar bot={bot} size={64} />
            <h2>{bot.name}</h2>
            <p>{bot.description || bot.title}</p>
            <div className="suggestions">
              {suggestions.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m) => <Message key={m.id} m={m} bot={bot} onShowSteps={onShowSteps} />)}
        {busy && (
          <div className="msg assistant">
            <Avatar bot={bot} size={28} />
            <div className="typing"><span /><span /><span /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer-wrap">
        {missingKey && (
          <div className="banner">
            Falta la API key de {provider.label}. <button onClick={onOpenSettings}>Añadirla</button>
          </div>
        )}
        {err && <div className="banner error">{err}</div>}
        <div className="composer">
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            placeholder={`Escribe a ${bot.name}…  (usa @Nombre para delegar)`}
            onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <div className="composer-bar">
            <select
              className="model-select"
              value={`${bot.provider}::${bot.model}`}
              onChange={(e) => { const [p, ...m] = e.target.value.split('::'); onChangeModel(p, m.join('::')); }}
              title="Modelo de este bot"
            >
              {providers.map((p) => (
                <optgroup key={p.id} label={`${p.label}${p.hasKey ? '' : ' — sin clave'}`}>
                  {[...new Set([...p.models, ...(p.id === bot.provider ? [bot.model] : [])])].map((m) => (
                    <option key={m} value={`${p.id}::${m}`}>{p.id === 'demo' ? 'Demo (sin IA)' : m}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button className="send" onClick={() => send()} disabled={!text.trim() || busy} aria-label="Enviar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function Message({ m, bot, onShowSteps }) {
  if (m.role === 'user') {
    return (
      <div className="msg user">
        {m.from && <div className="tag">Delegado por {m.from}</div>}
        {m.source === 'routine' && <div className="tag">Rutina automática</div>}
        <div className="bubble">{m.content}</div>
      </div>
    );
  }
  const tools = (m.steps || []).filter((s) => s.kind === 'tool').length;
  return (
    <div className={`msg assistant ${m.error ? 'is-error' : ''}`}>
      <Avatar bot={bot} size={28} />
      <div className="assistant-body">
        <Markdown text={m.content} />
        <div className="msg-foot">
          <span>{m.model}</span>
          {m.steps?.length > 0 && (
            <button onClick={() => onShowSteps(m.steps)}>{m.steps.length} pasos{tools ? ` · ${tools} herramientas` : ''}</button>
          )}
          <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    </div>
  );
}
