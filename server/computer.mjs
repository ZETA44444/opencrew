// Each bot's «computer» on your server: its own Docker container (terminal + headless Chromium)
// with a persistent /work folder. Created on first use, stopped after 30 minutes idle, limited
// in memory/CPU, no privileges and no access to the OpenCrew server or its data.
import { spawn } from 'node:child_process';

const IMAGE = process.env.OPENCREW_COMPUTER_IMAGE || 'opencrew-computer';
const IDLE_MS = 30 * 60_000;
const lastUsed = new Map();
const starting = new Map();
const name = (botId) => `opencrew-pc-${String(botId).replace(/[^\w-]/g, '')}`;

function run(args, { input, timeoutMs = 60_000, maxOut = 200_000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn('docker', args);
    let out = '';
    let err = '';
    let killed = false;
    const t = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, timeoutMs);
    p.stdout.on('data', (d) => { if (out.length < maxOut) out += d; });
    p.stderr.on('data', (d) => { if (err.length < 20_000) err += d; });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message, killed }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err, killed }); });
    p.stdin.on('error', () => {});
    if (input !== undefined) p.stdin.end(input); else p.stdin.end();
  });
}

async function ensure(botId) {
  const n = name(botId);
  lastUsed.set(botId, Date.now());
  if (starting.has(botId)) return starting.get(botId);
  const job = (async () => {
    const st = await run(['inspect', '-f', '{{.State.Running}}', n], { timeoutMs: 15_000 });
    if (st.code === 0 && st.out.trim() === 'true') return;
    if (st.code === 0) { const r = await run(['start', n], { timeoutMs: 30_000 }); if (r.code !== 0) throw new Error(r.err.trim()); return; }
    const img = await run(['image', 'inspect', IMAGE], { timeoutMs: 15_000 });
    if (img.code !== 0) throw new Error('El ordenador de los bots aún no está instalado en el servidor (ejecuta server/update.sh).');
    const r = await run([
      'run', '-d', '--name', n, '--init', '--hostname', 'bot',
      '-v', `${n}:/work`, '--memory', '1g', '--memory-swap', '1g', '--cpus', '1', '--pids-limit', '512', '--shm-size', '512m',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--label', 'opencrew=computer', IMAGE,
    ], { timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(r.err.trim() || 'No se pudo arrancar el ordenador');
  })().finally(() => starting.delete(botId));
  starting.set(botId, job);
  return job;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} caracteres más)` : s);
const abs = (p) => (String(p || '').startsWith('/') ? String(p) : `/work/${String(p || '').replace(/^\.\//, '')}`);

export const computer = {
  async shell(botId, command, { timeoutMs = 60_000 } = {}) {
    await ensure(botId);
    const secs = Math.max(1, Math.round(timeoutMs / 1000));
    const r = await run(['exec', '-i', '-w', '/work', name(botId), 'timeout', '-k', '5', String(secs), 'bash', '-lc', String(command)], { timeoutMs: timeoutMs + 15_000 });
    lastUsed.set(botId, Date.now());
    const text = [r.out, r.err].filter((x) => x.trim()).join('\n--- errores ---\n');
    return { code: r.killed || r.code === 124 ? 124 : r.code, output: clip(text || '(sin salida)', 10_000) };
  },

  async browse(botId, input) {
    await ensure(botId);
    const r = await run(['exec', '-i', name(botId), 'node', '/opt/oc/browse.mjs'], { input: JSON.stringify(input), timeoutMs: 150_000, maxOut: 5_000_000 });
    lastUsed.set(botId, Date.now());
    const i = r.out.lastIndexOf('__OPENCREW_BROWSE__');
    if (i < 0) return { ok: false, error: (r.err || 'el navegador no respondió').trim().split('\n').slice(-3).join(' ') };
    return JSON.parse(r.out.slice(i + 19).split('\n')[0]);
  },

  async writeFile(botId, path, content) {
    await ensure(botId);
    const p = abs(path);
    const r = await run(['exec', '-i', name(botId), 'bash', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', '_', p], { input: String(content ?? '') });
    if (r.code !== 0) throw new Error(r.err.trim() || 'No se pudo escribir');
    return p;
  },

  async readFile(botId, path, maxBytes = 2_000_000) {
    await ensure(botId);
    const p = abs(path);
    const size = await run(['exec', name(botId), 'stat', '-c', '%s', p]);
    if (size.code !== 0) throw new Error(`No existe: ${p}`);
    if (Number(size.out) > maxBytes) throw new Error(`Es demasiado grande (${Math.round(Number(size.out) / 1024)} KB; máximo ${maxBytes / 1_000_000} MB)`);
    const r = await run(['exec', name(botId), 'base64', '-w0', p], { maxOut: maxBytes * 2 });
    if (r.code !== 0) throw new Error(r.err.trim());
    return { path: p, base64: r.out.trim() };
  },

  async status(botId) {
    const st = await run(['inspect', '-f', '{{.State.Status}}', name(botId)], { timeoutMs: 15_000 });
    return st.code === 0 ? st.out.trim() : 'none';
  },

  // Deletes the container and its files.
  async remove(botId) {
    await run(['rm', '-f', name(botId)], { timeoutMs: 30_000 });
    await run(['volume', 'rm', '-f', name(botId)], { timeoutMs: 30_000 });
    lastUsed.delete(botId);
  },
};

// Stop computers nobody has used for a while (their files stay).
setInterval(async () => {
  for (const [botId, t] of lastUsed) {
    if (Date.now() - t > IDLE_MS) { lastUsed.delete(botId); await run(['stop', '-t', '5', name(botId)], { timeoutMs: 30_000 }); }
  }
}, 5 * 60_000).unref();
