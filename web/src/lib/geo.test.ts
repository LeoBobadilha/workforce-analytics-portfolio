import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeModel } from '../data/decode';
import { CATEGORIES, type Category } from '../data/types';
import { monthEndDay, parseYm } from './dates';
import { buildCube, bubbleSize, cell, changeStatus, countryPoints, scaleMaxima, summarise } from './geo';
import { activeAt, computeKpis, period } from './metrics';

const root = resolve(__dirname, '../../..');
const model = decodeModel(JSON.parse(readFileSync(resolve(root, 'web/public/data/hr_model.json'), 'utf-8')));
const geo = JSON.parse(readFileSync(resolve(root, 'web/public/geo/world-110m.json'), 'utf-8')) as {
  features: { properties: { iso3: string; name: string; label: [number, number] }; geometry: { type: string; coordinates: number[][][][] } }[];
};
const cube = buildCube(model);
const hq = model.meta.hq_country;
const ALL = { country: null, category: null };

/** Canonical headcount from the KPI engine's own active-contract logic. */
const canonical = (mi: number, country: string | null, category: Category | null) =>
  activeAt(model, monthEndDay(mi), { country, category }).length;

describe('geographic headcount cube reconciles with the canonical workforce model', () => {
  it('every country × category × month-end equals activeAt (no loss, no double counting)', () => {
    for (let mi = cube.m0; mi <= cube.m1; mi++) {
      const d = monthEndDay(mi);
      const active = activeAt(model, d, ALL);
      const expected = new Map<string, number>();
      for (const c of active) expected.set(`${c.country}|${c.staff_category}`, (expected.get(`${c.country}|${c.staff_category}`) ?? 0) + 1);
      let sum = 0;
      cube.countries.forEach((c, i) => {
        for (const k of CATEGORIES) {
          const v = cell(cube, mi, i, k)!;
          expect(v, `${c.name} ${k} ${mi}`).toBe(expected.get(`${c.name}|${k}`) ?? 0);
          sum += v;
        }
      });
      expect(sum).toBe(active.length);
      expect(new Set(active.map((c) => c.employee_id)).size).toBe(active.length);
    }
  });

  it('map total equals the dashboard headcount KPI for every filter scenario', () => {
    const scenarios: { from: string; to: string; country: string | null; category: Category | null }[] = [
      { from: '2024-01', to: '2026-10', country: null, category: null },
      { from: '2024-01', to: '2025-06', country: null, category: 'International Staff' },
      { from: '2025-01', to: '2025-12', country: 'Sudan', category: null },
      { from: '2024-01', to: '2026-10', country: 'Kenya', category: 'Global non-HQ Staff' },
      { from: '2024-01', to: '2024-12', country: null, category: 'National Staff' },
      { from: '2024-01', to: '2026-10', country: 'Switzerland', category: null },
    ];
    for (const s of scenarios) {
      const f = { from: parseYm(s.from), to: parseYm(s.to), country: s.country, category: s.category };
      const k = computeKpis(model, f);
      const pts = countryPoints(cube, f.to, f);
      const sm = summarise(pts, hq);
      expect(sm.total, JSON.stringify(s)).toBe(k.headcount);
      expect(sm.prev, JSON.stringify(s)).toBe(k.headcount_prev_year);
      expect(sm.countriesOfOperation, JSON.stringify(s)).toBe(k.countries_of_operation);
    }
  });

  it('category breakdown sums to the country total and respects the category filter', () => {
    const mi = parseYm('2026-10');
    for (const category of [null, ...CATEGORIES]) {
      for (const p of countryPoints(cube, mi, { country: null, category })) {
        const parts = Object.values(p.byCat).reduce((a, b) => a + b, 0);
        expect(parts, `${p.name} ${category}`).toBe(p.total);
        if (category) for (const k of CATEGORIES) if (k !== category) expect(p.byCat[k]).toBe(0);
      }
    }
  });

  it('HQ staff are assigned only to the HQ country and HQ is excluded from countries of operation', () => {
    const mi = parseYm('2026-10');
    const pts = countryPoints(cube, mi, ALL);
    for (const p of pts) {
      if (p.name === hq) expect(p.byCat['HQ Staff']).toBeGreaterThan(0);
      else expect(p.byCat['HQ Staff'], p.name).toBe(0);
    }
    const sm = summarise(pts, hq);
    expect(sm.countriesOfOperation).toBe(sm.countries - 1);
  });

  it('a global country filter restricts the map to that country', () => {
    const pts = countryPoints(cube, parseYm('2025-06'), { country: 'Ukraine', category: null });
    expect(pts.map((p) => p.name)).toEqual(['Ukraine']);
    expect(pts[0].total).toBe(canonical(parseYm('2025-06'), 'Ukraine', null));
  });

  it('timeline months give the canonical headcount for each month', () => {
    for (const ym of ['2024-01', '2024-07', '2025-01', '2025-12', '2026-10']) {
      const mi = parseYm(ym);
      expect(summarise(countryPoints(cube, mi, ALL), hq).total, ym).toBe(canonical(mi, null, null));
    }
  });

  it('YoY change equals headcount(D) − headcount(D − 12 months) from the monthly headcount logic', () => {
    const mi = parseYm('2026-10');
    for (const p of countryPoints(cube, mi, ALL)) {
      const now = canonical(mi, p.name, null);
      const before = canonical(mi - 12, p.name, null);
      expect(p.total).toBe(now);
      expect(p.prev).toBe(before);
      expect(p.change).toBe(now - before);
      expect(p.pct).toBe(before > 0 ? (now - before) / before : null);
    }
    // same reference date as the KPI engine's prior-year comparison
    const { prevD } = period(model, { from: mi, to: mi, country: null, category: null });
    expect(prevD).toBe(monthEndDay(mi - 12));
  });

  it('months without a prior-year month in the data have no baseline (not zero growth)', () => {
    const first = cube.m0; // Jan 2023: Jan 2022 precedes the simulation
    const pts = countryPoints(cube, first, ALL);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(p.prev).toBeNull();
      expect(p.change).toBeNull();
      expect(p.status).toBe('no-baseline');
    }
    expect(summarise(pts, hq).prev).toBeNull();
    expect(period(model, { from: first, to: first, country: null, category: null }).prevD).toBeNull();
  });

  it('change status distinguishes new, unchanged, growth, reduction and no baseline', () => {
    expect(changeStatus(5, 0)).toBe('new');
    expect(changeStatus(0, 0)).toBe('unchanged');
    expect(changeStatus(7, 7)).toBe('unchanged');
    expect(changeStatus(8, 7)).toBe('growth');
    expect(changeStatus(6, 7)).toBe('reduction');
    expect(changeStatus(6, null)).toBe('no-baseline');
  });

  it('bubble area is proportional to the value, with fixed maxima across the period', () => {
    const d = (v: number) => bubbleSize(v, 400, 40, 0);
    expect(d(100) ** 2 / d(400) ** 2).toBeCloseTo(0.25, 10);
    expect(bubbleSize(0, 400, 40)).toBe(0);
    const { total, change } = scaleMaxima(cube, parseYm('2024-01'), parseYm('2026-10'), ALL);
    const largest = Math.max(...countryPoints(cube, parseYm('2026-10'), ALL).map((p) => p.total));
    expect(total).toBeGreaterThanOrEqual(largest);
    expect(change).toBeGreaterThan(0);
  });
});

