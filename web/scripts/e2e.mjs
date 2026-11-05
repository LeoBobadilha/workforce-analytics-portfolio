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

// 8. Global Workforce Explorer (map)
const ex = page.locator('#global-workforce-explorer');
const exSummary = () => ex.locator('p[aria-live]').innerText();
const exTotal = async () => Number((await exSummary()).match(/([\d,]+) active staff/)[1].replace(/,/g, ''));
const exLabel = () => ex.locator('[data-month-label]').innerText();
const panelName = () => ex.locator('[data-detail-name]').innerText().catch(() => null);
const openExplorer = async () => {
  await ex.scrollIntoViewIfNeeded();
  await ex.locator('[data-map-ready="true"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
};
const mapResources = () =>
  page.evaluate(() => {
    const res = performance.getEntriesByType('resource');
    const geo = res.find((e) => e.name.includes('/geo/'));
    const chunk = res.find((e) => e.name.includes('ExplorerBody'));
    const model = res.find((e) => e.name.includes('hr_model.json'));
    return { geo: geo ? geo.startTime : null, chunk: chunk ? chunk.startTime : null, modelEnd: model ? model.responseEnd : null };
  });
await page.goto(`${base}#/profile`, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const onProfile = await mapResources();
await page.goto(`${base}#/`, { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('main h1');
await openExplorer();
const onOverview = await mapResources();
const mapPaths = await ex.locator('[data-map-ready] svg path').count();
check(
  'map: code and boundaries load lazily (never on other pages, after the dashboard data on Overview)',
  onProfile.geo === null && onProfile.chunk === null && onOverview.chunk > onOverview.modelEnd && onOverview.geo > onOverview.modelEnd && mapPaths > 150,
  `profile: none loaded; overview: data ${Math.round(onOverview.modelEnd)} ms, map chunk ${Math.round(onOverview.chunk)} ms, geo ${Math.round(onOverview.geo)} ms; ${mapPaths} paths`,
);
const kpiTotal = Number((await kpi('Total Active Staff')).replace(/,/g, ''));
check('map: total equals Total Active Staff KPI', (await exTotal()) === kpiTotal, `${await exTotal()} vs ${kpiTotal}`);

const slider = ex.locator('input[type="range"]');
const reportingBefore = await page.locator('main > header').innerText();
await slider.focus();
await page.keyboard.press('Home');
await page.waitForTimeout(400);
const firstLabel = await exLabel();
const firstTotal = await exTotal();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
check('map: timeline moves month by month', firstLabel === 'Jan 2024' && (await exLabel()) === 'Feb 2024', `${firstLabel} -> ${await exLabel()}`);
check('map: timeline is local (dashboard reporting date unchanged)', (await page.locator('main > header').innerText()) === reportingBefore && (await kpi('Total Active Staff')).replace(/,/g, '') === String(kpiTotal), `Jan 2024 total ${firstTotal}`);
const stepTimes = [];
for (let i = 0; i < 8; i++) {
  stepTimes.push(await page.evaluate(async () => {
    const input = document.querySelector('#global-workforce-explorer input[type="range"]');
    const label = document.querySelector('#global-workforce-explorer [data-month-label]');
    const prev = label.textContent;
    const t = performance.now();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(Number(input.value) + 1));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    while (label.textContent === prev && performance.now() - t < 3000) await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t;
  }));
}
stepTimes.sort((a, b) => a - b);
check('map: manual timeline step stays responsive', stepTimes[3] < 250, `median ${Math.round(stepTimes[3])} ms`);
await page.keyboard.press('End');

await ex.getByRole('radio', { name: 'YoY change' }).click();
await page.waitForTimeout(400);
check('map: YoY mode re-ranks the country list', (await ex.getByText(/ranked by YoY change/i).count()) === 1);
await ex.getByRole('radio', { name: 'Active staff' }).click();

await ex.getByRole('list', { name: 'Countries ranked' }).getByRole('button', { name: /^Kenya/ }).click();
await page.waitForTimeout(300);
const kenyaActive = Number((await ex.locator('[data-detail="country"] dd').first().innerText()).replace(/,/g, ''));
const parts = await ex.locator('[aria-label="Active staff by category"] li span.tabular').allInnerTexts();
const partSum = parts.reduce((s, v) => s + Number(v.replace(/,/g, '')), 0);
check('map: country list selects a country; categories sum to its total', (await panelName()) === 'Kenya' && partSum === kenyaActive, `Kenya ${kenyaActive} = ${parts.join(' + ')}`);
if (out) await ex.screenshot({ path: join(out, 'explorer-selected.png') });
await ex.getByRole('button', { name: 'Clear map selection' }).click();
check('map: selection can be cleared', (await ex.locator('[data-detail="summary"]').count()) === 1);

// click a bubble on the map itself (largest teal symbol)
const bubble = await ex.locator('[data-map-ready] svg path[fill="#0A9A8B"]').evaluateAll((els) => {
  const b = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 8).sort((x, y) => y.width - x.width)[0];
  return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
if (bubble) await page.mouse.click(bubble.x, bubble.y);
await page.waitForTimeout(400);
check('map: clicking a bubble pins that country', !!bubble && (await panelName()) !== null, `${await panelName()}`);
await page.keyboard.press('Escape');

const cats = selects().nth(4);
await cats.selectOption('International Staff');
await page.waitForTimeout(500);
check('map: staff-category filter is reflected', (await exTotal()) === Number((await kpi('Total Active Staff')).replace(/,/g, '')), `map ${await exTotal()} vs KPI ${await kpi('Total Active Staff')}`);
await page.getByRole('button', { name: 'Clear filters' }).click();
await page.waitForTimeout(300);
await selects().nth(3).selectOption('Kenya');
await page.waitForTimeout(500);
const rows = await ex.getByRole('list', { name: 'Countries ranked' }).getByRole('button').count();
check('map: global country filter highlights that country only', (await panelName()) === 'Kenya' && rows === 1, `${await panelName()}, ${rows} row(s)`);
await page.getByRole('button', { name: 'Clear filters' }).click();
await page.waitForTimeout(300);
await ex.getByRole('list', { name: 'Countries ranked' }).getByRole('button', { name: /^Sudan/ }).first().click();
await ex.getByRole('button', { name: /Filter whole dashboard to Sudan/ }).click();
await page.waitForTimeout(400);
check('map: applying a selection to the dashboard is explicit and works', (await selects().nth(3).inputValue()) === 'Sudan' && (await kpi('Countries of Operation')) === '1');
await page.getByRole('button', { name: 'Clear filters' }).click();
await page.waitForTimeout(300);

await ex.getByRole('button', { name: /Restart playback/ }).click();
await page.waitForTimeout(1800);
const playedTo = await exLabel();
await ex.getByRole('button', { name: /Pause playback/ }).click();
const paused = await exLabel();
await page.waitForTimeout(1200);
check('map: playback advances and pause stops it', playedTo !== 'Jan 2024' && paused === (await exLabel()), `${playedTo}, paused at ${paused}`);
await ex.getByRole('button', { name: /Play timeline/ }).click();
await page.locator('aside').getByRole('link', { name: 'Diversity & Mobility' }).click(); // unmount while playing
await page.waitForTimeout(1200);
await page.locator('aside').getByRole('link', { name: 'Workforce Overview' }).click();
await page.waitForTimeout(500);

const rm = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
const rmPage = await rm.newPage();
await rmPage.goto(`${base}#/`, { waitUntil: 'networkidle' });
const rmEx = rmPage.locator('#global-workforce-explorer');
await rmEx.scrollIntoViewIfNeeded();
await rmEx.locator('[data-map-ready="true"]').waitFor({ timeout: 20000 });
check('map: reduced motion disables playback', await rmEx.getByRole('button', { name: /Play timeline/ }).isDisabled());
await rm.close();

for (const vp of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  await page.setViewportSize(vp);
  await page.goto(`${base}#/`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await openExplorer();
  const geom = await page.evaluate(() => {
    const box = document.querySelector('#global-workforce-explorer [data-map-ready]').getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth - window.innerWidth, w: Math.round(box.width), h: Math.round(box.height) };
  });
  await ex.getByRole('list', { name: 'Countries ranked' }).getByRole('button').first().click();
  const sel = await panelName();
  check(`map at ${vp.width}x${vp.height}: fits, no page overflow, list selection works`, geom.overflow <= 1 && geom.w <= vp.width && geom.h >= 200 && !!sel, `${geom.w}x${geom.h}, overflow ${geom.overflow}px, ${sel}`);
  if (out && vp.width === 390) await ex.screenshot({ path: join(out, 'explorer-mobile.png') });
}

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
