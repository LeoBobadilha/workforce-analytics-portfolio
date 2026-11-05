// End-to-end interaction checks in a real browser (installed Chrome via playwright-core).
// Usage: node scripts/e2e.mjs <baseUrl> [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3];
if (out) mkdirSync(out, { recursive: true });
// SwiftShader gives software WebGL where there is no GPU (CI); a real GPU is used when present.
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
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

// 8. Global Workforce Explorer (2D map). The 3D globe is checked in section 9.
await page.evaluate(() => localStorage.setItem('wa-explorer-view', '2d'));
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
await rm.addInitScript(() => localStorage.setItem('wa-explorer-view', '2d'));
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

// 9. Global Workforce Explorer — 3D globe
const G = '#global-workforce-explorer';
const globeOf = (pg) => pg.locator(`${G} [data-globe-ready]`);
const camOf = async (pg) => ((await globeOf(pg).getAttribute('data-camera')) ?? '').split(',').map(Number);
/** wait until the globe has drawn no new frame for 300 ms (camera, inertia and transitions settled) */
const settle = (pg) =>
  pg.evaluate(async () => {
    const st = window.__globeStats;
    let last = st.frames;
    let t = performance.now();
    const t0 = t;
    while (performance.now() - t < 300 && performance.now() - t0 < 6000) {
      await new Promise((r) => requestAnimationFrame(r));
      if (st.frames !== last) {
        last = st.frames;
        t = performance.now();
      }
    }
  });
const open3d = async (pg) => {
  const gx = pg.locator(G);
  await gx.scrollIntoViewIfNeeded();
  await gx.locator('[role="radiogroup"][aria-label="Explorer view"]').waitFor({ timeout: 20000 });
  if ((await gx.getAttribute('data-view')) !== '3d') await gx.getByRole('radio', { name: '3D Globe' }).click();
  await gx.locator('[data-globe-ready="true"]').waitFor({ timeout: 30000 });
  await settle(pg);
};
const watch = (pg) => {
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
};
const anchorsOf = (pg) => pg.evaluate(async () => Object.fromEntries((await (await fetch('geo/world-110m.json')).json()).features.map((f) => [f.properties.iso3, f.properties.label])));
// a focused country sits 12° above the view centre (FOCUS_TILT), so its column is seen at an angle
const focusOf = (a) => [a[0], Math.max(-65, a[1] - 12)];
const near = (cam, a, tol = 2) => Math.abs(((cam[0] - a[0] + 540) % 360) - 180) < tol && Math.abs(cam[1] - a[1]) < tol;
const listRows = (pg) =>
  pg.locator(`${G} [aria-label="Countries ranked"] button`).evaluateAll((bs) =>
    bs.map((b) => {
      const s = b.querySelectorAll('span');
      return { name: s[0].textContent, total: Number(s[1].textContent.replace(/,/g, '')), change: s[2].textContent };
    }),
  );
const canvasCentre = async (pg) => {
  const b = await globeOf(pg).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};

// 9a. lazy loading: Three.js is never in the main bundle and loads only with the 3D view
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => localStorage.setItem('wa-explorer-view', '2d'));
  const pg = await ctx.newPage();
  watch(pg);
  const globeRes = () => pg.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('Globe3D')).length);
  await pg.goto(`${base}#/profile`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(600);
  const onProfile = await globeRes();
  await pg.goto(`${base}#/`, { waitUntil: 'networkidle' });
  await pg.reload({ waitUntil: 'networkidle' });
  const gx = pg.locator(G);
  await gx.scrollIntoViewIfNeeded();
  await gx.locator('[data-map-ready="true"]').waitFor({ timeout: 20000 });
  const in2d = await globeRes();
  const mainHasThree = await pg.evaluate(async () => {
    const src = document.querySelector('script[type="module"][src]').src;
    return (await (await fetch(src)).text()).includes('WebGLRenderer');
  });
  await open3d(pg);
  const in3d = await globeRes();
  check('3D: Three.js loads only when the 3D view is shown (not in the main bundle, not on other pages)', !mainHasThree && onProfile === 0 && in2d === 0 && in3d > 0, `main bundle has three: ${mainHasThree}; profile ${onProfile}, 2D ${in2d}, 3D ${in3d}`);
  await ctx.close();
}

