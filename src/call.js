// Voice call with a bot (or a group of bots): listen → detect when you stop talking → send →
// read the answer aloud with that bot's voice → listen again. Works with any model.
import { api } from './api.js';
import { getBot } from './core/store.js';
import { dictationSupported, preferCloudDictation, cloudDictationAvailable, transcribe, speakAsync, stopSpeaking, voiceForBot, toSpeech } from './voice.js';

const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
const SILENCE_MS = 1100;

export class CallSession {
  constructor({ threadId, onState, onLine, onError, rate = 1 }) {
    Object.assign(this, { threadId, onState, onLine, onError, rate });
    this.state = 'idle';
    this.closed = false;
    this.speakQueue = [];
    this.unsub = null;
  }

  set(state) { this.state = state; this.onState?.(state); }

  async start() {
    // Listen for the bots' answers in this chat.
    this.unsub = api.subscribe((ev) => {
      if (this.closed) return;
      if (ev.type === 'message' && ev.botId === this.threadId && ev.message.role === 'assistant' && !ev.message.from) {
        const bot = getBot(ev.message.botId) || getBot(this.threadId);
        this.onLine?.({ who: bot?.name || 'Bot', text: ev.message.content });
        if (!ev.message.stopped) this.speakQueue.push({ bot, text: ev.message.content });
        this.drain();
      }
      if (ev.type === 'status' && ev.botId === this.threadId && !ev.busy) {
        this.botDone = true;
        this.drain();
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
    this.closed = true;
    this.stopListening();
    stopSpeaking();
    this.unsub?.();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioCtx?.close().catch(() => {});
    this.set('ended');
  }
}
