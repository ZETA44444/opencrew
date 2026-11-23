// Links with your devices: the OpenCrew browser extension and the OpenCrew desktop app. Each one
// opens a WebSocket to your server; bots send it commands and it answers. Each kind is paired
// with its own code, separate from your main token, that you can revoke at any time.
import { createHash, timingSafeEqual } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const frame = (data, opcode = 1) => {
  const len = data.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, data]);
};
const same = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());

export function createDeviceLink(label) {
let conn = null; // { socket, send, info, since }
const waiting = new Map(); // id -> { resolve, reject, timer }
let seq = 0;
let onHello = null;

const link = {
  connected: () => !!conn,
  info: () => (conn ? { ...conn.info, since: conn.since } : null),
  send(cmd, args = {}, timeoutMs = 60_000) {
    if (!conn) return Promise.reject(new Error(`${label} no está conectada.`));
    const id = `c${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`${label} no respondió a tiempo`)); }, timeoutMs);
      waiting.set(id, { resolve, reject, timer });
      conn.send({ id, cmd, args });
    });
  },
  push: (obj) => conn?.send(obj),
  onHello: (fn) => { onHello = fn; },
  handleUpgrade,
};

function handleUpgrade(req, socket, url, expectedKey, onChange, onFail) {
  const fail = (code, text) => socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
  const k = url.searchParams.get('k') || '';
  if (!expectedKey() || !k || !same(k, expectedKey())) { onFail?.(); return fail(401, 'Unauthorized'); }
  const key = req.headers['sec-websocket-key'];
  if (!key) return fail(400, 'Bad Request');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${createHash('sha1').update(key + GUID).digest('base64')}`, '', ''].join('\r\n'));
  socket.setNoDelay(true);
  const me = {
    socket, since: Date.now(), info: { browser: 'navegador' },
    send: (obj) => { if (!socket.destroyed) socket.write(frame(Buffer.from(JSON.stringify(obj)))); },
  };
  if (conn) { try { conn.socket.destroy(); } catch { /* old one */ } }
  conn = me;
  onChange?.();
  const close = () => {
    if (conn === me) { conn = null; for (const [id, w] of waiting) { clearTimeout(w.timer); w.reject(new Error('Se desconectó la extensión')); waiting.delete(id); } onChange?.(); }
    socket.destroy();
  };
  let buf = Buffer.alloc(0);
  let pieces = [];
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 32 * 1024 * 1024) return close();
      const mask = masked ? buf.subarray(off, off + 4) : null;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      buf = buf.subarray(off + len);
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      if (op === 8) { me.send && socket.write(frame(Buffer.alloc(0), 8)); return close(); }
      if (op === 9) { socket.write(frame(payload, 10)); continue; }
      if (op === 10) continue;
      pieces.push(payload);
      if (!fin) continue;
      const text = Buffer.concat(pieces).toString('utf8');
      pieces = [];
      let m; try { m = JSON.parse(text); } catch { continue; }
      if (m.type === 'hello') { me.info = { browser: String(m.browser || m.device || 'dispositivo').slice(0, 60), version: String(m.version || '').slice(0, 20), folders: Array.isArray(m.folders) ? m.folders.slice(0, 50) : undefined, terminal: m.terminal }; onChange?.(); onHello?.(); continue; }
      if (m.type === 'ping') { me.send({ type: 'pong' }); continue; }
      const w = m.id && waiting.get(m.id);
      if (w) { clearTimeout(w.timer); waiting.delete(m.id); if (m.ok) w.resolve(m.result); else w.reject(new Error(m.error || 'Error en tu navegador')); }
    }
  });
  socket.on('close', close);
  socket.on('error', close);
}
return link;
}

export const extension = createDeviceLink('La extensión de OpenCrew (tu navegador)');
export const desktop = createDeviceLink('La app OpenCrew Escritorio (tu ordenador)');
