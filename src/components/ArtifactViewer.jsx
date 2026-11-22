import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Markdown from './Markdown.jsx';

const ext = (name) => (name.split('.').pop() || '').toLowerCase();

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.slice(0, 1000);
}

// Bot-made HTML runs in a sandboxed iframe with an opaque origin: it can draw charts and run its own
// scripts, but it cannot read your keys, chats or anything else of this app.
function HtmlPreview({ html }) {
  return <iframe className="artifact-frame" title="Vista previa" sandbox="allow-scripts allow-modals" srcDoc={html} />;
}

export default function ArtifactViewer({ botId, name, onClose }) {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('preview');
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { api.getArtifact(botId, name).then(setFile); }, [botId, name]);

  const kind = ext(name);
  const content = file?.content ?? '';
  const isImage = /^data:image\//.test(content);
  const canPreview = isImage || ['html', 'htm', 'md', 'markdown', 'csv', 'tsv', 'json', 'svg'].includes(kind);

  let body;
  if (!file) body = <div className="muted">Cargando…</div>;
  else if (isImage && mode !== 'code') body = <div className="artifact-image"><img src={content} alt={name} /></div>;
  else if (mode === 'code' || !canPreview) body = <pre className="artifact-code">{isImage ? `${content.slice(0, 200)}…` : content}</pre>;
  else if (kind === 'html' || kind === 'htm') body = <HtmlPreview html={content} />;
  else if (kind === 'svg') body = <HtmlPreview html={`<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${content}</body>`} />;
  else if (kind === 'md' || kind === 'markdown') body = <div className="artifact-md"><Markdown text={content} /></div>;
  else if (kind === 'csv' || kind === 'tsv') {
    const rows = parseCsv(content);
    body = (
      <div className="artifact-table">
        <table>
          <thead><tr>{(rows[0] || []).map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{rows.slice(1).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  } else if (kind === 'json') {
    let pretty = content;
    try { pretty = JSON.stringify(JSON.parse(content), null, 2); } catch { /* show as is */ }
    body = <pre className="artifact-code">{pretty}</pre>;
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal artifact-modal ${full ? 'full' : ''}`}>
        <div className="modal-head">
          <h3 className="artifact-title">{name}</h3>
          <div className="artifact-actions">
            {canPreview && (
              <div className="seg">
                <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>Vista</button>
                <button className={mode === 'code' ? 'on' : ''} onClick={() => setMode('code')}>Código</button>
              </div>
            )}
            <button className="icon-btn" title="Copiar" onClick={() => navigator.clipboard?.writeText(content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}>{copied ? '✓' : '⧉'}</button>
            <button className="icon-btn" title="Descargar" onClick={() => api.openArtifact(botId, name, true)}>↓</button>
            <button className="icon-btn" title={full ? 'Reducir' : 'Pantalla completa'} onClick={() => setFull((f) => !f)}>{full ? '⤡' : '⤢'}</button>
            <button className="icon-btn" onClick={onClose} aria-label="Cerrar">×</button>
          </div>
        </div>
        <div className="artifact-body">{body}</div>
      </div>
    </div>
  );
}
