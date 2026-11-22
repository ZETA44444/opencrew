// Native live voice (Gemini Live / OpenAI Realtime): everything the call needs, prepared where
// your keys live. On your server it hands the browser a short-lived token instead of your key.
import { getBot, getDb } from './store.js';
import { systemPrompt } from './agent.js';

const GEMINI_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'];
const OPENAI_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'sage', 'verse'];
const onServer = () => typeof window === 'undefined';
function hashIdx(s, n) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % n; }
export const voiceFor = (provider, bot) => (provider === 'openai' ? OPENAI_VOICES : GEMINI_VOICES)[hashIdx(bot.id, 8)];

const CALL_NOTE = 'Estás en una llamada de voz: responde breve y natural, como hablando. No puedes usar herramientas en esta llamada; si hace falta una, dile al usuario que te lo pida por chat.';

const cache = {};
async function geminiModel(key) {
  if (cache.gemini) return cache.gemini;
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15_000) });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Gemini ${res.status}`);
  const ids = (data.models || []).filter((m) => m.supportedGenerationMethods?.includes('bidiGenerateContent')).map((m) => m.name.replace(/^models\//, ''));
  if (!ids.length) throw new Error('Tu clave de Gemini no tiene ningún modelo de voz en directo (Live).');
  ids.sort((a, b) => (/native-audio/.test(b) - /native-audio/.test(a)) || b.localeCompare(a, undefined, { numeric: true }));
  return (cache.gemini = ids[0]);
}

async function openaiModel(key) {
  if (cache.openai) return cache.openai;
  const res = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  const data = await res.json().catch(() => ({}));
  const ids = (data.data || []).map((m) => m.id).filter((id) => /^gpt-realtime/.test(id) && !/mini/.test(id));
  ids.sort((a, b) => (/preview/.test(a) - /preview/.test(b)) || a.length - b.length || b.localeCompare(a));
  return (cache.openai = ids[0] || 'gpt-realtime');
}

// Returns { provider, model, voice, system, ...credentials } for the browser to open the call.
export async function liveSetup(botId, provider = 'gemini') {
  const bot = getBot(botId);
  if (!bot) throw new Error('Bot no encontrado');
  const key = getDb().keys[provider];
  if (!key) throw new Error(`Falta la clave de ${provider === 'openai' ? 'OpenAI' : 'Gemini'}`);
  const system = `${systemPrompt(bot)}\n\n${CALL_NOTE}`;
  const voice = voiceFor(provider, bot);

  if (provider === 'openai') {
    const model = await openaiModel(key);
    // Short-lived client secret: the browser never sees your real key.
    const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: 600 },
        session: {
          type: 'realtime', model, instructions: system,
          audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'server_vad' } }, output: { voice } },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || 'no se pudo crear la sesión de voz'}`);
    return { provider, model, voice, clientSecret: data.value || data.client_secret?.value };
  }

  const model = await geminiModel(key);
  if (!onServer()) return { provider, model, voice, system, key }; // your own browser: use the key directly
  const now = Date.now();
  const res = await fetch('https://generativelanguage.googleapis.com/v1alpha/auth_tokens', {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ uses: 1, expireTime: new Date(now + 30 * 60_000).toISOString(), newSessionExpireTime: new Date(now + 60_000).toISOString() }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.name) throw new Error(`Gemini ${res.status}: ${data?.error?.message || 'no se pudo crear el token temporal'}`);
  return { provider, model, voice, system, token: data.name };
}