const ctx3 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const g = await ctx3.newPage();
watch(g);
await g.goto(`${base}#/`, { waitUntil: 'networkidle' });
const gx = g.locator(G);
const hardware = await g.evaluate(() => !!document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true }));
await gx.scrollIntoViewIfNeeded();
await gx.locator('[role="radiogroup"][aria-label="Explorer view"]').waitFor({ timeout: 20000 });
const defView = await gx.getAttribute('data-view');
check('3D: default view follows WebGL capability (3D with hardware WebGL, else 2D)', defView === (hardware ? '3d' : '2d'), `hardware WebGL: ${hardware}, default ${defView}`);
await open3d(g);
const A = await anchorsOf(g);
const gKpi = Number((await g.locator('section', { has: g.locator('h3', { hasText: 'Total Active Staff' }) }).first().locator('p').first().innerText()).replace(/,/g, ''));
const gTotal = Number((await gx.locator('p[aria-live]').first().innerText()).match(/([\d,]+) active staff/)[1].replace(/,/g, ''));
const gpu = await g.evaluate(() => window.__globeStats.gpu);
check('3D: globe renders with the same total as the KPI and a small number of draw calls', gTotal === gKpi && gpu.drawCalls > 0 && gpu.drawCalls <= 12, `${gTotal} vs KPI ${gKpi}; ${gpu.drawCalls} draw calls, ${gpu.textures} texture(s)`);

const labels = await globeOf(g).locator('span').evaluateAll((s) => s.filter((e) => e.style.display !== 'none').map((e) => e.textContent));
const gRows = await listRows(g);
const labelOk = labels.length > 0 && labels.every((t) => gRows.some((r) => t === `${r.name} ${r.total.toLocaleString('en-GB')}`));
check('3D: on-globe labels show the same values as the country list', labelOk, labels.slice(0, 4).join(', '));

// the summary panel names every country tied for the largest increase / reduction
{
  const parse = (t) => Number((t.match(/[+\u2212-]\s?\d[\d,]*/)?.[0] ?? 'NaN').replace(/\u2212/, '-').replace(/[\s,+]/g, ''));
  const known = gRows.filter((r) => Number.isFinite(parse(r.change)));
  const up = Math.max(...known.map((r) => parse(r.change)));
  const down = Math.min(...known.map((r) => parse(r.change)));
  const upNames = known.filter((r) => parse(r.change) === up).map((r) => r.name);
  const downNames = known.filter((r) => parse(r.change) === down).map((r) => r.name);
  const inc = await gx.locator('[data-extreme="increase"]').innerText();
  const red = await gx.locator('[data-extreme="reduction"]').innerText();
  const tieOk = (txt, names, v) => names.every((n) => txt.includes(n) || /others/.test(txt)) && txt.includes(`${v > 0 ? '+' : '\u2212'}${Math.abs(v)}`) && (names.length > 1) === /each/.test(txt);
  check('3D: summary panel names every country tied for the largest increase and reduction', tieOk(inc, upNames, up) && tieOk(red, downNames, down), `${inc.replace(/\n/g, ' ')} | ${red.replace(/\n/g, ' ')}`);
}

