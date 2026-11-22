// Browser notifications: tell you when a routine finishes, or a bot answers while the app is in the background.
import { getDb } from './store.js';

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const notifyPermission = () => (notifySupported() ? Notification.permission : 'unsupported');

export async function askPermission() {
  if (!notifySupported()) return 'unsupported';
  return Notification.requestPermission();
}

const plain = (md) => String(md || '').replace(/[*_`#>]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();

export async function notify({ title, body, threadId, kind }) {
  const s = getDb().settings.notifications || {};
  if (kind === 'routine' && s.routines === false) return;
  if (kind === 'reply' && !s.replies) return;
  if (notifyPermission() !== 'granted') return;
  const options = { body: plain(body).slice(0, 180), icon: './icon-192.png', badge: './icon-192.png', tag: `opencrew-${threadId}`, data: { threadId } };
  try {
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      window.dispatchEvent(new CustomEvent('oc-open-thread', { detail: threadId }));
      n.close();
    };
  } catch {
    // Some mobile browsers only allow notifications through the service worker.
    const reg = await navigator.serviceWorker?.getRegistration?.();
    reg?.showNotification(title, options);
  }
}
