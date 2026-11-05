// End-to-end interaction checks in a real browser (installed Chrome via playwright-core).
// Usage: node scripts/e2e.mjs <baseUrl> [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3];
if (out) mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let failed = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failed++;
};
const kpi = (label) =>
  page.locator('section', { has: page.locator('h3', { hasText: label }) }).first().locator('p').first().innerText();
const selects = () => page.locator('main select');

await page.goto(`${base}#/`, { waitUntil: 'networkidle' });
await page.waitForSelector('main h1');

// 1. Navigation: all six dashboards + methodology
for (const [label, h1] of [
  ['Global Workforce Profile', 'Global Workforce Profile'],
  ['Diversity & Mobility', 'Diversity & Mobility'],
  ['Recruitment & Vacancies', 'Recruitment & Vacancies'],
  ['Retention & Development', 'Retention & Development'],
  ['Contracts & Data Quality', 'Contracts & Data Quality'],
  ['Methodology & KPIs', 'Methodology & KPIs'],
  ['Workforce Overview', 'Workforce Overview'],
]) {
  await page.locator('aside').getByRole('link', { name: label }).click();
  await page.waitForFunction((h) => document.querySelector('main h1')?.textContent === h, h1, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  const t = await page.locator('main h1').innerText();
  const charts = await page.locator('main [role="img"]').count();
  check(`navigate to ${label}`, t === h1, `${charts} charts`);
}

// 2. Global filters change KPIs
const total0 = await kpi('Total Active Staff');
await selects().nth(3).selectOption('Sudan');
await page.waitForTimeout(300);
const totalSudan = await kpi('Total Active Staff');
check('country filter changes headcount', total0 !== totalSudan, `${total0} -> ${totalSudan}`);
const countries = await kpi('Countries of Operation');
check('country filter -> 1 country of operation', countries.trim() === '1', countries);
await selects().nth(4).selectOption('International Staff');
await page.waitForTimeout(300);
const totalSI = await kpi('Total Active Staff');
check('category filter narrows further', Number(totalSI.replace(/,/g, '')) < Number(totalSudan.replace(/,/g, '')), `${totalSudan} -> ${totalSI}`);
// period preset
await selects().nth(4).selectOption('');
await selects().nth(0).selectOption('2025');
await page.waitForTimeout(300);
const asOf = await page.locator('main > header').first().innerText();
check('period preset moves reporting date to 31 Dec 2025', asOf.includes('31 Dec 2025'));
// filter persists across pages
await page.locator('aside').getByRole('link', { name: 'Recruitment & Vacancies' }).click();
const chips = await page.locator('main').innerText();
check('filters persist across pages', chips.includes('Country: Sudan') && chips.includes('31 Dec 2025'));
// clear filters
await page.getByRole('button', { name: 'Clear filters' }).click();
await page.locator('aside').getByRole('link', { name: 'Workforce Overview' }).click();
check('clear filters restores default', (await kpi('Total Active Staff')) === total0, total0);

// 3. Empty state: HQ country + National Staff category has no records
await selects().nth(3).selectOption('Switzerland');
await selects().nth(4).selectOption('National Staff');
await page.waitForTimeout(300);
const empties = await page.getByText('Nothing to show').count();
check('empty states rendered for impossible combination', empties > 0, `${empties} empty cards`);
if (out) await page.screenshot({ path: join(out, 'empty-state.png') });
await page.getByRole('button', { name: 'Clear filters' }).click();

// 4. Diversity GN/GS toggle updates nationality ranking
await page.locator('aside').getByRole('link', { name: 'Diversity & Mobility' }).click();
const natAll = await kpi('Nationalities Represented');
await page.getByRole('radio', { name: 'Global North' }).click();
await page.waitForTimeout(300);
const natGN = await kpi('Nationalities Represented');
await page.getByRole('radio', { name: 'Global South' }).click();
await page.waitForTimeout(300);
const natGS = await kpi('Nationalities Represented');
check('GN/GS toggle filters the diversity profile', Number(natGN) + Number(natGS) === Number(natAll), `all ${natAll} = GN ${natGN} + GS ${natGS}`);
if (out) await page.screenshot({ path: join(out, 'diversity-gs-toggle.png') });

// 5. Tables: search + sort
await page.locator('aside').getByRole('link', { name: 'Contracts & Data Quality' }).click();
const register = page.locator('section', { has: page.locator('h2', { hasText: 'Contract Register' }) });
const countText = async () => (await register.getByText(/^[\d,]+ records?$/).first().innerText()).trim();
const before = await countText();
await register.getByPlaceholder(/Search contract/).fill('Yemen');
await page.waitForTimeout(200);
const after = await countText();
check('table search filters rows', before !== after, `${before} -> ${after}`);
await register.getByPlaceholder(/Search contract/).fill('');
await register.locator('select').selectOption('expiring');
await page.waitForTimeout(200);
const exp = await countText();
const kpiExp = await kpi('Contracts Expiring in 4 Months');
check('status filter matches expiring KPI', exp.startsWith(kpiExp), `${exp} vs KPI ${kpiExp}`);
await register.getByRole('button', { name: /^Grade/ }).click(); // first click = descending
const firstGrade = await register.locator('tbody tr').first().locator('td').nth(5).innerText();
check('table sorts by column (grade desc)', firstGrade >= 'G5', `first row grade ${firstGrade}`);

// 6. Tooltip appears on chart hover
await page.locator('aside').getByRole('link', { name: 'Workforce Overview' }).click();
const chart = page.locator('main [role="img"]').first();
await page.waitForTimeout(800);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
const box = await chart.boundingBox();
await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
await page.waitForTimeout(400);
const tip = await page.locator('main [role="img"] div').filter({ hasText: 'Total' }).count();
check('chart tooltip shows on hover', tip > 0);
if (out) await page.screenshot({ path: join(out, 'tooltip.png'), clip: { x: box.x - 10, y: Math.max(0, box.y - 80), width: box.width + 20, height: box.height + 100 } });

// 7. Mobile layout: no horizontal overflow
await page.setViewportSize({ width: 390, height: 844 });
for (const r of ['/', '/recruitment', '/contracts']) {
  await page.goto(`${base}#${r}`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`mobile ${r} has no horizontal page overflow`, overflow <= 1, `${overflow}px`);
}
if (out) await page.screenshot({ path: join(out, 'mobile-contracts.png') });

check('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
