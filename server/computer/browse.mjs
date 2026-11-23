// Runs inside the bot's computer: opens Chromium with the bot's own profile (keeps sign-ins
// and cookies between calls), follows a list of steps and returns what the page shows.
import { chromium } from 'playwright';

const input = JSON.parse(await new Promise((r) => { let s = ''; process.stdin.on('data', (d) => (s += d)).on('end', () => r(s)); }));
const out = { ok: true, log: [] };
const STEP_MS = 15_000;
let ctx;
try {
  ctx = await chromium.launchPersistentContext('/work/.browser-profile', {
    headless: true, viewport: { width: 1280, height: 800 }, locale: input.locale || 'es-ES',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 OpenCrew',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  page.setDefaultTimeout(STEP_MS);
  if (input.url) { await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30_000 }); out.log.push(`abierto ${input.url}`); }
  const target = (t) => {
    const s = String(t || '');
    if (/^(css=|xpath=|\/\/|#|\.|\[)/.test(s)) return page.locator(s.replace(/^css=/, '')).first();
    return page.getByText(s.replace(/^text=/, ''), { exact: false }).first();
  };
  for (const st of (input.steps || []).slice(0, 20)) {
    const a = String(st.action || '').toLowerCase();
    try {
      if (a === 'goto') await page.goto(st.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      else if (a === 'click') await target(st.target).click();
      else if (a === 'type' || a === 'fill') await (st.target ? target(st.target) : page.locator(':focus')).fill(String(st.text ?? ''));
      else if (a === 'press') await page.keyboard.press(String(st.key || 'Enter'));
      else if (a === 'select') await target(st.target).selectOption(String(st.value ?? ''));
      else if (a === 'scroll') await page.mouse.wheel(0, Number(st.amount) || 800);
      else if (a === 'wait') await page.waitForTimeout(Math.min(10_000, Number(st.ms) || 1000));
      else if (a === 'back') await page.goBack();
      else { out.log.push(`acción desconocida: ${a}`); continue; }
      out.log.push(`✓ ${a} ${st.target || st.url || st.key || ''}`.trim());
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
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
  out.links = (await page.evaluate(() => [...document.querySelectorAll('a[href]')].slice(0, 400).map((a) => [a.innerText.trim().slice(0, 60), a.href]).filter(([t]) => t))).slice(0, 40);
  if (input.screenshot !== false) out.screenshot = (await page.screenshot({ type: 'jpeg', quality: 60 })).toString('base64');
} catch (e) {
  out.ok = false;
  out.error = String(e.message).split('\n')[0];
} finally {
  await ctx?.close().catch(() => {});
}
process.stdout.write(`\n__OPENCREW_BROWSE__${JSON.stringify(out)}\n`);
