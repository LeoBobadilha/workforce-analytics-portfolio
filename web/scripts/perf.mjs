// Performance measurements in a real browser (installed Chrome via playwright-core).
// Usage: node scripts/perf.mjs <baseUrl> [--runs=3]
// Reports load timings, long tasks and, when the Global Workforce Explorer is present,
// map loading time, timeline step latency and long tasks during playback.
// Profiles: laptop (1366x768, no throttling) and mobile (390x844, 4x CPU throttling).
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:4317/';
const runs = Number(args.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 3);

const PROFILES = [
  { name: 'laptop 1366x768', viewport: { width: 1366, height: 768 }, cpu: 1, mobile: false },
  { name: 'mobile 390x844, 4x CPU throttle', viewport: { width: 390, height: 844 }, cpu: 4, mobile: true },
];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};
const r = (x) => (Number.isFinite(x) ? Math.round(x) : 'n/a');

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function measure(profile) {
  const ctx = await browser.newContext({ viewport: profile.viewport, isMobile: profile.mobile, hasTouch: profile.mobile });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (profile.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  await page.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push({ t: e.startTime, d: e.duration }))).observe({ type: 'longtask', buffered: true });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const t0 = Date.now();
  await page.goto(`${base}#/`, { waitUntil: 'load' });
  await page.waitForSelector('main h1');
  await page.waitForFunction(() => document.querySelectorAll('main svg path').length > 50);
  const firstContent = Date.now() - t0;
  await page.waitForLoadState('networkidle');
  const load = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const sum = (f) => res.filter(f).reduce((s, e) => s + e.encodedBodySize, 0);
    return {
      dcl: nav.domContentLoadedEventEnd,
      js: sum((e) => e.name.endsWith('.js')),
      json: sum((e) => e.name.endsWith('.json')),
      geo: sum((e) => e.name.includes('/geo/')),
      longSum: window.__long.reduce((s, e) => s + e.d, 0),
      longMax: window.__long.reduce((m, e) => Math.max(m, e.d), 0),
    };
  });

  const out = { firstContent, ...load, geoAfter: 0, mapJs: 0, mapReady: NaN, step: NaN, stepMax: NaN, playLong: NaN, errors: errors.length };
  const explorer = page.locator('#global-workforce-explorer');
  if (await explorer.count()) {
    const before = await page.evaluate(() => performance.now());
    await explorer.scrollIntoViewIfNeeded();
    await page.waitForSelector('#global-workforce-explorer [data-map-ready="true"]', { timeout: 20000 });
    out.mapReady = (await page.evaluate(() => performance.now())) - before;
    const lazy = await page.evaluate(() => {
      const res = performance.getEntriesByType('resource');
      return {
        geo: res.filter((e) => e.name.includes('/geo/')).reduce((s, e) => s + e.encodedBodySize, 0),
        js: res.filter((e) => e.name.includes('ExplorerBody')).reduce((s, e) => s + e.encodedBodySize, 0),
      };
    });
    out.geoAfter = lazy.geo;
    out.mapJs = lazy.js;

    // Timeline step latency: key press -> label updated and two animation frames painted.
    const slider = explorer.locator('input[type="range"]');
    await slider.focus();
    const steps = [];
    for (let i = 0; i < 12; i++) {
      const ms = await page.evaluate(async () => {
        const input = document.querySelector('#global-workforce-explorer input[type="range"]');
        const label = document.querySelector('#global-workforce-explorer [data-month-label]');
        const prev = label.textContent;
        const t = performance.now();
        // native setter: React ignores programmatic `input.value =` assignments
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(Number(input.value) - 1));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        while (label.textContent === prev && performance.now() - t < 3000) await new Promise((res) => requestAnimationFrame(res));
        await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
        return performance.now() - t;
      });
      steps.push(ms);
    }
    out.step = median(steps);
    out.stepMax = Math.max(...steps);

    // Long tasks during 4 s of playback.
    const play = explorer.getByRole('button', { name: /restart/i });
    if (await play.isEnabled()) {
      const mark = await page.evaluate(() => performance.now());
      await play.click();
      await page.waitForTimeout(4000);
      await explorer.getByRole('button', { name: /pause/i }).click().catch(() => {});
      out.playLong = await page.evaluate((m) => window.__long.filter((e) => e.t >= m).reduce((s, e) => s + e.d, 0), mark);
    }
  }
  await ctx.close();
  return out;
}

for (const profile of PROFILES) {
  const results = [];
  for (let i = 0; i < runs; i++) results.push(await measure(profile));
  const m = (k) => r(median(results.map((x) => x[k])));
  console.log(`\n${profile.name} (median of ${runs} runs)`);
  console.log(`  first dashboard content (charts drawn): ${m('firstContent')} ms   DOMContentLoaded: ${m('dcl')} ms`);
  const kb = (k) => r(median(results.map((x) => x[k])) / 1024);
  console.log(`  transferred before scrolling: JS ${kb('js')} KB · JSON ${kb('json')} KB · map boundaries ${kb('geo')} KB`);
  console.log(`  loaded lazily when the map is reached: map code ${kb('mapJs')} KB · boundaries ${kb('geoAfter')} KB`);
  console.log(`  long tasks during load: total ${m('longSum')} ms · longest ${m('longMax')} ms`);
  console.log(`  map ready after scroll: ${m('mapReady')} ms · timeline step: median ${m('step')} ms, max ${m('stepMax')} ms · long tasks during 4 s playback: ${m('playLong')} ms`);
  console.log(`  console errors: ${Math.max(...results.map((x) => x.errors))}`);
}
await browser.close();
