import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Sidebar from './components/Sidebar.jsx';
import Chat from './components/Chat.jsx';
import RightPanel from './components/RightPanel.jsx';
import BotModal from './components/BotModal.jsx';
import SettingsModal from './components/SettingsModal.jsx';

export default function App() {
  const [state, setState] = useState(null);
  const [selectedId, setSelectedId] = useState(() => localStorageGet('oc.bot'));
  const [messages, setMessages] = useState([]);
  const [steps, setSteps] = useState({}); // runId -> step[]
  const [runOf, setRunOf] = useState({}); // botId -> latest runId
  const [pinnedSteps, setPinnedSteps] = useState(null); // steps of a clicked past message
  const [artifactsTick, setArtifactsTick] = useState(0);
  const [modal, setModal] = useState(null); // {type:'bot', bot?} | {type:'settings'}
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 1100);
  const [navOpen, setNavOpen] = useState(false);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const refresh = useCallback(() => api.state().then(setState).catch(console.error), []);
  useEffect(() => { refresh(); }, [refresh]);

  // Pick a bot once loaded (or if the selected one was deleted).
  useEffect(() => {
    if (!state) return;
    if (!state.bots.find((b) => b.id === selectedId)) setSelectedId(state.bots.find((b) => b.starred)?.id || state.bots[0]?.id || null);
  }, [state, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    localStorageSet('oc.bot', selectedId);
    setPinnedSteps(null);
    api.messages(selectedId).then(setMessages).catch(console.error);
  }, [selectedId]);

  // Live events from the server.
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === 'message' && ev.botId === selectedRef.current) {
        setMessages((m) => (m.some((x) => x.id === ev.message.id) ? m : [...m, ev.message]));
      } else if (ev.type === 'step') {
        const s = ev.step;
        setSteps((all) => {
          const list = all[s.runId] || [];
          const i = list.findIndex((x) => x.id === s.id);
          const next = i >= 0 ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s];
          return { ...all, [s.runId]: next };
        });
        if (s.depth === 0) setRunOf((r) => (r[s.botId] === s.runId ? r : { ...r, [s.botId]: s.runId }));
        if (s.depth === 0 && s.botId === selectedRef.current) setPinnedSteps(null);
      } else if (ev.type === 'status') {
        setState((st) => st && { ...st, busy: ev.busy ? [...new Set([...st.busy, ev.botId])] : st.busy.filter((b) => b !== ev.botId) });
      } else if (ev.type === 'bots' || ev.type === 'routines') {
        refresh();
      } else if (ev.type === 'artifacts') {
        setArtifactsTick((t) => t + 1);
      }
    };
    return () => es.close();
  }, [refresh]);

  if (!state) return <div className="loading">Cargando OpenCrew…</div>;

  const bot = state.bots.find((b) => b.id === selectedId);
  const liveSteps = bot && runOf[bot.id] ? steps[runOf[bot.id]] || [] : [];
  const shownSteps = pinnedSteps || liveSteps;
  const noKeys = !state.providers.some((p) => !p.noKey && p.hasKey);

  return (
    <div className={`app ${panelOpen ? '' : 'panel-closed'} ${navOpen ? 'nav-open' : ''}`}>
      <Sidebar
        bots={state.bots}
        busy={state.busy}
        selectedId={selectedId}
        onSelect={(id) => { setSelectedId(id); setNavOpen(false); }}
        onNew={() => setModal({ type: 'bot' })}
        onSettings={() => setModal({ type: 'settings' })}
        noKeys={noKeys}
      />
      {bot ? (
        <Chat
          bot={bot}
          bots={state.bots}
          providers={state.providers}
          messages={messages}
          busy={state.busy.includes(bot.id)}
          onSend={(text) => api.chat(bot.id, text)}
          onChangeModel={(provider, model) => api.updateBot(bot.id, { provider, model }).then(refresh)}
          onEdit={() => setModal({ type: 'bot', bot })}
          onClear={() => api.clear(bot.id).then(() => setMessages([]))}
          onShowSteps={(s) => { setPinnedSteps(s); setPanelOpen(true); }}
          onTogglePanel={() => setPanelOpen((o) => !o)}
          onToggleNav={() => setNavOpen((o) => !o)}
          onOpenSettings={() => setModal({ type: 'settings' })}
        />
      ) : (
        <main className="chat empty-state"><button className="btn primary" onClick={() => setModal({ type: 'bot' })}>Crea tu primer bot</button></main>
      )}
      {bot && panelOpen && (
        <RightPanel
          bot={bot}
          state={state}
          steps={shownSteps}
          pinned={!!pinnedSteps}
          onUnpin={() => setPinnedSteps(null)}
          artifactsTick={artifactsTick}
          refresh={refresh}
          onClose={() => setPanelOpen(false)}
        />
      )}
      {modal?.type === 'bot' && (
        <BotModal
          bot={modal.bot}
          providers={state.providers}
          tools={state.tools}
          onClose={() => setModal(null)}
          onSaved={(b) => { setModal(null); refresh().then(() => setSelectedId(b.id)); }}
          onDeleted={() => { setModal(null); refresh(); }}
        />
      )}
      {modal?.type === 'settings' && (
        <SettingsModal providers={state.providers} onClose={() => setModal(null)} onSaved={refresh} />
      )}
    </div>
  );
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
