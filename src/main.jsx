import { createRoot } from 'react-dom/client';
import { ready } from './core/store.js';
import App from './App.jsx';
import './styles.css';

ready.then(() => createRoot(document.getElementById('root')).render(<App />));

// Installable app + offline shell (only in the published build).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
