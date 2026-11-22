import { createRoot } from 'react-dom/client';
import { ready } from './core/store.js';
import App from './App.jsx';
import './styles.css';

ready.then(() => createRoot(document.getElementById('root')).render(<App />));
