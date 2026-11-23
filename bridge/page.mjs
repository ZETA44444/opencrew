// The bridge's own page: connect / disconnect your accounts and test them.
export const PAGE = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenCrew Puente</title>
<style>
:root{--bg:#0b0b0c;--bg2:#141415;--bg3:#1c1c1e;--line:#2a2a2d;--text:#ededed;--muted:#a1a1aa;--ok:#86efac;--err:#f87171}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,sans-serif;padding:16px}
main{max-width:720px;margin:0 auto}h1{font-size:22px;margin:8px 0 4px}p{color:var(--muted);margin:0 0 12px}
.card{background:var(--bg2);border:1px solid var(--line);border-radius:16px;padding:16px;margin:14px 0}
.head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.head h2{font-size:17px;margin:0}
.pill{font-size:12px;padding:2px 10px;border-radius:999px;background:var(--bg3);color:var(--muted)}.pill.ok{background:#12301f;color:var(--ok)}
button{font:inherit;border:1px solid var(--line);background:var(--bg3);color:var(--text);padding:8px 14px;border-radius:999px;cursor:pointer}
button.primary{background:var(--text);color:var(--bg);border-color:var(--text);font-weight:600}button:disabled{opacity:.5}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.small{font-size:13px;color:var(--muted)}
.code{font:600 26px/1.2 ui-monospace,monospace;letter-spacing:2px;background:var(--bg3);padding:10px 14px;border-radius:12px;display:inline-block;margin:6px 0}
a{color:#7dd3fc}input{font:inherit;background:var(--bg3);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:8px 10px;width:100%}
.err{color:var(--err);font-size:13px;margin-top:6px}.okmsg{color:var(--ok);font-size:13px;margin-top:6px}ol{padding-left:20px;margin:6px 0}li{margin:3px 0}
.login{display:none}.sw{display:flex;align-items:center;gap:8px;margin-left:auto;font-size:13px;color:var(--muted);cursor:pointer}.sw input{width:auto}.card.off{opacity:.65}.warn{background:#2a2111;border:1px solid #5a4316;color:#fcd34d;border-radius:12px;padding:10px 12px;font-size:13px}
</style></head><body><main>
<h1>🌉 OpenCrew Puente</h1>
<p>Conecta aquí <b>solo las suscripciones que quieras</b> (ChatGPT, Claude o las dos) y tus bots de OpenCrew podrán usarlas en lugar de pagar por API. Cada una es independiente: puedes conectar una y dejar la otra sin conectar, o desactivarla cuando quieras. Usa los programas oficiales (Codex y Claude Code) y tu sesión se queda solo en tu servidor.</p>
<div class="warn">Solo para tu uso personal. Lo que gasten tus bots cuenta en los límites de tu plan (también los de la app de ChatGPT/Claude). Si llegas al límite, OpenCrew cambia solo a tus claves de API si las tienes.</div>

<div id="auth" class="card login"><div class="head"><h2>Token de acceso</h2></div>
<p class="small">Abre esta página desde OpenCrew (Ajustes → Mis suscripciones) o pega el token de tu servidor.</p>
<input id="tok" type="password" placeholder="Token"><div class="actions"><button class="primary" onclick="saveTok()">Entrar</button></div></div>

<div id="app" style="display:none">
<div class="card" id="c-chatgpt"><div class="head"><h2>ChatGPT</h2><span class="pill" id="s-chatgpt">…</span><span id="w-chatgpt" class="sw"></span></div>
<p class="small">Plus o Pro. Antes de conectar: en ChatGPT → Configuración → Seguridad, activa el inicio de sesión con <b>código de dispositivo</b> (para Codex).</p>
<div id="l-chatgpt"></div>
<div class="actions" id="a-chatgpt"></div></div>

<div class="card" id="c-claude"><div class="head"><h2>Claude</h2><span class="pill" id="s-claude">…</span><span id="w-claude" class="sw"></span></div>
<p class="small">Pro o Max. Se conecta con Claude Code (el programa oficial de Anthropic).</p>
<div id="l-claude"></div>
<div class="actions" id="a-claude"></div></div>

<div class="card"><div class="head"><h2>Uso</h2></div><div class="small" id="usage">…</div>
<p class="small" style="margin-top:8px">En OpenCrew, elige en cada bot el proveedor <b>«Mis suscripciones (Puente)»</b> y el modelo: <code>chatgpt</code>, <code>claude-sonnet</code>, <code>claude-opus</code> o <code>claude-haiku</code>.</p></div>
</div>

<script>
const h = new URLSearchParams(location.hash.slice(1)); if (h.get('t')) { sessionStorage.setItem('puente', h.get('t')); history.replaceState(null, '', location.pathname); }
let T = sessionStorage.getItem('puente') || '';
const $ = (id) => document.getElementById(id);
function saveTok(){ T = $('tok').value.trim(); sessionStorage.setItem('puente', T); load(); }
async function api(path, data){ const r = await fetch('api/' + path, { method: data ? 'POST' : 'GET', credentials: 'same-origin', headers: { ...(T ? { authorization: 'Bearer ' + T } : {}), 'x-opencrew': '1', 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined }); const j = await r.json().catch(() => ({})); if (r.status === 401) { $('auth').style.display = 'block'; $('app').style.display = 'none'; throw new Error('Token no válido'); } if (!r.ok) throw new Error(j.error?.message || ('Error ' + r.status)); return j; }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const msg = {};
function render(s){
  for (const p of ['chatgpt','claude']) {
    const st = s[p], l = st.login, el = $('l-'+p), act = $('a-'+p), pill = $('s-'+p), sw = $('w-'+p);
    const name = p === 'chatgpt' ? 'ChatGPT' : 'Claude';
    pill.textContent = st.connected ? (st.enabled ? 'conectado · en uso' : 'conectado · desactivado') : (l && ['starting','waiting','checking'].includes(l.state) ? 'conectando…' : 'sin conectar (opcional)');
    pill.className = 'pill' + (st.connected && st.enabled ? ' ok' : '');
    $('c-'+p).classList.toggle('off', st.connected && !st.enabled);
    const swHtml = st.connected ? '<label class="sw"><input type="checkbox" '+(st.enabled?'checked':'')+' onchange="toggle(\\''+p+'\\', this.checked)"> Usar en OpenCrew</label>' : '';
    if (sw.dataset.h !== swHtml) { sw.innerHTML = swHtml; sw.dataset.h = swHtml; }
    let html = '';
    const busy = l && !st.connected && ['starting','waiting','checking'].includes(l.state);
    if (busy && l.state === 'starting') html = '<div class="small">Preparando…</div>';
    if (busy && l.state === 'waiting' && p === 'chatgpt') html = '<ol class="small"><li>Abre <a href="'+esc(l.url)+'" target="_blank" rel="noreferrer">'+esc(l.url)+'</a> (en el móvil o aquí) e inicia sesión en ChatGPT.</li><li>Escribe este código:</li></ol><div class="code">'+esc(l.code)+'</div><div class="small">Esta página se actualiza sola cuando termines.</div>';
    if (busy && p === 'claude' && (l.state === 'waiting' || l.state === 'checking')) html = '<ol class="small"><li>Abre <a href="'+esc(l.url)+'" target="_blank" rel="noreferrer">este enlace</a> (es nuevo en cada intento) e inicia sesión en Claude.</li><li>Pulsa «Autorizar» y copia el código <b>entero</b> que te muestra.</li><li>Pégalo aquí:</li></ol><input id="ccode" placeholder="Código de Claude" value="'+esc(msg.ccode||'')+'" oninput="msg.ccode=this.value"><div class="actions"><button class="primary" onclick="sendCode()" '+(l.state==='checking'?'disabled':'')+'>'+(l.state==='checking'?'Comprobando…':'Enviar código')+'</button></div>';
    if (l?.state === 'error' && !st.connected) html += '<div class="err">'+esc(l.error)+'</div>';
    if (l?.state === 'checking' && l.checkingFor > 25) html += '<div class="small" style="margin-top:8px">Está tardando más de lo normal ('+l.checkingFor+' s). Lo que muestra Claude ahora:</div><div class="small" style="font-family:ui-monospace,monospace;background:#1c1c1e;padding:8px;border-radius:8px;white-space:pre-wrap">'+esc(l.detail || '(nada)')+'</div>';
    if (l?.state === 'ok' && st.connected && !msg[p]) html += '<div class="okmsg">✓ Conectado. Pulsa «Probar» para comprobarlo.</div>';
    if (msg[p]) html += msg[p];
    if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
    const actHtml = st.connected
      ? '<button onclick="test(\\''+p+'\\')">Probar</button><button onclick="logout(\\''+p+'\\')">Desconectar</button>'
      : busy ? '<button onclick="cancel(\\''+p+'\\')">Cancelar</button>'
      : '<button class="primary" onclick="login(\\''+p+'\\')">Conectar '+name+'</button>';
    if (act.dataset.h !== actHtml) { act.innerHTML = actHtml; act.dataset.h = actHtml; }
  }
  $('usage').textContent = s.usage.requests ? (s.usage.requests + ' respuestas · ' + s.usage.errors + ' errores · última ' + new Date(s.usage.last).toLocaleString()) : 'Aún sin uso.';
}
async function toggle(p, on){ await api('enable', { provider: p, enabled: on }); load(); }
async function cancel(p){ await api('cancel', { provider: p }); msg.ccode = ''; load(); }
async function load(){ try { const s = await api('status'); $('auth').style.display = 'none'; $('app').style.display = 'block'; render(s); } catch (e) { if (!T) { $('auth').style.display = 'block'; } } }
async function login(p){ msg[p] = ''; if (p === 'claude') msg.ccode = ''; await api('login/' + p, {}); load(); }
async function sendCode(){ const c = $('ccode').value; msg.ccode = c; try { await api('login/claude/code', { code: c }); msg.claude = ''; } catch (e) { msg.claude = '<div class="err">' + esc(e.message) + '</div>'; } load(); }
async function logout(p){ if (!confirm('¿Desconectar ' + p + '?')) return; msg[p]=''; await api('logout', { provider: p }); load(); }
async function test(p){ msg[p] = '<div class="small">Probando…</div>'; load(); try { const r = await api('test', { provider: p }); msg[p] = '<div class="okmsg">✓ «' + esc(r.text) + '» (' + (r.ms/1000).toFixed(1) + ' s)</div>'; } catch (e) { msg[p] = '<div class="err">' + esc(e.message) + '</div>'; } load(); }
load(); // with the server owner's session it works without pasting anything
setInterval(() => { if ($('app').style.display === 'block') load(); }, 2500);
</script></main></body></html>`;
