// Visual QA + screenshot capture with the locally installed Chrome (playwright-core).
// Usage: node scripts/screenshot.mjs <baseUrl> <outDir> [route ...] [--width=1600] [--height=1000] [--full]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
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
  await page.waitForTimeout(900);
  const file = join(outDir, `${flags.prefix ?? ''}${name}.png`);
  await page.screenshot({ path: file, fullPage: 'full' in flags });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  console.log(`${r} -> ${file}${overflow ? '  [HORIZONTAL OVERFLOW]' : ''}`);
}
console.log(problems.length ? `Console problems:\n${[...new Set(problems)].join('\n')}` : 'No console errors or warnings.');
await browser.close();
