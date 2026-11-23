// Runs inside the bot's computer: drives the Chromium that is open on its screen (keeps sign-ins,
// cookies and tabs), follows a list of steps and returns what the page shows.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

// Playwright is installed globally in the image (ES modules don't look there by themselves).
const { chromium } = createRequire(import.meta.url)('/usr/local/lib/node_modules/playwright');

const input = JSON.parse(await new Promise((r) => { let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => r(s)); }));
const out = { ok: true, log: [] };
const STEP_MS = 15_000;
let browser;
try {
  // Use the Chromium that is already open on the bot's screen (the same one you can watch).
  for (let i = 0; i < 20 && !browser; i++) {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222').catch(() => null);
    if (!browser) await new Promise((r) => setTimeout(r, 500));
  }
  if (!browser) throw new Error('El navegador del ordenador no responde; vuelve a intentarlo en unos segundos');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages().filter((p) => !p.url().startsWith('devtools://'));
  const page = input.newTab || !pages.length ? await ctx.newPage() : pages[pages.length - 1];
  await page.bringToFront().catch(() => {});
  page.setDefaultTimeout(STEP_MS);
  if (input.url) { const r = await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30_000 }); out.status = r?.status(); out.log.push(`abierto ${input.url}`); }
  const target = (t) => {
    const s = String(t || '');
    // Only elements a person could see (pages often hide duplicates of the same field).
    if (/^(css=|xpath=|\/\/|#|\.|\[|[a-z]+\[)/i.test(s)) return page.locator(s.replace(/^css=/, '')).filter({ visible: true }).first();
    return page.getByText(s.replace(/^text=/, ''), { exact: false }).filter({ visible: true }).first();
  };

  // «Like a person»: the mouse travels along a curve with small pauses, clicks land on a random point of
  // the element, typing goes key by key with irregular rhythm and scrolling is gradual. The real cursor of
  // the screen (the one you see in «Ver su ordenador») follows the same path.
  const rnd = (a, b) => a + Math.random() * (b - a);
  const sleep = (ms) => page.waitForTimeout(ms);
  const offset = await page.evaluate(() => ({ x: window.screenX + (window.outerWidth - window.innerWidth), y: window.screenY + (window.outerHeight - window.innerHeight) })).catch(() => ({ x: 0, y: 0 }));
  const showCursor = (x, y) => { try { spawn('xdotool', ['mousemove', String(Math.round(x + offset.x)), String(Math.round(y + offset.y))], { stdio: 'ignore' }).on('error', () => {}); } catch {} };
  let mouse = { x: rnd(200, 900), y: rnd(150, 500) };
  const moveTo = async (x, y) => {
    const dist = Math.hypot(x - mouse.x, y - mouse.y);
    const n = Math.max(8, Math.min(40, Math.round(dist / 25)));
    // Bézier curve with a random bend, ease-in-out speed, and a tiny overshoot jitter at the end.
    const c1 = { x: mouse.x + (x - mouse.x) * 0.3 + rnd(-80, 80), y: mouse.y + (y - mouse.y) * 0.3 + rnd(-60, 60) };
    const c2 = { x: mouse.x + (x - mouse.x) * 0.7 + rnd(-60, 60), y: mouse.y + (y - mouse.y) * 0.7 + rnd(-40, 40) };
    const from = mouse;
    for (let i = 1; i <= n; i++) {
      const lin = i / n, t = lin < 0.5 ? 2 * lin * lin : 1 - (-2 * lin + 2) ** 2 / 2, u = 1 - t;
      const px = u ** 3 * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * x;
      const py = u ** 3 * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * y;
      await page.mouse.move(px, py);
      if (i % 3 === 0 || i === n) showCursor(px, py);
      await sleep(rnd(6, 18));
    }
    mouse = { x, y };
  };
  const humanClick = async (loc) => {
    await loc.scrollIntoViewIfNeeded({ timeout: STEP_MS });
    const box = await loc.boundingBox();
    if (!box) return loc.click();
    await moveTo(box.x + box.width * rnd(0.3, 0.7), box.y + box.height * rnd(0.3, 0.7));
    await sleep(rnd(80, 250));
    await page.mouse.down(); await sleep(rnd(40, 120)); await page.mouse.up();
  };
  const humanType = async (text) => {
    for (const ch of text) {
      await page.keyboard.type(ch);
      await sleep(/[ .,]/.test(ch) ? rnd(90, 260) : rnd(45, 160));
    }
  };
  const humanScroll = async (amount) => {
    const steps = Math.max(3, Math.round(Math.abs(amount) / 120));
    for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, (amount / steps) * rnd(0.8, 1.2)); await sleep(rnd(40, 140)); }
  };

  for (const st of (input.steps || []).slice(0, 20)) {
    const a = String(st.action || '').toLowerCase();
    try {
      if (a === 'goto') { const r = await page.goto(st.url, { waitUntil: 'domcontentloaded', timeout: 30_000 }); out.status = r?.status(); }
      else if (a === 'click') await humanClick(target(st.target));
      else if (a === 'type' || a === 'fill') {
        if (st.target) {
          const loc = target(st.target);
          await humanClick(loc);
          await loc.fill('');
        }
        await humanType(String(st.text ?? ''));
      }
      else if (a === 'press') { await sleep(rnd(120, 400)); await page.keyboard.press(String(st.key || 'Enter')); }
      else if (a === 'select') { await humanClick(target(st.target)); await target(st.target).selectOption(String(st.value ?? '')); }
      else if (a === 'scroll') await humanScroll(Number(st.amount) || 800);
      else if (a === 'wait') await page.waitForTimeout(Math.min(10_000, Number(st.ms) || 1000));
      else if (a === 'back') await page.goBack();
      else { out.log.push(`acción desconocida: ${a}`); continue; }
      out.log.push(`✓ ${a} ${st.target || st.url || st.key || ''}`.trim());
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      await sleep(rnd(250, 700));
    } catch (e) {
      out.log.push(`✗ ${a} ${st.target || ''}: ${String(e.message).split('\n')[0]}`);
      out.ok = false;
      break;
    }
  }
  await page.waitForTimeout(500);
  out.url = page.url();
  out.title = await page.title();
  out.text = (await page.evaluate(() => document.body?.innerText || '')).replace(/\n{3,}/g, '\n\n').slice(0, Number(input.maxText) || 8000);
  // Some sites (e.g. Wallapop) refuse any visit that comes from a data-centre address, before looking at
  // how the mouse moves. Say so clearly so the bot switches to the user's own browser instead of retrying.
  if (out.status === 403 || out.status === 429 || /request (could not be satisfied|blocked)|access denied|generated by cloudfront|are you a robot|verify you are human|unusual traffic|acceso denegado/i.test(`${out.title}\n${out.text.slice(0, 1500)}`)) out.blocked = true;
  out.links = (await page.evaluate(() => [...document.querySelectorAll('a[href]')].slice(0, 400).map((a) => [a.innerText.trim().slice(0, 60), a.href]).filter(([t]) => t))).slice(0, 40);
  if (input.screenshot !== false) out.screenshot = (await page.screenshot({ type: 'jpeg', quality: 60 })).toString('base64');
} catch (e) {
  out.ok = false;
  out.error = String(e.message).split('\n')[0];
}
// Don't close: the browser stays open on the bot's screen (sessions, tabs, what you see).
process.stdout.write(`\n__OPENCREW_BROWSE__${JSON.stringify(out)}\n`);
process.exit(0);
