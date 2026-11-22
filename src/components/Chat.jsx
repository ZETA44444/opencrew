import { useEffect, useRef, useState } from 'react';
import Avatar, { GroupAvatar } from './Avatar.jsx';
import Markdown from './Markdown.jsx';
import { api } from '../api.js';
import { fmtCost } from './UsageModal.jsx';
import { readAttachment, packMessage, MAX_FILES } from '../attachments.js';
import { dictationSupported, startDictation, speak, stopSpeaking, speechSupported, startCloudDictation, cloudDictationAvailable, preferCloudDictation, setDictationMode } from '../voice.js';

export default function Chat({ bot, bots, providers, messages, busy, draft, onStop, onRerun, queued = [], onRemoveQueued, proposals, proposalsLoading, onRefreshProposals, onDismissProposal, missed = [], botsById = {}, onResolveMissed, onOpenArtifact, approvals = [], onResolveApproval, onOpenThread, onSend, onChangeModel, onEdit, onClear, onShowSteps, onTogglePanel, onToggleNav, onOpenSettings }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [listening, setListening] = useState(false);
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);
  const addFiles = async (list) => {
    const incoming = [...list].slice(0, MAX_FILES - files.length);
    if (list.length > incoming.length) setErr(`Como mucho ${MAX_FILES} archivos por mensaje.`);
    for (const f of incoming) {
      try { const a = await readAttachment(f); setFiles((cur) => [...cur, a]); } catch (e) { setErr(e.message); }
    }
  };
  const stopRef = useRef(null);
  const baseRef = useRef('');
  const [transcribing, setTranscribing] = useState(false);
  const toggleDictation = () => {
    if (listening) { stopRef.current?.(); return; }
    baseRef.current = text ? `${text.trim()} ` : '';
    setErr('');
    setListening(true);
    // Cloud mode: record, then transcribe with your Gemini/OpenAI key.
    if (preferCloudDictation() || !dictationSupported) {
      stopRef.current = startCloudDictation({
        onStatus: (st) => { if (st === 'transcribing') { setListening(false); setTranscribing(true); } },
        onEnd: (t) => { setTranscribing(false); setListening(false); if (t) setText(baseRef.current + t); taRef.current?.focus(); },
        onError: (m) => { setErr(m); setListening(false); setTranscribing(false); },
      });
      return;
    }
    stopRef.current = startDictation({
      onText: (final, interim) => setText(baseRef.current + final + interim),
      onEnd: () => { setListening(false); taRef.current?.focus(); },
      onError: (m) => {
        setListening(false);
        // The browser's speech service is blocked here → switch to cloud dictation from now on.
        if (/network|service-not-allowed/.test(m)) {
          if (cloudDictationAvailable()) {
            setDictationMode('cloud');
            setErr('El dictado del navegador no funciona aquí. A partir de ahora grabaré tu voz y la transcribiré con tu clave de IA: pulsa el micrófono otra vez.');
          } else setErr('El dictado de este navegador no funciona (bloquea el servicio de voz de Google). Añade una clave de Gemini u OpenAI en Ajustes y lo haré con ella, o usa Chrome/Edge.');
        } else setErr(m);
      },
    });
  };
  useEffect(() => () => stopRef.current?.(), []);
  const endRef = useRef(null);
  const taRef = useRef(null);
  const isGroup = !!bot.isGroup;
  const provider = !isGroup && providers.find((p) => p.id === bot.provider);
  const missingKey = provider && !provider.hasKey;
  const draftText = draft?.text;
  const speaker = (isGroup && draft?.speaker && bots.find((b) => b.id === draft.speaker)) || (isGroup ? bot.members[0] : bot);
  const HeadAvatar = ({ size }) => (isGroup ? <GroupAvatar members={bot.members} size={size} /> : <Avatar bot={bot} size={size} />);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, busy]);
  // While streaming, keep the bottom in view without smooth-scroll jitter.
  useEffect(() => { if (draftText) endRef.current?.scrollIntoView({ block: 'end' }); }, [draftText]);
  useEffect(() => { setErr(''); taRef.current?.focus(); }, [bot.id]);

  const send = async (value = text) => {
    const v = value.trim();
    if (!v && !files.length) return;
    if (listening) stopRef.current?.();
    const { body, files: packed } = packMessage(v, files);
    const keep = files;
    setText('');
    setFiles([]);
    setErr('');
    try { await onSend(body, packed); } catch (e) { setErr(e.message); setText(v); setFiles(keep); }
  };

  const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user');
  const rerun = async (newText) => {
    setErr('');
    try { await onRerun(newText); } catch (e) { setErr(e.message); }
  };

  const others = bots.filter((b) => b.id !== bot.id);
  const suggestions = isGroup ? [
    `Presentaos todos, ¿qué puede hacer cada uno?`,
    bot.members[1] && `@${bot.members[1].name} empieza tú con una idea`,
    `Haced entre todos un plan para lanzar un blog`,
  ].filter(Boolean) : [
    `¿Qué sabes hacer, ${bot.name}?`,
    others[0] && `@${others[0].name} ${others[0].title === 'Investigadora' ? 'resume https://es.wikipedia.org/wiki/Inteligencia_artificial' : 'preséntate'}`,
    'recuerda que prefiero respuestas cortas',
  ].filter(Boolean);

  return (
    <main
      className={`chat ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
    >
      {dragging && <div className="drop-hint">Suelta aquí para adjuntar</div>}
      <header className="chat-header">
        <button className="icon-btn mobile-only" onClick={onToggleNav} aria-label="Bots">☰</button>
        <HeadAvatar size={34} />
        <div className="chat-title">
          <div className="name">{bot.name}</div>
          <div className="sub">{bot.title}</div>
        </div>
        <div className="header-actions">
          <button className="icon-btn" onClick={onEdit} title={isGroup ? 'Editar grupo' : 'Editar bot'}>✎</button>
          <button className="icon-btn" onClick={() => confirm(`¿Borrar la conversación con ${bot.name}?`) && onClear()} title="Borrar conversación">⌫</button>
          <button className="icon-btn" onClick={onTogglePanel} title="Panel lateral">▥</button>
        </div>
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <div className="welcome">
            <HeadAvatar size={64} />
            <h2>{bot.name}</h2>
            <p>{bot.description || bot.title}</p>
            <div className="suggestions">
              {suggestions.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Message key={m.id} m={m} bot={(isGroup && bots.find((b) => b.id === m.botId)) || bot} showName={isGroup} onShowSteps={onShowSteps} onOpenArtifact={onOpenArtifact}
            canRetry={!busy && i === messages.length - 1 && m.role === 'assistant'}
            canEdit={!busy && i === lastUserIdx}
            onRetry={() => rerun()}
            onEdit={(t) => rerun(t)} />
        ))}
        {busy && (
          <div className="msg assistant">
            <Avatar bot={speaker} size={28} />
            {draftText
              ? <div className="assistant-body streaming">{isGroup && <div className="speaker">{speaker.name}</div>}<Markdown text={draftText} /></div>
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
        {approvals.length > 0 && (
          <div className="approvals">
            {approvals.filter((a) => a.threadId === bot.id).map((a) => (
              <div key={a.id} className="approval">
                <div className="approval-head">🔐 <b>{a.botName}</b> pide permiso: {a.label}</div>
                {Object.keys(a.args).length > 0 && (
                  <details className="approval-args"><summary>Ver detalles</summary><pre>{JSON.stringify(a.args, null, 2)}</pre></details>
                )}
                <div className="approval-actions">
                  <button className="btn small primary" onClick={() => onResolveApproval(a.id, 'once')}>Permitir una vez</button>
                  <button className="btn small" onClick={() => onResolveApproval(a.id, 'always')}>Permitir siempre</button>
                  <button className="btn small ghost danger" onClick={() => onResolveApproval(a.id, 'deny')}>Denegar</button>
                </div>
              </div>
            ))}
            {approvals.filter((a) => a.threadId !== bot.id).length > 0 && (
              <button className="approval-elsewhere" onClick={() => onOpenThread(approvals.find((a) => a.threadId !== bot.id).threadId)}>
                🔐 {approvals.filter((a) => a.threadId !== bot.id).map((a) => a.botName).join(', ')} {approvals.filter((a) => a.threadId !== bot.id).length === 1 ? 'espera' : 'esperan'} tu permiso en otro chat →
              </button>
            )}
          </div>
        )}
        {missed.length > 0 && (
          <div className="missed">
            <div className="proposals-head">
              <span>⏱ Mientras OpenCrew estaba cerrada no se ejecutaron estas rutinas</span>
            </div>
            {missed.map((m) => (
              <div key={m.routineId} className="missed-row">
                <span className="missed-text"><b>{m.name}</b> · {botsById[m.botId]?.name || ''} · {m.count === 1 ? '1 vez' : `${m.count} veces`}</span>
                <button className="btn small" onClick={() => onResolveMissed(m.routineId, 'run')}>Ejecutar ahora</button>
                <button className="btn small ghost" onClick={() => onResolveMissed(m.routineId, 'skip')}>Omitir</button>
              </div>
            ))}
            {missed.length > 1 && (
              <div className="missed-row all">
                <button className="link" onClick={() => onResolveMissed('all', 'run')}>Ejecutar todas</button>
                <button className="link" onClick={() => onResolveMissed('all', 'skip')}>Omitir todas</button>
              </div>
            )}
          </div>
        )}
        {!busy && (proposalsLoading || proposals?.length > 0) && (
          <div className="proposals">
            <div className="proposals-head">
              <span>✦ {bot.name} propone</span>
              {!proposalsLoading && <button className="link" onClick={onRefreshProposals} title="Otras ideas">↻</button>}
              {!proposalsLoading && <button className="link" onClick={() => onDismissProposal(null)} title="Ocultar">×</button>}
            </div>
            {proposalsLoading ? <div className="muted small">Pensando en qué puede hacer por ti…</div> : (
              <div className="proposal-list">
                {proposals.map((p, i) => (
                  <button key={i} className="proposal" title={p.prompt} onClick={() => { onDismissProposal(i); send(p.prompt); }}>{p.title}</button>
                ))}
              </div>
            )}
          </div>
        )}
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
          {files.length > 0 && (
            <div className="pending-files">
              {files.map((f, i) => (
                <div key={i} className="pending-file" title={f.name}>
                  {f.kind === 'image' ? <img src={f.dataUrl} alt="" /> : <span className="pf-icon">{f.kind === 'pdf' ? 'PDF' : 'TXT'}</span>}
                  <span className="pf-name">{f.name}</span>
                  <button onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label="Quitar">×</button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            placeholder={busy ? 'Escribe y se pondrá en cola…' : isGroup ? 'Mensaje al grupo… (@Nombre para hablar con alguien)' : `Mensaje para ${bot.name}…`}
            onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`; }}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              if (e.key === 'Escape' && busy) onStop();
            }}
          />
          <div className="composer-bar">
            <button className="attach" onClick={() => fileRef.current?.click()} title="Adjuntar archivos (imágenes, PDF, texto)" aria-label="Adjuntar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M21 12.5l-8.5 8.5a5 5 0 0 1-7-7L14 5.5a3.5 3.5 0 0 1 5 5L10.5 19a2 2 0 0 1-3-3L15 8.5" /></svg>
            </button>
            <input ref={fileRef} type="file" multiple hidden accept="image/*,application/pdf,.pdf,.txt,.md,.csv,.tsv,.json,.xml,.html,.js,.ts,.py,.sql,.yaml,.yml,.log" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            {isGroup ? (
              <div className="members-bar">
                {bot.members.map((b) => (
                  <button key={b.id} className="member-chip" title={`${b.provider}/${b.model}`} onClick={() => { setText((t) => `@${b.name} ${t}`); taRef.current?.focus(); }}>
                    <Avatar bot={b} size={16} /> {b.name}
                  </button>
                ))}
              </div>
            ) : (
            <select
              className="model-select"
              value={`${bot.provider}::${bot.model}`}
              onChange={(e) => { const [p, ...m] = e.target.value.split('::'); onChangeModel(p, m.join('::')); }}
              title="Modelo de este bot"
            >
              {providers.map((p) => (
                <optgroup key={p.id} label={`${p.label}${p.hasKey ? '' : ' — sin clave'}`}>
                  {[...new Set([...p.models, ...(p.id === bot.provider ? [bot.model] : [])])].map((m) => (
                    <option key={m} value={`${p.id}::${m}`}>{p.id === 'demo' ? 'Demo (sin IA)' : p.id === 'auto' ? '⚡ Automático' : m}{p.live && !p.models.includes(m) ? ' (ya no disponible)' : ''}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            )}
            {(dictationSupported || cloudDictationAvailable()) && (
              <button className={`mic ${listening ? 'on' : ''} ${transcribing ? 'busy' : ''}`} onClick={toggleDictation} disabled={transcribing} title={transcribing ? 'Transcribiendo…' : listening ? 'Parar y transcribir' : 'Dictar con el micrófono'} aria-label="Dictar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              </button>
            )}
            {busy && (text.trim() || files.length > 0) && (
              <button className="queue-btn" onClick={() => send()} title="Se enviará cuando termine">+ A la cola</button>
            )}
            {busy ? (
              <button className="send stop" onClick={onStop} aria-label="Parar ahora" title="Parar ahora">
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" /></svg>
              </button>
            ) : (
              <button className="send" onClick={() => send()} disabled={!text.trim() && !files.length} aria-label="Enviar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Message({ m, bot, showName, onShowSteps, onOpenArtifact, canRetry, canEdit, onRetry, onEdit }) {
  const [editing, setEditing] = useState(null);
  const [speaking, setSpeaking] = useState(false);
  const voice = useVoiceSettings();
  const toggleSpeak = () => {
    if (speaking) { stopSpeaking(); setSpeaking(false); return; }
    setSpeaking(true);
    speak(m.content, { voiceName: voice.voiceName, rate: voice.rate, onEnd: () => setSpeaking(false) });
  };
  if (m.role === 'user') {
    if (editing !== null) {
      return (
        <div className="msg user">
          <div className="edit-box">
            <textarea autoFocus rows={Math.min(8, editing.split('\n').length + 1)} value={editing}
              onChange={(e) => setEditing(e.target.value)}
              onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
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
        {m.attachments?.length > 0 && (
          <div className="msg-files">
            {m.attachments.map((a, i) => (a.kind === 'image' && a.dataUrl
              ? <img key={i} className="msg-img" src={a.dataUrl} alt={a.name} title={a.name} />
              : <span key={i} className="file-chip"><span className="file-chip-icon">{a.kind === 'pdf' ? 'PDF' : 'TXT'}</span>{a.name}</span>))}
          </div>
        )}
        <div className="bubble">{String(m.content).split(/(?:^|\n\n)\[Archivo adjunto:/)[0] || '📎'}</div>
        {canEdit && <button className="msg-action" onClick={() => setEditing(m.content)} title="Editar y volver a enviar">✎ Editar</button>}
      </div>
    );
  }
  const tools = (m.steps || []).filter((s) => s.kind === 'tool').length;
  // Files this answer created, so you can open them right from the chat.
  const files = [...new Map((m.steps || [])
    .filter((s) => (s.tool === 'write_artifact' || s.tool === 'generate_image') && s.status === 'done')
    .map((s) => [s.detail?.match(/Archivo guardado: (.+?) \(/)?.[1] || s.args?.filename, s.botId])).entries()]
    .filter(([n]) => n);
  return (
    <div className={`msg assistant ${m.error ? 'is-error' : ''}`}>
      <Avatar bot={bot} size={28} />
      <div className="assistant-body">
        {showName && <div className="speaker">{bot.name} <span>{bot.title}</span></div>}
        <Markdown text={m.content} />
        {files.length > 0 && (
          <div className="file-chips">
            {files.map(([name, botId]) => (/\.(png|jpe?g|webp|gif|svg)$/i.test(name)
              ? <ImageThumb key={name} botId={botId} name={name} onOpen={() => onOpenArtifact(botId, name)} />
              : <button key={name} className="file-chip" onClick={() => onOpenArtifact(botId, name)}>
                <span className="file-chip-icon">{/\.html?$/i.test(name) ? '◧' : '▤'}</span>{name}
              </button>
            ))}
          </div>
        )}
        <div className="msg-foot">
          <span>{m.model}</span>
          {m.usage && <span title={`${m.usage.input} tokens enviados · ${m.usage.output} recibidos`}>{((m.usage.input + m.usage.output) / 1000).toFixed(1)}k tokens · {fmtCost(m.usage.cost)}</span>}
          {m.steps?.length > 0 && (
            <button onClick={() => onShowSteps(m.steps)}>{m.steps.length} pasos{tools ? ` · ${tools} herramientas` : ''}</button>
          )}
          <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          {speechSupported && <button onClick={toggleSpeak} title="Escuchar en voz alta">{speaking ? '■ Parar' : '🔊 Escuchar'}</button>}
          {canRetry && <button onClick={onRetry} title="Generar otra respuesta">↻ Reintentar</button>}
        </div>
      </div>
    </div>
  );
}

// Generated images are shown right in the chat.
function ImageThumb({ botId, name, onOpen }) {
  const [src, setSrc] = useState(null);
  useEffect(() => { api.getArtifact(botId, name).then((a) => setSrc(/^data:image\//.test(a.content) ? a.content : null)); }, [botId, name]);
  return (
    <button className="image-thumb" onClick={onOpen} title={name}>
      {src ? <img src={src} alt={name} /> : <span className="muted small">{name}</span>}
    </button>
  );
}

// Voice settings live in the app settings; this small hook reads them once per render.
let voiceSettings = { voiceName: '', rate: 1, autoSpeak: false };
export const setVoiceSettings = (v) => { voiceSettings = { ...voiceSettings, ...v }; };
function useVoiceSettings() { return voiceSettings; }