await gx.getByRole('list', { name: 'Countries ranked' }).getByRole('button', { name: /^Kenya/ }).click();
await settle(g);
const camK = await camOf(g);
check('3D: selecting a country in the list brings it into view', near(camK, focusOf(A.KEN)) && (await gx.locator('[data-detail-name]').innerText()) === 'Kenya', `camera ${camK.slice(0, 2)} vs Kenya ${A.KEN}`);
await gx.getByRole('button', { name: 'Clear map selection' }).click();
await settle(g);
const camAfterClear = await camOf(g);
check('3D: clearing the selection does not move the camera', camAfterClear.join() === camK.join(), camAfterClear.join());
let c = await canvasCentre(g);
const kenyaAt = async (pg) => {
  const b = await globeOf(pg).boundingBox();
  const p = await pg.evaluate(() => window.__globeStats.screenOf?.('KEN'));
  return p && { x: b.x + p[0], y: b.y + p[1] };
};
const kAt = await kenyaAt(g);
await g.mouse.move(kAt.x + 2, kAt.y + 1);
await g.waitForTimeout(400);
const tipText = await globeOf(g).locator('[role="tooltip"]').evaluate((t) => (t.style.display === 'block' ? t.textContent : ''));
check('3D: hovering a country shows its figures', tipText.includes('Kenya') && tipText.includes('Active staff'), tipText.slice(0, 60));
await g.mouse.click(kAt.x, kAt.y);
await g.waitForTimeout(400);
check('3D: clicking the globe selects the country under the pointer', (await gx.locator('[data-detail-name]').innerText().catch(() => null)) === 'Kenya');
await g.mouse.click(c.b.x + 6, c.b.y + c.b.height - 6); // corner of the stage, off the planet
await g.waitForTimeout(300);
check('3D: clicking empty space selects nothing new', (await gx.locator('[data-detail-name]').innerText().catch(() => null)) === 'Kenya');
await gx.getByRole('button', { name: 'Clear map selection' }).click();

// drag rotates; wheel scrolls the page until the globe is engaged
await g.mouse.move(c.x - 120, c.y);
await g.mouse.down();
for (let i = 1; i <= 20; i++) await g.mouse.move(c.x - 120 + i * 12, c.y + i * 2);
await g.mouse.up();
await settle(g);
const camDrag = await camOf(g);
check('3D: dragging rotates the globe', Math.abs(camDrag[0] - camK[0]) > 10, `lon ${camK[0]} -> ${camDrag[0]}`);
await gx.locator('[data-month-label]').scrollIntoViewIfNeeded();
await g.evaluate(() => window.scrollBy(0, -200));
c = await canvasCentre(g);
await g.mouse.move(2, 2); // pointer leaves the globe: it is no longer engaged
await g.waitForTimeout(100);
const y0 = await g.evaluate(() => window.scrollY);
await g.mouse.move(c.x, c.y + c.b.height / 2 - 30);
await g.waitForTimeout(100);
await g.mouse.wheel(0, 120);
await g.waitForTimeout(400);
const y1 = await g.evaluate(() => window.scrollY);
const dist1 = (await camOf(g))[2];
c = await canvasCentre(g);
await g.mouse.move(c.x + 40, c.y + 30);
await g.mouse.down();
await g.mouse.move(c.x + 52, c.y + 30);
await g.mouse.up();
await settle(g);
const yBefore = await g.evaluate(() => window.scrollY);
await g.mouse.wheel(0, -240);
await settle(g);
const dist2 = (await camOf(g))[2];
const y2 = await g.evaluate(() => window.scrollY);
check('3D: wheel scrolls the page until the globe is clicked, then zooms', y1 !== y0 && dist1 === camDrag[2] && dist2 < dist1 && y2 === yBefore, `scroll ${y0}->${y1}, zoom ${dist1}->${dist2}`);
await gx.getByRole('button', { name: 'Reset globe view' }).click();
await settle(g);
const camReset = await camOf(g);
await gx.getByRole('button', { name: 'Zoom in' }).click();
await settle(g);
const camZoom = await camOf(g);
await gx.getByRole('combobox', { name: 'Focus the globe on a region' }).selectOption('Latin America & Caribbean');
await settle(g);
const camRegion = await camOf(g);
check('3D: zoom, reset and region controls move the camera', camZoom[2] < camReset[2] && camRegion[0] < -55 && camRegion[0] > -90, `reset ${camReset.join()} zoom ${camZoom[2]} region lon ${camRegion[0]}`);
await gx.getByRole('button', { name: 'Reset globe view' }).click();
await settle(g);

