import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import Markdown from './Markdown.jsx';

export default function Chat({ bot, bots, providers, messages, busy, draft, onStop, onRerun, queued = [], onRemoveQueued, onSend, onChangeModel, onEdit, onClear, onShowSteps, onTogglePanel, onToggleNav, onOpenSettings }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const endRef = useRef(null);
  const taRef = useRef(null);
  const provider = providers.find((p) => p.id === bot.provider);
  const missingKey = provider && !provider.hasKey;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, busy]);
  // While streaming, keep the bottom in view without smooth-scroll jitter.
  useEffect(() => { if (draft) endRef.current?.scrollIntoView({ block: 'end' }); }, [draft]);
  useEffect(() => { setErr(''); taRef.current?.focus(); }, [bot.id]);

  const send = async (value = text) => {
    const v = value.trim();
    if (!v) return;
    setText('');
    setErr('');
    try { await onSend(v); } catch (e) { setErr(e.message); setText(v); }
  };

  const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user');
  const rerun = async (newText) => {
    setErr('');
    try { await onRerun(newText); } catch (e) { setErr(e.message); }
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
        {messages.map((m, i) => (
          <Message key={m.id} m={m} bot={bot} onShowSteps={onShowSteps}
            canRetry={!busy && i === messages.length - 1 && m.role === 'assistant'}
            canEdit={!busy && i === lastUserIdx}
            onRetry={() => rerun()}
            onEdit={(t) => rerun(t)} />
        ))}
        {busy && (
          <div className="msg assistant">
            <Avatar bot={bot} size={28} />
            {draft
              ? <div className="assistant-body streaming"><Markdown text={draft} /></div>
              : <div className="typing"><span /><span /><span /></div>}
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
        {queued.length > 0 && (
          <div className="queue">
            <div className="queue-title">En cola · {bot.name} lo hará al terminar</div>
            {queued.map((q, i) => (
              <div key={q.id} className="queue-item">
                <span className="queue-n">{i + 1}</span>
                <span className="queue-text">{q.text}</span>
                <button className="icon-btn" onClick={() => onRemoveQueued(q.id)} aria-label="Quitar de la cola" title="Quitar de la cola">×</button>
              </div>
            ))}
          </div>
        )}
        <div className="composer">
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            placeholder={busy ? 'Escribe y se pondrá en cola…' : `Mensaje para ${bot.name}…`}
            onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`; }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              if (e.key === 'Escape' && busy) onStop();
            }}
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
                    <option key={m} value={`${p.id}::${m}`}>{p.id === 'demo' ? 'Demo (sin IA)' : m}{p.live && !p.models.includes(m) ? ' (ya no disponible)' : ''}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {busy && text.trim() && (
              <button className="queue-btn" onClick={() => send()} title="Se enviará cuando termine">+ A la cola</button>
            )}
            {busy ? (
              <button className="send stop" onClick={onStop} aria-label="Parar ahora" title="Parar ahora">
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" /></svg>
              </button>
            ) : (
              <button className="send" onClick={() => send()} disabled={!text.trim()} aria-label="Enviar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Message({ m, bot, onShowSteps, canRetry, canEdit, onRetry, onEdit }) {
  const [editing, setEditing] = useState(null);
  if (m.role === 'user') {
    if (editing !== null) {
      return (
        <div className="msg user">
          <div className="edit-box">
            <textarea autoFocus rows={Math.min(8, editing.split('\n').length + 1)} value={editing}
              onChange={(e) => setEditing(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (editing.trim()) { onEdit(editing); setEditing(null); } }
                if (e.key === 'Escape') setEditing(null);
              }} />
            <div className="edit-actions">
              <button className="btn small ghost" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="btn small primary" disabled={!editing.trim()} onClick={() => { onEdit(editing); setEditing(null); }}>Enviar</button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="msg user">
        {m.from && <div className="tag">Delegado por {m.from}</div>}
        {m.source === 'routine' && <div className="tag">Rutina automática</div>}
        <div className="bubble">{m.content}</div>
        {canEdit && <button className="msg-action" onClick={() => setEditing(m.content)} title="Editar y volver a enviar">✎ Editar</button>}
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
          {canRetry && <button onClick={onRetry} title="Generar otra respuesta">↻ Reintentar</button>}
        </div>
      </div>
    </div>
  );
}
