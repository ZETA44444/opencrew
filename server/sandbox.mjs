// run_javascript on the server: each run happens in a throwaway Docker container with
// no network, little memory and CPU, a read-only disk and no privileges. Removed when done.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const IMAGE = process.env.OPENCREW_SANDBOX_IMAGE || 'node:22-alpine';
const MARK = '__OPENCREW_RESULT__';
const WRAPPER = `let src='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>src+=d).on('end',async()=>{
const fmt=v=>{if(typeof v==='string')return v;try{return JSON.stringify(v,null,2)}catch{return String(v)}};
const logs=[];const log=(...a)=>{if(logs.length<500)logs.push(a.map(fmt).join(' '))};
const out=process.stdout.write.bind(process.stdout);
console.log=console.info=console.warn=console.error=console.debug=log;let r;
try{const AF=Object.getPrototypeOf(async function(){}).constructor;const v=await new AF(src)();r={ok:true,logs,result:v===undefined?undefined:fmt(v)}}
catch(e){r={ok:false,logs,error:String(e&&e.stack||e).split('\\n').slice(0,4).join('\\n')}}
out('\\n${MARK}'+JSON.stringify(r)+'\\n');process.exit(0)});`;

export function runInSandbox(code, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const name = `opencrew-js-${randomBytes(4).toString('hex')}`;
    let stdout = '';
    let stderr = '';
    let finished = false;
    const done = (r) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ logs: [], ...r, ms: Date.now() - t0 });
    };
    const p = spawn('docker', [
      'run', '--rm', '-i', '--name', name,
      '--network', 'none', '--memory', '256m', '--memory-swap', '256m', '--cpus', '0.5', '--pids-limit', '64',
      '--read-only', '--tmpfs', '/tmp:size=16m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', '65534:65534',
      IMAGE, 'node', '-e', WRAPPER,
    ]);
    // Starting a container takes ~1 s: give the code its full time on top of that.
    const timer = setTimeout(() => {
      spawn('docker', ['rm', '-f', name]).on('error', () => {});
      done({ ok: false, error: `Tiempo agotado: el código tardó más de ${timeoutMs / 1000} s y se detuvo.` });
    }, timeoutMs + 5000);
    p.on('error', () => done({ ok: false, error: 'Ejecutar código no está disponible en este servidor (falta Docker).' }));
    p.stdout.on('data', (d) => { if (stdout.length < 300_000) stdout += d; });
    p.stderr.on('data', (d) => { if (stderr.length < 5000) stderr += d; });
    p.on('close', () => {
      const i = stdout.lastIndexOf(MARK);
      if (i >= 0) { try { return done(JSON.parse(stdout.slice(i + MARK.length).split('\n')[0])); } catch { /* fall through */ } }
      done({ ok: false, error: stderr.trim().split('\n').slice(-3).join('\n') || 'El código terminó sin resultado (¿se quedó sin memoria?)' });
    });
    p.stdin.on('error', () => {});
    p.stdin.end(code);
  });
}