// keyboard: the globe takes focus; arrows rotate, + zooms, 0 resets
{
  await globeOf(g).focus();
  const k0 = await camOf(g);
  await g.keyboard.press('ArrowRight');
  await settle(g);
  const k1 = await camOf(g);
  await g.keyboard.press('+');
  await settle(g);
  const k2 = await camOf(g);
  await g.keyboard.press('0');
  await settle(g);
  const k3 = await camOf(g);
  const focused = await g.evaluate(() => document.activeElement?.hasAttribute('data-globe-ready'));
  check('3D keyboard: focusable globe; arrow keys rotate, + zooms, 0 resets', focused && Math.abs(((k1[0] - k0[0] + 540) % 360) - 180 - 15) < 1 && k2[2] < k1[2] && k3.join() === camReset.join(), `${k0} -> ${k1} -> ${k2} -> ${k3}`);
}

// shared state: mode, month and selection survive switching between 3D and 2D
await gx.getByRole('radio', { name: 'YoY change' }).click();
const gSlider = gx.locator('input[type="range"]');
await gSlider.focus();
await g.keyboard.press('End');
for (let i = 0; i < 4; i++) await g.keyboard.press('ArrowLeft');
await gx.getByRole('list', { name: 'Countries ranked' }).getByRole('button', { name: /^Sudan/ }).click();
await settle(g);
const st3 = { m: await gx.locator('[data-month-label]').innerText(), p: await gx.locator('[data-detail-name]').innerText(), mode: await gx.getByRole('radio', { name: 'YoY change' }).getAttribute('aria-checked') };
await gx.getByRole('radio', { name: '2D Map' }).click();
await gx.locator('[data-map-ready="true"]').waitFor({ timeout: 20000 });
const st2 = { m: await gx.locator('[data-month-label]').innerText(), p: await gx.locator('[data-detail-name]').innerText(), mode: await gx.getByRole('radio', { name: 'YoY change' }).getAttribute('aria-checked') };
await gx.getByRole('radio', { name: '3D Globe' }).click();
await gx.locator('[data-globe-ready="true"]').waitFor({ timeout: 20000 });
await settle(g);
const camS = await camOf(g);
const st3b = { m: await gx.locator('[data-month-label]').innerText(), p: await gx.locator('[data-detail-name]').innerText(), mode: await gx.getByRole('radio', { name: 'YoY change' }).getAttribute('aria-checked') };
check(
  '3D: switching 3D ↔ 2D keeps month, selected country and analysis mode',
  JSON.stringify(st3) === JSON.stringify(st2) && JSON.stringify(st2) === JSON.stringify(st3b) && st3.p === 'Sudan' && st3.mode === 'true' && near(camS, focusOf(A.SDN)),
  `${st3.m}, ${st3.p}, yoy ${st3.mode}; camera at Sudan after remount: ${near(camS, focusOf(A.SDN))}`,
);
await gx.getByRole('button', { name: 'Clear map selection' }).click();
await gx.getByRole('radio', { name: 'Active staff' }).click();

// timeline steps update the existing scene (no new scene, responsive), nothing drawn while idle
const created0 = await g.evaluate(() => window.__globeStats.created);
const steps3 = [];
await g.keyboard.press('Escape');
for (let i = 0; i < 8; i++) {
  steps3.push(
    await g.evaluate(async () => {
      const input = document.querySelector('#global-workforce-explorer input[type="range"]');
      const label = document.querySelector('#global-workforce-explorer [data-month-label]');
      const prev = label.textContent;
      const t = performance.now();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(Number(input.value) - 1));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      while (label.textContent === prev && performance.now() - t < 3000) await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t;
    }),
  );
}
steps3.sort((a, b) => a - b);
await settle(g);
const idleF0 = await g.evaluate(() => window.__globeStats.frames);
await g.waitForTimeout(1500);
const idleF1 = await g.evaluate(() => window.__globeStats.frames);
const created1 = await g.evaluate(() => window.__globeStats.created);
check('3D: timeline steps reuse the scene, stay responsive, and nothing is drawn while idle', steps3[3] < 250 && created1 === created0 && idleF1 === idleF0, `median ${Math.round(steps3[3])} ms; scenes created ${created1 - created0}; idle frames ${idleF1 - idleF0}`);
await gSlider.focus();
await g.keyboard.press('End');

