// Network guard for everything bots fetch from the internet (pages, feeds, watched webs).
// Blocks private, loopback, link-local and internal addresses — written in any form (decimal,
// hex, IPv6, IPv4-mapped…), by DNS name that resolves to them, internal Docker names, and on every
// redirect. On your server the DNS check is real (globalThis.OPENCREW_RESOLVE); in the browser the
// browser itself can't reach your server's internal network anyway.
const BLOCKED_NAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|.*\.corp|metadata(\..*)?|.*\.nip\.io|.*\.sslip\.io|.*\.xip\.io|.*\.localtest\.me|lvh\.me|.*\.lvh\.me)$/i;

function ipv4ToInt(s) {
  // Accepts dotted decimal, and the odd forms browsers/servers also accept (0x7f.1, 2130706433, 0177.0.0.1).
  const parts = String(s).split('.');
  if (!parts.length || parts.length > 4 || parts.some((p) => p === '')) return null;
  const nums = parts.map((p) => (/^0x[0-9a-f]+$/i.test(p) ? parseInt(p, 16) : /^0[0-7]+$/.test(p) ? parseInt(p, 8) : /^\d+$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => Number.isNaN(n))) return null;
  const last = nums.pop();
  let v = 0;
  for (const n of nums) { if (n > 255) return null; v = v * 256 + n; }
  const remaining = 4 - nums.length;
  if (last >= 256 ** remaining) return null;
  return v * 256 ** remaining + last;
}

function privateV4(n) {
  const inRange = (base, bits) => { const b = ipv4ToInt(base); const size = 2 ** (32 - bits); return n >= b && n < b + size; };
  return [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]].some(([b, bits]) => inRange(b, bits));
}

function privateV6(addr) {
  const a = String(addr).toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (a === '::' || a === '::1') return true;
  const mapped = a.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/) || a.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(ipv4ToInt(mapped[1]));
  const hexMapped = a.match(/^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) return privateV4(parseInt(hexMapped[1], 16) * 65536 + parseInt(hexMapped[2], 16));
  return /^(fc|fd)/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a) || /^64:ff9b:/.test(a) || /^2001:db8:/.test(a);
}

export function isPrivateAddress(ip) {
  const s = String(ip).replace(/^\[|\]$/g, '');
  if (s.includes(':')) return privateV6(s);
  const n = ipv4ToInt(s);
  return n === null ? false : privateV4(n);
}

// Throws if the URL may point to something internal.
export async function assertPublicUrl(input) {
  let u;
  try { u = new URL(input); } catch { throw new Error('URL no válida'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Solo se permiten direcciones http(s)');
  if (u.username || u.password) throw new Error('No se permiten direcciones con usuario y contraseña');
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || BLOCKED_NAMES.test(host)) throw new Error('Solo se permiten webs públicas');
  if (host.includes(':') || ipv4ToInt(host) !== null) {
    if (isPrivateAddress(host)) throw new Error('Solo se permiten webs públicas');
    return u;
  }
  if (!host.includes('.')) throw new Error('Solo se permiten webs públicas'); // internal names (docker: «puente», «opencrew»…)
  const resolve = globalThis.OPENCREW_RESOLVE;
  if (resolve) {
    let addrs;
    try { addrs = await resolve(host); } catch { throw new Error(`No se encuentra ${host}`); }
    if (!addrs.length || addrs.some(isPrivateAddress)) throw new Error('Solo se permiten webs públicas');
  }
  return u;
}

// fetch() for untrusted URLs: checks the target and every redirect (max 5).
export async function safeFetch(input, init = {}) {
  let url = String(input);
  for (let i = 0; i <= 5; i++) {
    await assertPublicUrl(url);
    const res = await fetch(url, { ...init, redirect: 'manual' });
    const loc = res.status >= 300 && res.status < 400 && res.headers.get('location');
    // In a browser, manual redirects come back opaque (status 0): let the browser follow them (it
    // can't reach your server's internal network anyway).
    if (res.type === 'opaqueredirect') return fetch(url, { ...init, redirect: 'follow' });
    if (!loc) return res;
    url = new URL(loc, url).href;
  }
  throw new Error('Demasiadas redirecciones');
}
