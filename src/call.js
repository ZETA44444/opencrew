// Voice call with a bot (or a group of bots): listen → detect when you stop talking → send →
// read the answer aloud with that bot's voice → listen again. Works with any model.
import { api } from './api.js';
import { getBot, messagesOf } from './core/store.js';
import { busy } from './core/agent.js';
import { notify } from './core/notify.js';
import { dictationSupported, preferCloudDictation, cloudDictationAvailable, transcribe, speakAsync, stopSpeaking, voiceForBot, toSpeech } from './voice.js';

const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
const SILENCE_MS = 1100;
// «…en segundo plano», «avísame cuando termines», «cuelga y sigue»…
export const BACKGROUND_CUE = /(en segundo plano|av[ií]s(a|ad)me cuando (termines|acabes|est[eé]|lo tengas)|cuando (termines|acabes|lo tengas),? av[ií]sa|y (luego|despu[eé]s) me (avisas|cuentas)|cuelga y sigue|sigue sin m[ií])/i;

// Background voice tasks: when the bot finishes, you get a notification, an in-app notice and a short spoken summary.
const watching = new Set();
export function finishInBackground(threadId, { rate = 1, speak = true } = {}) {
  if (watching.has(threadId) || !busy.has(threadId)) return false;
  watching.add(threadId);
  const startAt = messagesOf(threadId).length;
  const unsub = api.subscribe((ev) => {
    if (ev.botId !== threadId || ev.type !== 'status' || ev.busy) return;
    unsub();
    // The reply is saved right after the «not busy» status, so read it a moment later.
    setTimeout(() => {
      watching.delete(threadId);
      const last = messagesOf(threadId).slice(startAt).filter((m) => m.role === 'assistant' && !m.from).pop();
      const owner = getBot(threadId);
      const bot = getBot(last?.botId) || owner;
      const name = bot?.name || 'Tu bot';
      const ok = last && !last.error && !last.stopped;
      const text = last?.content || '';
      const title = ok ? `✓ ${name} ha terminado tu encargo` : `⚠️ ${name} no pudo terminar tu encargo`;
      notify({ kind: 'routine', threadId, title, body: text });
      window.dispatchEvent(new CustomEvent('oc-toast', { detail: { title, body: toSpeech(text).slice(0, 160), threadId } }));
      if (speak && ok) {
        const first = toSpeech(text).split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').slice(0, 280);
        speakAsync(`${name} ha terminado. ${first}`, { voiceName: voiceForBot(bot), rate });
      }
    }, 300);
  });
  return true;
}


export class CallSession {
  constructor({ threadId, onState, onLine, onError, onBackground, rate = 1 }) {
    Object.assign(this, { threadId, onState, onLine, onError, onBackground, rate });
    this.state = 'idle';
    this.closed = false;
    this.speakQueue = [];
    this.unsub = null;
  }

  set(state) { this.state = state; this.onState?.(state); }

  async start() {
    // Listen for the bots' answers in this chat.
    this.unsub = api.subscribe((ev) => {
      if (this.closed || this.background) return;
      if (ev.type === 'message' && ev.botId === this.threadId && ev.message.role === 'assistant' && !ev.message.from) {
        const bot = getBot(ev.message.botId) || getBot(this.threadId);
        this.onLine?.({ who: bot?.name || 'Bot', text: ev.message.content });
        if (!ev.message.stopped) this.speakQueue.push({ bot, text: ev.message.content });
        this.drain();
      }
      if (ev.type === 'status' && ev.botId === this.threadId && !ev.busy) {
        // The final reply is emitted right after this status: wait a moment so it gets spoken before listening again.
        setTimeout(() => { if (this.closed || this.background) return; this.botDone = true; this.drain(); }, 300);
      }
    });
    this.listen();
  }

  async drain() {
    if (this.speaking || this.closed) return;
    const next = this.speakQueue.shift();
    if (next) {
      this.speaking = true;
      this.set('speaking');
      this.currentBot = next.bot;
      await speakAsync(toSpeech(next.text), { voiceName: voiceForBot(next.bot), rate: this.rate });
      this.speaking = false;
      return this.drain();
    }
    if (this.botDone && this.state !== 'listening') { this.botDone = false; this.listen(); }
  }

  // Interrupt the bot: stop talking and listen to you again.
  interrupt() {
    this.speakQueue = [];
    stopSpeaking();
    api.stop(this.threadId);
    this.speaking = false;
    this.listen();
  }

