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
