import { createRoot } from 'react-dom/client';
import { DialogHost } from './dialog.jsx';
import { ready } from './core/store.js';
import { setHosted } from './remote.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles.css';

// Served by an OpenCrew server with accounts? Then sign in first and use that server.
async function detectHosted() {
  if (/github\.io$/.test(location.hostname) || location.protocol === 'file:') return null;
  try {
    const r = await fetch('./api/auth/state', { credentials: 'same-origin', signal: AbortSignal.timeout(5000) });
    const j = r.ok ? await r.json() : null;
    return j?.gateway ? j : null;
  } catch { return null; }
}

const root = createRoot(document.getElementById('root'));
(async () => {
  const hosted = await detectHosted();
  if (hosted && !hosted.user) {
    const { default: Login } = await import('./components/Login.jsx');
    root.render(<ErrorBoundary><Login state={hosted} /><DialogHost /></ErrorBoundary>);
    return;
  }
  if (hosted) setHosted(hosted);
  await ready;
  const { default: App } = await import('./App.jsx'); // after setHosted: the app then talks to the server
  root.render(<ErrorBoundary><App /><DialogHost /></ErrorBoundary>);
  window.addEventListener('oc-login-needed', () => location.reload(), { once: true });
})();

// Installable app + offline shell (only in the published build).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