  async send(text) {
    const t = String(text || '').trim();
    if (!t || this.closed) { this.listen(); return; }
    this.onLine?.({ who: 'Tú', text: t });
    this.set('thinking');
    this.botDone = false;
    if (BACKGROUND_CUE.test(t)) {
      // Hand it off: the bot keeps working, the call ends and you get told when it's done.
      const bot = getBot(this.threadId);
      const run = api.chat(this.threadId, t).catch((e) => this.onError?.(e.message));
      await new Promise((r) => setTimeout(r, 50));
      if (busy.has(this.threadId)) {
        this.background = true;
        finishInBackground(this.threadId, { rate: this.rate });
        this.onLine?.({ who: bot?.name || 'Bot', text: 'Vale, me pongo con ello. Te aviso cuando termine.' });
        this.set('speaking');
        await speakAsync('Vale, me pongo con ello. Te aviso cuando termine.', { voiceName: voiceForBot(bot), rate: this.rate });
        this.onBackground?.();
        return;
      }
      await run;
      return;
    }
    try { await api.chat(this.threadId, t); } catch (e) { this.onError?.(e.message); this.listen(); }
  }

  listen() {
    if (this.closed) return;
    this.stopListening();
    this.set('listening');
    if (Recognition && dictationSupported && !preferCloudDictation()) this.listenBrowser();
    else if (cloudDictationAvailable()) this.listenCloud();
    else { this.onError?.('Tu navegador no permite dictar. Añade una clave de Gemini u OpenAI en Ajustes para usar las llamadas.'); this.set('error'); }
  }

  listenBrowser() {
    const rec = new Recognition();
    rec.lang = navigator.language || 'es-ES';
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = '';
    let timer;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      this.onLine?.({ who: 'Tú', text: finalText + interim, interim: true });
      clearTimeout(timer);
      timer = setTimeout(() => { rec.stop(); }, SILENCE_MS); // you stopped talking
    };
    rec.onerror = (e) => {
      if (e.error === 'network' || e.error === 'service-not-allowed') {
        if (cloudDictationAvailable()) { this.stopListening(); this.listenCloud(); return; }
        this.onError?.('El dictado del navegador no funciona aquí. Añade una clave de Gemini u OpenAI en Ajustes.');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') this.onError?.(`Micrófono: ${e.error}`);
    };
    rec.onend = () => {
      clearTimeout(timer);
      if (this.rec !== rec || this.closed) return;
      this.rec = null;
      if (finalText.trim()) this.send(finalText);
      else if (this.state === 'listening') this.listenBrowser(); // keep listening
    };
    this.rec = rec;
    rec.start();
  }

  // Record with the microphone, detect silence by volume, then transcribe with your key.
  async listenCloud() {
    try {
      this.stream ??= await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch { this.onError?.('No hay permiso para usar el micrófono.'); this.set('error'); return; }
    const ctx = (this.audioCtx ??= new AudioContext());
    const src = ctx.createMediaStreamSource(this.stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const chunks = [];
    const rec = new MediaRecorder(this.stream);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    let talked = false;
    let quietSince = Date.now();
    rec.onstop = async () => {
      src.disconnect();
      if (this.closed || this.recorder !== rec) return;
      this.recorder = null;
      if (!talked) { this.listen(); return; }
      this.set('transcribing');
      try { this.send(await transcribe(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))); } catch (e) { this.onError?.(e.message); this.listen(); }
    };
    this.recorder = rec;
    rec.start();
    const loop = () => {
      if (this.recorder !== rec) return;
      analyser.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length);
      if (rms > 0.02) { talked = true; quietSince = Date.now(); }
      if ((talked && Date.now() - quietSince > SILENCE_MS) || Date.now() - quietSince > 30_000) { rec.stop(); return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stopListening() {
    const rec = this.rec; this.rec = null;
    try { rec?.abort(); } catch { /* ignore */ }
    const r = this.recorder; this.recorder = null;
    try { if (r && r.state !== 'inactive') r.stop(); } catch { /* ignore */ }
  }

  hangup() {
    if (this.closed) return;
    this.closed = true;
    if (!this.background && busy.has(this.threadId)) finishInBackground(this.threadId, { rate: this.rate });
    this.stopListening();
    stopSpeaking();
    this.unsub?.();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioCtx?.close().catch(() => {});
    this.set('ended');
  }
}
