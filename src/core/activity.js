// Log of everything bots do on your devices (your browser, their computer): what, when, with
// which permission, and what happened. Kept on your server; the last 1000 actions.
import { getDb, newId, now, save } from './store.js';
import { broadcast } from './events.js';

export const DEVICE_TOOL = /^(mi_navegador_|computer_)/;
export const activity = () => (getDb().activity ??= []);

export function logActivity({ bot, tool, label, args, result, status, approval }) {
  const list = activity();
  list.unshift({
    id: newId(), at: now(), botId: bot.id, botName: bot.name, tool, label,
    args: JSON.stringify(args || {}).slice(0, 400), result: String(result || '').slice(0, 400), status, approval: approval || null,
  });
  if (list.length > 1000) list.length = 1000;
  save();
  broadcast({ type: 'activity', botId: bot.id });
}

export function clearActivity(botId) {
  getDb().activity = botId ? activity().filter((a) => a.botId !== botId) : [];
  save();
  broadcast({ type: 'activity', botId });
}