describe('geographic features', () => {
  const byIso = new Map(geo.features.map((f) => [f.properties.iso3, f]));

  it('every model country maps by ISO3 to exactly one boundary feature with a label point', () => {
    expect(byIso.size).toBe(geo.features.length);
    for (const c of model.countries) {
      const f = byIso.get(c.iso3);
      expect(f, `${c.name} (${c.iso3})`).toBeDefined();
      expect(f!.geometry.coordinates.length, c.name).toBeGreaterThan(0);
      // the bubble anchor (Natural Earth label point) lies inside the country's own outline
      const [x, y] = f!.properties.label;
      const inside = f!.geometry.coordinates.some((poly) => {
        let hit = false;
        const ring = poly[0];
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
        }
        return hit;
      });
      expect(inside, `${c.name} label point inside its boundary`).toBe(true);
    }
  });

  it('every country with contracts is in the country reference (no silent drops)', () => {
    const ref = new Set(model.countries.map((c) => c.name));
    for (const c of model.contracts) expect(ref.has(c.country), c.country).toBe(true);
  });

  it('zero workforce is distinguished from missing geographic coverage', () => {
    const modelIso = new Set(model.countries.map((c) => c.iso3));
    const uncovered = geo.features.filter((f) => !modelIso.has(f.properties.iso3));
    expect(uncovered.length).toBeGreaterThan(100); // countries without simulated coverage stay neutral
    // a covered country with no staff in the selected category is in the reference but has no point
    const pts = countryPoints(cube, parseYm('2026-10'), { country: null, category: 'HQ Staff' });
    expect(pts.map((p) => p.name)).toEqual([hq]);
  });
});
