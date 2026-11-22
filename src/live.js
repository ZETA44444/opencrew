// Native low-latency voice with Gemini Live (audio in → audio out over one WebSocket).
// Optional: needs your Gemini key. Same interface as CallSession so the call screen can use either.
// The conversation is saved to the chat when you hang up. Tools are not used in this mode.
import { getBot, getDb, messagesOf, newId, now, save } from './core/store.js';
import { broadcast } from './core/events.js';
import { systemPrompt } from './core/agent.js';

const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'];

export const liveAvailable = () => !!getDb().keys.gemini && typeof WebSocket !== 'undefined' && typeof AudioContext !== 'undefined';

// Find a model that supports live audio with your key (newest "native-audio" first).
let cachedModel = null;
export async function liveModel() {
  if (cachedModel) return cachedModel;
  const key = getDb().keys.gemini;
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15_000) });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Gemini ${res.status}`);
  const ids = (data.models || []).filter((m) => m.supportedGenerationMethods?.includes('bidiGenerateContent')).map((m) => m.name.replace(/^models\//, ''));
  if (!ids.length) throw new Error('Tu clave de Gemini no tiene ningún modelo de voz en directo (Live).');
  ids.sort((a, b) => (/native-audio/.test(b) - /native-audio/.test(a)) || b.localeCompare(a, undefined, { numeric: true }));
  return (cachedModel = ids[0]);
}

function hashIdx(s, n) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % n; }
export const liveVoiceFor = (bot) => VOICES[hashIdx(bot.id, VOICES.length)];

const toB64 = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
function floatToPcm16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) { const v = Math.max(-1, Math.min(1, f32[i])); out[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  return out.buffer;
}

export class LiveSession {
  constructor({ threadId, onState, onLine, onError, onFallback }) {
    Object.assign(this, { threadId, onState, onLine, onError, onFallback });
    this.closed = false;
    this.turns = []; // { role, content } saved to the chat on hang-up
    this.userText = '';
    this.botText = '';
    this.sources = new Set();
    this.playAt = 0;
  }

  set(state) { this.state = state; this.onState?.(state); }

  async start() {
    const bot = getBot(this.threadId);
    try {
      const model = await liveModel();
      if (this.closed) return;
      this.ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(getDb().keys.gemini)}`);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => this.ws.send(JSON.stringify({ setup: {
        model: `models/${model}`,
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: liveVoiceFor(bot) } } } },
        systemInstruction: { parts: [{ text: `${systemPrompt(bot)}\n\nEstás en una llamada de voz: responde breve y natural, como hablando. No puedes usar herramientas en esta llamada; si hace falta una, dile al usuario que te lo pida por chat.` }] },
        inputAudioTranscription: {}, outputAudioTranscription: {},
      } }));
      this.ws.onmessage = (e) => this.onMessage(e.data);
      this.ws.onerror = () => {};
      this.ws.onclose = (e) => {
        if (this.closed) return;
        const why = e.reason || `conexión cerrada (${e.code})`;
        if (!this.ready) { this.onFallback?.(`La voz nativa no ha podido conectar: ${why}. Uso la llamada normal.`); return; }
        this.onError?.(`Se cortó la voz nativa: ${why}`);
        this.set('error');
      };
    } catch (e) {
      this.onFallback?.(`La voz nativa no está disponible: ${e.message}. Uso la llamada normal.`);
    }
  }

  async onMessage(raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw instanceof Blob ? await raw.arrayBuffer() : raw)); } catch { return; }
    if (msg.setupComplete) { this.ready = true; await this.startMic(); return; }
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.inputTranscription?.text) {
      this.userText += sc.inputTranscription.text;
      this.onLine?.({ who: 'Tú', text: this.userText, interim: true });
    }
    if (sc.interrupted) { this.stopPlayback(); this.flushBot(); this.set('listening'); }
    for (const p of sc.modelTurn?.parts || []) {
      if (p.inlineData?.data && /audio/.test(p.inlineData.mimeType || 'audio/pcm')) {
        this.flushUser();
        this.play(p.inlineData.data, Number((p.inlineData.mimeType || '').match(/rate=(\d+)/)?.[1]) || 24000);
      }
    }
    if (sc.outputTranscription?.text) { this.flushUser(); this.botText += sc.outputTranscription.text; }
    if (sc.turnComplete) { this.flushUser(); this.flushBot(); }
  }

  flushUser() {
    if (!this.userText.trim()) return;
    this.onLine?.({ who: 'Tú', text: this.userText.trim() }); // replaces the live (interim) line
    this.turns.push({ role: 'user', content: this.userText.trim() });
    this.userText = '';
  }

  flushBot() {
    if (!this.botText.trim()) return;
    const bot = getBot(this.threadId);
    this.onLine?.({ who: bot?.name || 'Bot', text: this.botText.trim() });
    this.turns.push({ role: 'assistant', content: this.botText.trim() });
    this.botText = '';
  }

  async startMic() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch { this.onError?.('No hay permiso para usar el micrófono.'); this.set('error'); return; }
    if (this.closed) return;
    this.inCtx = new AudioContext({ sampleRate: 16000 });
    const src = this.inCtx.createMediaStreamSource(this.stream);
    const proc = this.inCtx.createScriptProcessor(2048, 1, 1);
    proc.onaudioprocess = (e) => {
      if (this.closed || this.muted || this.ws?.readyState !== 1) return;
      this.ws.send(JSON.stringify({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: toB64(floatToPcm16(e.inputBuffer.getChannelData(0))) } } }));
    };
    src.connect(proc);
    proc.connect(this.inCtx.destination); // needed for the processor to run (outputs silence)
    this.proc = proc;
    this.set('listening');
  }

  play(b64, rate) {
    const ctx = (this.outCtx ??= new AudioContext({ sampleRate: 24000 }));
    const pcm = new Int16Array(fromB64(b64));
    const buf = ctx.createBuffer(1, pcm.length, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(ctx.destination);
    this.playAt = Math.max(this.playAt, ctx.currentTime);
    node.start(this.playAt);
    this.playAt += buf.duration;
    this.sources.add(node);
    this.set('speaking');
    node.onended = () => { this.sources.delete(node); if (!this.sources.size && !this.closed) this.set('listening'); };
  }

  stopPlayback() {
    for (const s of this.sources) { try { s.stop(); } catch { /* already stopped */ } }
    this.sources.clear();
    this.playAt = 0;
  }

  // Gemini Live already lets you interrupt just by talking; the button also cuts the audio.
  interrupt() { this.stopPlayback(); this.flushBot(); this.set('listening'); }

  saveTranscript() {
    this.flushUser(); this.flushBot();
    if (!this.turns.length || !getBot(this.threadId)) return;
    const thread = messagesOf(this.threadId);
    for (const t of this.turns) {
      const m = { id: newId(), role: t.role, content: t.content, createdAt: now(), source: 'call', ...(t.role === 'assistant' && { botId: this.threadId, model: 'gemini-live' }) };
      thread.push(m);
      broadcast({ type: 'message', botId: this.threadId, message: m });
    }
    save();
  }

  hangup() {
    if (this.closed) return;
    this.closed = true;
    this.saveTranscript();
    this.stopPlayback();
    try { this.proc?.disconnect(); } catch { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.inCtx?.close().catch(() => {});
    this.outCtx?.close().catch(() => {});
    try { this.ws?.close(); } catch { /* ignore */ }
    this.set('ended');
  }
}
