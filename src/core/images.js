// Image generation for bots. Uses Gemini (image models) or OpenAI (gpt-image-1), whichever key you have.
// The image is saved as a file (data URL) in the bot's Archivos, so it shows up in the chat.
import { getDb } from './store.js';

const key = (id) => getDb().keys[id] || '';

async function post(url, headers, body, label) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${label} ${res.status}: ${data?.error?.message || text.slice(0, 200)}`);
  return data;
}

let geminiImageModels = null;
async function geminiModels() {
  if (geminiImageModels) return geminiImageModels;
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key('gemini') } });
    const data = await res.json();
    geminiImageModels = (data.models || [])
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /image|nano-banana/i.test(n) && !/imagen|veo|tts/i.test(n))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch { geminiImageModels = []; }
  if (!geminiImageModels.length) geminiImageModels = ['gemini-2.5-flash-image'];
  return geminiImageModels;
}

async function gemini(prompt) {
  const errors = [];
  for (const model of (await geminiModels()).slice(0, 3)) {
    try {
      const data = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': key('gemini') },
        { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } },
        `Gemini (${model})`);
      const parts = data.candidates?.[0]?.content?.parts || [];
      const img = parts.find((p) => p.inlineData?.data);
      if (img) return { dataUrl: `data:${img.inlineData.mimeType || 'image/png'};base64,${img.inlineData.data}`, via: model };
      errors.push(`${model}: no devolvió imagen`);
    } catch (e) { errors.push(e.message); }
  }
  throw new Error(errors.join(' | '));
}

async function openai(prompt) {
  const data = await post('https://api.openai.com/v1/images/generations', { authorization: `Bearer ${key('openai')}` },
    { model: 'gpt-image-1', prompt, size: '1024x1024', n: 1 }, 'OpenAI');
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI no devolvió imagen');
  return { dataUrl: `data:image/png;base64,${b64}`, via: 'gpt-image-1' };
}

// Demo (no key): a simple generated SVG so the whole flow can be tried.
function demo(prompt) {
  const hue = [...prompt].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const esc = (t) => t.replace(/[<&>]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="512" viewBox="0 0 768 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 80) % 360},70%,25%)"/></linearGradient></defs><rect width="768" height="512" fill="url(#g)"/><circle cx="560" cy="180" r="90" fill="#fff3"/><circle cx="200" cy="360" r="140" fill="#0003"/><text x="40" y="70" font-family="system-ui" font-size="28" fill="#fff">Imagen de ejemplo (modo demo)</text><text x="40" y="470" font-family="system-ui" font-size="20" fill="#fffc">${esc(prompt.slice(0, 60))}</text></svg>`;
  return { dataUrl: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`, via: 'demo' };
}

export async function generateImage(prompt, { demoMode = false } = {}) {
  const tries = [key('gemini') && gemini, key('openai') && openai].filter(Boolean);
  if (!tries.length) {
    if (demoMode) return demo(prompt);
    throw new Error('Para generar imágenes hace falta una API key de Gemini u OpenAI (Ajustes y claves).');
  }
  const errors = [];
  for (const fn of tries) {
    try { return await fn(prompt); } catch (e) { errors.push(e.message); }
  }
  throw new Error(errors.join(' | '));
}
