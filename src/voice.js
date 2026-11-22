import { getDb, save } from './core/store.js';
import { broadcast } from './core/events.js';
import { transcribeBase64 } from './core/transcribe.js';
import { isRemote, remoteHasKey, rpc } from './remote.js';
// Voice: dictation (speech → text) and reading answers aloud (text → speech), using the browser's
// built-in Web Speech API. Nothing extra to install and no API key needed.

const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
export const dictationSupported = !!Recognition;
export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

// Starts listening. onText(finalText, interimText) is called as you speak. Returns a stop() function.
export function startDictation({ lang = navigator.language || 'es-ES', onText, onEnd, onError }) {
  if (!Recognition) { onError?.('Tu navegador no permite dictar. Prueba con Chrome o Edge.'); return () => {}; }
  const rec = new Recognition();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onText?.(finalText, interim);
  };
  rec.onerror = (e) => onError?.(e.error === 'not-allowed' ? 'No hay permiso para usar el micrófono.' : `Error de dictado: ${e.error}`);
  rec.onend = () => onEnd?.(finalText);
  rec.start();
  return () => rec.stop();
}

// Markdown → plain text that sounds natural.
export function toSpeech(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' (código omitido) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'enlace')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_>#|~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function voices() {
  if (!speechSupported) return [];
  return speechSynthesis.getVoices();
}

let current = null;
export function speak(text, { voiceName, rate = 1, onEnd } = {}) {
  if (!speechSupported) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(toSpeech(text).slice(0, 4000));
  const all = voices();
  const lang = navigator.language || 'es-ES';
  u.voice = all.find((v) => v.name === voiceName) || all.find((v) => v.lang === lang) || all.find((v) => v.lang.startsWith(lang.slice(0, 2))) || null;
  u.lang = u.voice?.lang || lang;
  u.rate = rate;
  u.onend = () => { if (current === u) current = null; onEnd?.(); };
  u.onerror = u.onend;
  current = u;
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (speechSupported) speechSynthesis.cancel();
  current = null;
}

export const isSpeaking = () => speechSupported && speechSynthesis.speaking;

// ---------- Fallback: record audio and transcribe it with your own AI key ----------
// The browser's built-in dictation sends audio to an online speech service; some browsers
// (Brave, Arc, Opera…) or networks block it and it fails with "network". In that case we
// record with the microphone and ask Gemini (or OpenAI) to transcribe.

export const cloudDictationAvailable = () => (isRemote() ? remoteHasKey('gemini') || remoteHasKey('openai') : !!(getDb().keys.gemini || getDb().keys.openai)) && typeof MediaRecorder !== 'undefined';
export const preferCloudDictation = () => getDb().settings.voice?.dictation === 'cloud';
export function setDictationMode(mode) {
  const s = getDb().settings;
  s.voice = { ...(s.voice || {}), dictation: mode };
  if (isRemote()) { rpc('updateSettings', [{ voice: s.voice }]).catch(() => {}); return; }
  save();
  broadcast({ type: 'bots' }); // refresh the app state so Ajustes shows (and keeps) the new mode
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

export async function transcribe(blob) {
  const lang = navigator.language || 'es-ES';
  const data = await toBase64(blob);
  const mime = blob.type || 'audio/webm';
  return isRemote() ? rpc('transcribeAudio', [data, mime, lang]) : transcribeBase64(data, mime, lang);
}

// Starts recording. Returns stop(); onEnd(text) is called after transcription.
export function startCloudDictation({ onStatus, onEnd, onError }) {
  let rec;
  let stream;
  let stopped = false;
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); onEnd?.(''); return; }
      const chunks = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!chunks.length) { onEnd?.(''); return; }
        onStatus?.('transcribing');
        try { onEnd?.(await transcribe(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))); } catch (e) { onError?.(e.message); }
      };
      rec.start();
      onStatus?.('recording');
    } catch (e) {
      onError?.(e.name === 'NotAllowedError' ? 'No hay permiso para usar el micrófono.' : `No se pudo usar el micrófono: ${e.message}`);
    }
  })();
  return () => { stopped = true; if (rec && rec.state !== 'inactive') rec.stop(); };
}

// A distinct, stable voice for each bot (same language as the app), so group calls sound like a team.
export function voiceForBot(bot) {
  if (bot?.voiceName) return bot.voiceName;
  const lang = (navigator.language || 'es').slice(0, 2);
  const sameLang = voices().filter((v) => v.lang.toLowerCase().startsWith(lang));
  // Skip novelty/robotic system voices when there are normal ones.
  const NOVELTY = /grandpa|grandma|rocko|eddy|flo\b|reed|sandy|shelley|bad news|bells|bubbles|boing|jester|whisper|zarvox|trinoids|organ|cellos|superstar|wobble|bahh|albert|fred|junior|ralph|kathy/i;
  const normal = sameLang.filter((v) => !NOVELTY.test(v.name));
  const list = normal.length >= 2 ? normal : sameLang;
  if (!list.length) return '';
  const h = [...String(bot?.id || bot?.name || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
  return list[Math.abs(h) % list.length].name;
}

export function speakAsync(text, opts = {}) {
  return new Promise((resolve) => speak(text, { ...opts, onEnd: resolve }));
}
