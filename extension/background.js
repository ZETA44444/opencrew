// OpenCrew extension: keeps a private connection with YOUR OpenCrew server and carries out what
// your bots ask (after you approve it in OpenCrew). Never touches passwords, cards or blocked sites.
const DEFAULT_BLOCK = 'bank, banco, banca, bbva, santander, caixabank, ing.es, openbank, revolut, wise.com, paypal, stripe.com, coinbase, binance, kraken, agenciatributaria, seg-social';
let ws = null;
let retry = 1000;
let state = { status: 'off', error: '' };

const setState = (s) => { state = { ...state, ...s }; chrome.storage.session?.set({ state }).catch(() => {}); chrome.action.setBadgeText({ text: state.status === 'on' ? '' : '!' }); chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); };
const cfg = () => chrome.storage.local.get(['server', 'key', 'block', 'paused']);

async function connect() {
  const { server, key, paused } = await cfg();
  if (!server || !key) { setState({ status: 'off', error: 'Sin emparejar' }); return; }
  if (paused) { setState({ status: 'paused', error: '' }); return; }
  if (ws && ws.readyState <= 1) return;
  const url = `${server.replace(/^http/, 'ws').replace(/\/+$/, '')}/api/ext?k=${encodeURIComponent(key)}`;
  try { ws = new WebSocket(url); } catch (e) { setState({ status: 'error', error: e.message }); return schedule(); }
  setState({ status: 'connecting', error: '' });
  ws.onopen = () => { retry = 1000; setState({ status: 'on', error: '' }); ws.send(JSON.stringify({ type: 'hello', browser: navigator.brave ? 'Brave' : 'Chrome', version: chrome.runtime.getManifest().version })); };
  ws.onmessage = async (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (!m.id || !m.cmd) return;
    try { const result = await run(m.cmd, m.args || {}); ws.send(JSON.stringify({ id: m.id, ok: true, result })); }
    catch (err) { ws.send(JSON.stringify({ id: m.id, ok: false, error: String(err.message || err) })); }
  };
  ws.onclose = () => { ws = null; if (state.status !== 'paused') { setState({ status: 'error', error: 'Sin conexión con tu servidor; reintentando…' }); schedule(); } };
  ws.onerror = () => {};
}
function schedule() { setTimeout(connect, retry); retry = Math.min(retry * 2, 60_000); }

// Keep the service worker alive and the link up (Chrome stops idle workers).
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'ping' })); else connect(); });
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(() => { chrome.storage.local.get('block').then(({ block }) => { if (block === undefined) chrome.storage.local.set({ block: DEFAULT_BLOCK }); }); connect(); });
chrome.storage.onChanged.addListener((c) => { if (c.server || c.key || c.paused) { try { ws?.close(); } catch { /* */ } ws = null; connect(); } });
chrome.runtime.onMessage.addListener((msg, _s, reply) => { if (msg === 'state') { reply(state); } else if (msg === 'reconnect') { connect(); reply(true); } return true; });
connect();

// ---------- actions ----------
async function blocked(url) {
  const { block } = await cfg();
  const list = String(block ?? DEFAULT_BLOCK).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const u = String(url || '').toLowerCase();
  return u.startsWith('chrome') || u.startsWith('brave') || u.startsWith('edge') || list.some((b) => u.includes(b));
}
async function tabFor(tabId) {
  const tab = tabId ? await chrome.tabs.get(Number(tabId)) : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab) throw new Error('No encuentro esa pestaña');
  if (await blocked(tab.url)) throw new Error('Esta web está bloqueada para los bots (puedes cambiarlo en la extensión)');
  return tab;
}
const inPage = async (tab, func, args = []) => (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args }))[0]?.result;

// Little notice on the page so you see a bot is using it.
function banner(text) {
  let el = document.getElementById('__opencrew_banner');
  if (!el) { el = document.createElement('div'); el.id = '__opencrew_banner'; el.style.cssText = 'position:fixed;z-index:2147483647;top:10px;right:10px;background:#0b0b0c;color:#ededed;font:13px system-ui;padding:8px 12px;border-radius:999px;border:1px solid #3a3a3d;box-shadow:0 6px 20px rgba(0,0,0,.4);pointer-events:none'; document.documentElement.appendChild(el); }
  el.textContent = `🤖 OpenCrew: ${text}`;
  clearTimeout(window.__ocBannerT); window.__ocBannerT = setTimeout(() => el.remove(), 4000);
}

