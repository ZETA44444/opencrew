// Runs JavaScript written by a bot, isolated from the app:
// - a sandboxed iframe with an opaque origin (no access to your keys, IndexedDB, cookies or the page)
// - a Content-Security-Policy with no network access (no fetch, no images, no requests at all)
// - the code itself runs in a Web Worker inside that iframe, so an infinite loop can't freeze the app;
//   after the time limit the whole iframe is removed.
const WORKER = `
const fmt = (v) => { if (typeof v === 'string') return v; try { return JSON.stringify(v, null, 2); } catch { return String(v); } };
self.onmessage = async (e) => {
  const logs = [];
  const log = (...a) => { if (logs.length < 500) logs.push(a.map(fmt).join(' ')); };
  console.log = console.info = console.warn = console.error = console.debug = log;
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const result = await new AsyncFunction(e.data)();
    postMessage({ ok: true, logs, result: result === undefined ? undefined : fmt(result) });
  } catch (err) {
    postMessage({ ok: false, logs, error: String((err && err.stack) || err).split('\\n').slice(0, 4).join('\\n') });
  }
};`;

const page = (id) => `<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:">
<script>
  const w = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(WORKER)}], { type: 'text/javascript' })));
  w.onmessage = (e) => parent.postMessage({ id: ${JSON.stringify(id)}, ...e.data }, '*');
  w.onerror = (e) => { e.preventDefault(); parent.postMessage({ id: ${JSON.stringify(id)}, ok: false, error: e.message, logs: [] }, '*'); };
  window.onmessage = (e) => w.postMessage(e.data);
  parent.postMessage({ id: ${JSON.stringify(id)}, ready: true }, '*');
<\/script>`;

export function runJavaScript(code, { timeoutMs = 10_000 } = {}) {
  // On the server, code runs in a throwaway, network-less container instead (see server/sandbox.mjs).
  if (globalThis.OPENCREW_RUN_JS) return globalThis.OPENCREW_RUN_JS(String(code), { timeoutMs });
  if (typeof document === 'undefined') return Promise.resolve({ ok: false, logs: [], error: 'Ejecutar código no está disponible aquí.', ms: 0 });
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.style.display = 'none';
    iframe.srcdoc = page(id);
    const t0 = performance.now();
    let timer;
    const done = (out) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      iframe.remove();
      resolve({ ...out, ms: Math.round(performance.now() - t0) });
    };
    const onMsg = (e) => {
      if (e.source !== iframe.contentWindow || e.data?.id !== id) return;
      if (e.data.ready) { iframe.contentWindow.postMessage(String(code), '*'); return; }
      done(e.data);
    };
    window.addEventListener('message', onMsg);
    timer = setTimeout(() => done({ ok: false, logs: [], error: `Tiempo agotado: el código tardó más de ${timeoutMs / 1000} s y se detuvo.` }), timeoutMs);
    document.body.appendChild(iframe);
  });
}

export function formatRun(r) {
  const parts = [];
  if (r.logs?.length) parts.push(`Salida:\n${r.logs.join('\n')}`);
  if (r.ok && r.result !== undefined) parts.push(`Resultado: ${r.result}`);
  if (!r.ok) parts.push(`Error: ${r.error}`);
  if (!parts.length) parts.push('(sin salida: usa console.log o return)');
  return `${parts.join('\n\n')}\n\n(${r.ms} ms)`.slice(0, 8000);
}
