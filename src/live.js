// Native low-latency voice: Gemini Live (audio over a WebSocket) or OpenAI Realtime (WebRTC).
// Optional, with your key. In server mode the server hands out a short-lived token, so your
// key never reaches the browser. Same interface as CallSession so the call screen can use either.
// The conversation is saved to the chat when you hang up. Tools are not used in this mode.
import { getDb } from './core/store.js';
import { liveSetup } from './core/livevoice.js';
import { api } from './api.js';
import { isRemote, remoteHasKey, rpc } from './remote.js';

const GEMINI_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const GEMINI_WS_TOKEN = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';

const hasKey = (provider) => (isRemote() ? remoteHasKey(provider) : !!getDb().keys[provider]);
export function liveAvailable(provider = 'gemini') {
  if (!hasKey(provider)) return false;
  return provider === 'openai' ? typeof RTCPeerConnection !== 'undefined' : typeof WebSocket !== 'undefined' && typeof AudioContext !== 'undefined';
}
const setupFor = (botId, provider) => (isRemote() ? rpc('liveSetup', [botId, provider]) : liveSetup(botId, provider));

// Save what was said in the call to the bot's chat (here or on your server).
async function saveTurns(threadId, turns, model) {
  if (!turns.length) return;
  await api.appendCallTranscript(threadId, turns, model).catch((e) => console.error('No se pudo guardar la llamada:', e));
}

const toB64 = (buf) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
function floatToPcm16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) { const v = Math.max(-1, Math.min(1, f32[i])); out[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  return out.buffer;
}

export class LiveSession {
  constructor({ threadId, botName, onState, onLine, onError, onFallback }) {
    Object.assign(this, { threadId, botName, onState, onLine, onError, onFallback });
    this.closed = false;
    this.turns = []; // { role, content } saved to the chat on hang-up
    this.userText = '';
    this.botText = '';
    this.sources = new Set();
    this.playAt = 0;
  }

  set(state) { this.state = state; this.onState?.(state); }

  async start() {
    try {
      const cfg = await setupFor(this.threadId, 'gemini');
      if (this.closed) return;
      this.model = cfg.model;
      this.ws = new WebSocket(cfg.token ? `${GEMINI_WS_TOKEN}?access_token=${encodeURIComponent(cfg.token)}` : `${GEMINI_WS}?key=${encodeURIComponent(cfg.key)}`);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => this.ws.send(JSON.stringify({ setup: {
        model: `models/${cfg.model}`,
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voice } } } },
        systemInstruction: { parts: [{ text: cfg.system }] },
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
    this.onLine?.({ who: this.botName || 'Bot', text: this.botText.trim() });
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
    saveTurns(this.threadId, this.turns, `gemini-live/${this.model || ''}`);
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

// OpenAI Realtime over WebRTC: the browser sends your microphone and plays the bot's voice;
// transcripts arrive on a data channel. OpenAI detects when you stop talking and lets you interrupt.
export class RealtimeSession {
  constructor({ threadId, botName, onState, onLine, onError, onFallback }) {
    Object.assign(this, { threadId, botName, onState, onLine, onError, onFallback });
    this.closed = false;
    this.turns = [];
    this.botText = '';
  }

  set(state) { this.state = state; this.onState?.(state); }

  async start() {
    try {
      const cfg = await setupFor(this.threadId, 'openai');
      if (this.closed) return;
      if (!cfg.clientSecret) throw new Error('OpenAI no devolvió una clave temporal');
      this.model = cfg.model;
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch { this.onError?.('No hay permiso para usar el micrófono.'); this.set('error'); return; }
      const pc = (this.pc = new RTCPeerConnection());
      this.audio = new Audio();
      this.audio.autoplay = true;
      pc.ontrack = (e) => { this.audio.srcObject = e.streams[0]; };
      this.stream.getTracks().forEach((t) => pc.addTrack(t, this.stream));
      const dc = (this.dc = pc.createDataChannel('oai-events'));
      dc.onmessage = (e) => { try { this.onEvent(JSON.parse(e.data)); } catch { /* ignore */ } };
      pc.onconnectionstatechange = () => {
        if (this.closed) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          if (!this.ready) this.onFallback?.('La voz de OpenAI no ha podido conectar. Uso la llamada normal.');
          else { this.onError?.('Se cortó la voz de OpenAI.'); this.set('error'); }
        }
      };
      await pc.setLocalDescription(await pc.createOffer());
      const res = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(cfg.model)}`, {
        method: 'POST', body: pc.localDescription.sdp,
        headers: { authorization: `Bearer ${cfg.clientSecret}`, 'content-type': 'application/sdp' },
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
      await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
      this.ready = true;
      this.set('listening');
    } catch (e) {
      if (!this.closed) this.onFallback?.(`La voz de OpenAI no está disponible: ${e.message}. Uso la llamada normal.`);
    }
  }

  onEvent(ev) {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started': this.set('listening'); break;
      case 'input_audio_buffer.speech_stopped': this.set('thinking'); break;
      case 'conversation.item.input_audio_transcription.completed':
        if (ev.transcript?.trim()) { this.onLine?.({ who: 'Tú', text: ev.transcript.trim() }); this.turns.push({ role: 'user', content: ev.transcript.trim() }); }
        break;
      case 'output_audio_buffer.started': case 'response.output_audio.delta': case 'response.audio.delta': this.set('speaking'); break;
      case 'response.output_audio_transcript.done': case 'response.audio_transcript.done':
        if (ev.transcript?.trim()) { this.onLine?.({ who: this.botName || 'Bot', text: ev.transcript.trim() }); this.turns.push({ role: 'assistant', content: ev.transcript.trim() }); }
        break;
      case 'output_audio_buffer.stopped': case 'output_audio_buffer.cleared': this.set('listening'); break;
      case 'error': if (ev.error?.message) this.onError?.(`OpenAI: ${ev.error.message}`); break;
      default:
    }
  }

  send(obj) { if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(obj)); }

  interrupt() { this.send({ type: 'response.cancel' }); this.send({ type: 'output_audio_buffer.clear' }); this.set('listening'); }

  hangup() {
    if (this.closed) return;
    this.closed = true;
    saveTurns(this.threadId, this.turns, `openai-realtime/${this.model || ''}`);
    try { this.dc?.close(); } catch { /* ignore */ }
    try { this.pc?.close(); } catch { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.audio) this.audio.srcObject = null;
    this.set('ended');
  }
}
