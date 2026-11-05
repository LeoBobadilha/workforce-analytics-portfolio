// Visual QA + screenshot capture with the locally installed Chrome (playwright-core).
// Usage: node scripts/screenshot.mjs <baseUrl> <outDir> [route ...] [--width=1600] [--height=1000] [--full]
//        [--element=<css>] capture one element (scrolled into view) · [--wait=<css>] wait for a selector first
//        [--reveal=<css>] scroll an element into view (so lazy sections load), then back to the top
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; }));
const [base, outDir, ...routes] = args.filter((a) => !a.startsWith('--'));
const width = Number(flags.width ?? 1600);
const height = Number(flags.height ?? 1000);
const pages = routes.length ? routes : ['/', '/profile', '/diversity', '/recruitment', '/retention', '/contracts', '/methodology'];
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: Number(flags.scale ?? 1) });
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));

for (const r of pages) {
  const name = r === '/' ? 'overview' : r.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-');
  await page.goto(`${base}#${r}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('main h1');
  if (!(await page.getByText('Workforce Analytics').count())) throw new Error(`Unexpected app at ${base}`);
  if (flags.reveal) await page.locator(flags.reveal).first().scrollIntoViewIfNeeded();
  if (flags.element) await page.locator(flags.element).first().scrollIntoViewIfNeeded();
  if (flags.wait) await page.waitForSelector(flags.wait, { timeout: 20000 });
  if (flags.reveal) await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(900);
  const file = join(outDir, `${flags.prefix ?? ''}${name}.png`);
  if (flags.element) {
    // clip from a full-page capture so sticky headers are not painted over the element
    const clip = await page.locator(flags.element).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.max(0, r.x - 8), y: r.y + window.scrollY - 8, width: Math.min(r.width + 16, document.documentElement.clientWidth), height: r.height + 16 };
    });
    await page.screenshot({ path: file, fullPage: true, clip });
  }
  else await page.screenshot({ path: file, fullPage: 'full' in flags });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  console.log(`${r} -> ${file}${overflow ? '  [HORIZONTAL OVERFLOW]' : ''}`);
}
console.log(problems.length ? `Console problems:\n${[...new Set(problems)].join('\n')}` : 'No console errors or warnings.');
await browser.close();