// global filters flow into the globe
await g.locator('main select').nth(4).selectOption('International Staff');
await g.waitForTimeout(500);
const intlKpi = (await g.locator('section', { has: g.locator('h3', { hasText: 'Total Active Staff' }) }).first().locator('p').first().innerText()).replace(/,/g, '');
const intlMap = (await gx.locator('p[aria-live]').first().innerText()).match(/([\d,]+) active staff/)[1].replace(/,/g, '');
await g.getByRole('button', { name: 'Clear filters' }).click();
await g.waitForTimeout(300);
await g.locator('main select').nth(3).selectOption('Kenya');
await g.waitForTimeout(400);
await settle(g);
const camF = await camOf(g);
const fRows = await gx.getByRole('list', { name: 'Countries ranked' }).getByRole('button').count();
check('3D: category and country filters apply; a country filter focuses the globe', intlKpi === intlMap && fRows === 1 && near(camF, focusOf(A.KEN)), `intl ${intlMap} vs KPI ${intlKpi}; ${fRows} row; camera at Kenya ${near(camF, focusOf(A.KEN))}`);
await g.getByRole('button', { name: 'Clear filters' }).click();
await g.waitForTimeout(400);
await gx.scrollIntoViewIfNeeded();

// guided exploration
const allRows = await listRows(g);
const num = (t) => Number((t.match(/[+−-]\s?\d[\d,]*/)?.[0] ?? 'NaN').replace(/−/, '-').replace(/[\s,+]/g, ''));
const maxUp = Math.max(...allRows.map((r) => num(r.change)).filter(Number.isFinite));
await gx.getByRole('button', { name: 'Explore workforce changes' }).click();
await settle(g);
const tourBox = gx.getByRole('region', { name: 'Explore workforce changes' });
const stop1 = await tourBox.locator('[data-tour-stop]').getAttribute('data-tour-stop');
const stop1Text = await tourBox.innerText();
const camT = await camOf(g);
const panelT = await gx.locator('[data-detail-name]').innerText();
if (out) await gx.screenshot({ path: join(out, 'globe-tour.png') });
check(
  '3D: guided exploration starts at the largest calculated increase and focuses it',
  stop1Text.includes('1 / ') && /largest increase/i.test(stop1Text) && stop1Text.includes(`+${maxUp}`) && near(camT, focusOf(A[stop1])) && stop1Text.includes(panelT),
  `${stop1} (${panelT}) +${maxUp}`,
);
await tourBox.getByRole('button', { name: 'Next country in guided exploration' }).click();
await settle(g);
const stop2 = await tourBox.locator('[data-tour-stop]').getAttribute('data-tour-stop');
await tourBox.getByRole('button', { name: 'Pause guided exploration' }).click();
await g.waitForTimeout(5600);
const stop2b = await tourBox.locator('[data-tour-stop]').getAttribute('data-tour-stop');
await tourBox.getByRole('button', { name: 'Exit guided exploration' }).click();
check('3D: guided exploration can step, pause and exit', stop2 !== stop1 && stop2b === stop2 && (await gx.getByRole('region', { name: 'Explore workforce changes' }).count()) === 0, `${stop1} -> ${stop2}, paused at ${stop2b}`);
if (out) await gx.screenshot({ path: join(out, 'globe-selected.png') });
await g.keyboard.press('Escape');

