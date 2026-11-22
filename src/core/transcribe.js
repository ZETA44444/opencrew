// Speech → text with your own key (Gemini or OpenAI). Used by dictation and calls,
// in the browser or on your server (where the keys live in server mode).
import { getDb } from './store.js';

export const canTranscribe = () => !!(getDb().keys.gemini || getDb().keys.openai);

export async function transcribeBase64(data, mime = 'audio/webm', lang = 'es-ES') {
  const keys = getDb().keys;
  const type = String(mime || 'audio/webm').split(';')[0];
  if (keys.gemini) {
    const model = 'gemini-flash-lite-latest';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': keys.gemini },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { inlineData: { mimeType: type, data } },
          { text: `Transcribe literalmente este audio (idioma probable: ${lang}). Devuelve SOLO el texto transcrito, sin comillas ni comentarios.` },
        ] }],
      }),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${out?.error?.message || ''}`);
    return (out.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  }
  if (keys.openai) {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), 'audio.webm');
    form.append('model', 'gpt-4o-mini-transcribe');
    form.append('language', String(lang).slice(0, 2));
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${keys.openai}` }, body: form });
    const out = await res.json();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${out?.error?.message || ''}`);
    return String(out.text || '').trim();
  }
  throw new Error('Para dictar en este navegador hace falta una API key de Gemini u OpenAI (Ajustes y claves).');
}
