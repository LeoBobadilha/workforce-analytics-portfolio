// Month × country × category headcount cube for the Global Workforce Explorer.
//
// Built once per model in a single pass over contracts. Each cell is the number of contracts
// active at that month-end (start ≤ D ≤ end), i.e. exactly the headcount semantics of
// `activeAt`. Contracts never overlap per employee (rule CTR-08), so a cell is a count of
// people, and the four categories are mutually exclusive. Timeline and filter changes then
// become array lookups instead of scans of the contract table.
import { CATEGORIES, type Category, type Model } from '../data/types';
import { monthEndDay, monthOfDay } from './dates';

const K = CATEGORIES.length;

export interface GeoCube {
  /** first / last month index covered (simulation start → data end) */
  m0: number;
  m1: number;
  countries: { name: string; iso3: string }[];
  /** counts[((mi - m0) * nCountries + ci) * 4 + k] */
  counts: Uint16Array;
}

const cubeCache = new WeakMap<Model, GeoCube>();

export function buildCube(m: Model): GeoCube {
  const hit = cubeCache.get(m);
  if (hit) return hit;
  const m0 = monthOfDay(m.simStartDay);
  const m1 = monthOfDay(m.dataEndDay);
  const countries = m.countries.map((c) => ({ name: c.name, iso3: c.iso3 }));
  const ci = new Map(countries.map((c, i) => [c.name, i]));
  const n = countries.length;
  const counts = new Uint16Array((m1 - m0 + 1) * n * K);
  for (const c of m.contracts) {
    const i = ci.get(c.country);
    if (i == null) throw new Error(`Contract ${c.contract_id}: country "${c.country}" is not in the country reference`);
    const k = CATEGORIES.indexOf(c.staff_category);
    // month-ends covered by [start, endN]
    let first = monthOfDay(c.start_date);
    let last = Math.min(m1, monthOfDay(Math.min(c.endN, monthEndDay(m1))));
    if (monthEndDay(last) > c.endN) last -= 1;
    first = Math.max(first, m0);
    for (let mi = first; mi <= last; mi++) counts[((mi - m0) * n + i) * K + k]++;
  }
  const cube = { m0, m1, countries, counts };
  cubeCache.set(m, cube);
  return cube;
}

/** Headcount for one country at one month-end (null when the month is outside the data). */
export function cell(cube: GeoCube, mi: number, country: number, category: Category | null): number | null {
  if (mi < cube.m0 || mi > cube.m1) return null;
  const base = ((mi - cube.m0) * cube.countries.length + country) * K;
  if (category) return cube.counts[base + CATEGORIES.indexOf(category)];
  let s = 0;
  for (let k = 0; k < K; k++) s += cube.counts[base + k];
  return s;
}

export function byCategory(cube: GeoCube, mi: number, country: number): Record<Category, number> {
  const base = ((mi - cube.m0) * cube.countries.length + country) * K;
  return Object.fromEntries(CATEGORIES.map((c, k) => [c, cube.counts[base + k]])) as Record<Category, number>;
}

export type ChangeStatus = 'growth' | 'reduction' | 'unchanged' | 'new' | 'no-baseline';

export interface CountryPoint {
  name: string;
  iso3: string;
  index: number;
  total: number;
  /** headcount at the same month-end one year earlier; null when that month precedes the data */
  prev: number | null;
  change: number | null;
  /** change ÷ prev, only when prev > 0 */
  pct: number | null;
  status: ChangeStatus;
  byCat: Record<Category, number>;
}

export function changeStatus(total: number, prev: number | null): ChangeStatus {
  if (prev == null) return 'no-baseline';
  if (prev === 0) return total > 0 ? 'new' : 'unchanged';
  return total > prev ? 'growth' : total < prev ? 'reduction' : 'unchanged';
}

/**
 * Countries at month `mi` under the global filters. A country filter restricts the result to that
 * country and a category filter to that category, as `activeAt` does. Countries with neither
 * current nor prior-year staff are omitted; countries whose staff fell to zero are kept.
 */
export function countryPoints(cube: GeoCube, mi: number, f: { country: string | null; category: Category | null }): CountryPoint[] {
  const out: CountryPoint[] = [];
  cube.countries.forEach((c, i) => {
    if (f.country && c.name !== f.country) return;
    const total = cell(cube, mi, i, f.category) ?? 0;
    const prev = cell(cube, mi - 12, i, f.category);
    if (total === 0 && !prev) return;
    const byCat = byCategory(cube, mi, i);
    if (f.category) for (const k of CATEGORIES) if (k !== f.category) byCat[k] = 0;
    out.push({
      name: c.name,
      iso3: c.iso3,
      index: i,
      total,
      prev,
      change: prev == null ? null : total - prev,
      pct: prev ? (total - prev) / prev : null,
      status: changeStatus(total, prev),
      byCat,
    });
  });
  return out;
}

/** Largest country headcount and largest absolute YoY change over a month range (fixed bubble scales). */
export function scaleMaxima(cube: GeoCube, from: number, to: number, f: { country: string | null; category: Category | null }) {
  let total = 0;
  let change = 0;
  for (let mi = Math.max(from, cube.m0); mi <= Math.min(to, cube.m1); mi++) {
    for (const p of countryPoints(cube, mi, f)) {
      total = Math.max(total, p.total);
      if (p.change != null) change = Math.max(change, Math.abs(p.change));
    }
  }
  return { total, change };
}

export interface MapSummary {
  total: number;
  prev: number | null;
  countries: number;
  /** countries of assignment excluding the HQ country, as in the Countries of Operation KPI */
  countriesOfOperation: number;
}

export function summarise(points: CountryPoint[], hqCountry: string): MapSummary {
  const withStaff = points.filter((p) => p.total > 0);
  const total = points.reduce((s, p) => s + p.total, 0);
  const prevKnown = points.every((p) => p.prev != null);
  return {
    total,
    prev: prevKnown ? points.reduce((s, p) => s + (p.prev ?? 0), 0) : null,
    countries: withStaff.length,
    countriesOfOperation: withStaff.filter((p) => p.name !== hqCountry).length,
  };
}

/** Bubble diameter in px: area proportional to value (diameter ∝ √value), with a small visibility floor. */
export const bubbleSize = (value: number, max: number, maxDiameter: number, floor = 5) =>
  value <= 0 || max <= 0 ? 0 : Math.max(floor, maxDiameter * Math.sqrt(value / max));