// context loss: fallback message, then the scene is rebuilt when the context returns
await g.evaluate(() => {
  const cv = document.querySelector('#global-workforce-explorer [data-globe-ready] canvas');
  window.__lc = (cv.getContext('webgl2') || cv.getContext('webgl')).getExtension('WEBGL_lose_context');
  window.__lc.loseContext();
});
const alertShown = await gx.getByRole('alert').waitFor({ timeout: 5000 }).then(() => true, () => false);
const alertText = alertShown ? await gx.getByRole('alert').innerText() : '';
await g.evaluate(() => window.__lc.restoreContext());
await g.waitForTimeout(500);
await gx.locator('[data-globe-ready="true"]').waitFor({ timeout: 20000 }).catch(() => {});
const afterRestore = await g.evaluate(() => window.__globeStats.live);
check('3D: losing the graphics context shows a fallback and the globe recovers', alertShown && alertText.includes('2D map') && (await gx.getByRole('alert').count()) === 0 && afterRestore === 1, `alert ${alertShown}; live scenes ${afterRestore}`);

// cleanup: leaving the page while playing disposes the scene and stops all globe rendering
await gx.getByRole('button', { name: /Restart playback/ }).click();
await g.waitForTimeout(800);
await g.locator('aside').getByRole('link', { name: 'Diversity & Mobility' }).click();
await g.waitForTimeout(800);
const left = await g.evaluate(() => ({ live: window.__globeStats.live, f: window.__globeStats.frames }));
await g.waitForTimeout(1000);
const left2 = await g.evaluate(() => window.__globeStats.frames);
check('3D: navigating away disposes the scene; no rendering loop keeps running', left.live === 0 && left2 === left.f, `live ${left.live}, frames after leaving +${left2 - left.f}`);

// viewports
for (const vp of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  await g.setViewportSize(vp);
  await g.goto(`${base}#/`, { waitUntil: 'networkidle' });
  await g.reload({ waitUntil: 'networkidle' });
  await open3d(g);
  const geom = await g.evaluate(() => {
    const b = document.querySelector('#global-workforce-explorer [data-globe-ready] canvas').getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth - window.innerWidth, w: Math.round(b.width), h: Math.round(b.height) };
  });
  await gx.getByRole('list', { name: 'Countries ranked' }).getByRole('button').first().click();
  await settle(g);
  const sel = await gx.locator('[data-detail-name]').innerText().catch(() => null);
  check(`3D at ${vp.width}x${vp.height}: fits, no page overflow, list selection works`, geom.overflow <= 1 && geom.w <= vp.width && geom.h >= 300 && !!sel, `${geom.w}x${geom.h}, overflow ${geom.overflow}px, ${sel}`);
  if (out && vp.width === 1920) await gx.screenshot({ path: join(out, 'globe.png') });
}
await ctx3.close();

// touch: horizontal drag rotates, vertical drag scrolls the page, tap selects
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  watch(pg);
  const cdp = await ctx.newCDPSession(pg);
  await pg.goto(`${base}#/`, { waitUntil: 'networkidle' });
  await open3d(pg);
  const px = pg.locator(G);
  const lay = await px.evaluate((el) => {
    const r = (s) => el.querySelector(s).getBoundingClientRect();
    const slider = r('input[type="range"]');
    const chip = r('[data-month-label]');
    return { controls: Math.round(r('[data-explorer-controls]').height), globe: Math.round(r('[data-globe-ready]').height), width: Math.round(r('[data-globe-ready]').width), sameRow: Math.abs(slider.top + slider.height / 2 - (chip.top + chip.height / 2)) < 12 };
  });
  check('3D phone layout: two rows of controls, timeline on one row, globe stays prominent', lay.controls <= 80 && lay.sameRow && lay.globe >= 320 && lay.width >= 320, JSON.stringify(lay));
  const touchDrag = async (x0, y0, dx, dy) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / 12, y: y0 + (dy * i) / 12 }] });
      await pg.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  let cc = await canvasCentre(pg);
  const cam0 = await camOf(pg);
  await touchDrag(cc.x - 80, cc.y, 160, 0);
  await settle(pg);
  const cam1 = await camOf(pg);
  cc = await canvasCentre(pg);
  const sy0 = await pg.evaluate(() => window.scrollY);
  await touchDrag(cc.x, cc.y + 60, 0, -180);
  await pg.waitForTimeout(600);
  const sy1 = await pg.evaluate(() => window.scrollY);
  await settle(pg);
  const cam2 = await camOf(pg);
  check('3D touch: sideways drag rotates the globe; vertical drag scrolls the page', Math.abs(cam1[0] - cam0[0]) > 10 && sy1 > sy0 + 50 && Math.abs(cam2[1] - cam1[1]) < 1, `cam ${cam0} -> ${cam1} -> ${cam2}; scrollY ${sy0} -> ${sy1}`);
  await px.getByRole('list', { name: 'Countries ranked' }).getByRole('button', { name: /^Kenya/ }).click();
  await settle(pg);
  await px.getByRole('button', { name: 'Clear map selection' }).click();
  await px.locator('[data-globe-ready]').scrollIntoViewIfNeeded();
  await settle(pg);
  const kp = await kenyaAt(pg);
  await pg.touchscreen.tap(kp.x, kp.y);
  await pg.waitForTimeout(400);
  const rowH = await px.getByRole('list', { name: 'Countries ranked' }).getByRole('button').first().evaluate((b) => b.getBoundingClientRect().height);
  check('3D touch: tapping a country selects it; list rows are comfortable touch targets', (await px.locator('[data-detail-name]').innerText().catch(() => null)) === 'Kenya' && rowH >= 40, `row height ${rowH}px`);
  if (out) {
    // viewport capture: an element capture taller than the screen briefly resets touch emulation
    await px.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 64));
    await pg.waitForTimeout(300);
    const hintTouch = (await px.locator('[data-stage] p').innerText()).startsWith('Drag sideways');
    if (!hintTouch) errors.push('touch hint not shown in the mobile screenshot');
    await pg.screenshot({ path: join(out, 'globe-mobile.png') });
  }
  await ctx.close();
}

