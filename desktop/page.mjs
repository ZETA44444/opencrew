// Settings page of OpenCrew Escritorio (only reachable from this computer).
export const PAGE = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenCrew Escritorio</title><style>
:root{--bg:#0b0b0c;--bg2:#141415;--bg3:#1c1c1e;--line:#2a2a2d;--text:#ededed;--muted:#a1a1aa;--ok:#86efac;--err:#f87171}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,sans-serif;padding:16px}
main{max-width:760px;margin:0 auto}h1{font-size:22px;margin:6px 0}h2{font-size:16px;margin:0}p{color:var(--muted);margin:4px 0 10px}
.card{background:var(--bg2);border:1px solid var(--line);border-radius:16px;padding:16px;margin:14px 0}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pill{font-size:12px;padding:2px 10px;border-radius:999px;background:var(--bg3);color:var(--muted)}.ok{background:#12301f;color:var(--ok)}.bad{background:#3b1414;color:#fca5a5}
button{font:inherit;border:1px solid var(--line);background:var(--bg3);color:var(--text);padding:7px 14px;border-radius:999px;cursor:pointer}button.primary{background:var(--text);color:var(--bg);font-weight:600}
input{font:inherit;background:var(--bg3);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:8px 10px;width:100%}
label.ck{display:inline-flex;gap:6px;align-items:center;font-size:13px;color:var(--muted);margin-right:12px;cursor:pointer}label.ck input{width:auto}
.folder{border-top:1px solid var(--line);padding:10px 0}.folder:first-child{border-top:0}.path{font-family:ui-monospace,monospace;font-size:13px;word-break:break-all}
.small{font-size:13px;color:var(--muted)}.log{font-family:ui-monospace,monospace;font-size:12px;color:var(--muted);white-space:pre-wrap;max-height:180px;overflow:auto}
.warn{background:#2a2111;border:1px solid #5a4316;color:#fcd34d;border-radius:12px;padding:10px 12px;font-size:13px;margin-top:8px}.spacer{flex:1}.err{color:var(--err);font-size:13px}
</style></head><body><main>
<h1>🖥 OpenCrew Escritorio</h1>
<p>Deja que tus bots de OpenCrew usen archivos de este ordenador. Solo las carpetas que añadas aquí, con el permiso que elijas, y cada acción te la piden en OpenCrew antes de hacerla.</p>
<div id="locked" class="card" style="display:none"><h2>Abre los ajustes desde la app</h2><p>Por seguridad, esta página solo funciona abierta desde «OpenCrew Escritorio» (en Aplicaciones).</p></div>
<div id="app" style="display:none">
<div class="card"><div class="row"><h2>Conexión</h2><span id="st" class="pill">…</span><span class="spacer"></span><button id="pause"></button></div>
<p class="small" id="sterr"></p>
<div class="row"><input id="server" placeholder="Dirección de tu servidor (https://…)"><input id="key" type="password" placeholder="Código de emparejamiento (OpenCrew → Apps conectadas → Tu ordenador)"><button class="primary" onclick="pair()">Guardar y conectar</button></div></div>

<div class="card"><div class="row"><h2>Carpetas</h2><span class="spacer"></span><button class="primary" onclick="pick()">+ Añadir carpeta…</button></div>
<p class="small">Elige carpetas concretas (no tu carpeta personal entera). Archivos privados como claves SSH, .env o contraseñas del navegador nunca se pueden leer.</p>
<div id="folders"></div><div id="ferr" class="err"></div></div>

<div class="card"><div class="row"><h2>Terminal</h2><span class="spacer"></span><label class="ck"><input type="checkbox" id="term" onchange="setTerm()"> Permitir que los bots ejecuten comandos</label></div>
<p class="small">Desactivada por defecto. Los comandos solo se ejecutan dentro de tus carpetas permitidas, como tu usuario, y cada uno te lo piden en OpenCrew.</p>
<div id="termbots"></div><div class="warn" id="termwarn" style="display:none">Con la terminal un bot puede hacer casi cualquier cosa que puedas hacer tú. Actívala solo para bots de confianza y revisa cada comando antes de permitirlo.</div></div>

<div class="card"><h2>Actividad reciente</h2><div class="log" id="log">—</div></div>
</div>
<script>
const h = location.hash.slice(1); if (h) { sessionStorage.setItem('ocd', h); history.replaceState(null, '', '/'); }
const S = sessionStorage.getItem('ocd') || '';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let st = null;
async function api(p, data){ const r = await fetch('/api/' + p, { method: data ? 'POST' : 'GET', headers: { 'x-oc-secret': S, 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined }); const j = await r.json().catch(() => ({})); if (r.status === 401) { $('locked').style.display = 'block'; $('app').style.display = 'none'; throw new Error('locked'); } if (!r.ok) throw new Error(j.error || 'Error'); return j; }
function botChecks(selected, onchange){
  if (!st.bots.length) return '<div class="small">Conéctate a tu servidor para elegir bots.</div>';
  const all = !selected || !selected.length;
  return '<div class="small" style="margin-top:6px">Bots: <label class="ck"><input type="checkbox" '+(all?'checked':'')+' onchange="'+onchange+'(null,this.checked)"> todos los que tengan «Puede usar mi ordenador»</label>' +
    (all ? '' : st.bots.map((b) => '<label class="ck"><input type="checkbox" '+(selected.includes(b.id)?'checked':'')+' onchange="'+onchange+'(\\''+b.id+'\\',this.checked)"> '+esc(b.name)+(b.enabled?'':' <span title=\\'No tiene activado «Puede usar mi ordenador» en OpenCrew\\'>(desactivado en OpenCrew)</span>')+'</label>').join('')) + '</div>';
}
function render(){
  const map = { on: ['conectado', 'ok'], connecting: ['conectando…', ''], paused: ['en pausa', ''], off: ['sin emparejar', 'bad'], error: ['sin conexión', 'bad'] };
  const [t, c] = map[st.status.state] || ['…', ''];
  $('st').textContent = t; $('st').className = 'pill ' + c; $('sterr').textContent = st.status.error || '';
  if (document.activeElement !== $('server')) $('server').value = st.server || '';
  $('key').placeholder = st.paired ? '•••••••• (guardado; pega uno nuevo para cambiarlo)' : 'Código de emparejamiento (OpenCrew → Apps conectadas → Tu ordenador)';
  $('pause').textContent = st.paused ? 'Reanudar' : 'Pausar';
  $('folders').innerHTML = st.folders.length ? st.folders.map((f, i) => '<div class="folder"><div class="row"><span class="path">📁 '+esc(f.path)+'</span><span class="spacer"></span>' +
    '<label class="ck"><input type="checkbox" '+(f.write?'checked':'')+' onchange="upd('+i+',{write:this.checked})"> también escribir</label><button onclick="rm('+i+')">Quitar</button></div>' +
    botChecks(f.bots, 'fb'+i) + '</div>').join('') : '<div class="small">Aún no has añadido ninguna carpeta.</div>';
  st.folders.forEach((f, i) => { window['fb'+i] = (id, on) => { const all = st.bots.map((b) => b.id); let cur = f.bots && f.bots.length ? f.bots : all; if (id === null) cur = on ? [] : all; else cur = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id); upd(i, { bots: cur.length === all.length ? [] : cur }); }; });
  $('term').checked = !!st.terminal; $('termwarn').style.display = st.terminal ? 'block' : 'none';
  $('termbots').innerHTML = st.terminal ? botChecks(st.terminalBots, 'tb') : '';
  window.tb = (id, on) => { const all = st.bots.map((b) => b.id); let cur = st.terminalBots && st.terminalBots.length ? st.terminalBots : all; if (id === null) cur = on ? [] : all; else cur = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id); api('terminal', { bots: cur.length === all.length ? [] : cur }).then(load); };
  $('log').textContent = st.log.length ? st.log.join('\\n') : 'Aún no ha pasado nada.';
}
async function load(){ try { st = await api('state'); $('app').style.display = 'block'; render(); } catch {} }
async function pair(){ await api('pair', { server: $('server').value, key: $('key').value }); $('key').value = ''; setTimeout(load, 1200); }
async function pick(){ $('ferr').textContent = ''; const r = await api('pick', {}); let p = r.path; if (!p) p = prompt('Escribe la ruta de la carpeta (por ejemplo ~/Documents/Proyectos):'); if (!p) return; try { await api('folders/add', { path: p, write: false }); } catch (e) { $('ferr').textContent = e.message; } load(); }
async function upd(i, patch){ await api('folders/update', { path: st.folders[i].path, ...patch }); load(); }
async function rm(i){ if (confirm('¿Quitar el acceso a ' + st.folders[i].path + '?')) { await api('folders/remove', { path: st.folders[i].path }); load(); } }
async function setTerm(){ const on = $('term').checked; if (on && !confirm('¿Permitir que los bots ejecuten comandos en este ordenador? Cada comando te lo pedirán en OpenCrew.')) { $('term').checked = false; return; } await api('terminal', { enabled: on }); load(); }
$('pause').onclick = async () => { await api('pause', { paused: !st.paused }); load(); };
if (!S) $('locked').style.display = 'block'; else { load(); setInterval(load, 3000); }
</script></main></body></html>`;
