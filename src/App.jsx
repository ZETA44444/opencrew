import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Sidebar from './components/Sidebar.jsx';
import Chat from './components/Chat.jsx';
import RightPanel from './components/RightPanel.jsx';
import BotModal from './components/BotModal.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import GroupModal from './components/GroupModal.jsx';
import SkillsModal from './components/SkillsModal.jsx';

export default function App() {
  const [state, setState] = useState(null);
  const [selectedId, setSelectedId] = useState(() => localStorageGet('oc.bot'));
  const [messages, setMessages] = useState([]);
  const [steps, setSteps] = useState({}); // runId -> step[]
  const [runOf, setRunOf] = useState({}); // botId -> latest runId
  const [pinnedSteps, setPinnedSteps] = useState(null); // steps of a clicked past message
  const [artifactsTick, setArtifactsTick] = useState(0);
  const [drafts, setDrafts] = useState({}); // botId -> text being streamed right now
  const [queued, setQueued] = useState([]); // queued messages of the selected bot
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
    if (!state.bots.find((b) => b.id === selectedId) && !state.groups.find((g) => g.id === selectedId)) setSelectedId(state.bots.find((b) => b.starred)?.id || state.bots[0]?.id || null);
  }, [state, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    localStorageSet('oc.bot', selectedId);
    setPinnedSteps(null);
    api.messages(selectedId).then(setMessages).catch(console.error);
    api.queue(selectedId).then(setQueued).catch(console.error);
  }, [selectedId]);

  // Clicking a notification opens that chat.
  useEffect(() => {
    const open = (e) => { setSelectedId(e.detail); setNavOpen(false); };
    window.addEventListener('oc-open-thread', open);
    return () => window.removeEventListener('oc-open-thread', open);
  }, []);

  // Live events from the in-browser agent engine.
  useEffect(() => {
    const unsubscribe = api.subscribe((raw) => {
      const ev = structuredClone(raw);
      if (ev.type === 'draft') {
        setDrafts((d) => ({ ...d, [ev.botId]: { text: ev.text, speaker: ev.speaker } }));
      } else if (ev.type === 'delta') {
        setDrafts((d) => ({ ...d, [ev.botId]: { text: (d[ev.botId]?.text || '') + ev.text, speaker: ev.speaker } }));
      } else if (ev.type === 'message') {
        if (ev.message.role === 'assistant') setDrafts(({ [ev.botId]: _, ...rest }) => rest);
        if (ev.botId === selectedRef.current) setMessages((m) => (m.some((x) => x.id === ev.message.id) ? m : [...m, ev.message]));
      } else if (ev.type === 'step') {
        const s = ev.step;
        setSteps((all) => {
          const list = all[s.runId] || [];
          const i = list.findIndex((x) => x.id === s.id);
          const next = i >= 0 ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s];
          return { ...all, [s.runId]: next };
        });
        const thread = s.threadId || s.botId;
        if (s.depth === 0) setRunOf((r) => (r[thread] === s.runId ? r : { ...r, [thread]: s.runId }));
        if (s.depth === 0 && thread === selectedRef.current) setPinnedSteps(null);
      } else if (ev.type === 'status') {
        setState((st) => st && { ...st, busy: ev.busy ? [...new Set([...st.busy, ev.botId])] : st.busy.filter((b) => b !== ev.botId) });
      } else if (ev.type === 'bots' || ev.type === 'routines' || ev.type === 'skills' || ev.type === 'suggestions') {
        refresh();
      } else if (ev.type === 'queue') {
        if (ev.botId === selectedRef.current) api.queue(ev.botId).then(setQueued);
      } else if (ev.type === 'artifacts') {
        setArtifactsTick((t) => t + 1);
      }
    });
    return unsubscribe;
  }, [refresh]);

  if (!state) return <div className="loading">Cargando OpenCrew…</div>;

  const group = state.groups.find((g) => g.id === selectedId);
  // A group is shown with the same Chat component, as a "bot" with several members.
  const bot = group
    ? (() => {
      const members = group.memberIds.map((id) => state.bots.find((b) => b.id === id)).filter(Boolean);
      return { id: group.id, name: group.name, title: `${members.length} bots · ${members.map((b) => b.name).join(', ')}`, description: 'Chat de grupo', isGroup: true, members };
    })()
    : state.bots.find((b) => b.id === selectedId);
  const liveSteps = bot && runOf[bot.id] ? steps[runOf[bot.id]] || [] : [];
  const shownSteps = pinnedSteps || liveSteps;
  const noKeys = !state.providers.some((p) => !p.noKey && p.hasKey);

  return (
    <div className={`app ${panelOpen ? '' : 'panel-closed'} ${navOpen ? 'nav-open' : ''}`}>
      <Sidebar
        bots={state.bots}
        groups={state.groups}
        skillsCount={state.skills.length}
        onSkills={() => setModal({ type: 'skills' })}
        busy={state.busy}
        selectedId={selectedId}
        onSelect={(id) => { setSelectedId(id); setNavOpen(false); }}
        onNew={() => setModal({ type: 'bot' })}
        onNewGroup={() => setModal({ type: 'group' })}
        onSettings={() => setModal({ type: 'settings' })}
        noKeys={noKeys}
        onClose={() => setNavOpen(false)}
      />
      {(navOpen || panelOpen) && <div className="scrim" onClick={() => { setNavOpen(false); if (window.innerWidth <= 1100) setPanelOpen(false); }} />}
      {bot ? (
        <Chat
          bot={bot}
          bots={state.bots}
          providers={state.providers}
          messages={messages}
          busy={state.busy.includes(bot.id)}
          draft={drafts[bot.id]}
          onStop={() => api.stop(bot.id)}
          missed={state.missed}
          botsById={Object.fromEntries(state.bots.map((b) => [b.id, b]))}
          onResolveMissed={(id, action) => api.resolveMissed(id, action)}
          proposals={!group && bot.starred && state.suggestions?.botId === bot.id ? state.suggestions.items : null}
          proposalsLoading={!group && bot.starred && state.suggestionsLoading}
          onRefreshProposals={() => api.refreshSuggestions()}
          onDismissProposal={(i) => api.dismissSuggestion(i)}
          queued={queued}
          onRemoveQueued={(id) => api.removeQueued(bot.id, id)}
          onRerun={(text) => api.rerunLast(bot.id, text).then(() => api.messages(bot.id)).then(setMessages)}
          onSend={(text) => api.chat(bot.id, text)}
          onChangeModel={(provider, model) => api.updateBot(bot.id, { provider, model }).then(refresh)}
          onEdit={() => setModal(group ? { type: 'group', group } : { type: 'bot', bot })}
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
      {modal?.type === 'group' && (
        <GroupModal
          group={modal.group}
          bots={state.bots}
          onClose={() => setModal(null)}
          onSaved={(g) => { setModal(null); refresh().then(() => setSelectedId(g.id)); }}
          onDeleted={() => { setModal(null); refresh(); }}
        />
      )}
      {modal?.type === 'skills' && <SkillsModal skills={state.skills} onClose={() => setModal(null)} />}
      {modal?.type === 'settings' && (
        <SettingsModal providers={state.providers} settings={state.settings} services={state.services} onClose={() => setModal(null)} onSaved={refresh} />
      )}
    </div>
  );
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
