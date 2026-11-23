import { useCallback, useEffect, useRef, useState } from 'react';
import { api, serverMode } from './api.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { lazy, Suspense } from 'react';
const ComputerViewer = lazy(() => import('./components/ComputerViewer.jsx'));
import Sidebar from './components/Sidebar.jsx';
import Chat, { setVoiceSettings } from './components/Chat.jsx';
import { speak } from './voice.js';
import RightPanel from './components/RightPanel.jsx';
import BotModal from './components/BotModal.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import GroupModal from './components/GroupModal.jsx';
import SkillsModal from './components/SkillsModal.jsx';
import ArtifactViewer from './components/ArtifactViewer.jsx';
import ConnectorsModal from './components/ConnectorsModal.jsx';
import UsageModal from './components/UsageModal.jsx';
import ProjectModal from './components/ProjectModal.jsx';
import CallOverlay from './components/CallOverlay.jsx';

export default function App() {
  const [state, setState] = useState(null);
  const [selectedId, setSelectedId] = useState(() => localStorageGet('oc.bot'));
  const [messages, setMessages] = useState([]);
  const [steps, setSteps] = useState({}); // runId -> step[]
  const [runOf, setRunOf] = useState({}); // botId -> latest runId
  const [pinnedSteps, setPinnedSteps] = useState(null); // steps of a clicked past message
  const [artifactsTick, setArtifactsTick] = useState(0);
  const [drafts, setDrafts] = useState({}); // botId -> text being streamed right now
  const [queued, setQueued] = useState([]);
  const [memProposals, setMemProposals] = useState([]);
  const [call, setCall] = useState(false);
  const [viewPc, setViewPc] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [serverDown, setServerDown] = useState(null);
  const [viewer, setViewer] = useState(null); // { botId, name } of the open file
  const [projectId, setProjectId] = useState(() => localStorageGet('oc.project') || ''); // queued messages of the selected bot
  const [modal, setModal] = useState(null); // {type:'bot', bot?} | {type:'settings'}
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 1100);
  const [navOpen, setNavOpen] = useState(false);
  const selectedRef = useRef(selectedId);
  const voiceRef = useRef({});
  selectedRef.current = selectedId;

  const [loadError, setLoadError] = useState('');
  const refresh = useCallback(() => api.state().then((st) => { setState(st); setLoadError(''); }).catch((e) => { console.error(e); setLoadError(e.message); }), []);
  // Server mode: when the connection comes back, reload everything.
  useEffect(() => { if (serverMode && serverDown === false) refresh(); }, [serverDown, refresh]);
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
    api.memoryProposals(selectedId).then(setMemProposals).catch(console.error);
  }, [selectedId]);

  // In-app notices (e.g. a voice task finished in the background).
  useEffect(() => {
    const add = (e) => {
      const t = { id: Math.random().toString(36).slice(2), ...e.detail };
      setToasts((ts) => [...ts, t].slice(-3));
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), 12_000);
    };
    window.addEventListener('oc-toast', add);
    return () => window.removeEventListener('oc-toast', add);
  }, []);

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
        // Read new answers aloud if enabled (only the chat you're looking at, not while hidden).
        if (ev.message.role === 'assistant' && ev.botId === selectedRef.current && voiceRef.current.autoSpeak && !document.hidden && ev.message.source !== 'routine' && !ev.message.error && !ev.message.stopped) {
          speak(ev.message.content, voiceRef.current);
        }
      } else if (ev.type === 'server') {
        setServerDown(!ev.connected);
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
      } else if (ev.type === 'bots' || ev.type === 'routines' || ev.type === 'skills' || ev.type === 'suggestions' || ev.type === 'connectors' || ev.type === 'approvals' || ev.type === 'watchers') {
        refresh();
      } else if (ev.type === 'memoryProposals') {
        if (ev.botId === selectedRef.current) api.memoryProposals(ev.botId).then(setMemProposals);
      } else if (ev.type === 'queue') {
        if (ev.botId === selectedRef.current) api.queue(ev.botId).then(setQueued);
      } else if (ev.type === 'artifacts') {
        setArtifactsTick((t) => t + 1);
      }
    });
    return unsubscribe;
  }, [refresh]);

  if (!state && serverMode && loadError) {
    return (
      <div className="loading server-offline">
        <div>☁️ No puedo conectar con tu servidor.</div>
        <div className="muted small">{loadError}</div>
        <div className="card-actions">
          <button className="btn small primary" onClick={refresh}>Reintentar</button>
          <button className="btn small ghost" onClick={() => { if (confirm('¿Volver a usar los datos de este navegador? Tu servidor sigue funcionando con los suyos.')) { localStorage.removeItem('oc.server'); location.reload(); } }}>Usar este navegador sin servidor</button>
        </div>
      </div>
    );
  }
  if (!state) return <div className="loading">Cargando OpenCrew…</div>;
  voiceRef.current = state.settings.voice || {};
  setVoiceSettings(voiceRef.current);

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
        projects={state.projects}
        projectId={state.projects.some((p) => p.id === projectId) ? projectId : ''}
        onProject={(id) => { setProjectId(id); localStorageSet('oc.project', id); }}
        onNewProject={() => setModal({ type: 'project' })}
        onEditProject={(p) => setModal({ type: 'project', project: p })}
        waiting={state.approvals.map((a) => a.threadId)}
        skillsCount={state.skills.length}
        connectorsCount={state.connectors.filter((c) => c.enabled && c.status === 'ok').length + (state.services.github ? 1 : 0)}
        onConnectors={() => setModal({ type: 'connectors' })}
        onUsage={() => setModal({ type: 'usage' })}
        onSkills={() => setModal({ type: 'skills' })}
        busy={state.busy}
        selectedId={selectedId}
        onSelect={(id) => { setSelectedId(id); setNavOpen(false); }}
        onNew={() => setModal({ type: 'bot' })}
        onNewGroup={() => setModal({ type: 'group' })}
        onSettings={() => setModal({ type: 'settings' })}
        onEditItem={(item, kind) => setModal(kind === 'group' ? { type: 'group', group: item } : { type: 'bot', bot: item })}
        onDeleteItem={async (item, kind) => {
          const msg = kind === 'group' ? `¿Borrar el grupo ${item.name} y su conversación? Los bots no se borran.` : `¿Borrar ${item.name} y su conversación?`;
          if (!confirm(msg)) return;
          try {
            await (kind === 'group' ? api.deleteGroup(item.id) : api.deleteBot(item.id));
            refresh();
          } catch (e) { alert(`No se pudo borrar: ${e.message}`); }
        }}
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
          onCall={() => setCall(true)}
          onViewComputer={serverMode && bot && !bot.isGroup && bot.computer ? () => setViewPc(true) : null}
          memProposals={group ? [] : memProposals}
          inProject={!group && state.projects.some((p) => p.botIds.includes(bot.id))}
          onResolveMemory={(id, action, scope) => api.resolveMemoryProposal(bot.id, id, action, scope)}
          approvals={state.approvals}
          onResolveApproval={(id, decision) => api.resolveApproval(id, decision)}
          onOpenThread={(id) => setSelectedId(id)}
          onOpenArtifact={(botId, name) => setViewer({ botId, name })}
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
          onSend={(text, files) => api.chat(bot.id, text, files)}
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
          onOpenArtifact={(botId, name) => setViewer({ botId, name })}
        />
      )}
      <ErrorBoundary inline key={modal?.type || 'none'} onReset={() => setModal(null)}>
      {modal?.type === 'bot' && (
        <BotModal
          bot={modal.bot}
          providers={state.providers}
          tools={state.tools}
          onClose={() => setModal(null)}
          onSaved={async (b) => {
            setModal(null);
            const p = state.projects.find((x) => x.id === projectId);
            if (!modal.bot && p && !p.botIds.includes(b.id)) await api.saveProject({ id: p.id, botIds: [...p.botIds, b.id] });
            refresh().then(() => setSelectedId(b.id));
          }}
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
      </ErrorBoundary>
      {viewPc && bot && (
        <ErrorBoundary inline onReset={() => setViewPc(false)}>
          <Suspense fallback={null}><ComputerViewer bot={bot} busy={state.busy.includes(bot.id)} onClose={() => setViewPc(false)} /></Suspense>
        </ErrorBoundary>
      )}
      {call && bot && <CallOverlay bot={bot} rate={state.settings.voice?.rate || 1} native={state.settings.voice?.native || ''} onClose={() => setCall(false)} />}
      {serverMode && serverDown && <div className="server-down" role="status">☁️ Sin conexión con tu servidor · reintentando… (tus bots siguen trabajando allí)</div>}
      {toasts.length > 0 && (
        <div className="toasts" role="status">
          {toasts.map((t) => (
            <button key={t.id} className="toast" onClick={() => { if (t.threadId) setSelectedId(t.threadId); setToasts((ts) => ts.filter((x) => x.id !== t.id)); }}>
              <b>{t.title}</b>{t.body && <span className="muted small">{t.body}</span>}
            </button>
          ))}
        </div>
      )}
      {viewer && <ArtifactViewer botId={viewer.botId} name={viewer.name} onClose={() => setViewer(null)} />}
      {modal?.type === 'project' && (
        <ProjectModal
          project={modal.project}
          bots={state.bots}
          groups={state.groups}
          onClose={() => setModal(null)}
          onSaved={(p) => { setModal(null); setProjectId(p.id); localStorageSet('oc.project', p.id); refresh(); }}
          onDeleted={() => { setModal(null); setProjectId(''); localStorageSet('oc.project', ''); refresh(); }}
        />
      )}
      {modal?.type === 'usage' && <UsageModal bots={state.bots} onClose={() => setModal(null)} />}
      {modal?.type === 'connectors' && <ConnectorsModal connectors={state.connectors} services={state.services} bots={state.bots} onClose={() => setModal(null)} />}
      {modal?.type === 'skills' && <SkillsModal skills={state.skills} onClose={() => setModal(null)} />}
      {modal?.type === 'settings' && (
        <SettingsModal providers={state.providers} settings={state.settings} services={state.services} sensitiveTools={state.sensitiveTools} onClose={() => setModal(null)} onSaved={refresh} />
      )}
    </div>
  );
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
