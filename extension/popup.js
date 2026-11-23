const $ = (id) => document.getElementById(id);
async function show() {
  const s = await chrome.runtime.sendMessage('state');
  const { server = '', key = '', block = '', paused = false } = await chrome.storage.local.get(['server', 'key', 'block', 'paused']);
  $('server').value ||= server; if (key && !$('key').value) $('key').placeholder = '•••••••• (guardado)'; $('block').value ||= block;
  const map = { on: ['conectado', 'ok'], connecting: ['conectando…', ''], paused: ['en pausa', ''], off: ['sin emparejar', 'err'], error: ['sin conexión', 'err'] };
  const [t, c] = map[s?.status] || ['…', ''];
  $('st').textContent = t; $('st').className = `pill ${c}`; $('er').textContent = s?.status === 'error' ? s.error : '';
  $('pause').textContent = paused ? 'Reanudar' : 'Pausar (desconectar)';
}
$('save').onclick = async () => {
  const data = { server: $('server').value.trim().replace(/\/+$/, ''), block: $('block').value };
  if ($('key').value.trim()) data.key = $('key').value.trim();
  await chrome.storage.local.set({ ...data, paused: false });
  $('key').value = '';
  setTimeout(show, 1500);
};
$('pause').onclick = async () => { const { paused } = await chrome.storage.local.get('paused'); await chrome.storage.local.set({ paused: !paused }); setTimeout(show, 500); };
show(); setInterval(show, 2000);