async function run(cmd, a) {
  if (cmd === 'tabs') {
    const tabs = await chrome.tabs.query({});
    const out = [];
    for (const t of tabs) out.push({ id: t.id, title: (await blocked(t.url)) ? '(web bloqueada)' : t.title, url: (await blocked(t.url)) ? '' : t.url, active: t.active, windowId: t.windowId });
    return out;
  }
  if (cmd === 'open') {
    if (!/^https?:\/\//.test(a.url || '')) throw new Error('Solo puedo abrir direcciones http(s)');
    if (await blocked(a.url)) throw new Error('Esa web está bloqueada para los bots');
    const t = await chrome.tabs.create({ url: a.url, active: false });
    return { id: t.id, url: a.url };
  }
  const tab = await tabFor(a.tabId);
  if (cmd === 'read') {
    await inPage(tab, banner, ['leyendo esta pestaña']);
    return inPage(tab, () => {
      const label = (el) => (el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.placeholder || el.name || el.id || '').trim().slice(0, 60);
      const sel = (el) => (el.id ? `#${CSS.escape(el.id)}` : el.name ? `${el.tagName.toLowerCase()}[name="${el.name}"]` : el.tagName.toLowerCase());
      const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=password]),textarea,select')].filter((el) => !/cc-|card|cvc|iban/i.test(el.autocomplete + el.name + el.id)).slice(0, 40).map((el) => ({ label: label(el), selector: sel(el) }));
      return {
        title: document.title, url: location.href,
        text: (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 15000),
        links: [...document.querySelectorAll('a[href]')].map((x) => [x.innerText.trim().slice(0, 60), x.href]).filter(([t]) => t).slice(0, 40),
        fields,
      };
    });
  }
  if (cmd === 'click') {
    await inPage(tab, banner, [`clic en «${a.target}»`]);
    const r = await inPage(tab, (target) => {
      let el = null;
      try { if (/^[#.\[]|^[a-z]+[#.\[]/i.test(target)) el = document.querySelector(target); } catch { /* not a selector */ }
      if (!el) {
        const t = target.toLowerCase();
        const all = [...document.querySelectorAll('a,button,[role=button],input[type=submit],input[type=button],label,summary,[onclick]')];
        el = all.find((x) => (x.innerText || x.value || x.getAttribute('aria-label') || '').trim().toLowerCase() === t)
          || all.find((x) => (x.innerText || x.value || x.getAttribute('aria-label') || '').toLowerCase().includes(t));
      }
      if (!el) return { error: `No encuentro «${target}» en la página` };
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { clicked: (el.innerText || el.value || el.getAttribute('aria-label') || target).trim().slice(0, 60) };
    }, [String(a.target || '')]);
    if (r?.error) throw new Error(r.error);
    await new Promise((res) => setTimeout(res, 1200));
    const now = await chrome.tabs.get(tab.id);
    return { ...r, title: now.title, url: now.url };
  }
  if (cmd === 'type') {
    await inPage(tab, banner, [`escribiendo en «${a.target}»`]);
    const r = await inPage(tab, (target, text, submit) => {
      const t = target.toLowerCase();
      let el = null;
      try { if (/^[#.\[]|^[a-z]+[#.\[]/i.test(target)) el = document.querySelector(target); } catch { /* */ }
      const fields = [...document.querySelectorAll('input,textarea,[contenteditable=true]')];
      const name = (x) => `${x.labels?.[0]?.innerText || ''} ${x.getAttribute('aria-label') || ''} ${x.placeholder || ''} ${x.name || ''} ${x.id || ''}`.toLowerCase();
      if (!el) el = fields.find((x) => name(x).includes(t));
      if (!el) return { error: `No encuentro el campo «${target}»` };
      if (el.type === 'password' || /cc-|card|cvc|iban|password|contraseñ/i.test(`${el.autocomplete} ${name(el)}`)) return { error: 'Por seguridad no escribo contraseñas ni datos de tarjeta o banco' };
      el.focus();
      if (el.isContentEditable) el.textContent = text;
      else { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set; setter ? setter.call(el, text) : (el.value = text); }
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      if (submit) { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true })); el.form?.requestSubmit?.(); }
      const nice = (el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.placeholder || el.name || el.id || target).trim().slice(0, 60);
      return { field: nice };
    }, [String(a.target || ''), String(a.text ?? ''), !!a.submit]);
    if (r?.error) throw new Error(r.error);
    return r;
  }
  if (cmd === 'screenshot') {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    await new Promise((res) => setTimeout(res, 400));
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 });
    return { dataUrl, title: tab.title };
  }
  throw new Error(`Orden desconocida: ${cmd}`);
}
