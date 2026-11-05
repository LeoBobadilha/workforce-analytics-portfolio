// Performance measurements in a real browser (installed Chrome via playwright-core).
// Usage: node scripts/perf.mjs <baseUrl> [--runs=3] [--profile=laptop|mobile] [--view=2d|3d]
// Reports load timings, long tasks and, when the Global Workforce Explorer is present,
// explorer loading time, timeline step latency and long tasks during playback, in the 2D map
// or the 3D globe (--view, default 2d). In 3D it also reports the drag frame rate, frames drawn
// while idle, JS heap, GPU resource counts and live scenes after leaving the page.
// Profiles: laptop (1366x768, no throttling) and mobile (390x844, 4x CPU throttling).
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:4317/';
const runs = Number(args.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 3);
const only = args.find((a) => a.startsWith('--profile='))?.split('=')[1]; // laptop | mobile
const view = args.find((a) => a.startsWith('--view='))?.split('=')[1] ?? '2d';

const PROFILES = [
  { name: 'laptop 1366x768', viewport: { width: 1366, height: 768 }, cpu: 1, mobile: false },
  { name: 'mobile 390x844, 4x CPU throttle', viewport: { width: 390, height: 844 }, cpu: 4, mobile: true },
];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};
const r = (x) => (Number.isFinite(x) ? Math.round(x) : 'n/a');

// SwiftShader is only a fallback for machines without a GPU (e.g. CI); this machine uses its GPU.
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });

async function measure(profile) {
  const ctx = await browser.newContext({ viewport: profile.viewport, isMobile: profile.mobile, hasTouch: profile.mobile });
  // a visitor who chose a view keeps it; this measures that view from the first load
  await ctx.addInitScript((v) => localStorage.setItem('wa-explorer-view', v), view);
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

  const out = {
    firstContent, ...load, geoAfter: 0, mapJs: 0, globeJs: 0, mapReady: NaN, step: NaN, stepMax: NaN, playLong: NaN,
    dragFps: NaN, flightFps: NaN, dragLong: NaN, renderMs: NaN, idleFrames: NaN, heapMB: NaN, drawCalls: NaN, textures: NaN, liveAfterLeave: NaN, errors: 0,
  };
  const explorer = page.locator('#global-workforce-explorer');
  if (await explorer.count()) {
    const before = await page.evaluate(() => performance.now());
    await explorer.scrollIntoViewIfNeeded();
    const ready = view === '3d' ? '[data-globe-ready="true"]' : '[data-map-ready="true"]';
    // builds before the 3D globe have no view switch: they only offer the 2D map
    const viewSwitch = explorer.locator('[role="radiogroup"][aria-label="Explorer view"]');
    await explorer.locator('[data-map-ready="true"], [role="radiogroup"][aria-label="Explorer view"]').first().waitFor({ timeout: 20000 });
    if ((await viewSwitch.count()) && (await explorer.getAttribute('data-view')) !== view) await explorer.getByRole('radio', { name: view === '3d' ? '3D Globe' : '2D Map' }).click();
    await page.waitForSelector(`#global-workforce-explorer ${ready}`, { timeout: 30000 });
    out.mapReady = (await page.evaluate(() => performance.now())) - before;
    const lazy = await page.evaluate(() => {
      const res = performance.getEntriesByType('resource');
      const sum = (f) => res.filter(f).reduce((s, e) => s + e.encodedBodySize, 0);
      return { geo: sum((e) => e.name.includes('/geo/')), js: sum((e) => e.name.includes('ExplorerBody')), globe: sum((e) => e.name.includes('Globe3D')) };
    });
    out.geoAfter = lazy.geo;
    out.mapJs = lazy.js;
    out.globeJs = lazy.globe;

    if (view === '3d') {
      // Drag the globe for ~2 s (mouse on laptop, touch on mobile) and count the frames drawn.
      await page.waitForTimeout(300);
      const box = await explorer.locator('[data-globe-ready] canvas').boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const stat = () => page.evaluate(() => ({ f: window.__globeStats.frames, r: window.__globeStats.renderMs, t: performance.now() }));
      const s0 = await stat();
      const x = (i) => cx - 120 + (i % 50) * 5 * (Math.floor(i / 50) % 2 ? -1 : 1);
      if (profile.mobile) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x(0), y: cy }] });
        for (let i = 1; i < 100; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x(i), y: cy }] });
          await page.waitForTimeout(16);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(x(0), cy);
        await page.mouse.down();
        for (let i = 1; i < 100; i++) {
          await page.mouse.move(x(i), cy + Math.sin(i / 8) * 20);
          await page.waitForTimeout(16);
        }
        await page.mouse.up();
      }
      const s1 = await stat();
      out.dragFps = ((s1.f - s0.f) / (s1.t - s0.t)) * 1000;
      out.renderMs = (s1.r - s0.r) / Math.max(1, s1.f - s0.f);
      out.dragLong = await page.evaluate((m) => window.__long.filter((e) => e.t >= m).reduce((s, e) => s + e.d, 0), s0.t);
      await page.waitForTimeout(1500); // let inertia settle
      // Camera flight to a country on the far side (not limited by synthetic input rate):
      // frames drawn per second while the camera moves.
      await explorer.getByRole('list', { name: 'Countries ranked' }).getByRole('button', { name: /^Colombia/ }).click();
      out.flightFps = await page.evaluate(async () => {
        const st = window.__globeStats;
        const f0 = st.frames;
        const t0 = performance.now();
        let last = f0;
        let tLast = t0;
        while (performance.now() - tLast < 250 && performance.now() - t0 < 5000) {
          await new Promise((r) => requestAnimationFrame(r));
          if (st.frames !== last) {
            last = st.frames;
            tLast = performance.now();
          }
        }
        return ((last - f0) / Math.max(1, tLast - t0)) * 1000;
      });
      await explorer.getByRole('button', { name: 'Clear map selection' }).click();
      await page.waitForTimeout(300);
      const idle0 = await page.evaluate(() => window.__globeStats.frames);
      await page.waitForTimeout(2000);
      out.idleFrames = (await page.evaluate(() => window.__globeStats.frames)) - idle0;
      await cdp.send('Performance.enable');
      const metrics = (await cdp.send('Performance.getMetrics')).metrics;
      out.heapMB = (metrics.find((x) => x.name === 'JSHeapUsedSize')?.value ?? NaN) / 1048576;
      const gpu = await page.evaluate(() => window.__globeStats.gpu);
      out.drawCalls = gpu.drawCalls;
      out.textures = gpu.textures;
    }

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
    if (view === '3d') {
      await page.goto(`${base}#/profile`);
      await page.waitForTimeout(800);
      out.liveAfterLeave = await page.evaluate(() => window.__globeStats?.live ?? 0);
    }
  }
  out.errors = errors.length;
  await ctx.close();
  return out;
}

