import Avatar from './Avatar.jsx';

export default function Sidebar({ bots, busy, selectedId, onSelect, onNew, onSettings, noKeys }) {
  const sorted = [...bots].sort((a, b) => Number(!!b.starred) - Number(!!a.starred));
  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo />
        <span>OpenCrew</span>
      </div>
      <button className="new-bot" onClick={onNew}>
        <span className="plus">+</span> Nuevo bot
      </button>
      <div className="section-label">Bots</div>
      <nav className="bot-list">
        {sorted.map((b) => (
          <button key={b.id} className={`bot-item ${b.id === selectedId ? 'active' : ''}`} onClick={() => onSelect(b.id)}>
            <div className="avatar-wrap">
              <Avatar bot={b} size={30} />
              {busy.includes(b.id) && <span className="busy-dot" title="Trabajando" />}
            </div>
            <div className="bot-meta">
              <div className="bot-name">{b.name}{b.starred && <span className="star">★</span>}</div>
              <div className="bot-sub">{b.title}</div>
            </div>
            <span className="model-tag" title={`${b.provider}/${b.model}`}>{shortModel(b)}</span>
          </button>
        ))}
      </nav>
      <button className={`settings-btn ${noKeys ? 'attention' : ''}`} onClick={onSettings}>
        <GearIcon /> Ajustes y claves
        {noKeys && <span className="badge">sin claves</span>}
      </button>
    </aside>
  );
}

export function shortModel(b) {
  if (b.provider === 'demo') return 'demo';
  return b.model.replace(/^claude-/, '').replace(/^gemini-/, 'gem-').replace(/-preview.*$/, '').slice(0, 14);
}

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="8" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M7 25L25 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