// reduced motion: no camera animation, no automatic tour
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
  const pg = await ctx.newPage();
  watch(pg);
  await pg.goto(`${base}#/`, { waitUntil: 'networkidle' });
  await open3d(pg);
  const px = pg.locator(G);
  const pa = await anchorsOf(pg);
  const f0 = await pg.evaluate(() => window.__globeStats.frames);
  await px.getByRole('list', { name: 'Countries ranked' }).getByRole('button', { name: /^Colombia/ }).click();
  await settle(pg);
  const f1 = await pg.evaluate(() => window.__globeStats.frames);
  const camR = await camOf(pg);
  await px.getByRole('button', { name: 'Explore workforce changes' }).click();
  const tb = px.getByRole('region', { name: 'Explore workforce changes' });
  const s1 = await tb.locator('[data-tour-stop]').getAttribute('data-tour-stop');
  await pg.waitForTimeout(5600);
  const s2 = await tb.locator('[data-tour-stop]').getAttribute('data-tour-stop');
  check('3D reduced motion: the camera jumps without animation and the tour never advances by itself', near(camR, focusOf(pa.COL)) && f1 - f0 <= 3 && s1 === s2 && (await tb.getByRole('button', { name: /Pause guided/ }).count()) === 0, `${f1 - f0} frame(s) for the move; stop ${s1} -> ${s2}`);
  await ctx.close();
}

// no WebGL: 2D map is used and the 3D option is disabled with an explanation
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...a) {
      return /webgl/i.test(type) ? null : orig.call(this, type, ...a);
    };
  });
  const pg = await ctx.newPage();
  watch(pg);
  await pg.goto(`${base}#/`, { waitUntil: 'networkidle' });
  const px = pg.locator(G);
  await px.scrollIntoViewIfNeeded();
  await px.locator('[data-map-ready="true"]').waitFor({ timeout: 20000 });
  const radio = px.getByRole('radio', { name: '3D Globe' });
  if (out) {
    await pg.waitForTimeout(400);
    await px.screenshot({ path: join(out, 'explorer.png') });
  }
  check('3D unavailable (no WebGL): 2D map shown, 3D option disabled with a reason', (await px.getAttribute('data-view')) === '2d' && (await radio.isDisabled()) && /WebGL/.test((await radio.getAttribute('title')) ?? ''), await radio.getAttribute('title'));
  await ctx.close();
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