for (const profile of PROFILES.filter((p) => !only || p.name.startsWith(only))) {
  const results = [];
  for (let i = 0; i < runs; i++) results.push(await measure(profile));
  const m = (k) => r(median(results.map((x) => x[k])));
  console.log(`\n${profile.name} (median of ${runs} runs)`);
  console.log(`  first dashboard content (charts drawn): ${m('firstContent')} ms   DOMContentLoaded: ${m('dcl')} ms`);
  const kb = (k) => r(median(results.map((x) => x[k])) / 1024);
  console.log(`  transferred before scrolling: JS ${kb('js')} KB · JSON ${kb('json')} KB · map boundaries ${kb('geo')} KB`);
  console.log(`  loaded lazily when the explorer is reached (${view}): explorer code ${kb('mapJs')} KB · 3D globe code ${kb('globeJs')} KB · boundaries ${kb('geoAfter')} KB`);
  console.log(`  long tasks during load: total ${m('longSum')} ms · longest ${m('longMax')} ms`);
  console.log(`  explorer ready after scroll: ${m('mapReady')} ms · timeline step: median ${m('step')} ms, max ${m('stepMax')} ms · long tasks during 4 s playback: ${m('playLong')} ms`);
  if (view === '3d') {
    console.log(`  camera flight: ${m('flightFps')} frames/s · globe drag: ${m('dragFps')} frames/s drawn (bounded by the synthetic input rate) · CPU per frame ${median(results.map((x) => x.renderMs)).toFixed(1)} ms · long tasks during the 2 s drag ${m('dragLong')} ms`);
    console.log(`  idle: ${m('idleFrames')} frames drawn in 2 s · JS heap ${median(results.map((x) => x.heapMB)).toFixed(1)} MB · draw calls ${m('drawCalls')} · textures ${m('textures')} · live scenes after leaving the page ${m('liveAfterLeave')}`);
  }
  console.log(`  console errors: ${Math.max(...results.map((x) => x.errors))}`);
}
await browser.close();
